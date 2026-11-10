/**
 * Cosa gli apparati dicono di sé sul trunk (10/11/2026, Riccardo: «nel trunk arrivano tante
 * informazioni passive… non so cosa si può estrarre in più»).
 *
 * Dalla sonda 0.8.292 il sensore tiene, per MAC, cosa un apparato dichiara in SSDP (prodotto, tipo,
 * programma di chi cerca), mDNS (servizi, modello) e DHCP (classe del produttore, nome completo) e
 * lo espone in `GET /dichiarazioni`. Qui si leggono, si agganciano agli host per MAC e diventano
 * prove di riconoscimento con le stesse regole delle sonde attive (`evidenceFromMdns`,
 * `evidenceFromSsdp`): niente regole nuove per le stesse cose. Sono dati, non rilievi.
 * Modello e nome si riempiono solo dove mancano, come per gli annunci (`apparati-dal-trunk.ts`).
 */
import type Database from "better-sqlite3";
import { getCurrentTenantCode, getTenantDb, getTenantSetting, setTenantSetting } from "@/lib/db-tenant";
import { recordEvidence } from "@/lib/attribution/evidence";
import { evidenceFromMdns, evidenceFromSsdp } from "@/lib/attribution/probe-evidence";
import { recomputeAttributionForDb } from "@/lib/attribution/recompute";
import type { EvidenceInput } from "@/lib/attribution/types";
import { normalizeMacForStorage } from "@/lib/utils";

export interface Dichiarazione {
  mac: string;
  chiave: string;
  valore: string;
  vid: number;
  ultima_vista: string;
}

export const CHIAVE_CURSORE = "trunk_dichiarazioni_dopo";
/** Segno della pulizia fatta una volta (vedi `pulisciMdnsRipetuto`). */
export const CHIAVE_PULIZIA = "trunk_dichiarazioni_pulizia";
const VERSIONE_PULIZIA = "1";
const CHIAVI = new Set([
  "ssdp_server", "ssdp_tipo", "ssdp_agente", "mdns_servizio", "mdns_modello", "dhcp_classe", "dhcp_fqdn",
  // Sonda 0.8.294: annunci di Windows, DHCPv6, WS-Discovery, spanning tree, router IPv6.
  "nbt_dominio", "nbt_os", "nbt_ruolo", "nbt_commento", "dhcp6_fqdn", "dhcp6_classe", "wsd_tipo",
  "stp_radice", "stp_ponte", "stp_costo", "ra_prefisso",
]);
const TETTO_TESTO = 160;

function db(): Database.Database {
  return getTenantDb(getCurrentTenantCode() ?? "DEFAULT");
}

/** Salva le dichiarazioni lette e le aggancia all'host con quel MAC, se è uno solo. Ritorna gli host toccati. */
export function salvaDichiarazioni(righe: Dichiarazione[]): number[] {
  const d = db();
  const hostDi = d.prepare("SELECT id FROM hosts WHERE mac = ?");
  const ins = d.prepare(`
    INSERT INTO trunk_dichiarazioni (mac, chiave, valore, vid, host_id, ultima_vista) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(mac, chiave, valore) DO UPDATE SET vid = excluded.vid, host_id = excluded.host_id, ultima_vista = excluded.ultima_vista
  `);
  const toccati = new Set<number>();
  d.transaction(() => {
    for (const r of righe) {
      if (!r || typeof r.mac !== "string" || typeof r.valore !== "string" || !CHIAVI.has(r.chiave)) continue;
      const mac = normalizeMacForStorage(r.mac);
      if (!mac) continue;
      const trovati = hostDi.all(mac) as Array<{ id: number }>;
      const hostId = trovati.length === 1 ? trovati[0].id : null;
      ins.run(mac, r.chiave, r.valore.slice(0, TETTO_TESTO), Number.isInteger(r.vid) ? r.vid : 0, hostId, r.ultima_vista ?? new Date().toISOString());
      if (hostId != null) toccati.add(hostId);
    }
  })();
  return [...toccati];
}

/** Il sistema operativo che una stringa di programma o di classe DHCP lascia capire; null se non si sa. */
export function sistemaDa(testo: string): string | null {
  const t = testo.toLowerCase();
  if (/\bmsft\b|windows/.test(t)) return "windows";
  if (/mac os|macos|os x|darwin/.test(t)) return "macos";
  if (/android/.test(t)) return "android";
  if (/\biphone|\bipad|\bios\b/.test(t)) return "ios";
  if (/udhcp|dhcpcd|linux|ubuntu|debian|busybox/.test(t)) return "linux";
  return null;
}

/** Le prove di un host dalle sue dichiarazioni. Funzione pura: la usano il salvataggio e le prove. */
export function proveDaDichiarazioni(righe: ReadonlyArray<Pick<Dichiarazione, "chiave" | "valore">>): EvidenceInput[] {
  const di = (chiave: string) => righe.filter((r) => r.chiave === chiave).map((r) => r.valore);
  const out: EvidenceInput[] = [];

  // Un computer che offre AirPlay non è uno schermo (hub, 10/11/2026: un MacBook risultava
  // «display»). Chi offre anche SSH, condivisione file o controllo remoto, o cerca in SSDP con un
  // browser, è un computer: per lui AirPlay non dice il mestiere.
  const tutti = di("mdns_servizio");
  const eComputer = di("ssdp_agente").length > 0
    || tutti.some((x) => /^_(ssh|sftp-ssh|smb|afpovertcp|rfb|companion-link|workstation|adisk)\._tcp/.test(x));
  const servizi = eComputer ? tutti.filter((x) => !/^_(airplay|raop)\._tcp/.test(x)) : tutti;
  const modelli = di("mdns_modello");
  if (servizi.length > 0 || modelli.length > 0) {
    out.push(...evidenceFromMdns({
      // Il sensore toglie «.local»: le regole delle sonde attive lo aspettano.
      services: servizi.map((s) => (s.endsWith(".local") ? s : `${s}.local`)),
      model: modelli[0] ?? null,
      usbMfg: null,
      usbMdl: null,
      hapCategory: null,
    }));
  }

  const server = di("ssdp_server");
  const tipi = di("ssdp_tipo");
  for (const s of server.length > 0 ? server : [null]) {
    for (const t of tipi.length > 0 ? tipi : [null]) {
      if (!s && !t) continue;
      // «device:MediaRenderer» com'è scritto negli annunci UPnP: le regole lo leggono così.
      const tipo = t ? `urn:schemas-upnp-org:${t}:1` : null;
      out.push(...evidenceFromSsdp({ st: tipo, server: s, location: null, manufacturer: null, modelName: null, deviceType: tipo }));
    }
  }

  // Il sistema operativo da chi cerca in SSDP e dalla classe DHCP: prova debole, non autoritativa.
  for (const [chiave, fonte, confidenza] of [["ssdp_agente", "ssdp", 0.6], ["dhcp_classe", "dhcp", 0.6]] as const) {
    for (const v of di(chiave)) {
      const os = sistemaDa(v);
      if (os) out.push({ source: fonte, phase: "scan_naabu", dimension: "os", claim: os, confidence: confidenza, raw_value: v.slice(0, 200) });
    }
  }

  // Annuncio del «browser» di Windows: chi lo manda è Windows (o lo imita, come Samba: prova
  // debole), e il ruolo dichiarato dice se è un server o una postazione.
  const ruoli = di("nbt_ruolo").flatMap((v) => v.split(","));
  if (di("nbt_os").length > 0) {
    out.push({ source: "netbios", phase: "scan_naabu", dimension: "os", claim: "windows", confidence: 0.6, raw_value: `annuncio NetBIOS, versione ${di("nbt_os")[0]}` });
  }
  if (ruoli.some((r) => r === "dc" || r === "sql" || r === "server")) {
    out.push({ source: "netbios", phase: "scan_naabu", dimension: "category", claim: "compute.server", confidence: 0.7, raw_value: `ruolo ${ruoli.join(",")}` });
  } else if (ruoli.includes("workstation")) {
    out.push({ source: "netbios", phase: "scan_naabu", dimension: "category", claim: "compute.workstation", confidence: 0.6, raw_value: "ruolo workstation" });
  }
  // WS-Discovery: solo i tipi che dicono il mestiere con certezza, come nelle sonde attive.
  const wsd = di("wsd_tipo");
  if (wsd.some((t) => /^Print(DeviceType|er)/i.test(t))) {
    out.push({ source: "wsd", phase: "scan_naabu", dimension: "category", claim: "peripheral.printer", confidence: 0.9, raw_value: wsd.join(" ") });
  } else if (wsd.includes("NetworkVideoTransmitter")) {
    out.push({ source: "wsd", phase: "scan_naabu", dimension: "category", claim: "av.camera", confidence: 0.95, raw_value: wsd.join(" ") });
  }
  // «CPQRIB3» è la classe DHCPv6 delle schede di gestione HP iLO.
  if (di("dhcp6_classe").some((v) => /^CPQRIB/i.test(v))) {
    out.push({ source: "dhcp", phase: "scan_naabu", dimension: "vendor", claim: "hpe", confidence: 0.8, raw_value: di("dhcp6_classe")[0] });
  }

  // Una prova per fonte, dimensione e valore: la più forte.
  const migliori = new Map<string, EvidenceInput>();
  for (const e of out) {
    const k = `${e.source}|${e.dimension}|${e.claim}`;
    const prima = migliori.get(k);
    if (!prima || e.confidence > prima.confidence) migliori.set(k, e);
  }
  return [...migliori.values()];
}

export interface EsitoDichiarazioni {
  host: number;
  prove: number;
  campi: number;
}

/** Trasforma in prove le dichiarazioni degli host dati; riempie modello e nome solo dove mancano. */
export function portaDichiarazioniSugliHost(hostIds: readonly number[]): EsitoDichiarazioni {
  const d = db();
  const esito: EsitoDichiarazioni = { host: 0, prove: 0, campi: 0 };
  const leggi = d.prepare("SELECT chiave, valore FROM trunk_dichiarazioni WHERE host_id = ? ORDER BY ultima_vista DESC");
  const riempiModello = d.prepare("UPDATE hosts SET model = ?, updated_at = datetime('now') WHERE id = ? AND (model IS NULL OR TRIM(model) = '')");
  const riempiNome = d.prepare("UPDATE hosts SET hostname = ?, updated_at = datetime('now') WHERE id = ? AND (hostname IS NULL OR TRIM(hostname) = '')");
  for (const hostId of hostIds) {
    const righe = leggi.all(hostId) as Array<{ chiave: string; valore: string }>;
    if (righe.length === 0) continue;
    esito.host += 1;
    const modello = righe.find((r) => r.chiave === "mdns_modello")?.valore;
    if (modello && riempiModello.run(modello.slice(0, 120), hostId).changes > 0) esito.campi += 1;
    const nome = righe.find((r) => r.chiave === "dhcp_fqdn" || r.chiave === "dhcp6_fqdn")?.valore;
    if (nome && riempiNome.run(nome.slice(0, 120), hostId).changes > 0) esito.campi += 1;
    const prove = proveDaDichiarazioni(righe);
    if (prove.length === 0) continue;
    try {
      const r = recordEvidence(d, hostId, prove);
      esito.prove += prove.length;
      // Si ricalcola solo se è cambiato qualcosa: il giro passa ogni due minuti.
      if (r.inserted > 0 || r.superseded > 0) recomputeAttributionForDb(d, hostId, "scan");
    } catch (e) {
      console.error(`[trunk] host ${hostId}: prove dalle dichiarazioni non salvate:`, e);
    }
  }
  return esito;
}

/**
 * Una volta sola (10/11/2026): la sonda 0.8.292 attribuiva al gateway gli annunci mDNS che ripeteva
 * fra le VLAN, e DA-IPAM li ha letti per mezz'ora. Si tolgono le dichiarazioni mDNS raccolte e le
 * prove `mdns` degli host che le avevano, si ricalcola il loro riconoscimento e si rilegge dal
 * sensore da capo: le dichiarazioni buone tornano al giro dopo (sonda 0.8.293), le prove delle
 * sonde attive alla prossima scansione. Ritorna gli host ricalcolati.
 */
export function pulisciMdnsRipetuto(): number {
  if (getTenantSetting(CHIAVE_PULIZIA) === VERSIONE_PULIZIA) return 0;
  const d = db();
  const host = (d.prepare("SELECT DISTINCT host_id AS id FROM trunk_dichiarazioni WHERE chiave LIKE 'mdns\\_%' ESCAPE '\\' AND host_id IS NOT NULL").all() as Array<{ id: number }>).map((r) => r.id);
  d.transaction(() => {
    d.prepare("DELETE FROM trunk_dichiarazioni WHERE chiave LIKE 'mdns\\_%' ESCAPE '\\'").run();
    const togli = d.prepare("DELETE FROM attribution_evidence WHERE host_id = ? AND source = 'mdns'");
    for (const id of host) togli.run(id);
  })();
  for (const id of host) {
    try {
      recomputeAttributionForDb(d, id, "scan");
    } catch (e) {
      console.error(`[trunk] host ${id}: riconoscimento non ricalcolato dopo la pulizia mDNS:`, e);
    }
  }
  setTenantSetting(CHIAVE_CURSORE, "");
  setTenantSetting(CHIAVE_PULIZIA, VERSIONE_PULIZIA);
  return host.length;
}

type Lettore = <T>(percorso: string, params?: Record<string, string | number>) => Promise<T>;

/**
 * Un giro: le dichiarazioni nuove dal cursore. Un sensore più vecchio non ha la rotta: non è un errore.
 * Ritorna null se il sensore non le espone.
 */
export async function sincronizzaDichiarazioni(leggi: Lettore): Promise<EsitoDichiarazioni | null> {
  let righe: Dichiarazione[];
  try {
    const puliti = pulisciMdnsRipetuto();
    if (puliti > 0) console.info(`[trunk] dichiarazioni: tolte le mDNS ripetute dal gateway, ${puliti} host ricalcolati`);
    const dopo = getTenantSetting(CHIAVE_CURSORE) ?? "";
    const r = await leggi<{ dichiarazioni?: Dichiarazione[] }>("/dichiarazioni", { dopo, limite: 5000 });
    righe = Array.isArray(r.dichiarazioni) ? r.dichiarazioni : [];
  } catch (e) {
    if (e instanceof Error && /\b404\b|assente|ENOENT|ECONNREFUSED/.test(e.message)) return null;
    throw e;
  }
  if (righe.length === 0) return { host: 0, prove: 0, campi: 0 };
  const toccati = salvaDichiarazioni(righe);
  const ultima = righe.reduce((m, r) => (r.ultima_vista > m ? r.ultima_vista : m), "");
  if (ultima) setTenantSetting(CHIAVE_CURSORE, ultima);
  return portaDichiarazioniSugliHost(toccati);
}
