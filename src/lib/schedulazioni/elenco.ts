/**
 * La pagina Schedulazioni (tavola del 22/10, oggetti 21-30): tutto ciò che parte da solo, in un elenco unico. Le fonti
 * erano sparse in sei posti (censimento in TASKS.md del 22/10): i job del cliente (`scheduled_jobs`, anche quelli per rete
 * e per controller), le scansioni Edge per rete (`edge_scan_schedules`, girano sulla sonda), i timer di `server.ts`.
 *
 * Qui non si configura niente: ogni riga dice cosa, su cosa, quando, il prossimo giro e l'ultimo esito, e porta alla
 * pagina che la configura oggi («Dove ›»). Accendere e spegnere passa dalle funzioni che esistono già: le righe che in
 * Opzioni hanno una riga loro (job di serie, pulizia, controller, Chocolatey, dati sugli exploit) dalla stessa opzione,
 * così la lapide e il «spento da … il …» restano gli stessi; gli altri job dal loro interruttore, come la pagina dei job.
 */
import { getCurrentTenantCode, getHypervisorSyncSchedule, getScheduledJobs, getTenantDb, listNetworksLite } from "@/lib/db-tenant";
import { parseDbDate } from "@/lib/db-date";
import { ETICHETTE_JOB, scheduledJobLabel, unifiJobKind } from "@/lib/scheduled-job-types";
import type { ScheduledJob } from "@/types";
import { statoScheduler, chiaveJob } from "@/lib/cron/stato-scheduler";
import { findStaleJobs } from "@/lib/health/scheduler-freshness";
import { eJobRiservato } from "@/lib/cron/job-riservati";
import { idOpzioneDelJob } from "@/lib/opzioni/ancore";
import { catalogo, leggiStato, oraItaliana } from "@/lib/opzioni/catalogo";
import type { TipoEsito } from "@/lib/opzioni/tipi";
import { listControllerViews } from "@/lib/controllers/service";
import { getMdmConfig } from "@/lib/integrations/mdm-config";
import { etichettaFrequenza, frequenzaDaJob, leggiConfig, prossimaEsecuzione } from "@/lib/apparati-scelti/regole";
import { listEdgeSchedules } from "@/lib/vuln/edge-schedule-store";
import { elencoPianificazioni, quandoInParole } from "@/lib/vuln/proposta/pianificazione";
import { ETICHETTE_FAMIGLIA as ETICHETTE_FAMIGLIE_VA } from "@/lib/vuln/proposta/regole";
import { describeCron, describeFinestra, type Frequency } from "@/lib/vuln/cron-builder";
import { ultimoBackup } from "@/lib/backup/engine";
import { statoCalcolo } from "@/lib/mappa-porte/calcolo";
import { getNotificationConfig } from "@/lib/notifications/config";
import { leggiConfigDalink } from "@/lib/dalink/config";
import { statoSegnale } from "@/lib/dalink/stato";

export type Famiglia = "reti" | "apparati" | "moduli" | "appliance";
export type StatoRiga = "acceso" | "spento" | "da_configurare";
export type Cambio = { tipo: "opzione"; id: string } | { tipo: "job"; id: number };

export interface RigaSchedulazione {
  /** `job.<id>` · `controller.<id>` · `controller.nessuno` · `edge.<rete>` · `device.<rete>` · `timer.<nome>`. */
  id: string;
  famiglia: Famiglia;
  nome: string;
  cosa: string;
  su: string;
  quando: string;
  /** Il prossimo giro, UTC come lo scrive SQLite; null = non si sa da qui. */
  prossimo: string | null;
  stato: StatoRiga;
  /** Sempre attivo, senza interruttore: i timer dell'appliance (oggetto «SEMPRE» col lucchetto). */
  fisso: boolean;
  esito: { tipo: TipoEsito; testo: string };
  dove: { href: string; etichetta: string } | null;
  /** Come si accende e si spegne da qui; null = non da qui (`perche` dice dove). */
  cambio: Cambio | null;
  /** Il job da lanciare con «Esegui ora» (`POST /api/jobs/[id]/run`); null = non è un job. */
  jobId: number | null;
  /** Il tipo del job (`scheduled_jobs.job_type`), per le azioni della riga: «Modifica» e gli esiti di `apparati_scelti`. */
  jobTipo?: string;
  perche?: string;
}

export const ETICHETTE_FAMIGLIA: Record<Famiglia, string> = { reti: "Reti", apparati: "Apparati", moduli: "Moduli", appliance: "Appliance" };

// ── Aiuti ────────────────────────────────────────────────────────────────────

const esito = (tipo: TipoEsito, testo: string) => ({ tipo, testo });
const dataSqlite = (d: Date): string => d.toISOString().slice(0, 19).replace("T", " ");

function ogni(m: number): string {
  if (m % 1440 === 0) return m === 1440 ? "ogni giorno" : `ogni ${m / 1440} giorni`;
  if (m % 60 === 0) return m === 60 ? "ogni ora" : `ogni ${m / 60} ore`;
  return `ogni ${m} minuti`;
}

/** Un testo d'errore in una riga: niente a capo, al più 160 caratteri. */
function taglia(t: string): string {
  const una = t.replace(/\s+/g, " ").trim();
  return una.length > 160 ? `${una.slice(0, 157)}…` : una;
}

/** Il prossimo scatto di un cron «M H * * *» registrato senza fuso: vale l'ora del server. */
function prossimaOraServer(h: number, m: number, adesso: Date): Date {
  const d = new Date(adesso);
  d.setHours(h, m, 0, 0);
  if (d.getTime() <= adesso.getTime()) d.setDate(d.getDate() + 1);
  return d;
}

/** Il prossimo scatto di «ogni N minuti» allineato all'ora (cron «*\/N»). */
function prossimoOgniMinuti(n: number, adesso: Date): Date {
  const d = new Date(adesso);
  d.setSeconds(0, 0);
  d.setMinutes(Math.floor(d.getMinutes() / n) * n + n);
  return d;
}

/** Cron «minuto ogni N ore»: es. 17 ogni 6 ore. */
function prossimaOgniOreAlMinuto(ore: number, minuto: number, adesso: Date): Date {
  const d = new Date(adesso);
  d.setSeconds(0, 0);
  d.setMilliseconds(0);
  d.setMinutes(minuto);
  d.setHours(Math.floor(adesso.getHours() / ore) * ore);
  if (d.getTime() <= adesso.getTime()) d.setHours(d.getHours() + ore);
  return d;
}

/** Cron «M H * * 1»: prossimo lunedì a quell'ora del server. */
function prossimoLunedi(h: number, m: number, adesso: Date): Date {
  const d = new Date(adesso);
  d.setHours(h, m, 0, 0);
  d.setDate(d.getDate() + ((1 - d.getDay() + 7) % 7));
  if (d.getTime() <= adesso.getTime()) d.setDate(d.getDate() + 7);
  return d;
}

function tenant(): string {
  const t = getCurrentTenantCode();
  if (!t) throw new Error("contesto del cliente assente");
  return t;
}

// ── Job del cliente ──────────────────────────────────────────────────────────

const FAMIGLIA_JOB: Record<string, Famiglia> = {
  ping_sweep: "reti", fast_scan: "reti", snmp_scan: "reti", nmap_scan: "reti", known_host_check: "reti", dns_resolve: "reti",
  anomaly_check: "reti", pulizia_host: "reti",
  arp_poll: "apparati", hypervisor_sync: "apparati", unifi_sync: "apparati", apparati_scelti: "apparati", cleanup: "apparati",
  ad_sync: "moduli", librenms_sync: "moduli", vuln_sync: "moduli", wazuh_sync: "moduli", wazuh_alerts_sync: "moduli",
  mdm_sync: "moduli", meshcentral_sync: "moduli",
};

/** Su cosa lavora un job senza rete. */
const SU_JOB: Record<string, string> = {
  arp_poll: "router e switch", dns_resolve: "gli host conosciuti", hypervisor_sync: "gli hypervisor con credenziale",
  pulizia_host: "gli host offline da tempo", cleanup: "le tabelle MAC", anomaly_check: "tutte le reti",
  ad_sync: "Active Directory", librenms_sync: "LibreNMS", vuln_sync: "le sonde Edge", wazuh_sync: "Wazuh",
  wazuh_alerts_sync: "gli allarmi di Wazuh", mdm_sync: "Headwind MDM", meshcentral_sync: "MeshCentral",
};

/** I tipi che in Opzioni hanno UNA riga per il tipo e un job solo: si accendono da quella riga (lapide, «spento da»). */
const TIPI_DA_OPZIONE = new Set(["arp_poll", "dns_resolve", "hypervisor_sync", "pulizia_host"]);

function esitoJob(j: ScheduledJob, adesso: Date): RigaSchedulazione["esito"] {
  if (j.enabled !== 1) return esito("neutro", "spento");
  const f = statoScheduler().fallimenti.jobs.get(chiaveJob(tenant(), j.id));
  if (f && f.consecutiveFailures > 0) {
    const quando = f.lastFailureMs ? `${oraItaliana(dataSqlite(new Date(f.lastFailureMs)), adesso)} · ` : "";
    const di = f.consecutiveFailures > 1 ? ` (${f.consecutiveFailures} di fila)` : "";
    return esito("errore", `${quando}${taglia(f.lastError ?? "errore")}${di}`);
  }
  if (j.job_type === "mdm_sync") {
    const m = getMdmConfig();
    if (m.consecutive_errors > 0) {
      return esito("errore", `${taglia(m.last_error ?? "errore")} (${m.consecutive_errors} di fila su ${m.max_errori})`);
    }
  }
  if (j.job_type === "hypervisor_sync" && getHypervisorSyncSchedule().hypervisors === 0) {
    return esito("attenzione", "mai girata: nessun hypervisor con credenziale");
  }
  if (j.job_type === "apparati_scelti") {
    const righe = getTenantDb(tenant())
      .prepare("SELECT stato, COUNT(*) AS n, MAX(giro_il) AS il FROM job_apparati_esiti WHERE job_id = ? GROUP BY stato")
      .all(j.id) as Array<{ stato: string; n: number; il: string | null }>;
    const tot = righe.reduce((a, r) => a + r.n, 0);
    if (tot > 0) {
      const letti = righe.filter((r) => r.stato === "ok").reduce((a, r) => a + r.n, 0);
      const il = righe.map((r) => r.il).filter((x): x is string => !!x).sort().at(-1) ?? null;
      const testo = `${il ? `${oraItaliana(il, adesso)} · ` : ""}${letti} su ${tot} letti`;
      return esito(letti === tot ? "ok" : "attenzione", testo);
    }
  }
  const [fermo] = findStaleJobs([j], adesso.getTime());
  if (fermo) {
    return esito("attenzione", fermo.neverRan ? "mai girato da quando è stato creato" : `fermo: in ritardo di ${ogni(fermo.overdueMinutes).replace("ogni ", "")}`);
  }
  if (!j.last_run) return esito("neutro", "non ancora girato");
  const o = oraItaliana(j.last_run, adesso);
  return esito("ok", `girato ${o.includes("/") ? "il" : "alle"} ${o}`);
}

function rigaJob(j: ScheduledJob, reti: Map<number, string>, controller: Map<number, string>, adesso: Date): RigaSchedulazione {
  const rete = j.network_id !== null ? reti.get(j.network_id) : undefined;
  const tipo = j.job_type;
  let su = rete ?? SU_JOB[tipo] ?? "—";
  let quando = ogni(j.interval_minutes);
  let prossimo = j.next_run;
  // Dall'11/11/2026 i job si gestiscono in questa pagina: nessun rimando, salvo quelli che hanno una pagina loro.
  let dove: RigaSchedulazione["dove"] = null;
  let cambio: Cambio = { tipo: "job", id: j.id };

  if (TIPI_DA_OPZIONE.has(tipo)) {
    cambio = { tipo: "opzione", id: `job.${tipo}` };
    dove = { href: `/settings/opzioni#job.${tipo}`, etichetta: "Opzioni ›" };
  } else if (tipo === "fast_scan" || tipo === "known_host_check") {
    dove = j.network_id !== null
      ? { href: `/networks/${j.network_id}`, etichetta: "Rete ›" }
      : { href: `/settings/opzioni#job.${tipo}`, etichetta: "Opzioni ›" };
  } else if (tipo === "unifi_sync") {
    const id = idOpzioneDelJob(j);
    if (id.startsWith("controller.")) cambio = { tipo: "opzione", id };
    let cid: number | null = null;
    try {
      const c = (JSON.parse(j.config || "{}") as { controller_id?: unknown }).controller_id;
      cid = typeof c === "number" ? c : null;
    } catch {
      cid = null;
    }
    su = cid !== null ? (controller.get(cid) ?? `controller n. ${cid}`) : "controller";
    if (unifiJobKind(j.config) === "client") quando = "ogni ora dalle 7 alle 20";
    dove = { href: "/controllers", etichetta: "Controller ›" };
  } else if (tipo === "apparati_scelti") {
    const cfg = leggiConfig(j.config);
    su = cfg ? `${cfg.device_ids.length} ${cfg.device_ids.length === 1 ? "apparato scelto" : "apparati scelti"}` : "apparati scelti";
    const f = cfg ? frequenzaDaJob(j.interval_minutes, cfg) : null;
    if (f) {
      quando = etichettaFrequenza(f);
      // `next_run` non vale per questi job (ora italiana, CONTEXT §6): il prossimo lo calcola la regola dello scheduler.
      prossimo = dataSqlite(prossimaEsecuzione(f, adesso));
    } else {
      prossimo = null;
    }
    dove = { href: "/discovery", etichetta: "Discovery ›" };
  } else if (tipo === "mdm_sync") {
    dove = { href: "/settings/mdm", etichetta: "Scheda MDM ›" };
  }

  return {
    id: `job.${j.id}`,
    famiglia: FAMIGLIA_JOB[tipo] ?? "apparati",
    nome: tipo === "fast_scan" ? "Scansione veloce" : scheduledJobLabel(j, ETICHETTE_JOB),
    cosa: "",
    su,
    quando,
    prossimo: j.enabled === 1 ? prossimo : null,
    stato: j.enabled === 1 ? "acceso" : "spento",
    fisso: false,
    esito: esitoJob(j, adesso),
    dove,
    cambio,
    // La pulizia degli host non si lancia a mano (gira solo di notte, `job-riservati.ts`).
    jobId: eJobRiservato(tipo) ? null : j.id,
    jobTipo: tipo,
  };
}

/** I controller senza job degli apparati (spenti), o la riga che chiede di aggiungerne uno. */
function righeController(jobs: ScheduledJob[]): RigaSchedulazione[] {
  const controller = listControllerViews().filter((c) => c.kind !== "omada");
  const base = { famiglia: "apparati" as const, cosa: "", quando: "—", prossimo: null, fisso: false, jobId: null };
  if (controller.length === 0) {
    return [{
      ...base, id: "controller.nessuno", nome: "Lettura degli apparati UniFi", su: "serve un controller", stato: "da_configurare",
      esito: esito("neutro", "nessun controller"), dove: { href: "/controllers", etichetta: "Aggiungi ›" }, cambio: null,
      perche: "Prima si aggiunge un controller",
    }];
  }
  const conJob = new Set(jobs.filter((j) => j.job_type === "unifi_sync").map((j) => idOpzioneDelJob(j)));
  return controller
    .filter((c) => !conJob.has(`controller.${c.id}.apparati`))
    .map((c) => ({
      ...base, id: `controller.${c.id}`, nome: "Lettura degli apparati UniFi", su: c.name, stato: "spento" as const,
      esito: esito("neutro", "spenta"), dove: { href: "/controllers", etichetta: "Controller ›" },
      cambio: { tipo: "opzione" as const, id: `controller.${c.id}.apparati` },
    }));
}

// ── Scansioni Edge per rete ──────────────────────────────────────────────────

function righeEdge(reti: Map<number, string>): RigaSchedulazione[] {
  return listEdgeSchedules().map((e) => {
    let quando = e.cron_expr ? `cron ${e.cron_expr}` : "—";
    if (e.modo === "finestra") {
      // Finestra (05/11): fascia in ora italiana, non un cron. Una riga illeggibile si dice, non si nasconde.
      try {
        quando = describeFinestra({
          giorni: (e.fascia_giorni ?? "").match(/\d/g)?.map(Number) ?? [],
          dalle: e.fascia_dalle ?? "",
          alle: e.fascia_alle ?? "",
          ripeti: e.ripeti === "settimana" ? "settimana" : "mese",
        });
      } catch {
        quando = "finestra illeggibile";
      }
    } else if (e.frequency && e.at_time) {
      try {
        quando = describeCron({
          frequency: e.frequency as Frequency,
          at: e.at_time,
          daysOfWeek: (e.days_of_week ?? "").match(/\d/g)?.map(Number),
          dayOfMonth: e.day_of_month ?? undefined,
        }).replace(/^Ogni/, "ogni");
      } catch {
        // orario illeggibile: resta l'espressione cron
      }
    }
    return {
      id: `edge.${e.network_id}`,
      famiglia: "reti",
      nome: "Scansione Edge (vulnerabilità)",
      cosa: "gira sulla sonda Edge del cliente",
      su: reti.get(e.network_id) ?? `rete n. ${e.network_id}`,
      quando,
      prossimo: null,
      stato: (e.modo === "finestra" ? e.fascia_attiva : e.enabled) ? "acceso" : "spento",
      fisso: false,
      esito: esito("neutro", "l'esito è nella pagina della rete"),
      dove: { href: `/networks/${e.network_id}`, etichetta: "Rete ›" },
      cambio: null,
      jobId: null,
      perche: "Si accende e si spegne dalla pagina della rete: la pianificazione sta sulla sonda Edge",
    } satisfies RigaSchedulazione;
  });
}

// ── Scansioni «Per device» (Passo 6, 08/11/2026, tavola oggetto 30) ─────────

const ESITO_TONO: Record<string, TipoEsito> = { ok: "ok", avviso: "attenzione", errore: "errore", spento: "neutro" };

function righeDevice(reti: Map<number, string>): RigaSchedulazione[] {
  return elencoPianificazioni().map((p) => ({
    id: `device.${p.network_id}`,
    famiglia: "reti",
    nome: "Scansione VA per device",
    cosa: `${p.famiglie.map((f) => ETICHETTE_FAMIGLIE_VA[f]).join(", ")} · la lancia DA-IPAM con i device confermati`,
    su: reti.get(p.network_id) ?? `rete n. ${p.network_id}`,
    quando: quandoInParole(p),
    prossimo: p.attiva && p.prossima_il ? dataSqlite(new Date(p.prossima_il)) : null,
    stato: p.attiva ? "acceso" : "spento",
    fisso: false,
    esito: p.ultimo_esito ? esito(ESITO_TONO[p.ultimo_tono ?? ""] ?? "neutro", taglia(p.ultimo_esito)) : esito("neutro", "non è ancora partita"),
    dove: { href: "/vulnerabilities/scansioni", etichetta: "Scansioni VA ›" },
    cambio: null,
    jobId: null,
    perche: "Si accende e si spegne dalla scheda «Per device» della pagina Scansioni VA",
  }) satisfies RigaSchedulazione);
}

// ── Timer dell'appliance (server.ts) ─────────────────────────────────────────

/** I moduli che `server.ts` avvia, con la riga che li mostra o il perché non c'è (prova di completezza). */
export const TIMER_DI_SERVER: Readonly<Record<string, string>> = {
  "./src/lib/backup/scheduler": "timer.backup",
  "./src/lib/modules/appliance-health-notify": "timer.salute",
  "./src/lib/health/scheduler-health-notify": "timer.job_fermi",
  "./src/lib/patch/choco-automatico": "timer.choco",
  "./src/lib/vuln/exploit-feed/job": "timer.feed_exploit",
  "./src/lib/vuln/cve-locali/job": "timer.cve_potenziali",
  "./src/lib/dalink/segnale-job": "timer.dalink",
  "./src/lib/assegnatari/job": "timer.accessi_pc",
  "./src/lib/trunk/job": "timer.sensore_trunk",
  "./src/lib/mappa-porte/job": "timer.mappa_porte",
  "./src/lib/scanner/profili/sconosciuti-job": "timer.riconoscimento",
  "./src/lib/security/eventi-dc/job": "timer.eventi_dc",
  "./src/lib/servizi-rete/job": "timer.servizi_rete",
  "./src/lib/segmentazione/job": "timer.segmentazione",
  "./src/lib/vuln/proposta/pianificazione-job": "fuori: è il giro delle pianificazioni «Per device», le sue righe sono le pianificazioni (device.<rete>)",
  "./src/lib/cron/scheduler": "fuori: è lo scheduler dei job, le sue righe sono i job",
  "./src/lib/cron/scheduler-defaults": "fuori: correzioni all'avvio, non un giro (in Opzioni › Da file)",
  "./src/lib/vulcan/job": "fuori: deciso il 23/10, spento senza gettone su tutte le appliance (in Opzioni › Notifiche e uscite)",
  "./src/lib/integrations/segreti-migrazione": "fuori: gira una volta all'avvio (copia dei segreti di LibreNMS e Graylog), non è un giro",
  "./src/lib/scanner/rilancia-giri": "fuori: gira una volta all'avvio (fa ripartire i giri lanciati a mano interrotti dal riavvio), non è un giro",
  "./src/lib/vault/avvio": "fuori: sblocco del vault all'avvio e cache di DA-Link, solo con DA_VAULT_LOCALE/DA_VAULT_DALINK (spenti di serie, in Opzioni › Da file)",
};

async function righeTimer(adesso: Date): Promise<RigaSchedulazione[]> {
  const base = { famiglia: "appliance" as const, cosa: "", su: "l'appliance", fisso: true, cambio: null, jobId: null };
  const righe: RigaSchedulazione[] = [];

  const exprBackup = process.env.DA_INVENT_BACKUP_CRON || "0 3 * * *";
  const b = ultimoBackup();
  const giornaliero = /^(\d{1,2}) (\d{1,2}) \* \* \*$/.exec(exprBackup.trim());
  righe.push({
    ...base,
    id: "timer.backup",
    nome: "Backup di hub e clienti",
    cosa: "l'orario si cambia nel file dell'appliance",
    quando: giornaliero ? `ogni notte, ${giornaliero[2].padStart(2, "0")}:${giornaliero[1].padStart(2, "0")} (ora del server)` : `cron ${exprBackup}`,
    prossimo: giornaliero ? dataSqlite(prossimaOraServer(Number(giornaliero[2]), Number(giornaliero[1]), adesso)) : null,
    stato: "acceso",
    esito: !b
      ? esito("attenzione", "nessun backup trovato")
      : b.illeggibile
        ? esito("errore", `${b.giorno}: manifesto illeggibile`)
        : b.errori > 0
          ? esito("errore", `${b.giorno}: ${b.errori} errori`)
          : esito("ok", `${b.finitoIl ? oraItaliana(dataSqlite(new Date(b.finitoIl)), adesso) : b.giorno} · ${b.file} file`),
    dove: { href: "/settings/opzioni#sempre.backup", etichetta: "Dove si cambia ›" },
    perche: "Gira sempre: l'orario è la riga DA_INVENT_BACKUP_CRON del file .env.local",
  });

  const notifiche = getNotificationConfig().enabled;
  const muto = esito("attenzione", "non avvisa nessuno: le notifiche sono spente");
  let salute = esito("ok", "nessun problema");
  try {
    const db = getTenantDb(tenant());
    const c = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'appliance_health_state'").get();
    if (c) {
      const r = db.prepare("SELECT verdict, headline FROM appliance_health_state WHERE verdict != 'ok' ORDER BY verdict = 'fail' DESC LIMIT 1").get() as
        | { verdict: string; headline: string | null }
        | undefined;
      if (r) salute = esito(r.verdict === "fail" ? "errore" : "attenzione", taglia(r.headline ?? r.verdict));
    }
  } catch {
    salute = esito("errore", "stato illeggibile");
  }
  righe.push({
    ...base, id: "timer.salute", nome: "Salute dell'appliance", cosa: "avvisa se il disco si riempie o Docker si ferma",
    quando: "ogni 30 minuti", prossimo: dataSqlite(prossimoOgniMinuti(30, adesso)), stato: "acceso",
    esito: notifiche ? salute : muto, dove: { href: "/settings/opzioni#notifiche.attive", etichetta: "Notifiche ›" },
    perche: "Gira sempre: non ha un interruttore",
  });

  const fermi = findStaleJobs(getScheduledJobs(), adesso.getTime()).length;
  righe.push({
    ...base, id: "timer.job_fermi", nome: "Allarme sui job fermi", cosa: "avvisa se i job di questo elenco smettono di girare",
    quando: "ogni 30 minuti", prossimo: dataSqlite(prossimoOgniMinuti(30, adesso)), stato: "acceso",
    esito: !notifiche ? muto : fermi > 0 ? esito("attenzione", `${fermi} ${fermi === 1 ? "job fermo" : "job fermi"}`) : esito("ok", "nessun job fermo"),
    dove: { href: "/settings/opzioni#notifiche.attive", etichetta: "Notifiche ›" },
    perche: "Gira sempre: non ha un interruttore",
  });

  // Chocolatey e dati sugli exploit hanno la levetta in Opzioni: stato ed esito sono quelli della sua riga.
  const opzioni = catalogo().filter((o) => o.id === "automatismo.choco_automatico" || o.id === "automatismo.feed_exploit");
  for (const o of opzioni) {
    const s = await leggiStato(o);
    const choco = o.id === "automatismo.choco_automatico";
    const acceso = s.acceso === true;
    righe.push({
      ...base,
      id: choco ? "timer.choco" : "timer.feed_exploit",
      nome: o.nome,
      su: choco ? "gli host Windows con WinRM" : "KEV, Exploit-DB, EPSS",
      quando: choco ? "ogni notte, 02:00 (ora del server)" : "ogni giorno, 06:00",
      prossimo: acceso
        ? dataSqlite(choco ? prossimaOraServer(2, 0, adesso) : prossimaEsecuzione({ tipo: "giorno", ora: "06:00" }, adesso))
        : null,
      stato: acceso ? "acceso" : "spento",
      fisso: false,
      esito: s.esito,
      dove: { href: `/settings/opzioni#${o.id}`, etichetta: "Opzioni ›" },
      cambio: { tipo: "opzione", id: o.id },
    });
  }

  // Chi si collega ai PC (assegnatari da AD, 23/10): levetta per cliente in Opzioni, giro ogni ora al minuto 17.
  const accessi = catalogo().find((o) => o.id === "automatismo.accessi_pc");
  if (accessi) {
    const s = await leggiStato(accessi);
    const acceso = s.acceso === true;
    const prossimo = new Date(adesso);
    prossimo.setMinutes(17, 0, 0);
    if (prossimo <= adesso) prossimo.setHours(prossimo.getHours() + 1);
    righe.push({
      ...base,
      id: "timer.accessi_pc",
      nome: accessi.nome,
      su: "Wazuh e WinRM",
      quando: "ogni ora, al minuto 17",
      prossimo: acceso ? dataSqlite(prossimo) : null,
      stato: acceso ? "acceso" : "spento",
      fisso: false,
      esito: s.esito,
      dove: { href: `/settings/opzioni#${accessi.id}`, etichetta: "Opzioni ›" },
      cambio: { tipo: "opzione", id: accessi.id },
    });
  }

  // CVE potenziali (08/11, piano daipam-cve-locali): archivio NVD alle 06:30, levetta in Opzioni.
  const cvePot = catalogo().find((o) => o.id === "automatismo.cve_potenziali");
  if (cvePot) {
    const s = await leggiStato(cvePot);
    const acceso = s.acceso === true;
    righe.push({
      ...base,
      id: "timer.cve_potenziali",
      nome: cvePot.nome,
      su: "archivio NVD e versioni dei servizi",
      quando: "ogni giorno, 06:30 (ricalcolo ogni ora al minuto 41)",
      prossimo: acceso ? dataSqlite(prossimaEsecuzione({ tipo: "giorno", ora: "06:30" }, adesso)) : null,
      stato: acceso ? "acceso" : "spento",
      fisso: false,
      esito: s.esito,
      dove: { href: `/settings/opzioni#${cvePot.id}`, etichetta: "Opzioni ›" },
      cambio: { tipo: "opzione", id: cvePot.id },
    });
  }

  // Mappa porte (07/11): ricalcolo dalle tabelle già lette, non interroga gli apparati. Sempre acceso, tocca solo le sue tabelle.
  const prossimaMappa = prossimoOgniMinuti(30, adesso);
  prossimaMappa.setMinutes(prossimaMappa.getMinutes() + 5);
  let calcoloMappa: ReturnType<typeof statoCalcolo> = null;
  try {
    calcoloMappa = statoCalcolo();
  } catch {
    /* tabelle assenti (migrazione fallita) o nessun contesto: la riga resta, senza ultimo calcolo */
  }
  righe.push({
    ...base,
    id: "timer.mappa_porte",
    nome: "Mappa porte",
    su: "le tabelle già lette",
    quando: "ogni 30 minuti",
    prossimo: dataSqlite(prossimaMappa),
    stato: "acceso",
    esito: calcoloMappa ? esito("ok", `ultimo calcolo ${calcoloMappa.il}`) : esito("neutro", "non ancora calcolata"),
    dove: { href: "/port-map", etichetta: "Mappa porte ›" },
    perche: "Gira sempre: non interroga gli apparati e tocca solo le sue tabelle. I parser sugli apparati, ogni 6 ore, stanno dietro «Tutti i dati per la Mappa porte»",
  });

  const serviziRete = catalogo().find((o) => o.id === "automatismo.servizi_rete");
  if (serviziRete) {
    const s = await leggiStato(serviziRete);
    const acceso = s.acceso === true;
    righe.push({
      ...base,
      id: "timer.servizi_rete",
      nome: serviziRete.nome,
      su: "le porte già note e gli host senza porte",
      quando: "3 minuti dopo l'avvio, poi ogni 6 ore al minuto 17",
      prossimo: acceso ? dataSqlite(prossimaOgniOreAlMinuto(6, 17, adesso)) : null,
      stato: acceso ? "acceso" : "spento",
      fisso: false,
      esito: s.esito,
      dove: { href: `/settings/opzioni#${serviziRete.id}`, etichetta: "Opzioni ›" },
      cambio: { tipo: "opzione", id: serviziRete.id },
    });
  }

  const matrice = catalogo().find((o) => o.id === "automatismo.segmentazione");
  if (matrice) {
    const s = await leggiStato(matrice);
    const acceso = s.acceso === true;
    righe.push({
      ...base,
      id: "timer.segmentazione",
      nome: matrice.nome,
      su: "i servizi già noti, da ogni VLAN del trunk",
      quando: "ogni lunedì alle 03:23 (ora del server)",
      prossimo: acceso ? dataSqlite(prossimoLunedi(3, 23, adesso)) : null,
      stato: acceso ? "acceso" : "spento",
      fisso: false,
      esito: s.esito,
      dove: { href: `/settings/opzioni#${matrice.id}`, etichetta: "Opzioni ›" },
      cambio: { tipo: "opzione", id: matrice.id },
    });
  }

  // Sensore trunk (25/10): levetta per cliente in Opzioni, lettura ogni 2 minuti.
  const trunk = catalogo().find((o) => o.id === "modulo.sensore_trunk");
  if (trunk) {
    const s = await leggiStato(trunk);
    const acceso = s.acceso === true;
    const prossimo = new Date(adesso);
    prossimo.setSeconds(0, 0);
    prossimo.setMinutes(prossimo.getMinutes() + (2 - (prossimo.getMinutes() % 2)));
    righe.push({
      ...base,
      id: "timer.sensore_trunk",
      nome: trunk.nome,
      su: "il sensore sulla porta trunk",
      quando: "ogni 2 minuti",
      prossimo: acceso ? dataSqlite(prossimo) : null,
      stato: acceso ? "acceso" : "spento",
      fisso: false,
      esito: s.esito,
      dove: { href: `/settings/opzioni#${trunk.id}`, etichetta: "Opzioni ›" },
      cambio: { tipo: "opzione", id: trunk.id },
    });
  }

  // Riconoscimento degli host unknown (06/11): levetta per cliente in Opzioni, giro notturno.
  const riconoscimento = catalogo().find((o) => o.id === "automatismo.riconoscimento");
  if (riconoscimento) {
    const s = await leggiStato(riconoscimento);
    righe.push({
      ...base,
      id: "timer.riconoscimento",
      nome: riconoscimento.nome,
      su: "gli host non riconosciuti",
      quando: "ogni notte alle 2:23 UTC",
      prossimo: null,
      stato: s.acceso === true ? "acceso" : "spento",
      fisso: false,
      esito: s.esito,
      dove: { href: `/settings/opzioni#${riconoscimento.id}`, etichetta: "Opzioni ›" },
      cambio: { tipo: "opzione", id: riconoscimento.id },
    });
  }

  // Eventi di sicurezza dai DC (29/10): scelta per cliente in Opzioni, lettura ogni 5 minuti.
  const eventiDc = catalogo().find((o) => o.id === "automatismo.eventi_dc");
  if (eventiDc) {
    const s = await leggiStato(eventiDc);
    const acceso = s.acceso === true;
    righe.push({
      ...base,
      id: "timer.eventi_dc",
      nome: eventiDc.nome,
      su: "i domain controller, via WinRM",
      quando: "ogni 5 minuti",
      prossimo: acceso ? dataSqlite(prossimoOgniMinuti(5, adesso)) : null,
      stato: acceso ? "acceso" : "spento",
      fisso: false,
      esito: s.esito,
      dove: { href: `/settings/opzioni#${eventiDc.id}`, etichetta: "Opzioni ›" },
      cambio: { tipo: "opzione", id: eventiDc.id },
    });
  }

  const dalink = leggiConfigDalink();
  const seg = dalink.stato === "pronta" ? statoSegnale() : null;
  righe.push({
    ...base,
    id: "timer.dalink",
    nome: "Segnale a DA-Link",
    cosa: "il ritmo è fisso; cosa esce si sceglie in Opzioni",
    quando: "ogni 5 minuti",
    prossimo: dalink.stato === "pronta" ? dataSqlite(prossimoOgniMinuti(5, adesso)) : null,
    stato: dalink.stato === "pronta" ? "acceso" : "spento",
    esito:
      dalink.stato === "assente"
        ? esito("neutro", "spento: nessun file di DA-Link")
        : dalink.stato === "non_valida"
          ? esito("errore", "file di DA-Link non valido")
          : !seg?.tentato_il
            ? esito("neutro", "non ancora partito")
            : seg.esito === "ok"
              ? esito("ok", `${oraItaliana(seg.tentato_il, adesso)} · ok`)
              : esito("errore", `${oraItaliana(seg.tentato_il, adesso)} · ${taglia(seg.dettaglio ?? seg.esito ?? "errore")}`),
    dove: { href: "/settings/cosa-esce", etichetta: "Cosa esce ›" },
    perche: "Si accende quando c'è il file di DA-Link sull'appliance",
  });
  return righe;
}

// ── L'elenco ─────────────────────────────────────────────────────────────────

/** Ordine: prima chi ha un prossimo giro (il più vicino in cima), poi gli altri per famiglia e nome. */
function ordina(a: RigaSchedulazione, b: RigaSchedulazione): number {
  if (a.prossimo && b.prossimo) return parseDbDate(a.prossimo).getTime() - parseDbDate(b.prossimo).getTime();
  if (a.prossimo) return -1;
  if (b.prossimo) return 1;
  return a.famiglia.localeCompare(b.famiglia) || a.nome.localeCompare(b.nome, "it");
}

/** Un blocco che non si legge diventa una riga d'errore: il resto dell'elenco regge (come i gruppi di Opzioni). */
async function sicuro(nome: string, f: () => RigaSchedulazione[] | Promise<RigaSchedulazione[]>): Promise<RigaSchedulazione[]> {
  try {
    return await f();
  } catch (e) {
    const codice = e && typeof e === "object" && "code" in e && typeof e.code === "string" ? e.code : e instanceof Error ? e.name : "errore";
    return [{
      id: `errore.${nome}`, famiglia: "appliance", nome: `Elenco non leggibile: ${nome}`, cosa: "", su: "—", quando: "—", prossimo: null,
      stato: "spento", fisso: true, esito: esito("errore", `stato illeggibile (${codice})`), dove: null, cambio: null, jobId: null,
    }];
  }
}

export async function elencoSchedulazioni(adesso: Date = new Date()): Promise<RigaSchedulazione[]> {
  const reti = new Map(listNetworksLite().map((n) => [n.id, n.name || n.cidr]));
  const jobs = getScheduledJobs();
  const nomiController = new Map(listControllerViews().map((c) => [c.id, c.name]));
  const righe = [
    ...(await sicuro("job", () => jobs.map((j) => rigaJob(j, reti, nomiController, adesso)))),
    ...(await sicuro("controller", () => righeController(jobs))),
    ...(await sicuro("Edge", () => righeEdge(reti))),
    ...(await sicuro("Per device", () => righeDevice(reti))),
    ...(await sicuro("appliance", () => righeTimer(adesso))),
  ];
  return righe.sort(ordina);
}

/** La riga e il suo cambio, per la rotta di scrittura. */
export async function trovaRiga(id: string): Promise<RigaSchedulazione | undefined> {
  return (await elencoSchedulazioni()).find((r) => r.id === id);
}
