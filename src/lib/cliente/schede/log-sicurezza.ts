import type Database from "better-sqlite3";
import { FUSO_UTENTI, parseDbDate } from "@/lib/db-date";
import { fraseAvviso } from "../frasi-avvisi";
import { nelCliente, moduloAttivo, type ContestoCliente } from "../contesto";
import type { Gravita, RiquadroCliente, SchedaCliente, VoceAttenzione } from "../registro";

export interface TipoAvviso {
  gravita: Gravita;
  /** fraseAvviso(rule_description); descrizione vuota → «Avviso». */
  testo: string;
  /** Righe del tipo negli ultimi 7 giorni. */
  avvisi: number;
  /** agent_name distinti; i vuoti non contano. */
  computer: number;
  /** last_seen_at più recente del tipo. */
  ultima: string;
}

export interface LogSicurezza {
  sottoControllo: number;
  totaleComputer: number;
  /** Sette giorni, dal più vecchio a oggi. `giorno` è YYYY-MM-DD in ora italiana. */
  perGiorno: Array<{ giorno: string; avvisi: number }>;
  /** Al più 30, i più gravi prima. */
  tipi: TipoAvviso[];
  /** Somma di perGiorno. */
  totaleSettimana: number;
}

const MASSIMO_TIPI = 30;
const MASSIMO_VOCI = 3;
const GIORNI = 7;
const PESO: Record<Gravita, number> = { grave: 0, attenzione: 1, nota: 2 };

interface RigaFinestra {
  rule_level: number;
  rule_description: string | null;
  agent_name: string | null;
  last_seen_at: string;
}

function pulito(v: string | null | undefined): string | null {
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

function fraseDi(descrizione: string | null): string {
  const t = pulito(descrizione);
  return t ? fraseAvviso(t) : "Avviso";
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

function righeNellaFinestra(db: Database.Database, giorni: readonly string[]): RigaFinestra[] {
  if (!tabella(db, "wazuh_alert_event")) return [];
  const dal = new Date(mezzanotteItaliana(giorni[0] ?? "")).toISOString();
  return db.prepare(`
    SELECT rule_level, rule_description, agent_name, last_seen_at
    FROM wazuh_alert_event
    WHERE diagnostic = 0 AND last_seen_at >= ?
  `).all(dal) as RigaFinestra[];
}

function perGiorno(giorni: readonly string[], righe: readonly RigaFinestra[]): LogSicurezza["perGiorno"] {
  const conti = new Map(giorni.map((g) => [g, 0]));
  for (const riga of righe) {
    const giorno = giornoItaliano(parseDbDate(riga.last_seen_at).getTime());
    if (conti.has(giorno)) conti.set(giorno, (conti.get(giorno) ?? 0) + 1);
  }
  return giorni.map((giorno) => ({ giorno, avvisi: conti.get(giorno) ?? 0 }));
}

function tipiDi(giorni: readonly string[], righe: readonly RigaFinestra[]): TipoAvviso[] {
  const nelSet = new Set(giorni);
  const gruppi = new Map<string, { livello: number; avvisi: number; computer: Set<string>; ultima: string; ultimaT: number }>();
  for (const riga of righe) {
    const istante = parseDbDate(riga.last_seen_at).getTime();
    if (Number.isNaN(istante) || !nelSet.has(giornoItaliano(istante))) continue;
    const testo = fraseDi(riga.rule_description);
    let gruppo = gruppi.get(testo);
    if (!gruppo) {
      gruppo = { livello: riga.rule_level, avvisi: 0, computer: new Set(), ultima: riga.last_seen_at, ultimaT: istante };
      gruppi.set(testo, gruppo);
    }
    gruppo.avvisi += 1;
    if (riga.rule_level > gruppo.livello) gruppo.livello = riga.rule_level;
    const computer = pulito(riga.agent_name);
    if (computer) gruppo.computer.add(computer);
    if (istante >= gruppo.ultimaT) {
      gruppo.ultima = riga.last_seen_at;
      gruppo.ultimaT = istante;
    }
  }
  return [...gruppi.entries()]
    .map(([testo, gruppo]) => ({
      gravita: gravitaDi(gruppo.livello),
      testo,
      avvisi: gruppo.avvisi,
      computer: gruppo.computer.size,
      ultima: gruppo.ultima,
    }))
    .sort((a, b) => PESO[a.gravita] - PESO[b.gravita] || b.avvisi - a.avvisi || a.testo.localeCompare(b.testo, "it"))
    .slice(0, MASSIMO_TIPI);
}

/** Va chiamata dentro il contesto del cliente. Conta solo gli avvisi veri (diagnostic = 0) degli ultimi 7 giorni. */
export function logSicurezza(db: Database.Database, ora: Date): LogSicurezza {
  const giorni = setteGiorni(ora);
  let sottoControllo = 0;
  let totaleComputer = 0;
  if (tabella(db, "wazuh_agent")) {
    const computer = db.prepare("SELECT COUNT(*) AS n, SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS accesi FROM wazuh_agent").get() as { n: number; accesi: number | null };
    totaleComputer = computer.n;
    sottoControllo = computer.accesi ?? 0;
  }
  const righe = righeNellaFinestra(db, giorni);
  const barre = perGiorno(giorni, righe);
  return {
    sottoControllo,
    totaleComputer,
    perGiorno: barre,
    tipi: tipiDi(giorni, righe),
    totaleSettimana: barre.reduce((n, g) => n + g.avvisi, 0),
  };
}

function contestoRiquadro(tipi: number): string {
  const n = tipi === 1 ? "1 tipo" : `${tipi} tipi`;
  return `avvisi in 7 giorni · ${n}`;
}

function riquadroLog(c: ContestoCliente): RiquadroCliente {
  return nelCliente(c, (db) => {
    const log = logSicurezza(db, c.ora);
    const gravi = log.tipi.filter((t) => t.gravita === "grave").length;
    const attenzioni = log.tipi.filter((t) => t.gravita === "attenzione").length;
    return {
      numero: String(log.totaleSettimana),
      contesto: contestoRiquadro(log.tipi.length),
      aperti: gravi + attenzioni,
      stato: gravi > 0 ? "grave" : attenzioni > 0 ? "attenzione" : "a_posto",
    };
  });
}

function attenzioneLog(c: ContestoCliente): VoceAttenzione[] {
  return nelCliente(c, (db) =>
    logSicurezza(db, c.ora).tipi
      .filter((t) => t.gravita === "grave")
      .slice(0, MASSIMO_VOCI)
      .map((t) => ({
        gravita: "grave" as const,
        testo: `${t.testo} · ${contoTipo(t.avvisi, t.computer)}`,
        href: "/cliente/log-sicurezza",
        scheda: "Log di sicurezza",
      })),
  );
}

/** «2 avvisi su 3 computer», «1 avviso», «1 avviso su 1 computer». Con zero computer non si dice «su». */
export function contoTipo(avvisi: number, computer: number): string {
  const quantiAvvisi = avvisi === 1 ? "1 avviso" : `${avvisi} avvisi`;
  if (computer <= 0) return quantiAvvisi;
  const quantiComputer = computer === 1 ? "1 computer" : `${computer} computer`;
  return `${quantiAvvisi} su ${quantiComputer}`;
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
