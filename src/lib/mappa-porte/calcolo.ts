/**
 * La Mappa porte sul DB del tenant (piano 2026-11-07): legge l'ingresso, scrive il risultato in una transazione, risponde alla
 * pagina. Scrive SOLO nelle sue tabelle `mappa_porte_*`. Va chiamata dentro `withTenant`.
 */
import type Database from "better-sqlite3";
import { getCurrentTenantCode, getTenantDb } from "@/lib/db-tenant";
import { getLinkStaleDays } from "@/lib/topology/settings";
import { parseProxmoxScan } from "@/lib/topology/vms";
import { isRunning } from "@/lib/topology/vm-nodes";
import { calcolaMappa, trovaSpostamenti } from "@/lib/mappa-porte/regola";
import type { ConteggiMappa, IngressoMappaPorte, OggettoMappa, PortaMappa, RigaVm } from "@/lib/mappa-porte/tipi";

/** Gli spostamenti si conservano 90 giorni (Riccardo, 07/11). */
export const GIORNI_SPOSTAMENTI = 90;

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
  const scansioni = tutte<{ id: number; raw: string }>("SELECT id, last_proxmox_scan_result AS raw FROM network_devices WHERE COALESCE(last_proxmox_scan_result, '') <> ''");
  for (const s of scansioni) {
    for (const v of parseProxmoxScan(s.id, s.raw).vms) {
      for (const mac of v.macs) vm.push({ mac, nome: v.name, acceso: isRunning(v.status), nodo: v.node, apparatoScansione: s.id });
    }
  }
  return {
    nowMs, staleDays: getLinkStaleDays(),
    apparati: tutte("SELECT id, name, device_type, protocol FROM network_devices"),
    macPorte: tutte("SELECT device_id, mac, port_name, vlan, timestamp, source FROM mac_port_entries"),
    porte: tutte("SELECT device_id, port_index, port_name, status, speed, vlan, poe_status, poe_power_mw, stp_state, is_uplink FROM switch_ports"),
    vicini: tutte("SELECT device_id, local_port, local_port_index, remote_device_name, remote_port, protocol, remote_mac, source FROM device_neighbors"),
    fatti: seCe("topology_port_facts", "SELECT device_id, source, port_name, port_index, lag_group FROM topology_port_facts"),
    macApparati: seCe("topology_device_macs", "SELECT device_id, mac FROM topology_device_macs"),
    hosts: tutte("SELECT id, ip, mac, hostname, custom_name, vendor, classification, status FROM hosts"),
    macIp: tutte("SELECT mac_normalized, ip, hostname, vendor FROM mac_ip_mapping"),
    vm,
    vlanPorte: seCe("switch_vlan_porte", "SELECT device_id, vlan_id, if_index, egress, untagged FROM switch_vlan_porte"),
    pvid: seCe("switch_porta_pvid", "SELECT device_id, if_index, pvid FROM switch_porta_pvid"),
    nativa: seCe("switch_vlan_nativa", "SELECT device_id, if_index, vlan_id FROM switch_vlan_nativa"),
    vlanLetture: seCe("switch_vlan_lettura", "SELECT device_id, ordine_bit FROM switch_vlan_lettura"),
    mkPorte: seCe("mikrotik_bridge_port", "SELECT device_id, interface, pvid FROM mikrotik_bridge_port"),
    mkVlan: seCe("mikrotik_bridge_vlan", "SELECT device_id, vlan_ids, tagged, current_tagged FROM mikrotik_bridge_vlan"),
  };
}

interface RigaOggetto {
  chiave: string; categoria: string; mac: string | null; ip: string | null; n_ip: number; nome: string | null; tipo: string | null; host_id: number | null;
  apparato_id: number | null; confidenza: string; device_id: number | null; apparato: string | null; porta_chiave: string | null; porta: string | null;
  tipo_porta: string | null; vlan: number | null; ramo: string | null; perche: string; fonti: string; prove: string; conflitto: number; dedotta: number;
  vecchio: number; senza_host: number; visto: string | null;
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
  conflitto: r.conflitto === 1, dedotta: r.dedotta === 1, vecchio: r.vecchio === 1, senzaHost: r.senza_host === 1, visto: r.visto,
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
export function ricalcolaMappaPorte(nowMs: number = Date.now()): EsitoCalcolo {
  const inizio = Date.now();
  const d = dbTenant();
  const ingresso = leggiIngresso(nowMs);
  const giaScritti = (d.prepare("SELECT COUNT(*) AS n FROM mappa_porte_oggetti").get() as { n: number }).n;
  if (ingresso.macPorte.length === 0 && giaScritti > 0) return { ok: false, motivo: "tabelle dei MAC vuote: tengo l'ultimo calcolo" };
  const r = calcolaMappa(ingresso);
  const prima = (d.prepare("SELECT * FROM mappa_porte_oggetti").all() as RigaOggetto[]).map(oggettoDa);
  const spostati = trovaSpostamenti(prima, r.oggetti);
  const il = new Date(nowMs).toISOString().slice(0, 19).replace("T", " ");
  const insO = d.prepare(`INSERT INTO mappa_porte_oggetti (chiave, categoria, mac, ip, n_ip, nome, tipo, host_id, apparato_id, confidenza, device_id, apparato, porta_chiave, porta,
    tipo_porta, vlan, ramo, perche, fonti, prove, conflitto, dedotta, vecchio, senza_host, visto) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insP = d.prepare(`INSERT INTO mappa_porte_porte (device_id, chiave, apparato, ordine, nome, membri, stato, velocita, modo, pvid, vlan_tagged, dato_vlan, poe_stato, poe_mw, stp, tipo,
    vicino, n_mac, motivi) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insS = d.prepare("INSERT INTO mappa_porte_spostamenti (chiave, mac, nome, da_apparato, da_porta, a_apparato, a_porta, il) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  d.transaction(() => {
    d.prepare("DELETE FROM mappa_porte_oggetti").run();
    d.prepare("DELETE FROM mappa_porte_porte").run();
    for (const o of r.oggetti) {
      insO.run(o.chiave, o.categoria, o.mac, o.ip, o.nIp, o.nome, o.tipo, o.hostId, o.apparatoId, o.confidenza, o.deviceId, o.apparato, o.portaChiave, o.porta, o.tipoPorta, o.vlan, o.ramo, o.perche,
        JSON.stringify(o.fonti), JSON.stringify(o.prove), o.conflitto ? 1 : 0, o.dedotta ? 1 : 0, o.vecchio ? 1 : 0, o.senzaHost ? 1 : 0, o.visto);
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

export interface FiltriOggetti {
  q?: string; deviceId?: number; vlan?: number; confidenza?: string; tipoPorta?: string; senzaHost?: boolean; spostati?: boolean; vecchi?: boolean; pagina: number;
}
const simile = (s: string) => `%${s.replace(/[\\%_]/g, "\\$&")}%`;

export function cercaOggetti(f: FiltriOggetti): { righe: OggettoMappa[]; totale: number } {
  const d = dbTenant();
  const dove: string[] = [];
  const val: Array<string | number> = [];
  if (!f.vecchi) dove.push("o.vecchio = 0");
  if (f.q) {
    dove.push("(o.nome LIKE ? ESCAPE '\\' OR o.mac LIKE ? ESCAPE '\\' OR o.ip LIKE ? ESCAPE '\\' OR o.apparato LIKE ? ESCAPE '\\' OR o.porta LIKE ? ESCAPE '\\' OR o.ramo LIKE ? ESCAPE '\\')");
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
  const righe = d.prepare(`SELECT o.* FROM mappa_porte_oggetti o ${w} ORDER BY o.categoria = 'apparato', COALESCE(o.nome, '~') COLLATE NOCASE, o.chiave LIMIT ? OFFSET ?`)
    .all(...val, DIMENSIONE_PAGINA, f.pagina * DIMENSIONE_PAGINA) as RigaOggetto[];
  return { righe: righe.map(oggettoDa), totale };
}

export interface FiltriPorte { q?: string; deviceId?: number; tipo?: string; modo?: string; libere?: boolean; pagina: number }

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
  const righe = d.prepare(`SELECT * FROM mappa_porte_porte ${w} ORDER BY apparato COLLATE NOCASE, ordine, chiave LIMIT ? OFFSET ?`)
    .all(...val, DIMENSIONE_PAGINA, f.pagina * DIMENSIONE_PAGINA) as RigaPortaDb[];
  return { righe: righe.map(portaDa), totale };
}

export function apparatiDellaMappa(): Array<{ id: number; nome: string }> {
  return (dbTenant().prepare("SELECT DISTINCT device_id AS id, apparato AS nome FROM mappa_porte_porte ORDER BY apparato COLLATE NOCASE").all() as Array<{ id: number; nome: string }>);
}

export function vlanDellaMappa(): number[] {
  return (dbTenant().prepare("SELECT DISTINCT vlan FROM mappa_porte_oggetti WHERE vlan IS NOT NULL ORDER BY vlan").all() as Array<{ vlan: number }>).map((r) => r.vlan);
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
