/**
 * La Mappa porte sul DB del tenant (piano 2026-11-07): legge l'ingresso, scrive il risultato in una transazione, risponde alla
 * pagina. Scrive SOLO nelle sue tabelle `mappa_porte_*`. Va chiamata dentro `withTenant`.
 */
import type Database from "better-sqlite3";
import { getCurrentTenantCode, getNetworkDeviceKnownMacs, getTenantDb } from "@/lib/db-tenant";
import { getLinkStaleDays } from "@/lib/topology/settings";
import { parseProxmoxScan } from "@/lib/topology/vms";
import { isRunning } from "@/lib/topology/vm-nodes";
import { calcolaMappa, trovaSpostamenti } from "@/lib/mappa-porte/regola";
import { unisciStrati } from "@/lib/mappa-porte/completa";
import { dalloSnapshot, type DatiParser, type StratoPorta } from "@/lib/mappa-porte/parser";
import { leggiPayload } from "@/lib/acquisizione-modulare/archivio";
import type { ConteggiMappa, IngressoMappaPorte, OggettoMappa, PortaMappa, RigaArp, RigaMacApparato, RigaMacPorta, RigaMkPorta, RigaMkVlan, RigaVicino, RigaVm } from "@/lib/mappa-porte/tipi";

/** Gli spostamenti si conservano 90 giorni (Riccardo, 07/11). */
export const GIORNI_SPOSTAMENTI = 90;
/** ARP e rotte restano un anno anche se la fonte non li ha più. */
const GIORNI_REGISTRO = 365;

function dbTenant(): Database.Database {
  const code = getCurrentTenantCode();
  if (!code) throw new Error("Nessun contesto tenant");
  return getTenantDb(code);
}

const esiste = (d: Database.Database, tabella: string): boolean =>
  !!d.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(tabella);

/** Tutte le colonne sono elencate: `network_devices` tiene anche i segreti, qui non servono. */
export function leggiIngresso(nowMs: number = Date.now()): IngressoMappaPorte {
  const d = dbTenant();
  const tutte = <T>(sql: string): T[] => d.prepare(sql).all() as T[];
  const seCe = <T>(tabella: string, sql: string): T[] => (esiste(d, tabella) ? tutte<T>(sql) : []);
  const vm: RigaVm[] = [];
  const macDegliHypervisor: RigaMacApparato[] = [];
  const ipervisori = tutte<{ id: number; name: string }>("SELECT id, name FROM network_devices WHERE device_type = 'hypervisor'");
  const scansioni = tutte<{ id: number; raw: string }>("SELECT id, last_proxmox_scan_result AS raw FROM network_devices WHERE COALESCE(last_proxmox_scan_result, '') <> ''");
  for (const s of scansioni) {
    for (const v of parseProxmoxScan(s.id, s.raw).vms) {
      for (const mac of v.macs) vm.push({ mac, nome: v.name, acceso: isRunning(v.status), nodo: v.node, apparatoScansione: s.id });
    }
    // Le schede dei nodi del cluster: un hypervisor ha più MAC, e la scansione di un nodo descrive anche gli altri.
    for (const h of parseProxmoxScan(s.id, s.raw).hosts) {
      const nome = h.hostname.trim().toLowerCase().split(".")[0];
      const nodo = ipervisori.find((a) => a.name.trim().toLowerCase().split(".")[0] === nome)?.id ?? s.id;
      for (const mac of h.macs) macDegliHypervisor.push({ device_id: nodo, mac });
    }
  }
  const parser: DatiParser = { macPorte: [], arp: [], vicini: [], mkPorte: [], mkVlan: [], porte: [] };
  // L'ultimo snapshot buono di ogni apparato: uno scritto dal parser è la lettura più ricca che abbiamo.
  const ultimi = seCe<{ id: number; device_id: number; finished_at: string }>("acquisition_snapshots", `SELECT s.id, s.device_id, s.finished_at FROM acquisition_snapshots s
    JOIN (SELECT device_id, MAX(id) AS id FROM acquisition_snapshots WHERE status <> 'error' GROUP BY device_id) u ON u.id = s.id`);
  for (const u of ultimi) {
    const l = leggiPayload(u.device_id, u.id);
    if (!l.ok) continue;
    const dati = dalloSnapshot(u.device_id, l.snapshot, u.finished_at.slice(0, 19).replace("T", " "));
    for (const k of Object.keys(parser) as Array<keyof DatiParser>) (parser[k] as unknown[]).push(...dati[k]);
  }
  const strati = seCe<StratoPorta>("mappa_porte_fonti", "SELECT device_id, fonte, port_index, port_name, valori, letto_il FROM mappa_porte_fonti WHERE fonte <> 'giro'");
  return {
    nowMs, staleDays: getLinkStaleDays(),
    apparati: tutte("SELECT id, name, device_type, protocol FROM network_devices"),
    // LibreNMS solo per gli apparati che il giro non legge: dove c'è la nostra tabella, i suoi nomi di porta («0/5») e le sue voci
    // vecchie mettevano lo stesso MAC «nello stesso giro» su due switch. Misurato sull'hub il 07/11: da capire da 32 a 83.
    macPorte: [
      ...tutte<RigaMacPorta>("SELECT device_id, mac, port_name, vlan, timestamp, source FROM mac_port_entries"),
      ...(esiste(d, "librenms_mac_porta") ? tutte<RigaMacPorta>(`SELECT nd.id AS device_id, m.mac, p.if_name AS port_name, m.vlan_id AS vlan, COALESCE(m.visto_il, m.letto_il) AS timestamp, 'librenms' AS source
        FROM librenms_mac_porta m JOIN librenms_porta p ON p.librenms_device_id = m.librenms_device_id AND p.port_id = m.port_id
        JOIN librenms_apparato a ON a.librenms_device_id = m.librenms_device_id JOIN network_devices nd ON nd.host = a.ip WHERE COALESCE(p.if_name, '') <> ''
        AND nd.id NOT IN (SELECT device_id FROM mac_port_entries WHERE timestamp >= datetime('now', '-2 days'))`) : []),
      ...parser.macPorte,
    ],
    porte: unisciStrati(tutte("SELECT device_id, port_index, port_name, status, speed, vlan, poe_status, poe_power_mw, stp_state, is_uplink FROM switch_ports"), [...strati, ...parser.porte]),
    vicini: [...tutte<RigaVicino>("SELECT device_id, local_port, local_port_index, remote_device_name, remote_port, protocol, remote_mac, source FROM device_neighbors"), ...parser.vicini],
    fatti: seCe("topology_port_facts", "SELECT device_id, source, port_name, port_index, lag_group FROM topology_port_facts"),
    macApparati: seCe("topology_device_macs", "SELECT device_id, mac FROM topology_device_macs"),
    hosts: tutte("SELECT id, ip, mac, hostname, custom_name, vendor, classification, status FROM hosts"),
    macIp: tutte("SELECT mac_normalized, ip, hostname, vendor, last_seen FROM mac_ip_mapping"),
    macNote: [
      ...getNetworkDeviceKnownMacs(),
      ...tutte<RigaMacApparato>("SELECT nd.id AS device_id, i.mac FROM device_interfaces i JOIN network_devices nd ON nd.physical_device_id = i.physical_device_id WHERE COALESCE(i.mac, '') <> '' AND i.is_virtual_mac = 0"),
      ...macDegliHypervisor,
    ],
    // Dal registro, non da `arp_entries`: quella si riscrive a ogni giro e qui non si perde niente.
    arp: [...seCe<RigaArp>("mappa_porte_visti", "SELECT device_id, mac, NULLIF(ip, '') AS ip, interfaccia AS interface_name, ultimo AS timestamp, NULL AS status FROM mappa_porte_visti"),
      ...tutte<RigaArp>("SELECT device_id, mac, ip, interface_name, timestamp, status FROM arp_entries"), ...parser.arp],
    lnmsArp: esiste(d, "librenms_arp") ? tutte(`SELECT nd.id AS device_id, r.mac, r.ip, p.if_name, r.letto_il FROM librenms_arp r
      LEFT JOIN librenms_porta p ON p.librenms_device_id = r.librenms_device_id AND p.port_id = r.port_id
      LEFT JOIN librenms_apparato a ON a.librenms_device_id = r.librenms_device_id LEFT JOIN network_devices nd ON nd.host = a.ip`) : [],
    dhcp: tutte("SELECT source_device_id, source_name, ip_address, mac_address, hostname, scope_name, last_seen, last_synced FROM dhcp_leases"),
    mkVlanIf: seCe("mikrotik_vlan", "SELECT device_id, name, vlan_id FROM mikrotik_vlan"),
    vm,
    vlanPorte: seCe("switch_vlan_porte", "SELECT device_id, vlan_id, if_index, egress, untagged FROM switch_vlan_porte"),
    pvid: seCe("switch_porta_pvid", "SELECT device_id, if_index, pvid FROM switch_porta_pvid"),
    nativa: seCe("switch_vlan_nativa", "SELECT device_id, if_index, vlan_id FROM switch_vlan_nativa"),
    vlanLetture: seCe("switch_vlan_lettura", "SELECT device_id, ordine_bit FROM switch_vlan_lettura"),
    mkPorte: [...seCe<RigaMkPorta>("mikrotik_bridge_port", "SELECT device_id, interface, pvid FROM mikrotik_bridge_port"), ...parser.mkPorte],
    mkVlan: [...seCe<RigaMkVlan>("mikrotik_bridge_vlan", "SELECT device_id, vlan_ids, tagged, current_tagged FROM mikrotik_bridge_vlan"), ...parser.mkVlan],
  };
}

interface RigaOggetto {
  chiave: string; categoria: string; mac: string | null; ip: string | null; n_ip: number; nome: string | null; tipo: string | null; host_id: number | null;
  apparato_id: number | null; confidenza: string; device_id: number | null; apparato: string | null; porta_chiave: string | null; porta: string | null;
  tipo_porta: string | null; vlan: number | null; ramo: string | null; perche: string; fonti: string; prove: string; conflitto: number; dedotta: number;
  vecchio: number; senza_host: number; visto: string | null; macs: string; ips: string;
}
interface RigaPortaDb {
  device_id: number; chiave: string; apparato: string; ordine: number; nome: string; membri: string; stato: string | null; velocita: string | null; modo: string;
  pvid: number | null; vlan_tagged: string; dato_vlan: string; poe_stato: string | null; poe_mw: number | null; stp: string | null; tipo: string; vicino: string | null;
  n_mac: number; motivi: string;
}

const lista = <T>(s: string): T[] => {
  try {
    const v: unknown = JSON.parse(s);
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
};

const oggettoDa = (r: RigaOggetto): OggettoMappa => ({
  chiave: r.chiave, categoria: r.categoria as OggettoMappa["categoria"], mac: r.mac, ip: r.ip, nIp: r.n_ip, nome: r.nome, tipo: r.tipo, hostId: r.host_id, apparatoId: r.apparato_id,
  confidenza: r.confidenza as OggettoMappa["confidenza"], deviceId: r.device_id, apparato: r.apparato, portaChiave: r.porta_chiave, porta: r.porta,
  tipoPorta: r.tipo_porta as OggettoMappa["tipoPorta"], vlan: r.vlan, ramo: r.ramo, perche: r.perche, fonti: lista<string>(r.fonti), prove: lista(r.prove),
  conflitto: r.conflitto === 1, dedotta: r.dedotta === 1, vecchio: r.vecchio === 1, senzaHost: r.senza_host === 1, visto: r.visto, macs: lista<string>(r.macs), ips: lista<string>(r.ips),
});
const portaDa = (r: RigaPortaDb): PortaMappa => ({
  deviceId: r.device_id, chiave: r.chiave, apparato: r.apparato, ordine: r.ordine, nome: r.nome, membri: lista<string>(r.membri), stato: r.stato, velocita: r.velocita,
  modo: r.modo as PortaMappa["modo"], pvid: r.pvid, vlanTagged: lista<number>(r.vlan_tagged), datoVlan: r.dato_vlan as PortaMappa["datoVlan"], poeStato: r.poe_stato, poeMw: r.poe_mw,
  stp: r.stp, tipo: r.tipo as PortaMappa["tipo"], vicino: r.vicino, nMac: r.n_mac, motivi: lista(r.motivi),
});

export type EsitoCalcolo = { ok: true; conteggi: ConteggiMappa; spostamenti: number; ms: number } | { ok: false; motivo: string };

/**
 * Un calcolo intero. Se le tabelle dei MAC sono vuote e prima c'era una mappa non si scrive niente: un ingresso vuoto per un
 * guasto non deve diventare «non c'è più nessuno», e gli spostamenti non devono ripartire da zero.
 */
/** ARP e rotte si accumulano: una voce uscita dalla tabella del router resta con la sua data, e un giro vuoto non cancella. */
function aggiornaRegistri(d: Database.Database, il: string): void {
  const presente = (t: string) => !!d.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
  if (!presente("mappa_porte_visti") || !presente("mappa_porte_rotte")) return;
  d.transaction(() => {
    d.prepare(`INSERT INTO mappa_porte_visti (mac, ip, device_id, interfaccia, primo, ultimo)
      SELECT mac, COALESCE(ip, ''), device_id, MAX(interface_name), MIN(COALESCE(timestamp, ?)), MAX(COALESCE(timestamp, ?)) FROM arp_entries
       WHERE COALESCE(status, '') NOT IN ('failed', 'incomplete') GROUP BY mac, COALESCE(ip, ''), device_id
      ON CONFLICT(mac, ip, device_id) DO UPDATE SET interfaccia = COALESCE(excluded.interfaccia, interfaccia), ultimo = MAX(ultimo, excluded.ultimo)`).run(il, il);
    d.prepare(`INSERT INTO mappa_porte_rotte (device_id, destinazione, gateway, interfaccia, protocollo, metrica, distanza, attiva, primo, ultimo)
      SELECT device_id, destination, COALESCE(gateway, ''), interface_name, COALESCE(protocol, ''), metric, distance, active, ?, ? FROM routing_table WHERE TRUE
      ON CONFLICT(device_id, destinazione, gateway, protocollo) DO UPDATE SET interfaccia = excluded.interfaccia, metrica = excluded.metrica, distanza = excluded.distanza,
        attiva = excluded.attiva, ultimo = excluded.ultimo`).run(il, il);
    d.prepare("DELETE FROM mappa_porte_visti WHERE ultimo < datetime(?, ?)").run(il, `-${GIORNI_REGISTRO} days`);
    d.prepare("DELETE FROM mappa_porte_rotte WHERE ultimo < datetime(?, ?)").run(il, `-${GIORNI_REGISTRO} days`);
  })();
}

export function ricalcolaMappaPorte(nowMs: number = Date.now()): EsitoCalcolo {
  const inizio = Date.now();
  const d = dbTenant();
  aggiornaRegistri(d, new Date(nowMs).toISOString().slice(0, 19).replace("T", " "));
  const ingresso = leggiIngresso(nowMs);
  const giaScritti = (d.prepare("SELECT COUNT(*) AS n FROM mappa_porte_oggetti").get() as { n: number }).n;
  if (ingresso.macPorte.length === 0 && giaScritti > 0) return { ok: false, motivo: "tabelle dei MAC vuote: tengo l'ultimo calcolo" };
  const r = calcolaMappa(ingresso);
  const prima = (d.prepare("SELECT * FROM mappa_porte_oggetti").all() as RigaOggetto[]).map(oggettoDa);
  const spostati = trovaSpostamenti(prima, r.oggetti);
  const il = new Date(nowMs).toISOString().slice(0, 19).replace("T", " ");
  const insO = d.prepare(`INSERT INTO mappa_porte_oggetti (chiave, categoria, mac, ip, n_ip, nome, tipo, host_id, apparato_id, confidenza, device_id, apparato, porta_chiave, porta,
    tipo_porta, vlan, ramo, perche, fonti, prove, conflitto, dedotta, vecchio, senza_host, visto, macs, ips) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insP = d.prepare(`INSERT INTO mappa_porte_porte (device_id, chiave, apparato, ordine, nome, membri, stato, velocita, modo, pvid, vlan_tagged, dato_vlan, poe_stato, poe_mw, stp, tipo,
    vicino, n_mac, motivi) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insS = d.prepare("INSERT INTO mappa_porte_spostamenti (chiave, mac, nome, da_apparato, da_porta, a_apparato, a_porta, il) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  d.transaction(() => {
    d.prepare("DELETE FROM mappa_porte_oggetti").run();
    d.prepare("DELETE FROM mappa_porte_porte").run();
    for (const o of r.oggetti) {
      insO.run(o.chiave, o.categoria, o.mac, o.ip, o.nIp, o.nome, o.tipo, o.hostId, o.apparatoId, o.confidenza, o.deviceId, o.apparato, o.portaChiave, o.porta, o.tipoPorta, o.vlan, o.ramo, o.perche,
        JSON.stringify(o.fonti), JSON.stringify(o.prove), o.conflitto ? 1 : 0, o.dedotta ? 1 : 0, o.vecchio ? 1 : 0, o.senzaHost ? 1 : 0, o.visto, JSON.stringify(o.macs), JSON.stringify(o.ips));
    }
    for (const p of r.porte) {
      insP.run(p.deviceId, p.chiave, p.apparato, p.ordine, p.nome, JSON.stringify(p.membri), p.stato, p.velocita, p.modo, p.pvid, JSON.stringify(p.vlanTagged), p.datoVlan, p.poeStato, p.poeMw, p.stp, p.tipo,
        p.vicino, p.nMac, JSON.stringify(p.motivi));
    }
    for (const s of spostati) insS.run(s.chiave, s.mac, s.nome, s.daApparato, s.daPorta, s.aApparato, s.aPorta, il);
    d.prepare("DELETE FROM mappa_porte_spostamenti WHERE il < datetime(?, ?)").run(il, `-${GIORNI_SPOSTAMENTI} days`);
    d.prepare("INSERT INTO mappa_porte_calcolo (id, il, durata_ms, conteggi) VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET il = excluded.il, durata_ms = excluded.durata_ms, conteggi = excluded.conteggi")
      .run(il, Date.now() - inizio, JSON.stringify(r.conteggi));
  })();
  return { ok: true, conteggi: r.conteggi, spostamenti: spostati.length, ms: Date.now() - inizio };
}

export interface StatoCalcolo { il: string; conteggi: ConteggiMappa }

export function statoCalcolo(): StatoCalcolo | null {
  const r = dbTenant().prepare("SELECT il, conteggi FROM mappa_porte_calcolo WHERE id = 1").get() as { il: string; conteggi: string } | undefined;
  if (!r) return null;
  try {
    return { il: r.il, conteggi: JSON.parse(r.conteggi) as ConteggiMappa };
  } catch {
    return null;
  }
}

export const DIMENSIONE_PAGINA = 100;

/**
 * Ordinamento delle tabelle della Mappa porte (Riccardo, 08/11: «le colonne sono fisse e non è possibile ordinarle come in tutti
 * gli altri moduli»). Dal server, perché le tabelle sono paginate: ordinare solo la pagina visibile darebbe un ordine falso.
 * Ogni colonna è una lista chiusa di espressioni SQL (mai testo dalla richiesta); una colonna sconosciuta vale l'ordine di sempre.
 */
export type Verso = "asc" | "desc";
export interface Ordine { colonna?: string; verso?: Verso }

/** IPv4 in testo → numero, per ordinare 10.0.0.9 prima di 10.0.0.10. Un valore che non è un IPv4 dà un numero senza senso, ma resta in fondo coi NULL. */
export function ipSql(col: string): string {
  const r1 = `substr(${col}, instr(${col}, '.') + 1)`;
  const r2 = `substr(${r1}, instr(${r1}, '.') + 1)`;
  const r3 = `substr(${r2}, instr(${r2}, '.') + 1)`;
  const pezzo = (s: string) => `CAST(substr(${s}, 1, instr(${s}, '.') - 1) AS INTEGER)`;
  return `(CASE WHEN ${col} GLOB '[0-9]*.[0-9]*.[0-9]*.[0-9]*' THEN ${pezzo(col)} * 16777216 + ${pezzo(r1)} * 65536 + ${pezzo(r2)} * 256 + CAST(${r3} AS INTEGER) END)`;
}

/** ORDER BY dalla lista chiusa: ogni pezzo col verso scelto e i NULL in fondo, poi le chiavi che rendono l'ordine stabile. */
export function ordinePer(colonne: Readonly<Record<string, readonly string[]>>, o: Ordine | undefined, base: readonly string[], spareggio: readonly string[]): string {
  const scelta = o?.colonna ? colonne[o.colonna] : undefined;
  const verso = o?.verso === "desc" ? "DESC" : "ASC";
  const pezzi = scelta ? scelta.map((e) => `${e} ${verso} NULLS LAST`) : [...base];
  return [...pezzi, ...spareggio].join(", ");
}

const ORDINE_OGGETTI: Record<string, readonly string[]> = {
  nome: ["o.nome COLLATE NOCASE"], mac: ["o.mac"], ip: [ipSql("o.ip")], dove: ["o.apparato COLLATE NOCASE", "o.porta COLLATE NOCASE"], vlan: ["o.vlan"],
  confidenza: ["CASE o.confidenza WHEN 'certa' THEN 0 WHEN 'spiegata' THEN 1 WHEN 'da_capire' THEN 2 ELSE 3 END"], visto: ["o.visto"],
};
const ORDINE_PORTE: Record<string, readonly string[]> = {
  apparato: ["apparato COLLATE NOCASE", "ordine"], porta: ["ordine", "nome COLLATE NOCASE"], stato: ["stato"], tipo: ["tipo"], modo: ["modo"], pvid: ["pvid"],
  velocita: ["CAST(velocita AS INTEGER)"], poe: ["poe_mw"], vicino: ["vicino COLLATE NOCASE"], mac: ["n_mac"],
};
const ORDINE_ROTTE: Record<string, readonly string[]> = {
  apparato: ["nd.name COLLATE NOCASE"], destinazione: [ipSql("substr(r.destinazione, 1, instr(r.destinazione || '/', '/') - 1)"), "r.destinazione"],
  gateway: [ipSql("NULLIF(r.gateway, '')")], interfaccia: ["r.interfaccia COLLATE NOCASE"], protocollo: ["NULLIF(r.protocollo, '')"], metrica: ["r.metrica"],
  stato: ["r.attiva"],
};


export interface FiltriOggetti {
  q?: string; deviceId?: number; vlan?: number; confidenza?: string; tipoPorta?: string; senzaHost?: boolean; spostati?: boolean; recenti?: boolean; pagina: number; ordine?: Ordine;
}
const simile = (s: string) => `%${s.replace(/[\\%_]/g, "\\$&")}%`;

export function cercaOggetti(f: FiltriOggetti): { righe: OggettoMappa[]; totale: number } {
  const d = dbTenant();
  const dove: string[] = [];
  const val: Array<string | number> = [];
  if (f.recenti) dove.push("o.vecchio = 0");
  if (f.q) {
    dove.push("(o.nome LIKE ? ESCAPE '\\' OR o.macs LIKE ? ESCAPE '\\' OR o.ips LIKE ? ESCAPE '\\' OR o.apparato LIKE ? ESCAPE '\\' OR o.porta LIKE ? ESCAPE '\\' OR o.ramo LIKE ? ESCAPE '\\')");
    val.push(...Array<string>(6).fill(simile(f.q)));
  }
  if (f.deviceId != null) { dove.push("o.device_id = ?"); val.push(f.deviceId); }
  if (f.vlan != null) { dove.push("o.vlan = ?"); val.push(f.vlan); }
  if (f.confidenza) { dove.push("o.confidenza = ?"); val.push(f.confidenza); }
  if (f.tipoPorta) { dove.push("o.tipo_porta = ?"); val.push(f.tipoPorta); }
  if (f.senzaHost) dove.push("o.senza_host = 1");
  if (f.spostati) dove.push("EXISTS (SELECT 1 FROM mappa_porte_spostamenti s WHERE s.chiave = o.chiave AND s.il >= datetime('now', '-7 days'))");
  const w = dove.length > 0 ? `WHERE ${dove.join(" AND ")}` : "";
  const totale = (d.prepare(`SELECT COUNT(*) AS n FROM mappa_porte_oggetti o ${w}`).get(...val) as { n: number }).n;
  const righe = d.prepare(`SELECT o.* FROM mappa_porte_oggetti o ${w} ORDER BY ${ordinePer(ORDINE_OGGETTI, f.ordine, ["COALESCE(o.nome, '~') COLLATE NOCASE"], ["o.chiave"])} LIMIT ? OFFSET ?`)
    .all(...val, DIMENSIONE_PAGINA, f.pagina * DIMENSIONE_PAGINA) as RigaOggetto[];
  return { righe: righe.map(oggettoDa), totale };
}

export interface FiltriPorte { q?: string; deviceId?: number; tipo?: string; modo?: string; libere?: boolean; pagina: number; ordine?: Ordine }

export function cercaPorte(f: FiltriPorte): { righe: PortaMappa[]; totale: number } {
  const d = dbTenant();
  const dove: string[] = [];
  const val: Array<string | number> = [];
  if (f.q) {
    dove.push("(nome LIKE ? ESCAPE '\\' OR apparato LIKE ? ESCAPE '\\' OR vicino LIKE ? ESCAPE '\\')");
    val.push(...Array<string>(3).fill(simile(f.q)));
  }
  if (f.deviceId != null) { dove.push("device_id = ?"); val.push(f.deviceId); }
  if (f.tipo) { dove.push("tipo = ?"); val.push(f.tipo); }
  if (f.modo) { dove.push("modo = ?"); val.push(f.modo); }
  if (f.libere) dove.push("n_mac = 0 AND COALESCE(stato, '') <> 'up'");
  const w = dove.length > 0 ? `WHERE ${dove.join(" AND ")}` : "";
  const totale = (d.prepare(`SELECT COUNT(*) AS n FROM mappa_porte_porte ${w}`).get(...val) as { n: number }).n;
  const righe = d.prepare(`SELECT * FROM mappa_porte_porte ${w} ORDER BY ${ordinePer(ORDINE_PORTE, f.ordine, ["apparato COLLATE NOCASE", "ordine"], ["device_id", "chiave"])} LIMIT ? OFFSET ?`)
    .all(...val, DIMENSIONE_PAGINA, f.pagina * DIMENSIONE_PAGINA) as RigaPortaDb[];
  return { righe: righe.map(portaDa), totale };
}

export function apparatiDellaMappa(): Array<{ id: number; nome: string }> {
  return (dbTenant().prepare("SELECT DISTINCT device_id AS id, apparato AS nome FROM mappa_porte_porte ORDER BY apparato COLLATE NOCASE").all() as Array<{ id: number; nome: string }>);
}

export function vlanDellaMappa(): number[] {
  return (dbTenant().prepare("SELECT DISTINCT vlan FROM mappa_porte_oggetti WHERE vlan IS NOT NULL ORDER BY vlan").all() as Array<{ vlan: number }>).map((r) => r.vlan);
}

export interface VoceRotta {
  deviceId: number; apparato: string; destinazione: string; gateway: string; interfaccia: string | null; protocollo: string; metrica: number | null; distanza: number | null;
  attiva: boolean; presente: boolean; ultimo: string;
}

/** Le rotte di tutti i router, comprese quelle che non si vedono più: `presente` dice se sono nell'ultimo giro dell'apparato. */
export function cercaRotte(f: { q?: string; deviceId?: number; pagina: number; ordine?: Ordine }): { righe: VoceRotta[]; totale: number } {
  const d = dbTenant();
  if (!esiste(d, "mappa_porte_rotte")) return { righe: [], totale: 0 };
  const dove: string[] = [];
  const val: Array<string | number> = [];
  if (f.q) { dove.push("(r.destinazione LIKE ? ESCAPE '\\' OR r.gateway LIKE ? ESCAPE '\\' OR r.interfaccia LIKE ? ESCAPE '\\')"); val.push(...Array<string>(3).fill(simile(f.q))); }
  if (f.deviceId != null) { dove.push("r.device_id = ?"); val.push(f.deviceId); }
  const w = dove.length > 0 ? `WHERE ${dove.join(" AND ")}` : "";
  const totale = (d.prepare(`SELECT COUNT(*) AS n FROM mappa_porte_rotte r ${w}`).get(...val) as { n: number }).n;
  const righe = d.prepare(`SELECT r.device_id AS deviceId, nd.name AS apparato, r.destinazione, r.gateway, r.interfaccia, r.protocollo, r.metrica, r.distanza, r.attiva, r.ultimo,
      r.ultimo = (SELECT MAX(x.ultimo) FROM mappa_porte_rotte x WHERE x.device_id = r.device_id) AS presente
    FROM mappa_porte_rotte r JOIN network_devices nd ON nd.id = r.device_id ${w} ORDER BY ${ordinePer(ORDINE_ROTTE, f.ordine, ["nd.name COLLATE NOCASE", "r.destinazione"], ["r.device_id", "r.destinazione", "r.gateway", "r.protocollo"])} LIMIT ? OFFSET ?`)
    .all(...val, DIMENSIONE_PAGINA, f.pagina * DIMENSIONE_PAGINA) as Array<Omit<VoceRotta, "attiva" | "presente"> & { attiva: number; presente: number }>;
  return { righe: righe.map((r) => ({ ...r, attiva: r.attiva === 1, presente: r.presente === 1 })), totale };
}

export interface VoceSpostamento { daApparato: string; daPorta: string; aApparato: string; aPorta: string; il: string }

export function dettaglioOggetto(chiave: string): { oggetto: OggettoMappa; spostamenti: VoceSpostamento[] } | null {
  const d = dbTenant();
  const r = d.prepare("SELECT * FROM mappa_porte_oggetti WHERE chiave = ?").get(chiave) as RigaOggetto | undefined;
  if (!r) return null;
  const spostamenti = d.prepare(`SELECT da_apparato AS daApparato, da_porta AS daPorta, a_apparato AS aApparato, a_porta AS aPorta, il
    FROM mappa_porte_spostamenti WHERE chiave = ? ORDER BY il DESC LIMIT 20`).all(chiave) as VoceSpostamento[];
  return { oggetto: oggettoDa(r), spostamenti };
}
