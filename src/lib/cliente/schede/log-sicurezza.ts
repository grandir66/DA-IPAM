import type Database from "better-sqlite3";
import { FUSO_UTENTI, parseDbDate } from "@/lib/db-date";
import { fraseAvviso } from "../frasi-avvisi";
import { nelCliente, moduloAttivo, type ContestoCliente } from "../contesto";
import type { Gravita, RiquadroCliente, SchedaCliente, VoceAttenzione } from "../registro";

export interface AvvisoCliente {
  gravita: Gravita;
  testo: string;
  dove: string | null;
  chi: string | null;
  quando: string;
  volte: number;
}

export interface LogSicurezza {
  sottoControllo: number;
  totaleComputer: number;
  /** Sette giorni, dal più vecchio a oggi. `giorno` è YYYY-MM-DD in ora italiana. */
  perGiorno: Array<{ giorno: string; avvisi: number }>;
  aperti: AvvisoCliente[];
  totaleAperti: number;
  chiusiNelMese: number;
}

const MASSIMO_APERTI = 30;
const MASSIMO_VOCI = 5;
const GIORNI = 7;
const GIORNI_MESE = 30;
const PESO: Record<Gravita, number> = { grave: 0, attenzione: 1, nota: 2 };

interface RigaAvviso {
  rule_level: number;
  rule_description: string | null;
  agent_name: string | null;
  target_user: string | null;
  last_seen_at: string;
  occurrence_count: number;
}

function testo(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

function tabella(db: Database.Database, nome: string): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(nome);
}

function gravitaDi(livello: number): Gravita {
  if (livello >= 12) return "grave";
  if (livello >= 7) return "attenzione";
  return "nota";
}

/** Giorno di calendario italiano (YYYY-MM-DD), come in kpi-dashboard. */
function giornoItaliano(t: number): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: FUSO_UTENTI, year: "numeric", month: "2-digit", day: "2-digit" }).format(t);
}

function mezzanotteItaliana(giorno: string): number {
  const [y, m, d] = giorno.split("-").map(Number);
  const utc = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  const ore = Number(new Intl.DateTimeFormat("en-GB", { timeZone: FUSO_UTENTI, hour: "2-digit", hourCycle: "h23" }).format(utc));
  return utc - ore * 3_600_000;
}

function giornoPiu(giorno: string, delta: number): string {
  const [y, m, d] = giorno.split("-").map(Number);
  const data = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + delta));
  const mese = String(data.getUTCMonth() + 1).padStart(2, "0");
  const giornoMese = String(data.getUTCDate()).padStart(2, "0");
  return `${data.getUTCFullYear()}-${mese}-${giornoMese}`;
}

function setteGiorni(ora: Date): string[] {
  const oggi = giornoItaliano(ora.getTime());
  const giorni: string[] = [];
  for (let i = GIORNI - 1; i >= 0; i--) giorni.push(giornoPiu(oggi, -i));
  return giorni;
}

/** `acknowledged_at` è scritto con datetime('now'): lo spazio, non la T dell'ISO. */
function istanteSql(data: Date): string {
  return data.toISOString().slice(0, 19).replace("T", " ");
}

function avvisoDi(riga: RigaAvviso): AvvisoCliente {
  return {
    gravita: gravitaDi(riga.rule_level),
    testo: fraseAvviso(testo(riga.rule_description) ?? "Avviso"),
    dove: testo(riga.agent_name),
    chi: testo(riga.target_user),
    quando: riga.last_seen_at,
    volte: riga.occurrence_count,
  };
}

function perGiorno(db: Database.Database, ora: Date): LogSicurezza["perGiorno"] {
  const giorni = setteGiorni(ora);
  const conti = new Map(giorni.map((g) => [g, 0]));
  if (!tabella(db, "wazuh_alert_event")) return giorni.map((giorno) => ({ giorno, avvisi: 0 }));
  const dal = new Date(mezzanotteItaliana(giorni[0] ?? giornoItaliano(ora.getTime()))).toISOString();
  const righe = db.prepare(`
    SELECT last_seen_at FROM wazuh_alert_event
    WHERE diagnostic = 0 AND last_seen_at >= ?
  `).all(dal) as Array<{ last_seen_at: string }>;
  for (const riga of righe) {
    const giorno = giornoItaliano(parseDbDate(riga.last_seen_at).getTime());
    if (conti.has(giorno)) conti.set(giorno, (conti.get(giorno) ?? 0) + 1);
  }
  return giorni.map((giorno) => ({ giorno, avvisi: conti.get(giorno) ?? 0 }));
}

/** Va chiamata dentro il contesto del cliente. Conta solo gli avvisi veri (diagnostic = 0). */
export function logSicurezza(db: Database.Database, ora: Date): LogSicurezza {
  const giorni = perGiorno(db, ora);
  let sottoControllo = 0;
  let totaleComputer = 0;
  if (tabella(db, "wazuh_agent")) {
    const computer = db.prepare("SELECT COUNT(*) AS n, SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS accesi FROM wazuh_agent").get() as { n: number; accesi: number | null };
    totaleComputer = computer.n;
    sottoControllo = computer.accesi ?? 0;
  }
  if (!tabella(db, "wazuh_alert_event")) {
    return { sottoControllo, totaleComputer, perGiorno: giorni, aperti: [], totaleAperti: 0, chiusiNelMese: 0 };
  }
  const totaleAperti = (db.prepare(
    "SELECT COUNT(*) AS n FROM wazuh_alert_event WHERE diagnostic = 0 AND acknowledged = 0",
  ).get() as { n: number }).n;
  const dalMese = istanteSql(new Date(ora.getTime() - GIORNI_MESE * 24 * 3_600_000));
  const chiusiNelMese = (db.prepare(`
    SELECT COUNT(*) AS n FROM wazuh_alert_event
    WHERE diagnostic = 0 AND acknowledged = 1 AND acknowledged_at >= ?
  `).get(dalMese) as { n: number }).n;
  const righe = db.prepare(`
    SELECT rule_level, rule_description, agent_name, target_user, last_seen_at, occurrence_count
    FROM wazuh_alert_event
    WHERE diagnostic = 0 AND acknowledged = 0
    ORDER BY CASE WHEN rule_level >= 12 THEN 0 WHEN rule_level >= 7 THEN 1 ELSE 2 END,
             last_seen_at DESC
    LIMIT ?
  `).all(MASSIMO_APERTI) as RigaAvviso[];
  const aperti = righe.map(avvisoDi).sort((a, b) => PESO[a.gravita] - PESO[b.gravita] || b.quando.localeCompare(a.quando));
  return { sottoControllo, totaleComputer, perGiorno: giorni, aperti, totaleAperti, chiusiNelMese };
}

function contestoRiquadro(chiusi: number): string {
  const n = chiusi === 1 ? "1 chiuso nel mese" : `${chiusi} chiusi nel mese`;
  return `avvisi aperti · ${n}`;
}

function riquadroLog(c: ContestoCliente): RiquadroCliente {
  return nelCliente(c, (db) => {
    const log = logSicurezza(db, c.ora);
    const grave = log.aperti.some((a) => a.gravita === "grave");
    return {
      numero: String(log.totaleAperti),
      contesto: contestoRiquadro(log.chiusiNelMese),
      aperti: log.totaleAperti,
      stato: grave ? "grave" : log.totaleAperti > 0 ? "attenzione" : "a_posto",
    };
  });
}

function attenzioneLog(c: ContestoCliente): VoceAttenzione[] {
  return nelCliente(c, (db) =>
    logSicurezza(db, c.ora).aperti
      .filter((a) => a.gravita === "grave")
      .slice(0, MASSIMO_VOCI)
      .map((a) => ({
        gravita: "grave" as const,
        testo: a.dove ? `${a.testo} su ${a.dove}` : a.testo,
        href: "/cliente/log-sicurezza",
        scheda: "Log di sicurezza",
      })),
  );
}

export const schedaLogSicurezza: SchedaCliente = {
  id: "log-sicurezza",
  titolo: "Log di sicurezza",
  ordine: 50,
  icona: "FileText",
  attiva: (c) => moduloAttivo(c, "siem"),
  riquadro: riquadroLog,
  attenzione: attenzioneLog,
};
