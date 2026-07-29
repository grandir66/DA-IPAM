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

export function classifyDiskUsage(usePercent: number | null | undefined): HealthVerdict {
  if (usePercent === null || usePercent === undefined || !Number.isFinite(usePercent)) {
    return "ok";
  }
  if (usePercent >= DISK_FAIL_PERCENT) return "fail";
  if (usePercent >= DISK_WARN_PERCENT) return "degraded";
  return "ok";
}

export function classifyManager(daemons: Array<{ name: string; status: string }>): BlockHealth {
  const stopped = daemons.filter((d) => d.status !== "running").map((d) => d.name);

  if (stopped.length === 0) {
    return { key: "manager", verdict: "ok", headline: "tutti i demoni attivi", configured: true };
  }

  const headline = stopped.length === 1 ? `${stopped[0]} fermo` : `demoni fermi: ${stopped.join(", ")}`;

  return {
    key: "manager",
    verdict: "fail",
    headline,
    detail: stopped.map((name) => `${name}: fermo`),
    configured: true,
  };
}

export function classifyIndexer(
  cluster: { status?: string },
  nodes: Array<{ node: string; diskPercent: number | null }>,
): BlockHealth {
  const colorVerdict: HealthVerdict =
    cluster.status === "red"
      ? "fail"
      : cluster.status === "yellow"
        ? "degraded"
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
  const verdict = worst(colorVerdict, ...diskVerdicts);

  // Il nodo peggiore, non la media: una media rassicurante accanto a un
  // verdetto rosso nasconderebbe proprio il nodo che lo causa.
  const worstNode = nodes.reduce<{ node: string; diskPercent: number } | null>((acc, n) => {
    if (n.diskPercent === null) return acc;
    if (acc === null || n.diskPercent > acc.diskPercent) return { node: n.node, diskPercent: n.diskPercent };
    return acc;
  }, null);

  const headline =
    worstNode !== null
      ? `cluster ${colorLabel} · ${worstNode.diskPercent}% su ${nodes.length} nod${nodes.length === 1 ? "o" : "i"} (peggiore: ${worstNode.node})`
      : `cluster ${colorLabel}`;

  const detail =
    nodes.length > 0
      ? nodes.map((n) => `${n.node}: ${n.diskPercent !== null ? `${n.diskPercent}%` : "n/d"}`)
      : undefined;

  return { key: "indexer", verdict, headline, detail, configured: true };
}

export function classifyIngestion(input: {
  eventsDropped?: number;
  queueUsage?: number;
  newestAlertIso?: string | null;
  nowMs: number;
}): BlockHealth {
  const newestMs = parseFlexibleDate(input.newestAlertIso);
  const lagMinutes = newestMs !== null ? (input.nowMs - newestMs) / 60000 : null;
  const isLate = lagMinutes !== null && lagMinutes > INGESTION_LAG_WARN_MINUTES;
  const hasDropped = (input.eventsDropped ?? 0) > 0;

  const verdict = worst(isLate ? "degraded" : "ok", hasDropped ? "degraded" : "ok");

  const detail: string[] = [];
  if (hasDropped) detail.push(`eventi scartati: ${input.eventsDropped}`);
  if (typeof input.queueUsage === "number") detail.push(`code al ${Math.round(input.queueUsage)}%`);

  let headline: string;
  if (isLate) {
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

  const thresholdMinutes = Math.max(
    2 * intervalToMinutes(state.schedule.archive_interval),
    REPLICATION_MIN_HOURS * 60,
  );

  const newestMs = parseFlexibleDate(state.archives.newest);
  const ageMinutes = newestMs !== null ? (nowMs - newestMs) / 60000 : null;

  const archiveRun = state.runs.archive;
  // "never" = non ancora tentato (es. endpoint appena configurato, prima che
  // il ciclo orario abbia potuto girare): NON è un guasto immediato, si
  // concede la stessa soglia di grazia (thresholdMinutes, minimo 3h) usata
  // per la staleness. Un tentativo REALMENTE fallito (`failed`/`partial`,
  // o `failed > 0`) resta un errore da subito.
  const archiveNeverRun = archiveRun.outcome === "never";
  const archiveAttemptFailed =
    archiveRun.outcome === "failed" || archiveRun.outcome === "partial" || (archiveRun.failed ?? 0) > 0;

  // Verdetto di "freschezza": se esiste un `archives.newest` valido, la sua
  // età decide subito (staleness reale). Se non esiste (mai archiviato o
  // campo non parsabile), si usa `generated_at` come proxy di "da quanto
  // tempo attendiamo il primo ciclo" e si concede la stessa soglia di grazia
  // prima di dichiarare fail; nel frattempo il blocco è "degraded", non "ok"
  // (in attesa, non necessariamente sano) e non "fail" (non ancora provato
  // che sia rotto).
  let freshnessVerdict: HealthVerdict;
  let waitingForFirstCycle = false;
  if (ageMinutes !== null) {
    freshnessVerdict = ageMinutes > thresholdMinutes ? "fail" : "ok";
  } else {
    const generatedMs = parseFlexibleDate(state.generated_at);
    const waitMinutes = generatedMs !== null ? (nowMs - generatedMs) / 60000 : null;
    if (waitMinutes !== null && waitMinutes > thresholdMinutes) {
      freshnessVerdict = "fail";
    } else {
      freshnessVerdict = "degraded";
      waitingForFirstCycle = true;
    }
  }

  // `verify` vale spesso "never" a riposo: non è un guasto. Solo una catena
  // dichiarata esplicitamente non valida lo è.
  const verifyRun = state.runs.verify;
  const integrityFailed = verifyRun.manifest_chain_valid === false;

  const destPercent = parsePercent(state.backend.disk?.use_percent);
  const localPercent = parsePercent(state.local_disk.use_percent);
  const destVerdict = classifyDiskUsage(destPercent);
  const localVerdict = classifyDiskUsage(localPercent);

  const verdict: HealthVerdict = archiveAttemptFailed || integrityFailed
    ? "fail"
    : worst(freshnessVerdict, destVerdict, localVerdict);

  const detail: string[] = [`ultimo archivio: ${archiveRun.outcome}`];
  if ((archiveRun.failed ?? 0) > 0) detail.push(`upload falliti: ${archiveRun.failed}`);
  detail.push(`verifica integrità: ${verifyRun.outcome}`);
  if (destPercent !== null) detail.push(`disco destinazione: ${destPercent}%`);
  if (localPercent !== null) detail.push(`disco locale host wazuh: ${localPercent}%`);

  let headline: string;
  if (archiveAttemptFailed) {
    headline = (archiveRun.failed ?? 0) > 0
      ? `upload falliti nell'ultimo run di archiviazione (${archiveRun.failed})`
      : "ultimo run di archiviazione non riuscito";
  } else if (integrityFailed) {
    headline = "verifica di integrità fallita";
  } else if (freshnessVerdict === "fail") {
    headline = ageMinutes === null
      ? "nessuna replica riuscita"
      : `nessuna replica riuscita da ${formatDuration(ageMinutes)}`;
  } else if (waitingForFirstCycle) {
    headline = archiveNeverRun
      ? "in attesa del primo ciclo di archiviazione"
      : "nessuna replica riuscita finora, in attesa del prossimo ciclo";
  } else if (destVerdict === "fail" || localVerdict === "fail") {
    headline = "spazio esaurito sul disco di replica";
  } else if (destVerdict === "degraded" || localVerdict === "degraded") {
    headline = "disco di replica in esaurimento";
  } else {
    headline = `ultima replica riuscita ${formatDuration(ageMinutes ?? 0)} fa`;
  }

  return { key: "replication", verdict, headline, detail, configured: true };
}
