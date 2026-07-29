/**
 * Raccolta dei quattro blocchi di salute Wazuh (manager, indexer, ingestione,
 * repliche) per il cruscotto salute — fase 2.
 *
 * Struttura modellata su `src/lib/modules/health.ts`: cache 60s per tenant,
 * ogni probe con timeout individuale (`PROBE_TIMEOUT_MS`), `Promise.allSettled`
 * per isolare i fallimenti — un probe che lancia produce SOLO il suo blocco a
 * "fail", senza abbattere gli altri.
 *
 * Le soglie e i verdetti vivono in `wazuh-health-thresholds.ts` (funzioni
 * pure): qui si raccolgono solo i dati grezzi e si gestiscono i casi di
 * "non configurato" per i blocchi che non hanno un ingresso esplicito per
 * quello stato (manager, indexer, ingestione — repliche lo gestisce già
 * `classifyReplication(null, …)`).
 */
import { getTenantDb } from "@/lib/db-tenant";
import { getWazuhConfig } from "./wazuh-config";
import { createWazuhClient } from "./wazuh-api";
import { createWazuhIndexerClient } from "./wazuh-indexer-api";
import { fetchImmutableStoreState, getImmutableStoreConfig } from "./immutable-store-api";
import { ensureWazuhAlertSchema, getLatestAlertTimestamp } from "./wazuh-alerts-db";
import {
  classifyManager,
  classifyIndexer,
  classifyIngestion,
  classifyReplication,
  type BlockHealth,
} from "./wazuh-health-thresholds";

export interface WazuhHealth {
  blocks: BlockHealth[];
  probedAt: string;
}

const TTL_MS = 60_000;
const PROBE_TIMEOUT_MS = 8_000;

interface CacheEntry {
  at: number;
  value: WazuhHealth;
}

const cache = new Map<string, CacheEntry>();

/** Invalida la cache health Wazuh per un tenant (force re-probe). */
export function invalidateWazuhHealth(tenantCode: string): void {
  cache.delete(tenantCode);
}

/** Timeout generico per un probe: rigetta con `message` se `p` non risolve entro `ms`. */
function withTimeoutReject<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

/** Blocco a esito negativo — usato sia per gli errori di probe sia per la
 *  configurazione mancante nei blocchi non opzionali. */
function failBlock(key: BlockHealth["key"], headline: string, configured = true): BlockHealth {
  return { key, verdict: "fail", headline, configured };
}

// ── Probe: manager ────────────────────────────────────────────────────────────
async function probeManager(): Promise<BlockHealth> {
  const cfg = getWazuhConfig();
  const mgr = createWazuhClient({
    url: cfg.url,
    username: cfg.username,
    password: cfg.password,
    verifyTls: cfg.verifyTls,
  });
  if (!cfg.enabled || !mgr) {
    return failBlock("manager", "Wazuh non configurato", false);
  }
  try {
    const daemons = await withTimeoutReject(
      mgr.getManagerStatus(),
      PROBE_TIMEOUT_MS,
      "timeout stato manager",
    );
    return classifyManager(daemons);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "errore sconosciuto";
    return failBlock("manager", `manager non raggiungibile: ${msg}`);
  }
}

// ── Probe: indexer ────────────────────────────────────────────────────────────
async function probeIndexer(): Promise<BlockHealth> {
  const cfg = getWazuhConfig();
  const idx = createWazuhIndexerClient({
    url: cfg.indexerUrl,
    username: cfg.indexerUsername,
    password: cfg.indexerPassword,
    verifyTls: cfg.verifyTls,
  });
  if (!idx) {
    // L'indexer è opzionale (come in modules/health.ts): la sua assenza non
    // è un guasto, invita solo a configurarlo.
    return {
      key: "indexer",
      verdict: "ok",
      headline: "indexer non configurato (facoltativo)",
      configured: false,
    };
  }
  try {
    const [cluster, nodes] = await withTimeoutReject(
      Promise.all([idx.ping(), idx.getNodesDiskUsage()]),
      PROBE_TIMEOUT_MS,
      "timeout indexer",
    );
    return classifyIndexer({ status: cluster.status }, nodes);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "errore sconosciuto";
    return failBlock("indexer", `indexer non raggiungibile: ${msg}`);
  }
}

// ── Probe: ingestione ──────────────────────────────────────────────────────────
/**
 * Non avvolto in try/catch proprio: un errore nella lettura delle statistiche
 * analysisd propaga fino a `Promise.allSettled` in `compute()`, che isola il
 * fallimento sul blocco "ingestion" (comportamento voluto, non un bug).
 *
 * Con Wazuh non configurato il blocco è `configured: false` (come manager e
 * indexer), non un verde "allineata": senza credenziali non c'è nulla da
 * verificare, e un semaforo verde su un'appliance appena installata sarebbe
 * una falsa rassicurazione (fix review fase 2, Important 2).
 */
async function probeIngestion(tenantCode: string): Promise<BlockHealth> {
  const cfg = getWazuhConfig();
  const mgr = createWazuhClient({
    url: cfg.url,
    username: cfg.username,
    password: cfg.password,
    verifyTls: cfg.verifyTls,
  });

  if (!cfg.enabled || !mgr) {
    return classifyIngestion({ configured: false, nowMs: Date.now() });
  }

  const stats = await withTimeoutReject(
    mgr.getAnalysisdStats(),
    PROBE_TIMEOUT_MS,
    "timeout statistiche analysisd",
  );

  // L'alert più recente viene dal DB tenant (wazuh_alert_event.last_seen_at),
  // non dall'indexer: più economico e riflette ciò che DA-IPAM ha davvero
  // ricevuto (vedi brief Task 3).
  const db = getTenantDb(tenantCode);
  ensureWazuhAlertSchema(db);
  const newestAlertIso = getLatestAlertTimestamp(db);

  return classifyIngestion({
    eventsDropped: stats?.eventsDropped,
    queueUsage: stats?.queueUsage,
    newestAlertIso,
    nowMs: Date.now(),
  });
}

// ── Probe: repliche ────────────────────────────────────────────────────────────
async function probeReplication(): Promise<BlockHealth> {
  const cfg = getImmutableStoreConfig();
  if (!cfg) return classifyReplication(null, Date.now());
  try {
    const state = await fetchImmutableStoreState(cfg, PROBE_TIMEOUT_MS);
    return classifyReplication(state, Date.now());
  } catch (e) {
    // ImmutableStoreError/Error: il messaggio non contiene mai il token
    // (vedi immutable-store-api.ts), solo stato HTTP/motivo di rete.
    const msg = e instanceof Error ? e.message : "errore sconosciuto";
    return failBlock("replication", `endpoint di stato repliche non raggiungibile: ${msg}`);
  }
}

/** Le quattro dipendenze di `composeHealthBlocks`: una funzione per blocco,
 *  ciascuna `() => Promise<BlockHealth>`. Iniettabili per testare l'isolamento
 *  dei fallimenti senza aprire socket (vedi `wazuh-health.test.ts`). */
export interface WazuhHealthProbes {
  manager: () => Promise<BlockHealth>;
  indexer: () => Promise<BlockHealth>;
  ingestion: () => Promise<BlockHealth>;
  replication: () => Promise<BlockHealth>;
}

/**
 * Compone i quattro blocchi eseguendo i probe in parallelo con
 * `Promise.allSettled`: un probe che lancia produce SOLO il suo blocco a
 * "fail" (messaggio dell'errore), senza influenzare gli altri tre né
 * propagare l'eccezione al chiamante. L'ordine del risultato è sempre
 * manager → indexer → ingestion → replication (la UI vi si appoggia).
 */
export async function composeHealthBlocks(probes: WazuhHealthProbes): Promise<BlockHealth[]> {
  const tasks: Array<[BlockHealth["key"], Promise<BlockHealth>]> = [
    ["manager", probes.manager()],
    ["indexer", probes.indexer()],
    ["ingestion", probes.ingestion()],
    ["replication", probes.replication()],
  ];
  const settled = await Promise.allSettled(tasks.map(([, p]) => p));
  return settled.map((res, i) => {
    const key = tasks[i][0];
    if (res.status === "fulfilled") return res.value;
    const reason = res.reason instanceof Error ? res.reason.message : "errore sconosciuto";
    return failBlock(key, `probe fallito: ${reason}`);
  });
}

async function compute(tenantCode: string): Promise<WazuhHealth> {
  const probedAt = new Date().toISOString();
  const blocks = await composeHealthBlocks({
    manager: probeManager,
    indexer: probeIndexer,
    ingestion: () => probeIngestion(tenantCode),
    replication: probeReplication,
  });
  return { blocks, probedAt };
}

/**
 * Stato di salute Wazuh per il tenant (manager, indexer, ingestione, repliche).
 * @param opts.force bypassa la cache (re-probe live).
 */
export async function getWazuhHealth(
  tenantCode: string,
  opts?: { force?: boolean },
): Promise<WazuhHealth> {
  const now = Date.now();
  if (!opts?.force) {
    const cached = cache.get(tenantCode);
    if (cached && now - cached.at < TTL_MS) return cached.value;
  }
  const value = await compute(tenantCode);
  cache.set(tenantCode, { at: now, value });
  return value;
}
