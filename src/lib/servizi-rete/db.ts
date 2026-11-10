/**
 * Accesso alla tabella `servizi_rete`. Le funzioni ricevono il database: `db-tenant.ts`
 * le chiama col DB del tenant corrente, `db.ts` (facade) col suo `getDb()`. Una copia sola
 * della logica, così le due strade non divergono (regola 12 di CLAUDE.md).
 */
import type Database from "better-sqlite3";
import { assicuraColonnaControlloServizi, assicuraColonnaNtlmServizi } from "@/lib/db-tenant-schema";
import type { InfoControllo } from "@/lib/rilievi/controlli";
import type { EsitoSonda } from "./sonde";
import type { HostPerImpianti } from "@/lib/vuln/impianti-in-rete";

type IndiziImpianto = Omit<HostPerImpianti, "network_id" | "ip">;
const INDIZI_IMPIANTO = "h.vendor, h.device_manufacturer, h.inferred_vendor, h.attr_vendor_name, h.classification, h.attr_category, h.open_ports";

export interface PortaDaSondare extends IndiziImpianto {
  host_id: number;
  ip: string;
  porta: number;
}

export interface ServizioRete {
  id: number;
  host_id: number;
  ip: string;
  hostname: string | null;
  network_id: number;
  rete: string | null;
  cidr: string | null;
  porta: number;
  protocollo: string;
  nome: string | null;
  prodotto: string | null;
  versione: string | null;
  metodo: string | null;
  banner: string | null;
  tls_json: string | null;
  http_json: string | null;
  ssh_json: string | null;
  ntlm_json: string | null;
  primo_visto: string;
  ultimo_visto: string;
  ultima_sonda: string | null;
}

export interface FiltriServiziRete {
  q?: string;
  networkId?: number;
  hostId?: number;
  porta?: number;
  /** `tls`, `http`, `ssh`, `banner`, `ntlm`, `da-sondare` (mai sondato), `silenzio`. */
  tipo?: string;
  /** Nome del prodotto esatto; `(senza)` = righe senza prodotto. */
  prodotto?: string;
  limit: number;
  offset: number;
}

export interface ConteggiServiziRete {
  servizi: number;
  host: number;
  conProdotto: number;
  conTls: number;
  conHttp: number;
  sondati: number;
}

interface PortaJson {
  port?: unknown;
  protocol?: unknown;
  service?: unknown;
  product?: unknown;
  product_version?: unknown;
  version?: unknown;
}

function testo(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * Porta in `servizi_rete` le porte che le scansioni hanno già scritto in `hosts.open_ports`,
 * con nome e prodotto di nmap. Non cancella niente: una porta sparita resta con la sua data
 * di ultima osservazione. Ritorna quante righe nuove.
 */
export function allineaServiziDaPorte(db: Database.Database, networkId?: number): number {
  const righe = db
    .prepare(
      `SELECT id, open_ports, COALESCE(last_seen, updated_at) AS visto FROM hosts
       WHERE open_ports IS NOT NULL AND open_ports <> '' AND open_ports <> '[]'
       ${networkId ? "AND network_id = ?" : ""}`,
    )
    .all(...(networkId ? [networkId] : [])) as Array<{ id: number; open_ports: string; visto: string | null }>;
  const ins = db.prepare(
    `INSERT INTO servizi_rete (host_id, porta, protocollo, nome, prodotto, versione, metodo, primo_visto, ultimo_visto)
     VALUES (?, ?, ?, ?, ?, ?, 'nmap', COALESCE(?, datetime('now')), COALESCE(?, datetime('now')))
     ON CONFLICT(host_id, porta, protocollo) DO UPDATE SET
       nome = COALESCE(servizi_rete.nome, excluded.nome),
       prodotto = COALESCE(servizi_rete.prodotto, excluded.prodotto),
       versione = COALESCE(servizi_rete.versione, excluded.versione)`,
  );
  const conta = () => (db.prepare("SELECT COUNT(*) AS c FROM servizi_rete").get() as { c: number }).c;
  const prima = conta();
  db.transaction(() => {
    for (const r of righe) {
      let porte: PortaJson[] = [];
      try {
        const v = JSON.parse(r.open_ports) as unknown;
        if (Array.isArray(v)) porte = v as PortaJson[];
      } catch {
        continue;
      }
      const visto = r.visto ? r.visto.replace("T", " ").slice(0, 19) : null;
      for (const p of porte) {
        const porta = typeof p.port === "number" ? p.port : Number(p.port);
        if (!Number.isInteger(porta) || porta <= 0 || porta > 65535) continue;
        const proto = testo(p.protocol) ?? "tcp";
        const prodotto = testo(p.product) ?? (testo(p.product_version) ? null : testo(p.version));
        ins.run(r.id, porta, proto, testo(p.service), prodotto, testo(p.product_version), visto, visto);
      }
    }
  })();
  return conta() - prima;
}

/** Le porte TCP da sondare, quelle sondate da più tempo per prime. */
export function porteDaSondare(db: Database.Database, networkId?: number, limite = 5000): PortaDaSondare[] {
  return db
    .prepare(
      `SELECT s.host_id, h.ip, s.porta, ${INDIZI_IMPIANTO} FROM servizi_rete s JOIN hosts h ON h.id = s.host_id
       WHERE s.protocollo = 'tcp' ${networkId ? "AND h.network_id = ?" : ""}
       ORDER BY s.ultima_sonda IS NOT NULL, s.ultima_sonda, h.ip, s.porta
       LIMIT ?`,
    )
    .all(...(networkId ? [networkId, limite] : [limite])) as PortaDaSondare[];
}

/** Scrive l'esito di una sonda. `null` = la porta non risponde più: si segna solo la prova. */
export function salvaEsitoSonda(db: Database.Database, hostId: number, porta: number, esito: EsitoSonda | null): void {
  assicuraColonnaNtlmServizi(db);
  assicuraColonnaControlloServizi(db);
  if (!esito) {
    db.prepare(
      "UPDATE servizi_rete SET ultima_sonda = datetime('now') WHERE host_id = ? AND porta = ? AND protocollo = 'tcp'",
    ).run(hostId, porta);
    return;
  }
  const nomeDaMetodo = esito.metodo === "ssh" ? "ssh" : esito.metodo === "http" ? "http" : esito.metodo === "ntlm" ? "microsoft-ds" : esito.metodo.startsWith("tls") ? (esito.http || esito.metodo === "tls-http" ? "https" : "ssl") : null;
  db.prepare(
    `UPDATE servizi_rete SET
       metodo = ?, banner = ?, tls_json = ?, http_json = ?, ssh_json = ?, ntlm_json = ?,
       nome = COALESCE(nome, ?),
       prodotto = COALESCE(prodotto, ?), versione = COALESCE(versione, ?),
       ultimo_visto = datetime('now'), ultima_sonda = datetime('now')
     WHERE host_id = ? AND porta = ? AND protocollo = 'tcp'`,
  ).run(
    esito.metodo,
    esito.banner,
    esito.tls ? JSON.stringify(esito.tls) : null,
    esito.http ? JSON.stringify(esito.http) : null,
    esito.ssh ? JSON.stringify(esito.ssh) : null,
    esito.ntlm ? JSON.stringify(esito.ntlm) : null,
    nomeDaMetodo,
    esito.prodotto,
    esito.versione,
    hostId,
    porta,
  );
}

function condizioni(f: Omit<FiltriServiziRete, "limit" | "offset">): { where: string; args: unknown[] } {
  const w: string[] = [];
  const a: unknown[] = [];
  if (f.networkId) { w.push("h.network_id = ?"); a.push(f.networkId); }
  if (f.hostId) { w.push("s.host_id = ?"); a.push(f.hostId); }
  if (f.porta) { w.push("s.porta = ?"); a.push(f.porta); }
  if (f.prodotto === "(senza)") w.push("s.prodotto IS NULL");
  else if (f.prodotto) { w.push("s.prodotto = ?"); a.push(f.prodotto); }
  switch (f.tipo) {
    case "tls": w.push("s.tls_json IS NOT NULL"); break;
    case "http": w.push("s.http_json IS NOT NULL"); break;
    case "ssh": w.push("s.ssh_json IS NOT NULL"); break;
    case "ntlm": w.push("s.ntlm_json IS NOT NULL"); break;
    case "banner": w.push("s.metodo = 'banner'"); break;
    case "silenzio": w.push("s.metodo = 'silenzio'"); break;
    case "da-sondare": w.push("s.ultima_sonda IS NULL"); break;
    default: break;
  }
  const q = f.q?.trim();
  if (q) {
    const like = `%${q.replace(/[%_]/g, (c) => `\\${c}`)}%`;
    w.push(
      `(h.ip LIKE ? ESCAPE '\\' OR h.hostname LIKE ? ESCAPE '\\' OR s.nome LIKE ? ESCAPE '\\' OR s.prodotto LIKE ? ESCAPE '\\'
        OR s.banner LIKE ? ESCAPE '\\' OR s.http_json LIKE ? ESCAPE '\\' OR s.tls_json LIKE ? ESCAPE '\\' OR s.ntlm_json LIKE ? ESCAPE '\\')`,
    );
    a.push(like, like, like, like, like, like, like, like);
  }
  return { where: w.length ? `WHERE ${w.join(" AND ")}` : "", args: a };
}

export function serviziRetePaginati(db: Database.Database, f: FiltriServiziRete): { righe: ServizioRete[]; totale: number } {
  assicuraColonnaNtlmServizi(db);
  assicuraColonnaControlloServizi(db);
  const { where, args } = condizioni(f);
  const da = `FROM servizi_rete s JOIN hosts h ON h.id = s.host_id LEFT JOIN networks n ON n.id = h.network_id ${where}`;
  const totale = (db.prepare(`SELECT COUNT(*) AS c ${da}`).get(...args) as { c: number }).c;
  const righe = db
    .prepare(
      `SELECT s.id, s.host_id, h.ip, COALESCE(h.custom_name, h.hostname) AS hostname, h.network_id,
              n.name AS rete, n.cidr AS cidr, s.porta, s.protocollo, s.nome, s.prodotto, s.versione, s.metodo,
              s.banner, s.tls_json, s.http_json, s.ssh_json, s.ntlm_json, s.primo_visto, s.ultimo_visto, s.ultima_sonda
       ${da} ORDER BY h.network_id, h.ip, s.protocollo, s.porta LIMIT ? OFFSET ?`,
    )
    .all(...args, f.limit, f.offset) as ServizioRete[];
  return { righe, totale };
}

/** Una riga con anche l'esito dei controlli del giro: serve a calcolare i rilievi della porta. */
export type ServizioReteCompleto = ServizioRete & { controllo_json: string | null };

/**
 * Tutti i servizi che passano i filtri, senza pagina: gruppi, indicatori e barre della pagina
 * «Servizi di rete» si calcolano in memoria sugli stessi dati dell'elenco (come in Findings).
 * Resta sul server: al browser va una pagina sola. `tetto` ferma un tenant fuori misura.
 */
export function serviziReteTutti(
  db: Database.Database,
  f: Omit<FiltriServiziRete, "limit" | "offset">,
  tetto = 20000,
): { righe: ServizioReteCompleto[]; parziale: boolean } {
  assicuraColonnaNtlmServizi(db);
  assicuraColonnaControlloServizi(db);
  const { where, args } = condizioni(f);
  const righe = db
    .prepare(
      `SELECT s.id, s.host_id, h.ip, COALESCE(h.custom_name, h.hostname) AS hostname, h.network_id,
              n.name AS rete, n.cidr AS cidr, s.porta, s.protocollo, s.nome, s.prodotto, s.versione, s.metodo,
              s.banner, s.tls_json, s.http_json, s.ssh_json, s.ntlm_json, s.controllo_json,
              s.primo_visto, s.ultimo_visto, s.ultima_sonda
       FROM servizi_rete s JOIN hosts h ON h.id = s.host_id LEFT JOIN networks n ON n.id = h.network_id ${where}
       ORDER BY h.network_id, h.ip, s.protocollo, s.porta LIMIT ?`,
    )
    .all(...args, tetto + 1) as ServizioReteCompleto[];
  return { righe: righe.slice(0, tetto), parziale: righe.length > tetto };
}

export function conteggiServiziRete(db: Database.Database, networkId?: number): ConteggiServiziRete {
  const r = db
    .prepare(
      `SELECT COUNT(*) AS servizi, COUNT(DISTINCT s.host_id) AS host,
              SUM(s.prodotto IS NOT NULL) AS conProdotto, SUM(s.tls_json IS NOT NULL) AS conTls,
              SUM(s.http_json IS NOT NULL) AS conHttp, SUM(s.ultima_sonda IS NOT NULL) AS sondati
       FROM servizi_rete s JOIN hosts h ON h.id = s.host_id ${networkId ? "WHERE h.network_id = ?" : ""}`,
    )
    .get(...(networkId ? [networkId] : [])) as Record<keyof ConteggiServiziRete, number | null>;
  return {
    servizi: r.servizi ?? 0,
    host: r.host ?? 0,
    conProdotto: r.conProdotto ?? 0,
    conTls: r.conTls ?? 0,
    conHttp: r.conHttp ?? 0,
    sondati: r.sondati ?? 0,
  };
}

export interface HostDaProvare extends IndiziImpianto {
  host_id: number;
  ip: string;
}

/** Gli host di una rete, per il giro leggero delle porte comuni. */
export function hostDellaRete(db: Database.Database, networkId: number): HostDaProvare[] {
  return db
    .prepare(`SELECT h.id AS host_id, h.ip, ${INDIZI_IMPIANTO} FROM hosts h WHERE h.network_id = ? ORDER BY h.ip`)
    .all(networkId) as HostDaProvare[];
}

/**
 * Registra le porte TCP trovate aperte dal giro leggero: una riga in `servizi_rete` (metodo
 * `aperta`, finché la sonda non la legge) e l'unione con `hosts.open_ports`, dove le leggono
 * classificazione e scheda dell'host. `unisci` è `mergeOpenPortsJson` del chiamante: niente
 * copie della regola d'unione.
 */
export function registraPorteAperte(
  db: Database.Database,
  hostId: number,
  porte: number[],
  unisci: (esistente: string | null, nuove: string) => string,
): void {
  if (porte.length === 0) return;
  const ins = db.prepare(
    `INSERT INTO servizi_rete (host_id, porta, protocollo, metodo) VALUES (?, ?, 'tcp', 'aperta')
     ON CONFLICT(host_id, porta, protocollo) DO UPDATE SET ultimo_visto = datetime('now')`,
  );
  db.transaction(() => {
    for (const p of porte) ins.run(hostId, p);
    const r = db.prepare("SELECT open_ports FROM hosts WHERE id = ?").get(hostId) as { open_ports: string | null } | undefined;
    const nuove = JSON.stringify(porte.map((port) => ({ port, protocol: "tcp", service: null, version: null })));
    db.prepare("UPDATE hosts SET open_ports = ?, updated_at = datetime('now') WHERE id = ?").run(unisci(r?.open_ports ?? null, nuove), hostId);
  })();
}

/**
 * Host visti di recente che non hanno nessuna porta nota: arrivano da ARP, DHCP o trunk.
 * Il giro automatico prova su di loro le porte comuni.
 */
export function hostSenzaPorte(db: Database.Database, giorni = 7, limite = 300): HostDaProvare[] {
  return db
    .prepare(
      `SELECT h.id AS host_id, h.ip, ${INDIZI_IMPIANTO} FROM hosts h
       WHERE (h.open_ports IS NULL OR h.open_ports IN ('', '[]'))
         AND h.status <> 'offline'
         AND COALESCE(h.last_seen, h.updated_at) >= datetime('now', ?)
         AND NOT EXISTS (SELECT 1 FROM servizi_rete s WHERE s.host_id = h.id)
         AND NOT EXISTS (SELECT 1 FROM servizi_rete_prove p WHERE p.host_id = h.id AND p.provato_il >= datetime('now', ?))
       ORDER BY h.ip LIMIT ?`,
    )
    .all(`-${giorni} days`, `-${giorni} days`, limite) as HostDaProvare[];
}

/** Segna che il giro leggero ha provato l'host (anche senza trovare niente). */
export function segnaHostProvato(db: Database.Database, hostId: number, provate: number, aperte: number): void {
  db.prepare(
    `INSERT INTO servizi_rete_prove (host_id, provato_il, porte_provate, porte_aperte) VALUES (?, datetime('now'), ?, ?)
     ON CONFLICT(host_id) DO UPDATE SET provato_il = excluded.provato_il, porte_provate = excluded.porte_provate, porte_aperte = excluded.porte_aperte`,
  ).run(hostId, provate, aperte);
}

export interface PortaDaControllare extends PortaDaSondare {
  protocollo: string;
  /** 1 se la sonda ha già letto un certificato: lì si prova anche il TLS vecchio. */
  tls: number;
}

export interface CredenzialeValidata extends IndiziImpianto {
  host_id: number;
  ip: string;
  credential_id: number;
  protocol_type: "ssh" | "snmp";
  port: number;
  /** Valorizzato solo per SNMPv3. */
  auth_protocol: string | null;
  banner: string | null;
}

/**
 * Le credenziali SSH e SNMP già validate PER L'HOST (`validated = 1`) e fuori fermo. È l'unica
 * porta d'ingresso dei controlli autenticati: una voce del registro non validata su quell'host
 * qui non compare, quindi il giro non la può provare (Riccardo, 10/11/2026).
 */
export function credenzialiValidate(db: Database.Database, networkId: number | undefined, oraIso: string): CredenzialeValidata[] {
  return db
    .prepare(
      `SELECT hc.host_id, h.ip, hc.credential_id, hc.protocol_type, hc.port, c.auth_protocol, s.banner, ${INDIZI_IMPIANTO}
       FROM host_credentials hc
       JOIN hosts h ON h.id = hc.host_id
       JOIN credentials c ON c.id = hc.credential_id
       LEFT JOIN servizi_rete s ON s.host_id = hc.host_id AND s.porta = hc.port AND s.protocollo = 'tcp'
       WHERE hc.validated = 1 AND hc.protocol_type IN ('ssh', 'snmp') AND h.ip IS NOT NULL
         AND (hc.backoff_until IS NULL OR hc.backoff_until < ?) ${networkId ? "AND h.network_id = ?" : ""}
       ORDER BY hc.host_id, hc.sort_order, hc.id`,
    )
    .all(...(networkId ? [oraIso, networkId] : [oraIso])) as CredenzialeValidata[];
}

/**
 * Porte su cui ha senso un controllo (LDAP, Redis, Mongo, NFS, SNMP, VNC, FTP, SMB, API).
 * Se `ancheHttp401`, anche i servizi che hanno già un `http_json` (percorsi .git/.env/actuator e, con levetta, login di fabbrica).
 */
export function porteDaControllare(
  db: Database.Database,
  networkId: number | undefined,
  porte: ReadonlySet<number>,
  ancheHttp401: boolean,
): PortaDaControllare[] {
  const elenco = [...porte].filter((n) => Number.isInteger(n));
  if (elenco.length === 0 && !ancheHttp401) return [];
  const rete = networkId ? "AND h.network_id = ?" : "";
  const args: unknown[] = [];
  const or: string[] = [];
  if (elenco.length > 0) {
    or.push(`s.porta IN (${elenco.map(() => "?").join(",")})`);
    args.push(...elenco);
  }
  if (ancheHttp401) {
    or.push(`(s.http_json IS NOT NULL AND s.http_json != '')`);
    or.push(`(s.tls_json IS NOT NULL AND s.tls_json != '')`);
  }
  if (networkId) args.push(networkId);
  return db
    .prepare(
      `SELECT s.host_id, h.ip, s.porta, s.protocollo, (s.tls_json IS NOT NULL AND s.tls_json != '') AS tls, ${INDIZI_IMPIANTO}
       FROM servizi_rete s JOIN hosts h ON h.id = s.host_id
       WHERE (${or.join(" OR ")}) ${rete}
       ORDER BY h.ip, s.porta`,
    )
    .all(...args) as PortaDaControllare[];
}

/** Unisce l'esito del controllo a `controllo_json` senza toccare banner/TLS. */
export function salvaControlloServizio(db: Database.Database, hostId: number, porta: number, protocollo: string, info: InfoControllo): void {
  assicuraColonnaControlloServizi(db);
  const proto = protocollo === "udp" ? "udp" : "tcp";
  const r = db
    .prepare("SELECT controllo_json FROM servizi_rete WHERE host_id = ? AND porta = ? AND protocollo = ?")
    .get(hostId, porta, proto) as { controllo_json: string | null } | undefined;
  let prev: Record<string, unknown> = {};
  if (r?.controllo_json) {
    try {
      const v = JSON.parse(r.controllo_json) as unknown;
      if (v && typeof v === "object" && !Array.isArray(v)) prev = v as Record<string, unknown>;
    } catch {
      prev = {};
    }
  }
  const json = JSON.stringify({ ...prev, ...info });
  if (r) {
    db.prepare(
      "UPDATE servizi_rete SET controllo_json = ?, ultimo_visto = datetime('now') WHERE host_id = ? AND porta = ? AND protocollo = ?",
    ).run(json, hostId, porta, proto);
    return;
  }
  db.prepare(
    `INSERT INTO servizi_rete (host_id, porta, protocollo, metodo, controllo_json)
     VALUES (?, ?, ?, 'controllo', ?)`,
  ).run(hostId, porta, proto, json);
}
