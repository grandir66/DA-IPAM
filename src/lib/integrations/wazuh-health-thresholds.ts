/**
 * Soglie di salute Wazuh — funzioni pure (nessun I/O, nessuna eccezione).
 *
 * Classificano i quattro blocchi del cruscotto (manager, indexer, ingestione,
 * repliche) secondo le regole di `docs/superpowers/specs/2026-07-29-
 * monitoraggio-wazuh-repliche-design.md` §7. Sono l'unico posto dove vivono
 * le soglie numeriche: chi chiama (il modulo di raccolta, i test) non deve
 * ripetere la logica.
 *
 * Note sui formati reali (endpoint vivo 192.168.4.19):
 *  - `backend.disk.use_percent` arriva da `df -h` come STRINGA ("11%"),
 *    mentre `local_disk.use_percent` è già un numero calcolato dal servizio.
 *    `parsePercent` normalizza entrambi i casi senza mai lanciare.
 *  - `archives.newest` ha microsecondi e nessuna `Z` finale; `generated_at` e
 *    i timestamp dei run hanno la `Z`. `parseFlexibleDate` tollera entrambi.
 *  - `runs.retention` e `runs.verify` valgono spesso `{"outcome":"never"}`:
 *    è lo stato di riposo del file appena creato, non un guasto. Per questo
 *    il verdetto di replica NON usa `retention` (non compare nella tabella
 *    §7) e per `verify` guarda solo `manifest_chain_valid === false`, mai
 *    l'outcome da solo.
 *  - `classifyReplication` misura il CICLO di archiviazione
 *    (`runs.archive.last_finished_at` + outcome), non il suo prodotto: con
 *    `retention_policy.days_before_archive >= 1` un ciclo orario che riesce
 *    regolarmente può creare 0 archivi per oltre 24h, quindi
 *    `archives.newest` resta legittimamente indietro su un sistema sano.
 *    `archives.newest` resta un segnale di staleness di LUNGO periodo,
 *    valutato solo quando `days_before_archive` è noto (fix campo, appliance
 *    Domarc / Wazuh 192.168.4.19: il blocco era rosso permanentemente su un
 *    sistema sano — vedi brief `.superpowers/sdd/fix-misure-brief.md`).
 *  - `classifyIngestion` misura il `@timestamp` più recente nell'INDEXER
 *    (`wazuh-alerts-*`), non `wazuh_alert_event.last_seen_at` di DA-IPAM: la
 *    sincronizzazione scarta gli alert non rilevanti, quindi la tabella
 *    locale può restare indietro di ore su un'ingestione Wazuh perfettamente
 *    normale (misurava il soggetto sbagliato). L'ultimo alert importato
 *    resta comunque utile all'operatore, mostrato in `detail`.
 */

import type { ImmutableStoreState } from "./immutable-store-api";

export type HealthVerdict = "ok" | "degraded" | "fail";

export interface BlockHealth {
  key: "manager" | "indexer" | "ingestion" | "replication";
  verdict: HealthVerdict;
  headline: string;
  detail?: string[];
  configured: boolean;
}

export const DISK_WARN_PERCENT = 85;
export const DISK_FAIL_PERCENT = 95;
export const INGESTION_LAG_WARN_MINUTES = 30;
export const REPLICATION_MIN_HOURS = 3;
/**
 * Soglie della verifica d'integrità. Quando lo stato non dichiara la propria
 * cadenza (`schedule.verify_interval`) non si può calcolare "in ritardo di
 * quanto": si concede una finestra prudenziale fissa, oltre la quale una
 * verifica che non si completa va comunque detta.
 */
export const VERIFY_STALE_FALLBACK_MINUTES = 7 * 1440;
export const VERIFY_MIN_THRESHOLD_MINUTES = 1440;

const VERDICT_SEVERITY: Record<HealthVerdict, number> = { ok: 0, degraded: 1, fail: 2 };

/** Il verdetto più severo fra quelli passati. */
function worst(...verdicts: HealthVerdict[]): HealthVerdict {
  return verdicts.reduce<HealthVerdict>(
    (acc, v) => (VERDICT_SEVERITY[v] > VERDICT_SEVERITY[acc] ? v : acc),
    "ok",
  );
}

/**
 * Normalizza una percentuale che può arrivare come numero, stringa `df -h`
 * ("33%", "33"), `null` o `undefined`. Non lancia mai: input non numerico
 * ritorna `null`.
 */
function parsePercent(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const match = v.match(/-?\d+(?:\.\d+)?/);
    if (!match) return null;
    const n = Number(match[0]);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Normalizza un timestamp che può avere la `Z` finale o no, e microsecondi
 * o no ("2026-07-29T14:12:58.544552" vs "2026-07-29T11:55:00Z"). Ritorna i
 * millisecondi epoch, o `null` se non parsabile. Non lancia mai.
 */
function parseFlexibleDate(iso: string | null | undefined): number | null {
  if (typeof iso !== "string" || iso.trim().length === 0) return null;
  let s = iso.trim();
  // Tronca la frazione dei secondi a 3 cifre (millisecondi): i motori JS
  // non garantiscono il parsing di frazioni più lunghe (es. microsecondi).
  s = s.replace(/(\.\d{3})\d+/, "$1");
  // Nessun fuso indicato ("Z" o "+HH:MM"/"-HH:MM" finale) → si assume UTC,
  // come tutti i timestamp di questo servizio.
  if (!/[zZ]$/.test(s) && !/[+-]\d{2}:?\d{2}$/.test(s)) {
    s = `${s}Z`;
  }
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
}

/** Formatta una durata in minuti in una frase breve in italiano. */
function formatDuration(minutes: number): string {
  if (minutes < 60) {
    const m = Math.max(1, Math.round(minutes));
    return `${m} minut${m === 1 ? "o" : "i"}`;
  }
  const h = Math.round(minutes / 60);
  return `${h} or${h === 1 ? "a" : "e"}`;
}

/** Minuti dell'intervallo pianificato. Sconosciuto → si assume orario. */
function intervalToMinutes(interval: string | undefined): number {
  if (interval === "daily") return 1440;
  if (interval === "hourly") return 60;
  return 60;
}

/**
 * Minuti della cadenza di verifica, `null` se non la si riconosce. Volutamente
 * separata da `intervalToMinutes`: quella assume l'orario sui valori ignoti, e
 * su una verifica che gira ogni tre giorni la dichiarerebbe in ritardo a ogni
 * sguardo. Tenerle distinte evita anche che allargare i valori riconosciuti
 * qui cambi di riflesso la soglia del ciclo di archiviazione.
 */
function verifyIntervalToMinutes(interval: string | undefined): number | null {
  if (interval === "hourly") return 60;
  if (interval === "daily") return 1440;
  if (interval === "weekly") return 7 * 1440;
  return null;
}

export function classifyDiskUsage(usePercent: number | null | undefined): HealthVerdict {
  if (usePercent === null || usePercent === undefined || !Number.isFinite(usePercent)) {
    return "ok";
  }
  if (usePercent >= DISK_FAIL_PERCENT) return "fail";
  if (usePercent >= DISK_WARN_PERCENT) return "degraded";
  return "ok";
}

/**
 * Demoni essenziali del manager: il verdetto del blocco dipende solo da
 * questi. Gli altri demoni Wazuh standard (agentlessd, csyslogd, dbd,
 * integratord, maild, reportd, clusterd) sono OPZIONALI e disabilitati per
 * default in un'installazione sana — contarli come guasto produce un falso
 * rosso su praticamente ogni appliance sul campo, e un semaforo sempre rosso
 * è un semaforo che l'operatore smette di guardare.
 */
const ESSENTIAL_MANAGER_DAEMONS = new Set([
  "wazuh-analysisd",
  "wazuh-remoted",
  "wazuh-monitord",
  "wazuh-execd",
  "wazuh-modulesd",
  "wazuh-syscheckd",
  "wazuh-logcollector",
  "wazuh-db",
  "wazuh-apid",
]);

export function classifyManager(daemons: Array<{ name: string; status: string }>): BlockHealth {
  const stopped = daemons.filter((d) => d.status !== "running").map((d) => d.name);
  const stoppedEssential = stopped.filter((name) => ESSENTIAL_MANAGER_DAEMONS.has(name));
  const stoppedOptional = stopped.filter((name) => !ESSENTIAL_MANAGER_DAEMONS.has(name));

  if (stoppedEssential.length === 0) {
    return {
      key: "manager",
      verdict: "ok",
      headline: "tutti i demoni attivi",
      detail: stoppedOptional.length > 0
        ? [`demoni opzionali non attivi: ${stoppedOptional.join(", ")}`]
        : undefined,
      configured: true,
    };
  }

  const headline = stoppedEssential.length === 1
    ? `${stoppedEssential[0]} fermo`
    : `demoni fermi: ${stoppedEssential.join(", ")}`;

  const detail = stoppedEssential.map((name) => `${name}: fermo`);
  if (stoppedOptional.length > 0) detail.push(`demoni opzionali non attivi: ${stoppedOptional.join(", ")}`);

  return {
    key: "manager",
    verdict: "fail",
    headline,
    detail,
    configured: true,
  };
}

/** `true` solo per un numero finito — mai per stringhe, `null` o `undefined`:
 *  i due campi opzionali di `cluster` arrivano da un endpoint HTTP esterno e
 *  non vanno mai fidati ciecamente. */
function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export function classifyIndexer(
  cluster: { status?: string; number_of_nodes?: number; initializing_shards?: number },
  nodes: Array<{ node: string; diskPercent: number | null }>,
): BlockHealth {
  // Giallo "strutturale" a nodo singolo (fix campo, appliance Domarc, dato
  // reale: stato yellow, 1 nodo, 450 shard attivi, 29 non assegnati, 0 in
  // inizializzazione): su un cluster OpenSearch a un solo nodo gli shard
  // replica non hanno un secondo nodo su cui essere copiati, quindi restano
  // "non assegnati" per definizione — è lo stato di riposo dell'installazione
  // Wazuh predefinita (single-node), non un sintomo di guasto, e nessuna
  // azione dell'operatore lo farà mai tornare verde. Vale SOLO quando sia il
  // numero di nodi sia l'assenza di shard in inizializzazione sono noti e
  // verificati numericamente: un valore mancante, non numerico, un cluster a
  // più nodi (lì il giallo indica repliche davvero assegnabili) o shard
  // ancora in inizializzazione (il giallo potrebbe risolversi o peggiorare,
  // non è ancora "a riposo") fanno restare il verdetto "degraded" di oggi —
  // stessa convenzione dei due fix precedenti su questo file (v0.3.244,
  // v0.3.245): ciò che è strutturale/facoltativo non spegne l'allarme se non
  // è stato verificato per davvero.
  const singleNode = isFiniteNumber(cluster.number_of_nodes) && cluster.number_of_nodes === 1;
  const noInitializingShards = isFiniteNumber(cluster.initializing_shards) && cluster.initializing_shards === 0;
  const structuralYellow = cluster.status === "yellow" && singleNode && noInitializingShards;

  const colorVerdict: HealthVerdict =
    cluster.status === "red"
      ? "fail"
      : cluster.status === "yellow"
        ? (structuralYellow ? "ok" : "degraded")
        : cluster.status === "green"
          ? "ok"
          // Stato sconosciuto: non si dichiara "ok" un cluster di cui non si
          // conosce il colore.
          : "degraded";

  const colorLabel =
    cluster.status === "red"
      ? "rosso"
      : cluster.status === "yellow"
        ? "giallo"
        : cluster.status === "green"
          ? "verde"
          : "sconosciuto";

  const diskVerdicts = nodes.map((n) => classifyDiskUsage(n.diskPercent));
  // Il giallo strutturale spiega solo il COLORE del cluster: i dischi dei
  // nodi restano un segnale indipendente e concorrono comunque con
  // `worst(...)` — un nodo al 96% deve poter portare il blocco a rosso anche
  // quando il cluster è "sano" a nodo singolo.
  const verdict = worst(colorVerdict, ...diskVerdicts);

  // Il nodo peggiore, non la media: una media rassicurante accanto a un
  // verdetto rosso nasconderebbe proprio il nodo che lo causa.
  const worstNode = nodes.reduce<{ node: string; diskPercent: number } | null>((acc, n) => {
    if (n.diskPercent === null) return acc;
    if (acc === null || n.diskPercent > acc.diskPercent) return { node: n.node, diskPercent: n.diskPercent };
    return acc;
  }, null);

  // L'intestazione dice sempre il colore REALE del cluster: il giallo
  // strutturale non va nascosto, va spiegato (nel detail sotto) — l'operatore
  // deve poter vedere che il cluster è giallo e capire perché non è un
  // problema.
  const headline =
    worstNode !== null
      ? `cluster ${colorLabel} · ${worstNode.diskPercent}% su ${nodes.length} nod${nodes.length === 1 ? "o" : "i"} (peggiore: ${worstNode.node})`
      : `cluster ${colorLabel}`;

  const detail: string[] = [];
  if (structuralYellow) {
    detail.push("nodo singolo: gli shard replica non sono assegnabili (giallo strutturale)");
  }
  for (const n of nodes) {
    detail.push(`${n.node}: ${n.diskPercent !== null ? `${n.diskPercent}%` : "n/d"}`);
  }

  return { key: "indexer", verdict, headline, detail: detail.length > 0 ? detail : undefined, configured: true };
}

export function classifyIngestion(input: {
  /** `false` quando Wazuh non è configurato: nessun'altra soglia si applica,
   *  il blocco è neutro (come indexer/repliche), mai un falso verde. */
  configured?: boolean;
  eventsDropped?: number;
  queueUsage?: number;
  /**
   * `false` quando l'indexer (facoltativo) non è configurato — stesso
   * trattamento del blocco `indexer` (`classifyIndexer`/`probeIndexer`):
   * nessun allarme, `configured: false`. Distinto da "indexer configurato
   * ma irraggiungibile": quello resta un guasto (vedi `newestIndexerAlertIso`
   * sotto). Fix review: prima del fix "non configurato" e "irraggiungibile"
   * producevano entrambi `fail` — un tenant senza indexer configurato
   * vedeva il blocco ingestione rosso per sempre, la stessa classe di
   * difetto spostata da un blocco all'altro.
   */
  indexerConfigured?: boolean;
  /**
   * `@timestamp` del documento più recente in `wazuh-alerts-*` (indexer):
   * fonte di verità del verdetto (misura Wazuh, non DA-IPAM — vedi brief
   * Difetto 2). Tre stati distinti, nessuno equivalente agli altri due:
   *  - stringa ISO: alert più recente davvero ricevuto da Wazuh.
   *  - `null`: indice raggiungibile ma vuoto — nessun alert mai ricevuto
   *    (appliance appena installata).
   *  - `undefined` (con `indexerConfigured !== false`): indexer configurato
   *    ma non raggiungibile/in errore — non si può misurare l'ingestione.
   *    Non deve MAI produrre un "ok" inventato: il chiamante
   *    (wazuh-health.ts) passa esplicitamente `undefined` quando la sonda
   *    indexer fallisce, senza spacciarlo per "nessun alert".
   */
  newestIndexerAlertIso?: string | null;
  /**
   * Ultimo alert importato in DA-IPAM (`wazuh_alert_event.last_seen_at`):
   * informativo per l'operatore (mostrato in `detail`), NON concorre più al
   * verdetto — la sincronizzazione scarta gli alert non rilevanti, quindi
   * questa tabella può restare indietro di ore su un sistema perfettamente
   * sano (misurava il soggetto sbagliato, vedi brief Difetto 2).
   */
  latestImportedAlertIso?: string | null;
  nowMs: number;
}): BlockHealth {
  if (input.configured === false) {
    return {
      key: "ingestion",
      verdict: "ok",
      headline: "Wazuh non configurato",
      configured: false,
    };
  }

  if (input.indexerConfigured === false) {
    // Indexer facoltativo assente: nessun allarme, come fa `probeIndexer`
    // per il proprio blocco. Non si può verificare l'ingestione, ma la sua
    // assenza non è un guasto — configurarlo è un invito, non un obbligo.
    return {
      key: "ingestion",
      verdict: "ok",
      headline: "indexer non configurato: ingestione non verificabile (facoltativo)",
      configured: false,
    };
  }

  const indexerUnavailable = input.newestIndexerAlertIso === undefined;
  const newestMs = indexerUnavailable ? null : parseFlexibleDate(input.newestIndexerAlertIso ?? null);
  // Nessun alert MAI ricevuto (indice appena creato, o Wazuh configurato da
  // pochi minuti): non è "allineata", è "non sappiamo ancora". Un verde qui
  // sarebbe una falsa rassicurazione su un'appliance appena installata.
  // Distinto da `indexerUnavailable`: lì l'indice potrebbe benissimo avere
  // alert, semplicemente non siamo riusciti a interrogarlo.
  const noAlertsYet = !indexerUnavailable && newestMs === null;
  const lagMinutes = newestMs !== null ? (input.nowMs - newestMs) / 60000 : null;
  const isLate = lagMinutes !== null && lagMinutes > INGESTION_LAG_WARN_MINUTES;
  const hasDropped = (input.eventsDropped ?? 0) > 0;

  const freshnessVerdict: HealthVerdict = indexerUnavailable
    ? "fail"
    : noAlertsYet || isLate
      ? "degraded"
      : "ok";

  const verdict = worst(freshnessVerdict, hasDropped ? "degraded" : "ok");

  const detail: string[] = [];
  if (hasDropped) detail.push(`eventi scartati: ${input.eventsDropped}`);
  if (typeof input.queueUsage === "number") detail.push(`code al ${Math.round(input.queueUsage)}%`);
  if (input.latestImportedAlertIso) {
    const importedMs = parseFlexibleDate(input.latestImportedAlertIso);
    detail.push(
      importedMs !== null
        ? `ultimo alert rilevante importato: ${formatDuration((input.nowMs - importedMs) / 60000)} fa`
        : `ultimo alert rilevante importato: ${input.latestImportedAlertIso}`,
    );
  }

  let headline: string;
  if (indexerUnavailable) {
    headline = "indexer non raggiungibile: ingestione non verificabile";
  } else if (noAlertsYet) {
    headline = "nessun alert ricevuto finora";
  } else if (isLate) {
    headline = `in ritardo di ${Math.round(lagMinutes as number)} minuti`;
  } else if (hasDropped) {
    headline = "eventi scartati in ingestione";
  } else {
    headline = "allineata";
  }

  return { key: "ingestion", verdict, headline, detail: detail.length > 0 ? detail : undefined, configured: true };
}

export function classifyReplication(state: ImmutableStoreState | null, nowMs: number): BlockHealth {
  if (state === null) {
    return {
      key: "replication",
      verdict: "ok",
      headline: "repliche non configurate — collega l'endpoint di stato nelle impostazioni",
      configured: false,
    };
  }

  const intervalMinutes = intervalToMinutes(state.schedule.archive_interval);
  const thresholdMinutes = Math.max(2 * intervalMinutes, REPLICATION_MIN_HOURS * 60);

  const archiveRun = state.runs.archive;
  // "never" = non ancora tentato (es. endpoint appena configurato, prima che
  // il ciclo orario abbia potuto girare): NON è un guasto immediato, si
  // concede la stessa soglia di grazia (thresholdMinutes, minimo 3h) usata
  // per la staleness. Un tentativo REALMENTE fallito (`failed`/`partial`,
  // o `failed > 0`) resta un errore da subito.
  const archiveNeverRun = archiveRun.outcome === "never";
  const archiveAttemptFailed =
    archiveRun.outcome === "failed" || archiveRun.outcome === "partial" || (archiveRun.failed ?? 0) > 0;

  // Segnale PRIMARIO di freschezza: quando si è concluso l'ultimo CICLO di
  // archiviazione, non il suo prodotto. Con `days_before_archive >= 1` un
  // ciclo orario che riesce regolarmente può creare 0 archivi per oltre 24h:
  // misurare solo `archives.newest` produce un falso rosso strutturale su un
  // sistema perfettamente sano (vedi brief Difetto 1 — caso reale sul campo).
  const lastFinishedMs = parseFlexibleDate(archiveRun.last_finished_at);
  const cycleAgeMinutes = lastFinishedMs !== null ? (nowMs - lastFinishedMs) / 60000 : null;

  let cycleVerdict: HealthVerdict;
  let waitingForFirstCycle = false;
  if (cycleAgeMinutes === null) {
    // Nessun `last_finished_at` leggibile (mai tentato, o timestamp non
    // parsabile): non sappiamo da quanto gira il ciclo. `generated_at` fa da
    // orologio surrogato con la stessa soglia di grazia prima di dichiarare
    // fail; nel frattempo il blocco è "degraded" (in attesa), non "ok" (non
    // provato sano) e non "fail" (non ancora provato rotto).
    const generatedMs = parseFlexibleDate(state.generated_at);
    const waitMinutes = generatedMs !== null ? (nowMs - generatedMs) / 60000 : null;
    if (waitMinutes !== null && waitMinutes > thresholdMinutes) {
      cycleVerdict = "fail";
    } else {
      cycleVerdict = "degraded";
      waitingForFirstCycle = true;
    }
  } else if (archiveRun.outcome === "success") {
    cycleVerdict = cycleAgeMinutes <= thresholdMinutes ? "ok" : "fail";
  } else {
    // Outcome noto ma diverso da "success"/"never": `failed`/`partial` sono
    // già forzati a "fail" più sotto via `archiveAttemptFailed`; qualsiasi
    // altro valore non standard non deve comunque produrre un falso ok —
    // decide l'età dell'ultimo tentativo.
    cycleVerdict = cycleAgeMinutes <= thresholdMinutes ? "degraded" : "fail";
  }

  // Segnale SECONDARIO: staleness di LUNGO periodo di `archives.newest`,
  // valutabile solo quando `retention_policy.days_before_archive` è noto —
  // serve a calcolare l'orizzonte oltre il quale un archivio dovrebbe
  // comunque essere arrivato a destinazione (davvero non arriva più nulla).
  // Se il campo manca (endpoint più vecchio) NON si deduce nessun fail da
  // `archives.newest`: si reintrodurrebbe lo stesso falso rosso del difetto
  // originale su un endpoint che non espone l'informazione necessaria.
  const newestMs = parseFlexibleDate(state.archives.newest);
  const newestAgeMinutes = newestMs !== null ? (nowMs - newestMs) / 60000 : null;
  const daysBeforeArchive = state.retention_policy.days_before_archive;
  let longTermVerdict: HealthVerdict = "ok";
  if (typeof daysBeforeArchive === "number" && newestAgeMinutes !== null) {
    const horizonMinutes = (daysBeforeArchive + 1) * 1440 + 2 * intervalMinutes;
    if (newestAgeMinutes > horizonMinutes) longTermVerdict = "fail";
  }

  const freshnessVerdict = worst(cycleVerdict, longTermVerdict);

  // ── Verifica d'integrità ────────────────────────────────────────────────
  // Sul campo il comando di verifica ha riportato `outcome: "success"` con
  // `archives_checked: 0`: aveva validato solo la catena dei manifest (un file
  // di 6 KB, in 18 millesimi di secondo) senza rileggere nessuno dei 340
  // archivi presenti sullo storage né verificarne le firme. Un `success` così
  // non è una conferma d'integrità, e mostrarlo come tale è peggio che tacere.
  // Prima di questa modifica, inoltre, la sezione restava `{"outcome":"never"}`
  // per giorni dopo un crash del comando, senza che nulla lo segnalasse.
  const verifyRun = state.runs.verify;
  const verifyIntervalMinutes = verifyIntervalToMinutes(state.schedule.verify_interval);
  const verifyThresholdMinutes = verifyIntervalMinutes !== null
    ? Math.max(2 * verifyIntervalMinutes, VERIFY_MIN_THRESHOLD_MINUTES)
    : VERIFY_STALE_FALLBACK_MINUTES;

  const verifyLastMs = parseFlexibleDate(verifyRun.last_finished_at);
  const verifyAgeMinutes = verifyLastMs !== null ? (nowMs - verifyLastMs) / 60000 : null;
  const verifyChecked = verifyRun.archives_checked;
  const verifyValid = verifyRun.archives_valid;

  const chainInvalid = verifyRun.manifest_chain_valid === false;
  const verifyOutcomeFailed = verifyRun.outcome === "failed";
  // Archivi ricontrollati che NON corrispondono più: è la manomissione che
  // questa verifica esiste per rilevare.
  const verifyMismatch =
    typeof verifyChecked === "number" &&
    typeof verifyValid === "number" &&
    verifyChecked > 0 &&
    verifyValid < verifyChecked;
  // Archivi contati ma senza esito riportato: non si può dire quanti fossero
  // validi, quindi non si dice. Dedurre `validi = ricontrollati` sarebbe la
  // stessa falsa conferma che questo blocco esiste per eliminare.
  const verifyValidUnknown =
    typeof verifyChecked === "number" && verifyChecked > 0 && typeof verifyValid !== "number";
  const verifyNeverCompleted = verifyRun.outcome === "never";
  const verifyStale = verifyAgeMinutes !== null && verifyAgeMinutes > verifyThresholdMinutes;
  // `archives_checked` assente = endpoint che non espone il dato: non si
  // inventa un allarme. Solo uno zero DICHIARATO dice "non ho controllato
  // nulla".
  const verifyCheckedNothing = verifyRun.outcome === "success" && verifyChecked === 0;

  const integrityFailed = chainInvalid || verifyOutcomeFailed || verifyMismatch;
  const verifyVerdict: HealthVerdict = integrityFailed
    ? "fail"
    : verifyNeverCompleted || verifyStale || verifyCheckedNothing || verifyValidUnknown
      ? "degraded"
      : "ok";

  /** Riga di dettaglio: dice cosa è stato controllato, non solo l'esito. */
  function describeVerify(): string {
    if (chainInvalid) return "catena dei manifest non valida";
    if (verifyMismatch) return `${verifyValid} archivi validi su ${verifyChecked} ricontrollati`;
    if (verifyOutcomeFailed) return "fallita";
    if (verifyNeverCompleted) return "mai completata";
    const eta = verifyStale && verifyAgeMinutes !== null
      ? `, ferma da ${formatDuration(verifyAgeMinutes)}`
      : "";
    if (verifyCheckedNothing) return `catena valida, 0 archivi ricontrollati${eta}`;
    if (verifyValidUnknown) return `${verifyChecked} archivi ricontrollati, esito non riportato${eta}`;
    if (typeof verifyChecked === "number" && verifyChecked > 0) {
      return `${verifyChecked} archivi ricontrollati, ${verifyValid} validi${eta}`;
    }
    return `${verifyRun.outcome}${eta}`;
  }

  const destPercent = parsePercent(state.backend.disk?.use_percent);
  const localPercent = parsePercent(state.local_disk.use_percent);
  const destVerdict = classifyDiskUsage(destPercent);
  const localVerdict = classifyDiskUsage(localPercent);

  const verdict: HealthVerdict = archiveAttemptFailed
    ? "fail"
    : worst(freshnessVerdict, destVerdict, localVerdict, verifyVerdict);

  const detail: string[] = [`ultimo archivio: ${archiveRun.outcome}`];
  if ((archiveRun.failed ?? 0) > 0) detail.push(`upload falliti: ${archiveRun.failed}`);
  detail.push(`verifica integrità: ${describeVerify()}`);
  // `archives.newest` resta mostrato: non concorre più da sola al verdetto,
  // ma è informazione utile all'operatore (vedi brief Difetto 1).
  detail.push(
    newestAgeMinutes !== null
      ? `archivio più recente: creato ${formatDuration(newestAgeMinutes)} fa`
      : "archivio più recente: nessuno",
  );
  if (destPercent !== null) detail.push(`disco destinazione: ${destPercent}%`);
  if (localPercent !== null) detail.push(`disco locale host wazuh: ${localPercent}%`);

  let headline: string;
  if (archiveAttemptFailed) {
    headline = (archiveRun.failed ?? 0) > 0
      ? `upload falliti nell'ultimo run di archiviazione (${archiveRun.failed})`
      : "ultimo run di archiviazione non riuscito";
  } else if (verifyMismatch) {
    headline = `integrità compromessa: ${verifyValid} archivi validi su ${verifyChecked} ricontrollati`;
  } else if (integrityFailed) {
    headline = "verifica di integrità fallita";
  } else if (cycleVerdict === "fail") {
    headline = cycleAgeMinutes === null
      ? "nessun ciclo di archiviazione riuscito"
      : `ciclo di archiviazione fermo da ${formatDuration(cycleAgeMinutes)}`;
  } else if (longTermVerdict === "fail") {
    headline = `nessun archivio arrivato a destinazione da ${formatDuration(newestAgeMinutes ?? 0)}`;
  } else if (waitingForFirstCycle) {
    headline = archiveNeverRun
      ? "in attesa del primo ciclo di archiviazione"
      : "nessuna replica riuscita finora, in attesa del prossimo ciclo";
  } else if (destVerdict === "fail" || localVerdict === "fail") {
    headline = "spazio esaurito sul disco di replica";
  } else if (destVerdict === "degraded" || localVerdict === "degraded") {
    headline = "disco di replica in esaurimento";
  } else if (verifyNeverCompleted) {
    headline = "integrità mai verificata";
  } else if (verifyStale) {
    headline = `integrità non verificata da ${formatDuration(verifyAgeMinutes as number)}`;
  } else if (verifyCheckedNothing) {
    headline = "nessun archivio ricontrollato dalla verifica d'integrità";
  } else if (verifyValidUnknown) {
    headline = "verifica d'integrità senza esito sugli archivi ricontrollati";
  } else {
    const okAgeMinutes = cycleAgeMinutes ?? newestAgeMinutes ?? 0;
    headline = `ultimo ciclo di archiviazione riuscito ${formatDuration(okAgeMinutes)} fa`;
  }

  return { key: "replication", verdict, headline, detail, configured: true };
}
