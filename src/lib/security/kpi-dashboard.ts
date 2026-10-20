/**
 * KPI di sicurezza della dashboard (Riccardo, 20/10), letti dal DB del cliente:
 * - vulnerabilità dello Scanner-Edge (`vuln_findings`): critiche e alte, distinte come
 *   le conta la pagina Vulnerabilità (CVE, oppure l'NVT quando la CVE non c'è) e host colpiti;
 * - accessi falliti (4625) e account bloccati (4740) dagli alert di Wazuh
 *   (`wazuh_alert_event`, solo non diagnostici), alert da gestire;
 * - ultima Health di Active Directory riuscita e se l'ultimo tentativo è fallito.
 *
 * Gli alert sono salvati raggruppati: una riga = N occorrenze fra `first_seen_at` e
 * `last_seen_at`, e sull'hub un gruppo resta aperto per mesi. Revisione del 20/10:
 * contare tutto nel giorno dell'ultima occorrenza dava 41.223 accessi falliti nelle
 * ultime 24 ore contro circa 530. Ogni gruppo si ripartisce in proporzione sulla sua
 * durata: resta un'approssimazione (scelta di Riccardo: niente contatore giornaliero).
 * Date degli alert ISO con la «T» (CLAUDE.md, regola 9): si leggono in JavaScript.
 * Giorni della serie in ora italiana.
 */
import type Database from "better-sqlite3";
import { FUSO_UTENTI } from "@/lib/db-date";

export interface KpiSicurezza {
  cve: { critiche: { cve: number; host: number }; alte: { cve: number; host: number }; ultimaScansione: string | null } | null;
  accessi: {
    falliti24h: number;
    falliti24hPrima: number;
    bloccati30g: number;
    daGestire: number;
    /** Ultimi 14 giorni (ora italiana), dal più vecchio a oggi. */
    serie: { giorno: string; falliti: number; bloccati: number }[];
    /** Ultime 24 ore, ora per ora (ora italiana «HH»), dalla più vecchia all'ora in corso. */
    serie24h: { ora: string; falliti: number; bloccati: number }[];
  } | null;
  healthAd: { critici: number; alti: number; punteggio: number | null; giorni: number; ultimoFallito: boolean } | null;
}

function esiste(db: Database.Database, tabella: string): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(tabella);
}

const ORA_MS = 3_600_000;

/** Giorno di calendario italiano (YYYY-MM-DD) di un istante. */
function giornoItaliano(t: number): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: FUSO_UTENTI, year: "numeric", month: "2-digit", day: "2-digit" }).format(t);
}

/** Mezzanotte italiana del giorno YYYY-MM-DD, come istante. */
function mezzanotteItaliana(giorno: string): number {
  const [y, m, d] = giorno.split("-").map(Number);
  const utc = Date.UTC(y, m - 1, d);
  const ore = Number(new Intl.DateTimeFormat("en-GB", { timeZone: FUSO_UTENTI, hour: "2-digit", hourCycle: "h23" }).format(utc));
  return utc - ore * ORA_MS;
}

interface Gruppo { evento: string; n: number; da: number; a: number }

/** Occorrenze del gruppo cadute in [inizio, fine), ripartite in proporzione sulla sua durata. */
export function quoteNellIntervallo(g: Gruppo, inizio: number, fine: number): number {
  if (g.a <= g.da) return g.a >= inizio && g.a < fine ? g.n : 0;
  const sovrapposto = Math.max(0, Math.min(g.a, fine) - Math.max(g.da, inizio));
  return (g.n * sovrapposto) / (g.a - g.da);
}

export function kpiSicurezza(db: Database.Database, ora: Date = new Date()): KpiSicurezza {
  let cve: KpiSicurezza["cve"] = null;
  if (esiste(db, "vuln_findings")) {
    // Come la pagina Vulnerabilità: la CVE, oppure l'NVT quando la CVE manca.
    const per = (s: string) =>
      db.prepare(
        "SELECT COUNT(DISTINCT COALESCE(cve_id, 'nvt:' || nvt_oid)) AS cve, COUNT(DISTINCT host_id) AS host FROM vuln_findings WHERE severity = ?",
      ).get(s) as { cve: number; host: number };
    const ultima = (db.prepare("SELECT MAX(scanned_at) AS u FROM vuln_findings").get() as { u: string | null }).u;
    cve = { critiche: per("Critical"), alte: per("High"), ultimaScansione: ultima };
  }

  let accessi: KpiSicurezza["accessi"] = null;
  if (esiste(db, "wazuh_alert_event")) {
    const adesso = ora.getTime();
    const oggi = giornoItaliano(adesso);
    const giorni = Array.from({ length: 14 }, (_, i) => giornoItaliano(mezzanotteItaliana(oggi) - (13 - i) * 24 * ORA_MS + 12 * ORA_MS));
    const inizioFinestre = Math.min(mezzanotteItaliana(giorni[0]), adesso - 30 * 24 * ORA_MS);
    const gruppi: Gruppo[] = (db.prepare(
      `SELECT event_id, occurrence_count, first_seen_at, last_seen_at FROM wazuh_alert_event
        WHERE diagnostic = 0 AND event_id IN ('4625', '4740')`,
    ).all() as { event_id: string; occurrence_count: number; first_seen_at: string; last_seen_at: string }[])
      .map((r) => ({ evento: r.event_id, n: r.occurrence_count, da: Date.parse(r.first_seen_at), a: Date.parse(r.last_seen_at) }))
      .filter((g) => Number.isFinite(g.da) && Number.isFinite(g.a) && g.a >= inizioFinestre);
    const somma = (evento: string, inizio: number, fine: number) =>
      Math.round(gruppi.filter((g) => g.evento === evento).reduce((s, g) => s + quoteNellIntervallo(g, inizio, fine), 0));
    accessi = {
      falliti24h: somma("4625", adesso - 24 * ORA_MS, adesso + 1),
      falliti24hPrima: somma("4625", adesso - 48 * ORA_MS, adesso - 24 * ORA_MS),
      bloccati30g: somma("4740", adesso - 30 * 24 * ORA_MS, adesso + 1),
      daGestire: (db.prepare("SELECT COUNT(*) AS n FROM wazuh_alert_event WHERE acknowledged = 0 AND diagnostic = 0").get() as { n: number }).n,
      serie24h: Array.from({ length: 24 }, (_, i) => {
        // Ore piene: l'ultima è quella in corso, fino ad adesso.
        const fine = i === 23 ? adesso + 1 : Math.floor(adesso / ORA_MS) * ORA_MS - (22 - i) * ORA_MS;
        const inizio = Math.floor(adesso / ORA_MS) * ORA_MS - (23 - i) * ORA_MS;
        const ora = new Intl.DateTimeFormat("en-GB", { timeZone: FUSO_UTENTI, hour: "2-digit", hourCycle: "h23" }).format(inizio);
        return { ora, falliti: somma("4625", inizio, fine), bloccati: somma("4740", inizio, fine) };
      }),
      serie: giorni.map((g) => {
        const inizio = mezzanotteItaliana(g);
        const fine = g === oggi ? adesso + 1 : inizio + 24 * ORA_MS;
        return { giorno: g, falliti: somma("4625", inizio, fine), bloccati: somma("4740", inizio, fine) };
      }),
    };
  }

  let healthAd: KpiSicurezza["healthAd"] = null;
  if (esiste(db, "ad_health_runs") && esiste(db, "ad_health_findings")) {
    const run = db.prepare("SELECT id, started_at, score_global FROM ad_health_runs WHERE status = 'ok' ORDER BY id DESC LIMIT 1")
      .get() as { id: number; started_at: string; score_global: number | null } | undefined;
    const ultimo = db.prepare("SELECT id, status FROM ad_health_runs ORDER BY id DESC LIMIT 1").get() as { id: number; status: string } | undefined;
    if (run) {
      const conta = (s: string) =>
        (db.prepare("SELECT COUNT(*) AS n FROM ad_health_findings WHERE run_id = ? AND severity = ?").get(run.id, s) as { n: number }).n;
      healthAd = {
        critici: conta("Critical"),
        alti: conta("High"),
        punteggio: run.score_global,
        giorni: Math.floor((ora.getTime() - Date.parse(run.started_at)) / (24 * ORA_MS)),
        ultimoFallito: !!ultimo && ultimo.id !== run.id && ultimo.status === "error",
      };
    }
  }
  return { cve, accessi, healthAd };
}
