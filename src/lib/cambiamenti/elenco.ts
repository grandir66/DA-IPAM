/**
 * Elenco unico di ciò che cambia nel tempo (Riccardo, 14/11/2026: «in quell'area tutte le voci che cambiano nel
 * tempo: nuovi oggetti, spostamenti di porte, nuovi apparati, cambi di IP, nuove porte rilevate»).
 *
 * Non ha una tabella sua: legge le fonti che ci sono già (`hosts.first_seen`, `network_devices.created_at`,
 * `mac_ip_history`, `mac_port_entries`, `anomaly_events`, `network_changes`). L'unica cosa che scrive è «Visto»
 * (`cambiamenti_visti`, creata al primo clic come `network_changes`).
 *
 * Il rumore non si butta: si marca col suo motivo e la pagina lo nasconde di serie. Misura dell'hub 533 del 14/11:
 * 85 MAC su 91 con più di un IP in 7 giorni (DHCP e macchine con più indirizzi) e 511 MAC «nuovi» su una porta
 * (quasi tutte porte di collegamento fra switch): senza filtro l'elenco non si legge.
 */
import type Database from "better-sqlite3";
import { parseDbDate } from "@/lib/db-date";

export const TIPI_CAMBIAMENTO = [
  "oggetto_nuovo", "apparato_nuovo", "cambio_ip", "mac_cambiato", "spostamento_porta", "porta_nuova",
] as const;
export type TipoCambiamento = (typeof TIPI_CAMBIAMENTO)[number];

export interface Cambiamento {
  /** Stabile fra una lettura e l'altra: è la chiave di «Visto». */
  chiave: string;
  tipo: TipoCambiamento;
  quandoMs: number;
  /** Nome dell'oggetto se lo conosciamo, altrimenti IP o MAC. */
  oggetto: string;
  ip: string | null;
  hostId: number | null;
  reteId: number | null;
  prima: string | null;
  dopo: string | null;
  /** Perché di serie non si mostra; null = cambiamento da guardare. */
  rumore: string | null;
  visto: { da: string | null; il: string } | null;
}

export const DDL_CAMBIAMENTI_VISTI = `
CREATE TABLE IF NOT EXISTS cambiamenti_visti (
  chiave TEXT PRIMARY KEY,
  visto_il TEXT NOT NULL DEFAULT (datetime('now')),
  visto_da TEXT
);`;

/** Oltre questo numero di MAC, una porta di switch è un collegamento verso altri apparati e non una presa. */
const MAC_MASSIMI_SU_UNA_PRESA = 2;
/** Un MAC che nella sua storia ha avuto più indirizzi di così non «ha cambiato IP»: ne ha tanti. */
const IP_MASSIMI_PER_UN_CAMBIO = 2;

const haTabella = (db: Database.Database, nome: string) =>
  !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(nome);

/** `aabbccddeeff`: le tabelle scrivono il MAC in tre forme diverse. */
export const macNudo = (mac: string | null | undefined) => (mac ?? "").toLowerCase().replace(/[^0-9a-f]/g, "");
const macLeggibile = (nudo: string) => (nudo.match(/../g) ?? []).join(":").toUpperCase();
/** Le date di SQLite sono scritte in due forme (`T` o spazio): si confrontano in millisecondi, mai come testo. */
const ms = (v: string | null | undefined) => (v ? parseDbDate(v).getTime() : NaN);
const sqlData = (millis: number) => new Date(millis).toISOString().slice(0, 19).replace("T", " ");
/** Per i `WHERE`: la colonna portata alla forma con lo spazio, così il confronto di testo regge. */
const colonnaData = (c: string) => `replace(substr(${c}, 1, 19), 'T', ' ')`;

interface RigaHost {
  id: number; network_id: number; ip: string; mac: string | null; hostname: string | null;
  custom_name: string | null; vendor: string | null; first_seen: string | null;
}

export function leggiCambiamenti(
  db: Database.Database,
  opzioni: { giorni: number; reteId?: number; adesso?: number },
): Cambiamento[] {
  const adesso = opzioni.adesso ?? Date.now();
  const dalMs = adesso - opzioni.giorni * 86_400_000;
  const dal = sqlData(dalMs);
  const nelPeriodo = (t: number) => Number.isFinite(t) && t >= dalMs && t <= adesso + 60_000;
  const esito: Cambiamento[] = [];

  const hosts = db.prepare(
    "SELECT id, network_id, ip, mac, hostname, custom_name, vendor, first_seen FROM hosts",
  ).all() as RigaHost[];
  const nomeHost = (h: RigaHost) => h.custom_name?.trim() || h.hostname?.trim() || h.ip;
  const hostPerMac = new Map<string, RigaHost>();
  const hostPerIp = new Map<string, RigaHost>();
  for (const h of hosts) {
    const m = macNudo(h.mac);
    if (m && !hostPerMac.has(m)) hostPerMac.set(m, h);
    if (!hostPerIp.has(h.ip)) hostPerIp.set(h.ip, h);
  }

  // ── Oggetti nuovi ──────────────────────────────────────────────────────────────────────────────────────────
  for (const h of hosts) {
    const t = ms(h.first_seen);
    if (!nelPeriodo(t)) continue;
    esito.push({
      chiave: `host:${h.id}`, tipo: "oggetto_nuovo", quandoMs: t, oggetto: nomeHost(h), ip: h.ip, hostId: h.id,
      reteId: h.network_id, prima: null, dopo: [h.mac, h.vendor].filter(Boolean).join(" · ") || null,
      rumore: null, visto: null,
    });
  }

  // ── Apparati nuovi ─────────────────────────────────────────────────────────────────────────────────────────
  if (haTabella(db, "network_devices")) {
    const apparati = db.prepare(`
      SELECT id, name, host, device_type, vendor, host_id, created_at FROM network_devices
      WHERE ${colonnaData("created_at")} >= ?
    `).all(dal) as Array<{
      id: number; name: string; host: string; device_type: string; vendor: string; host_id: number | null; created_at: string;
    }>;
    for (const a of apparati) {
      const t = ms(a.created_at);
      if (!nelPeriodo(t)) continue;
      esito.push({
        chiave: `apparato:${a.id}`, tipo: "apparato_nuovo", quandoMs: t, oggetto: a.name, ip: a.host,
        hostId: a.host_id, reteId: hostPerIp.get(a.host)?.network_id ?? null, prima: null,
        dopo: `${a.device_type} · ${a.vendor}`, rumore: null, visto: null,
      });
    }
  }

  // ── Cambi di IP: lo stesso MAC visto su un indirizzo diverso da prima ──────────────────────────────────────
  if (haTabella(db, "mac_ip_history")) {
    const dinamici = new Set<string>();
    if (haTabella(db, "dhcp_leases")) {
      const lease = db.prepare(
        "SELECT mac_address FROM dhcp_leases WHERE dynamic_lease IS NOT 0",
      ).all() as Array<{ mac_address: string }>;
      for (const l of lease) dinamici.add(macNudo(l.mac_address));
    }
    const storia = db.prepare(`
      SELECT mac_normalized, ip, changed_at FROM mac_ip_history
      WHERE mac_normalized IN (SELECT DISTINCT mac_normalized FROM mac_ip_history WHERE ${colonnaData("changed_at")} >= ?)
      ORDER BY mac_normalized, changed_at, id
    `).all(dal) as Array<{ mac_normalized: string; ip: string; changed_at: string }>;
    const perMac = new Map<string, typeof storia>();
    for (const r of storia) {
      const m = macNudo(r.mac_normalized);
      if (!perMac.has(m)) perMac.set(m, []);
      perMac.get(m)!.push(r);
    }
    for (const [mac, righe] of perMac) {
      let ultimo: { prima: string; dopo: string; t: number; quando: string } | null = null;
      for (let i = 1; i < righe.length; i++) {
        const t = ms(righe[i].changed_at);
        if (righe[i].ip !== righe[i - 1].ip && nelPeriodo(t)) {
          ultimo = { prima: righe[i - 1].ip, dopo: righe[i].ip, t, quando: righe[i].changed_at };
        }
      }
      if (!ultimo) continue;
      const indirizzi = new Set(righe.map((r) => r.ip)).size;
      const host = hostPerMac.get(mac) ?? hostPerIp.get(ultimo.dopo);
      const rumore =
        /^0+$/.test(mac) || mac.length !== 12 ? "MAC non valido" :
        dinamici.has(mac) ? "indirizzo dato dal DHCP" :
        indirizzi > IP_MASSIMI_PER_UN_CAMBIO ? `${indirizzi} indirizzi sullo stesso MAC` : null;
      esito.push({
        chiave: `ip:${mac}:${ultimo.quando}`, tipo: "cambio_ip", quandoMs: ultimo.t,
        oggetto: host ? nomeHost(host) : macLeggibile(mac), ip: ultimo.dopo, hostId: host?.id ?? null,
        reteId: hostPerIp.get(ultimo.dopo)?.network_id ?? host?.network_id ?? null,
        prima: ultimo.prima, dopo: ultimo.dopo, rumore, visto: null,
      });
    }
  }

  // ── Spostamenti di porta: lo stesso MAC comparso su un'altra presa ─────────────────────────────────────────
  if (haTabella(db, "mac_port_entries")) {
    const affollate = new Set<string>();
    const conteggi = db.prepare(
      "SELECT device_id, port_name, COUNT(*) AS n FROM mac_port_entries GROUP BY device_id, port_name",
    ).all() as Array<{ device_id: number; port_name: string; n: number }>;
    for (const c of conteggi) if (c.n > MAC_MASSIMI_SU_UNA_PRESA) affollate.add(`${c.device_id}|${c.port_name}`);
    if (haTabella(db, "switch_ports")) {
      const dorsali = db.prepare(
        "SELECT device_id, port_name FROM switch_ports WHERE is_trunk = 1 OR is_uplink = 1",
      ).all() as Array<{ device_id: number; port_name: string }>;
      for (const d of dorsali) affollate.add(`${d.device_id}|${d.port_name}`);
    }
    const voci = db.prepare(`
      SELECT e.mac, e.device_id, e.port_name, COALESCE(e.first_seen, e.timestamp) AS dal, d.name AS apparato
      FROM mac_port_entries e JOIN network_devices d ON d.id = e.device_id
      WHERE e.mac IN (SELECT mac FROM mac_port_entries WHERE ${colonnaData("COALESCE(first_seen, timestamp)")} >= ?)
      ORDER BY e.mac, dal, e.id
    `).all(dal) as Array<{ mac: string; device_id: number; port_name: string; dal: string; apparato: string }>;
    const perMac = new Map<string, typeof voci>();
    for (const v of voci) {
      const m = macNudo(v.mac);
      if (!perMac.has(m)) perMac.set(m, []);
      perMac.get(m)!.push(v);
    }
    for (const [mac, righe] of perMac) {
      if (righe.length < 2) continue;
      // Si conta una volta sola: l'ultima presa su cui è comparso, rispetto a quella di prima.
      const dopo = righe[righe.length - 1];
      const prima = righe[righe.length - 2];
      const t = ms(dopo.dal);
      if (!nelPeriodo(t)) continue;
      const dorsale = [prima, dopo].some((r) => affollate.has(`${r.device_id}|${r.port_name}`));
      const nelPeriodoN = righe.filter((r) => nelPeriodo(ms(r.dal))).length;
      const host = hostPerMac.get(mac);
      esito.push({
        chiave: `porta:${mac}:${dopo.device_id}:${dopo.port_name}:${dopo.dal}`, tipo: "spostamento_porta", quandoMs: t,
        oggetto: host ? nomeHost(host) : macLeggibile(mac), ip: host?.ip ?? null, hostId: host?.id ?? null,
        reteId: host?.network_id ?? null,
        prima: `${prima.apparato} · ${prima.port_name}`, dopo: `${dopo.apparato} · ${dopo.port_name}`,
        rumore: dorsale ? "porta di collegamento fra apparati" :
          nelPeriodoN > 2 ? `visto su ${nelPeriodoN} porte nel periodo` : null,
        visto: null,
      });
    }
  }

  // ── Anomalie già rilevate dal controllo periodico: MAC cambiato su un IP, porte cambiate ───────────────────
  const macCambiatiVisti = new Set<string>();
  if (haTabella(db, "anomaly_events")) {
    const anomalie = db.prepare(`
      SELECT a.id, a.host_id, a.network_id, a.anomaly_type, a.description, a.detail_json, a.acknowledged,
             a.acknowledged_at, a.acknowledged_by, a.detected_at
      FROM anomaly_events a
      WHERE a.anomaly_type IN ('mac_flip', 'port_change') AND ${colonnaData("a.detected_at")} >= ?
    `).all(dal) as Array<{
      id: number; host_id: number | null; network_id: number | null; anomaly_type: "mac_flip" | "port_change";
      description: string; detail_json: string | null; acknowledged: number; acknowledged_at: string | null;
      acknowledged_by: string | null; detected_at: string;
    }>;
    for (const a of anomalie) {
      const t = ms(a.detected_at);
      if (!nelPeriodo(t)) continue;
      let d: Record<string, unknown> = {};
      try { d = a.detail_json ? JSON.parse(a.detail_json) as Record<string, unknown> : {}; } catch { d = {}; }
      const ip = typeof d.ip === "string" ? d.ip : null;
      const host = (ip && hostPerIp.get(ip)) || hosts.find((h) => h.id === a.host_id);
      const eMac = a.anomaly_type === "mac_flip";
      const prima = eMac && typeof d.old_mac === "string" ? d.old_mac : null;
      const dopo = eMac && typeof d.new_mac === "string" ? d.new_mac : a.description;
      if (eMac && ip) macCambiatiVisti.add(`${ip}|${macNudo(dopo)}`);
      esito.push({
        chiave: `anomalia:${a.id}`, tipo: eMac ? "mac_cambiato" : "porta_nuova", quandoMs: t,
        oggetto: host ? nomeHost(host) : ip ?? a.description, ip: ip ?? host?.ip ?? null, hostId: host?.id ?? a.host_id,
        reteId: a.network_id ?? host?.network_id ?? null, prima, dopo, rumore: null,
        visto: a.acknowledged ? { da: a.acknowledged_by, il: a.acknowledged_at ?? a.detected_at } : null,
      });
    }
  }

  // ── Confronto fra due giri uguali sulla stessa subnet: porte nuove, MAC cambiato ───────────────────────────
  if (haTabella(db, "network_changes")) {
    const cambi = db.prepare(`
      SELECT id, network_id, finished_ms, kind, ip, before_value, after_value FROM network_changes
      WHERE finished_ms >= ? AND kind <> 'host_nuovo'
    `).all(dalMs) as Array<{
      id: number; network_id: number; finished_ms: number; kind: "mac_cambiato" | "porta_nuova" | "porta_rilevata";
      ip: string; before_value: string | null; after_value: string;
    }>;
    for (const c of cambi) {
      if (!nelPeriodo(c.finished_ms)) continue;
      const eMac = c.kind === "mac_cambiato";
      if (eMac && macCambiatiVisti.has(`${c.ip}|${macNudo(c.after_value)}`)) continue;
      const host = hostPerIp.get(c.ip);
      esito.push({
        chiave: `giro:${c.id}`, tipo: eMac ? "mac_cambiato" : "porta_nuova", quandoMs: c.finished_ms,
        oggetto: host ? nomeHost(host) : c.ip, ip: c.ip, hostId: host?.id ?? null, reteId: c.network_id,
        prima: eMac ? c.before_value : c.kind === "porta_nuova" ? "chiusa" : null,
        dopo: eMac ? c.after_value : `${c.after_value} aperta`,
        // «rilevata» = il giro di prima non l'aveva provata: non sappiamo se è nuova.
        rumore: c.kind === "porta_rilevata" ? "il giro di prima non l'aveva provata" : null, visto: null,
      });
    }
  }

  if (haTabella(db, "cambiamenti_visti")) {
    const visti = new Map((db.prepare("SELECT chiave, visto_il, visto_da FROM cambiamenti_visti").all() as
      Array<{ chiave: string; visto_il: string; visto_da: string | null }>).map((v) => [v.chiave, v]));
    for (const e of esito) {
      const v = visti.get(e.chiave);
      if (v && !e.visto) e.visto = { da: v.visto_da, il: v.visto_il };
    }
  }

  const scelti = opzioni.reteId === undefined ? esito : esito.filter((e) => e.reteId === opzioni.reteId);
  return scelti.sort((a, b) => b.quandoMs - a.quandoMs || a.chiave.localeCompare(b.chiave));
}

/** Quanti cambiamenti aspettano uno sguardo: è il numero accanto ad «Apparati» nel menù. */
export function contaDaVedere(db: Database.Database, giorni = 7, adesso = Date.now()): number {
  return leggiCambiamenti(db, { giorni, adesso }).filter((c) => !c.rumore && !c.visto).length;
}

/** Segna come visti; le anomalie si chiudono anche nella loro tabella, così il controllo periodico non le riapre. */
export function segnaVisti(db: Database.Database, chiavi: readonly string[], utente: string | null): number {
  const valide = [...new Set(chiavi)].filter((c) => /^(host|apparato|ip|porta|anomalia|giro):.{1,200}$/.test(c));
  if (valide.length === 0) return 0;
  db.transaction(() => {
    db.exec(DDL_CAMBIAMENTI_VISTI);
    const metti = db.prepare("INSERT OR IGNORE INTO cambiamenti_visti (chiave, visto_da) VALUES (?, ?)");
    const chiudi = haTabella(db, "anomaly_events") ? db.prepare(`
      UPDATE anomaly_events SET acknowledged = 1, acknowledged_at = datetime('now'), acknowledged_by = ?
      WHERE id = ? AND acknowledged = 0
    `) : null;
    for (const c of valide) {
      metti.run(c, utente);
      if (chiudi && c.startsWith("anomalia:")) chiudi.run(utente, Number(c.slice(9)));
    }
    // Le chiavi di cambiamenti ormai fuori da ogni periodo mostrato non servono più.
    db.prepare("DELETE FROM cambiamenti_visti WHERE visto_il < datetime('now', '-120 days')").run();
  }).immediate();
  return valide.length;
}
