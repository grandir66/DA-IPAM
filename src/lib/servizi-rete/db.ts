/**
 * Accesso alla tabella `servizi_rete`. Le funzioni ricevono il database: `db-tenant.ts`
 * le chiama col DB del tenant corrente, `db.ts` (facade) col suo `getDb()`. Una copia sola
 * della logica, così le due strade non divergono (regola 12 di CLAUDE.md).
 */
import type Database from "better-sqlite3";
import { assicuraColonnaNtlmServizi } from "@/lib/db-tenant-schema";
import type { EsitoSonda } from "./sonde";

export interface PortaDaSondare {
  host_id: number;
  ip: string;
  porta: number;
  vendor: string | null;
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
      `SELECT s.host_id, h.ip, s.porta, COALESCE(h.vendor, h.device_manufacturer) AS vendor FROM servizi_rete s JOIN hosts h ON h.id = s.host_id
       WHERE s.protocollo = 'tcp' ${networkId ? "AND h.network_id = ?" : ""}
       ORDER BY s.ultima_sonda IS NOT NULL, s.ultima_sonda, h.ip, s.porta
       LIMIT ?`,
    )
    .all(...(networkId ? [networkId, limite] : [limite])) as PortaDaSondare[];
}

/** Scrive l'esito di una sonda. `null` = la porta non risponde più: si segna solo la prova. */
export function salvaEsitoSonda(db: Database.Database, hostId: number, porta: number, esito: EsitoSonda | null): void {
  assicuraColonnaNtlmServizi(db);
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

function condizioni(f: FiltriServiziRete): { where: string; args: unknown[] } {
  const w: string[] = [];
  const a: unknown[] = [];
  if (f.networkId) { w.push("h.network_id = ?"); a.push(f.networkId); }
  if (f.hostId) { w.push("s.host_id = ?"); a.push(f.hostId); }
  if (f.porta) { w.push("s.porta = ?"); a.push(f.porta); }
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

export interface HostDaProvare {
  host_id: number;
  ip: string;
  vendor: string | null;
}

/** Gli host di una rete, per il giro leggero delle porte comuni. */
export function hostDellaRete(db: Database.Database, networkId: number): HostDaProvare[] {
  return db
    .prepare("SELECT id AS host_id, ip, COALESCE(vendor, device_manufacturer) AS vendor FROM hosts WHERE network_id = ? ORDER BY ip")
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
      `SELECT h.id AS host_id, h.ip, COALESCE(h.vendor, h.device_manufacturer) AS vendor FROM hosts h
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
