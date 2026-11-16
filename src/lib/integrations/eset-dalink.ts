/**
 * I dati ESET delle postazioni del cliente, letti da DA-Link (17/11/2026).
 *
 * Riccardo, 16/11/2026: «anche la pagina dei findings deve arricchirsi con i dati ricevuti da
 * ESET, come l'archivio dei software delle postazioni». DA-IPAM non ha credenziali ESET: li
 * raccoglie DA-Link per tutti i clienti e ogni appliance legge i SUOI con la chiave del suo
 * oggetto, la stessa del segnale (`/etc/dalink/oggetto.env`). Il cliente lo decide DA-Link dalla
 * chiave; qui si controlla una seconda volta che la risposta porti il codice dell'istanza, e una
 * risposta di un altro cliente non si scrive (zona rossa: i dati di A non arrivano a B).
 *
 * È una COPIA: a ogni giro si sostituisce intera, in una transazione. Un giro fallito, o una
 * risposta vuota dopo un giro che aveva visto macchine, lascia la copia di prima (una lettura
 * fallita che svuota la copia sarebbe una cancellazione differita). Restano fra un giro e l'altro
 * solo gli agganci agli host (`eset_abbinamento`), che sono decisioni e non dati di ESET.
 *
 * Nasce spento, cliente per cliente: `eset.da_dalink` in `tenant_settings`.
 * Piano: DA-Link `docs/superpowers/plans/2026-11-16-eset-verso-da-ipam.md`, Task 2.
 */
import type Database from "better-sqlite3";

export const CHIAVE_ESET_DALINK = "eset.da_dalink";
export const VERSIONE_CONTRATTO = 1;
export const PERCORSO_ESET = "/api/v1/eset/appliance";
/** Domarc pesa 6 MB (misurato il 17/11/2026): 96 MB reggono un cliente quindici volte più grande. */
export const MAX_RISPOSTA_ESET = 96 * 1024 * 1024;
export const CONSOLE_ESET = ["edr", "mdr"] as const;
export const FONTI_VULN_ESET = ["eset", "software"] as const;
export type FonteVulnEset = (typeof FONTI_VULN_ESET)[number];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS eset_macchina (
  uuid TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  hostname TEXT,
  mac TEXT NOT NULL DEFAULT '[]',
  seriale TEXT,
  ip_locale TEXT,
  sistema TEXT,
  console TEXT,
  protezione TEXT,
  ultimo_contatto TEXT,
  letto_il TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS eset_vuln (
  macchina_uuid TEXT NOT NULL,
  cve TEXT NOT NULL,
  fonte TEXT NOT NULL,
  oggetto TEXT NOT NULL DEFAULT '',
  versione TEXT NOT NULL DEFAULT '',
  gravita TEXT,
  patch INTEGER,
  kev INTEGER NOT NULL DEFAULT 0,
  exploit INTEGER NOT NULL DEFAULT 0,
  cvss REAL
);
CREATE INDEX IF NOT EXISTS idx_eset_vuln_macchina ON eset_vuln(macchina_uuid);
CREATE INDEX IF NOT EXISTS idx_eset_vuln_cve ON eset_vuln(cve);
CREATE TABLE IF NOT EXISTS eset_software (
  macchina_uuid TEXT NOT NULL,
  nome TEXT NOT NULL,
  editore TEXT NOT NULL DEFAULT '',
  versione TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_eset_software_macchina ON eset_software(macchina_uuid);
CREATE INDEX IF NOT EXISTS idx_eset_software_nome ON eset_software(nome);
-- L'aggancio macchina ESET -> host: resta fra un giro e l'altro (Task 3).
CREATE TABLE IF NOT EXISTS eset_abbinamento (
  macchina_uuid TEXT PRIMARY KEY,
  host_id INTEGER,
  per TEXT NOT NULL,
  a_mano INTEGER NOT NULL DEFAULT 0,
  quando TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS eset_giro (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iniziato TEXT NOT NULL,
  finito TEXT,
  esito TEXT NOT NULL,
  macchine INTEGER,
  vulnerabilita INTEGER,
  software INTEGER,
  dettaglio TEXT
);
`;

export function assicuraSchemaEset(db: Database.Database): void {
  db.exec(SCHEMA);
}

export function esetDaDalinkAcceso(db: Database.Database): boolean {
  const r = db.prepare("SELECT value FROM tenant_settings WHERE key = ?").get(CHIAVE_ESET_DALINK) as { value: string } | undefined;
  return r?.value === "1";
}

export function impostaEsetDaDalink(db: Database.Database, acceso: boolean): void {
  db.prepare(
    `INSERT INTO tenant_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
  ).run(CHIAVE_ESET_DALINK, acceso ? "1" : "0");
}

export interface VulnEset {
  cve: string;
  fonte: FonteVulnEset;
  oggetto: string;
  versione: string;
  gravita: string | null;
  patch: boolean | null;
  kev: boolean;
  exploit: boolean;
  cvss: number | null;
}
export interface SoftwareEset { nome: string; editore: string; versione: string }
export interface MacchinaEset {
  uuid: string;
  nome: string;
  hostname: string | null;
  mac: string[];
  seriale: string | null;
  ip_locale: string | null;
  sistema: string | null;
  console: string | null;
  protezione: string | null;
  ultimo_contatto: string | null;
  vulnerabilita: VulnEset[];
  software: SoftwareEset[];
}
export interface RispostaEset { codcli: string; macchine: MacchinaEset[] }

const testo = (v: unknown, max = 500): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const elenco = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x)) : [];

/**
 * Legge la risposta di DA-Link al confine. Rifiuta (con il motivo) ciò che non è della versione
 * attesa o non è di questa istanza; il resto lo normalizza. Mai un'eccezione: è dato altrui.
 */
export function leggiRispostaEset(corpo: string, codcliAtteso: string): { ok: true; dati: RispostaEset } | { ok: false; motivo: string } {
  let v: unknown;
  try {
    v = JSON.parse(corpo);
  } catch {
    return { ok: false, motivo: "DA-Link ha mandato una risposta non leggibile" };
  }
  if (typeof v !== "object" || v === null || Array.isArray(v)) return { ok: false, motivo: "DA-Link ha mandato una risposta di forma inattesa" };
  const o = v as Record<string, unknown>;
  if (o.versione !== VERSIONE_CONTRATTO) return { ok: false, motivo: `versione del contratto inattesa (${String(o.versione).slice(0, 20)})` };
  // Secondo controllo del cliente, a questa estremità: la risposta di un altro cliente non si scrive.
  if (typeof o.codcli !== "string" || o.codcli !== codcliAtteso) return { ok: false, motivo: "la risposta è di un altro cliente: non scritta" };
  if (!Array.isArray(o.macchine)) return { ok: false, motivo: "nella risposta manca l'elenco delle macchine" };

  const macchine: MacchinaEset[] = [];
  const viste = new Set<string>();
  for (const m of elenco(o.macchine)) {
    const uuid = testo(m.uuid, 64);
    if (!uuid || viste.has(uuid)) continue;
    viste.add(uuid);
    const vulnerabilita: VulnEset[] = [];
    for (const x of elenco(m.vulnerabilita)) {
      const cve = testo(x.cve, 40);
      const fonte = FONTI_VULN_ESET.find((f) => f === x.fonte);
      if (!cve || !fonte) continue;
      vulnerabilita.push({
        cve,
        fonte,
        oggetto: testo(x.oggetto, 300) ?? "",
        versione: testo(x.versione, 300) ?? "",
        gravita: testo(x.gravita, 40),
        patch: typeof x.patch === "boolean" ? x.patch : null,
        kev: x.kev === true,
        exploit: x.exploit_pubblico === true,
        cvss: typeof x.cvss === "number" && Number.isFinite(x.cvss) ? x.cvss : null,
      });
    }
    const software: SoftwareEset[] = [];
    for (const x of elenco(m.software)) {
      const nome = testo(x.nome, 300);
      if (nome) software.push({ nome, editore: testo(x.editore, 300) ?? "", versione: testo(x.versione, 120) ?? "" });
    }
    macchine.push({
      uuid,
      nome: testo(m.nome, 200) ?? uuid,
      hostname: testo(m.hostname, 255),
      mac: Array.isArray(m.mac) ? m.mac.filter((x): x is string => typeof x === "string").map((x) => x.trim().toLowerCase().replace(/-/g, ":")).filter((x) => /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/.test(x)) : [],
      seriale: testo(m.seriale, 120),
      ip_locale: testo(m.ip_locale, 64),
      sistema: testo(m.sistema, 200),
      console: CONSOLE_ESET.find((c) => c === m.console) ?? null,
      protezione: testo(m.protezione, 40),
      ultimo_contatto: testo(m.ultimo_contatto, 40),
      vulnerabilita,
      software,
    });
  }
  return { ok: true, dati: { codcli: o.codcli, macchine } };
}

export interface ContiEset { macchine: number; vulnerabilita: number; software: number }

/** Quante macchine aveva visto l'ultimo giro riuscito (0 se mai). */
export function ultimeMacchineEset(db: Database.Database): number {
  const r = db.prepare("SELECT macchine FROM eset_giro WHERE esito = 'ok' ORDER BY id DESC LIMIT 1").get() as { macchine: number | null } | undefined;
  return r?.macchine ?? 0;
}

/** Sostituisce la copia intera in una transazione. Gli agganci di macchine sparite si tolgono. */
export function scriviCopiaEset(db: Database.Database, dati: RispostaEset, ora: Date): ContiEset {
  const letto = ora.toISOString();
  const conti: ContiEset = { macchine: 0, vulnerabilita: 0, software: 0 };
  db.transaction(() => {
    db.exec("DELETE FROM eset_vuln; DELETE FROM eset_software; DELETE FROM eset_macchina;");
    const insM = db.prepare("INSERT INTO eset_macchina (uuid, nome, hostname, mac, seriale, ip_locale, sistema, console, protezione, ultimo_contatto, letto_il) VALUES (?,?,?,?,?,?,?,?,?,?,?)");
    const insV = db.prepare("INSERT INTO eset_vuln (macchina_uuid, cve, fonte, oggetto, versione, gravita, patch, kev, exploit, cvss) VALUES (?,?,?,?,?,?,?,?,?,?)");
    const insS = db.prepare("INSERT INTO eset_software (macchina_uuid, nome, editore, versione) VALUES (?,?,?,?)");
    for (const m of dati.macchine) {
      insM.run(m.uuid, m.nome, m.hostname, JSON.stringify(m.mac), m.seriale, m.ip_locale, m.sistema, m.console, m.protezione, m.ultimo_contatto, letto);
      conti.macchine++;
      for (const v of m.vulnerabilita) {
        insV.run(m.uuid, v.cve, v.fonte, v.oggetto, v.versione, v.gravita, v.patch === null ? null : v.patch ? 1 : 0, v.kev ? 1 : 0, v.exploit ? 1 : 0, v.cvss);
        conti.vulnerabilita++;
      }
      for (const s of m.software) {
        insS.run(m.uuid, s.nome, s.editore, s.versione);
        conti.software++;
      }
    }
    db.exec("DELETE FROM eset_abbinamento WHERE macchina_uuid NOT IN (SELECT uuid FROM eset_macchina)");
  })();
  return conti;
}

export type EsitoGiroEset =
  | { esito: "spento" | "non_configurato"; dettaglio: string }
  | { esito: "errore"; dettaglio: string }
  | ({ esito: "ok" } & ContiEset);

export interface DipendenzeGiroEset {
  /** Il database del cliente dell'istanza. */
  db: Database.Database;
  /** Il codice cliente dell'istanza per DA-Link (`DALINK_CODCLI`). */
  codcli: string;
  /** Chiede a DA-Link: stato HTTP e corpo, oppure rifiuta per rete, certificato o tempo. */
  chiedi: () => Promise<{ status: number; body: string }>;
  ora?: () => Date;
  /** Dopo una copia riuscita (Task 3: riaggancio agli host). Un suo guasto non annulla la copia. */
  dopo?: (db: Database.Database) => void;
}

/** Un giro: spento non chiama nessuno; ogni esito lascia una riga in `eset_giro`. */
export async function giroEset(d: DipendenzeGiroEset): Promise<EsitoGiroEset> {
  assicuraSchemaEset(d.db);
  if (!esetDaDalinkAcceso(d.db)) return { esito: "spento", dettaglio: "lettura dei dati ESET da DA-Link spenta per questo cliente" };
  const ora = d.ora ?? (() => new Date());
  const id = Number(d.db.prepare("INSERT INTO eset_giro (iniziato, esito) VALUES (?, 'in corso')").run(ora().toISOString()).lastInsertRowid);
  const fallito = (dettaglio: string): EsitoGiroEset => {
    d.db.prepare("UPDATE eset_giro SET finito = ?, esito = 'errore', dettaglio = ? WHERE id = ?").run(ora().toISOString(), dettaglio.slice(0, 300), id);
    return { esito: "errore", dettaglio };
  };
  let r: { status: number; body: string };
  try {
    r = await d.chiedi();
  } catch (e) {
    return fallito(`DA-Link non raggiunto (${e instanceof Error ? e.name : "errore"}): resta la copia di prima`);
  }
  if (r.status !== 200) return fallito(`DA-Link ha risposto ${r.status}: resta la copia di prima`);
  const letta = leggiRispostaEset(r.body, d.codcli);
  if (!letta.ok) return fallito(letta.motivo);
  if (letta.dati.macchine.length === 0 && ultimeMacchineEset(d.db) > 0) {
    return fallito("DA-Link ha dato zero macchine dopo un giro che ne aveva viste: rifiutato, resta la copia di prima");
  }
  let conti: ContiEset;
  try {
    conti = scriviCopiaEset(d.db, letta.dati, ora());
  } catch (e) {
    return fallito(`copia non scritta (${e instanceof Error ? e.name : "errore"}): resta quella di prima`);
  }
  try {
    d.dopo?.(d.db);
  } catch (e) {
    console.error("[eset] dopo la copia:", e instanceof Error ? e.message : "errore imprevisto");
  }
  d.db.prepare("UPDATE eset_giro SET finito = ?, esito = 'ok', macchine = ?, vulnerabilita = ?, software = ? WHERE id = ?")
    .run(ora().toISOString(), conti.macchine, conti.vulnerabilita, conti.software, id);
  d.db.exec("DELETE FROM eset_giro WHERE id NOT IN (SELECT id FROM eset_giro ORDER BY id DESC LIMIT 200)");
  return { esito: "ok", ...conti };
}
