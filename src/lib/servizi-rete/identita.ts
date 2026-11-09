/**
 * Identità senza credenziali: impronte che dicono che due IP sono lo stesso
 * apparato. Le sonde già salvano SHA-256 del certificato TLS e (da questa tappa)
 * l'impronta della host key SSH; il trunk ha i nomi NetBIOS/mDNS; i profili
 * nmap hanno ssh-hostkey e SNMP engineID.
 *
 * Le impronte forti (SSH, TLS, engineID, nome Windows NTLM) diventano proposte «stesso apparato».
 * Conferma collega i due host allo stesso apparato fisico; rifiuto no.
 * Niente fusioni automatiche (Riccardo, 09/11/2026).
 */
import type Database from "better-sqlite3";
import { assicuraColonnaNtlmServizi } from "@/lib/db-tenant-schema";
import type { InfoNtlm } from "./sonde";

export const TIPI_FORTI = ["ssh_hostkey", "tls_cert", "snmp_engine_id", "ntlm_computer"] as const;
export type TipoForte = (typeof TIPI_FORTI)[number];

/** Un certificato condiviso da troppi IP è un reverse proxy, non un apparato. */
const TETTO_HOST_PER_IMPRONTA: Record<TipoForte, number> = {
  ssh_hostkey: 12,
  tls_cert: 8,
  snmp_engine_id: 12,
  ntlm_computer: 12,
};

const NTLM_GENERICO = new Set(["workgroup", "localhost", "none", "local", "*", "."]);

export interface PropostaIdentita {
  id: number;
  host_a: number;
  host_b: number;
  ip_a: string;
  ip_b: string;
  nome_a: string | null;
  nome_b: string | null;
  rete_a: string | null;
  rete_b: string | null;
  tipo: string;
  valore: string;
  stato: "proposto" | "confermato" | "rifiutato";
  deciso_da: string | null;
  deciso_il: string | null;
}

export interface ConteggiIdentita {
  prove: number;
  proposte: number;
  confermati: number;
  rifiutati: number;
}

function testo(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** Normalizza un'impronta: minuscolo, senza due punti, SHA256:base64 → hex. */
export function normalizzaImpronta(grezza: string): string | null {
  const s = grezza.trim();
  if (!s) return null;
  const b64 = /^SHA256:([A-Za-z0-9+/=]+)$/i.exec(s);
  if (b64) {
    try {
      return Buffer.from(b64[1], "base64").toString("hex");
    } catch {
      return null;
    }
  }
  const hex = s.replace(/:/g, "").toLowerCase();
  return /^[0-9a-f]{16,128}$/.test(hex) ? hex : null;
}

function upsertProva(
  db: Database.Database,
  hostId: number,
  tipo: string,
  valore: string,
  fonte: string,
  porta: number | null,
): void {
  db.prepare(
    `INSERT INTO identita_prove (host_id, tipo, valore, fonte, porta, visto)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(host_id, tipo, valore) DO UPDATE SET
       fonte = excluded.fonte, porta = COALESCE(excluded.porta, identita_prove.porta),
       visto = excluded.visto`,
  ).run(hostId, tipo, valore, fonte, porta);
}

function tlsSha(json: string | null): string | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as { sha256?: unknown };
    return typeof v.sha256 === "string" ? normalizzaImpronta(v.sha256) : null;
  } catch {
    return null;
  }
}

function sshFp(json: string | null): string | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as { fingerprint?: unknown };
    return typeof v.fingerprint === "string" ? normalizzaImpronta(v.fingerprint) : null;
  } catch {
    return null;
  }
}

function nomeNtlm(v: unknown): string | null {
  return typeof v === "string" && v.trim() && !NTLM_GENERICO.has(v.trim().toLowerCase()) ? v.trim() : null;
}

/**
 * Chiave di identità dalla CHALLENGE: FQDN del computer, altrimenti DOMINIO\PC.
 * WORKGROUP, localhost e nomi vuoti non contano: troppi host li condividono.
 */
export function chiaveIdentitaNtlm(n: Pick<InfoNtlm, "netbios" | "dominio_netbios" | "dns_computer" | "dominio_dns">): string | null {
  const dns = nomeNtlm(n.dns_computer);
  if (dns) return dns.toLowerCase();
  const pc = nomeNtlm(n.netbios);
  if (!pc) return null;
  const dom = nomeNtlm(n.dominio_dns) ?? nomeNtlm(n.dominio_netbios);
  return (dom ? `${dom}\\${pc}` : pc).toLowerCase();
}

function ntlmChiave(json: string | null): string | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as InfoNtlm;
    return chiaveIdentitaNtlm(v);
  } catch {
    return null;
  }
}

/**
 * Raccoglie le prove dagli archivi già scritti (sonde, profili, trunk) e calcola
 * le proposte nuove. Non tocca confermate o rifiutate. Ritorna quante prove e
 * quante proposte nuove.
 */
export function raccogliECalcola(db: Database.Database): { prove: number; proposte: number } {
  assicuraColonnaNtlmServizi(db);
  const provePrima = (db.prepare("SELECT COUNT(*) AS c FROM identita_prove").get() as { c: number }).c;
  const propostePrima = (db.prepare("SELECT COUNT(*) AS c FROM identita_proposte").get() as { c: number }).c;

  const servizi = db
    .prepare("SELECT host_id, porta, tls_json, ssh_json, ntlm_json FROM servizi_rete")
    .all() as Array<{ host_id: number; porta: number; tls_json: string | null; ssh_json: string | null; ntlm_json: string | null }>;
  db.transaction(() => {
    for (const s of servizi) {
      const tls = tlsSha(s.tls_json);
      if (tls) upsertProva(db, s.host_id, "tls_cert", tls, "sonda", s.porta);
      const ssh = sshFp(s.ssh_json);
      if (ssh) upsertProva(db, s.host_id, "ssh_hostkey", ssh, "sonda", s.porta);
      const ntlm = ntlmChiave(s.ntlm_json);
      if (ntlm) upsertProva(db, s.host_id, "ntlm_computer", ntlm, "sonda", s.porta);
    }
  })();

  const rilievi = db
    .prepare(
      `SELECT host_id, porta, script, elems_json FROM host_profilo_rilievi
       WHERE script IN ('ssh-hostkey', 'snmp-info') AND elems_json IS NOT NULL AND elems_json <> ''`,
    )
    .all() as Array<{ host_id: number; porta: number | null; script: string; elems_json: string }>;
  db.transaction(() => {
    for (const r of rilievi) {
      let elems: Record<string, unknown> = {};
      try {
        const v = JSON.parse(r.elems_json) as unknown;
        if (v && typeof v === "object") elems = v as Record<string, unknown>;
      } catch {
        continue;
      }
      if (r.script === "ssh-hostkey") {
        for (const [k, val] of Object.entries(elems)) {
          if (!/fingerprint/i.test(k) || typeof val !== "string") continue;
          const fp = normalizzaImpronta(val);
          if (fp) upsertProva(db, r.host_id, "ssh_hostkey", fp, "profilo", r.porta);
        }
      } else if (r.script === "snmp-info") {
        const dati = testo(elems.engineIDData) ?? testo(elems.engineiddata);
        if (dati && dati.length >= 8) {
          upsertProva(db, r.host_id, "snmp_engine_id", dati.toLowerCase(), "profilo", r.porta);
        }
      }
    }
  })();

  const nomi = db
    .prepare(
      `SELECT h.id AS host_id, t.nome, t.fonte_nome FROM trunk_osservazioni t
       JOIN hosts h ON h.ip = t.ip
       WHERE t.nome IS NOT NULL AND t.nome <> '' AND t.fonte_nome IN ('nbns', 'mdns', 'lldp', 'cdp')`,
    )
    .all() as Array<{ host_id: number; nome: string; fonte_nome: string }>;
  db.transaction(() => {
    for (const n of nomi) {
      const tipo = n.fonte_nome === "nbns" ? "netbios" : n.fonte_nome === "mdns" ? "mdns" : "lldp";
      upsertProva(db, n.host_id, tipo, n.nome.trim(), "trunk", null);
    }
  })();

  const forti = db
    .prepare(
      `SELECT tipo, valore, host_id FROM identita_prove
       WHERE tipo IN ('ssh_hostkey', 'tls_cert', 'snmp_engine_id', 'ntlm_computer')
       ORDER BY tipo, valore, host_id`,
    )
    .all() as Array<{ tipo: TipoForte; valore: string; host_id: number }>;
  const gruppi = new Map<string, number[]>();
  for (const r of forti) {
    const k = `${r.tipo}\0${r.valore}`;
    const g = gruppi.get(k) ?? [];
    if (!g.includes(r.host_id)) g.push(r.host_id);
    gruppi.set(k, g);
  }
  const ins = db.prepare(
    `INSERT INTO identita_proposte (host_a, host_b, tipo, valore)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(host_a, host_b, tipo, valore) DO NOTHING`,
  );
  db.transaction(() => {
    for (const [k, host] of gruppi) {
      if (host.length < 2) continue;
      const sep = k.indexOf("\0");
      const tipo = k.slice(0, sep) as TipoForte;
      const valore = k.slice(sep + 1);
      if (host.length > TETTO_HOST_PER_IMPRONTA[tipo]) continue;
      host.sort((a, b) => a - b);
      for (let i = 0; i < host.length; i++) {
        for (let j = i + 1; j < host.length; j++) ins.run(host[i], host[j], tipo, valore);
      }
    }
  })();

  return {
    prove: (db.prepare("SELECT COUNT(*) AS c FROM identita_prove").get() as { c: number }).c - provePrima,
    proposte: (db.prepare("SELECT COUNT(*) AS c FROM identita_proposte").get() as { c: number }).c - propostePrima,
  };
}

const SELECT_PROPOSTA = `SELECT p.id, p.host_a, p.host_b, a.ip AS ip_a, b.ip AS ip_b,
  COALESCE(a.custom_name, a.hostname) AS nome_a, COALESCE(b.custom_name, b.hostname) AS nome_b,
  na.name AS rete_a, nb.name AS rete_b, p.tipo, p.valore, p.stato, p.deciso_da, p.deciso_il
 FROM identita_proposte p
 JOIN hosts a ON a.id = p.host_a JOIN hosts b ON b.id = p.host_b
 LEFT JOIN networks na ON na.id = a.network_id LEFT JOIN networks nb ON nb.id = b.network_id`;

export function proposteIdentita(db: Database.Database, stato: "proposto" | "confermato" | "rifiutato" = "proposto"): PropostaIdentita[] {
  return db.prepare(`${SELECT_PROPOSTA} WHERE p.stato = ? ORDER BY p.id`).all(stato) as PropostaIdentita[];
}

export function conteggiIdentita(db: Database.Database): ConteggiIdentita {
  const r = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM identita_prove) AS prove,
         SUM(stato = 'proposto') AS proposte,
         SUM(stato = 'confermato') AS confermati,
         SUM(stato = 'rifiutato') AS rifiutati
       FROM identita_proposte`,
    )
    .get() as { prove: number; proposte: number | null; confermati: number | null; rifiutati: number | null };
  return {
    prove: r.prove ?? 0,
    proposte: r.proposte ?? 0,
    confermati: r.confermati ?? 0,
    rifiutati: r.rifiutati ?? 0,
  };
}

function collegaApparato(db: Database.Database, hostA: number, hostB: number): void {
  const ids = [hostA, hostB];
  const righe = db
    .prepare(`SELECT id, physical_device_id FROM hosts WHERE id IN (?, ?)`)
    .all(...ids) as Array<{ id: number; physical_device_id: number | null }>;
  const già = righe.map((r) => r.physical_device_id).filter((x): x is number => x != null);
  const unici = [...new Set(già)];
  let pid: number;
  if (unici.length === 1) {
    pid = unici[0]!;
  } else if (unici.length === 0) {
    pid = Number(db.prepare("INSERT INTO physical_devices (notes) VALUES ('collegato da impronta senza credenziali')").run().lastInsertRowid);
  } else {
    // Due apparati già distinti: si registra la proposta confermata e non si fondono.
    return;
  }
  db.prepare("UPDATE hosts SET physical_device_id = ? WHERE id IN (?, ?) AND physical_device_id IS NULL").run(pid, hostA, hostB);
}

export function decidiProposta(
  db: Database.Database,
  id: number,
  esito: "confermato" | "rifiutato",
  utente: string,
): PropostaIdentita | null {
  const r = db.prepare("SELECT id, host_a, host_b, stato FROM identita_proposte WHERE id = ?").get(id) as
    | { id: number; host_a: number; host_b: number; stato: string }
    | undefined;
  if (!r) return null;
  if (r.stato !== "proposto") return null;
  db.transaction(() => {
    db.prepare(
      "UPDATE identita_proposte SET stato = ?, deciso_da = ?, deciso_il = datetime('now') WHERE id = ?",
    ).run(esito, utente, id);
    if (esito === "confermato") collegaApparato(db, r.host_a, r.host_b);
  })();
  return db.prepare(`${SELECT_PROPOSTA} WHERE p.id = ?`).get(id) as PropostaIdentita;
}
