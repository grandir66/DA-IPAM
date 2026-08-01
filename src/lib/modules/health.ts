/**
 * Layer di SALUTE dei moduli — verità L7 (raggiungibile + auth + ultimo sync).
 *
 * v2 (2026-06-18, F2): i probe sono LIVE — chiamano i client lib di ciascun
 * modulo (createWazuhClient.ping, createWazuhIndexerClient.ping, pingEdge,
 * fetch librenms/graylog, probeBridgeWithAuth). Il risultato è normalizzato in
 * {reachable, authOk, verdict, detail, repairAction} oltre ai campi storici
 * (status/message/lastSync/probedAt) che il modules-grid.tsx già consuma.
 *
 *  - GET /api/modules/health → cache 60s (per il polling della UI).
 *  - POST /api/modules/health {key?} → force re-probe (bypass cache), usato
 *    dall'installer (connect.sh fail-fast) e dal bottone "Verifica".
 *
 * Ogni probe è bounded con withTimeout (PROBE_TIMEOUT_MS).
 */
import { statfs } from "node:fs/promises";
import { execFile } from "node:child_process";
import { withTenant, getTenantDb } from "@/lib/db-tenant";
import { getIntegrationConfig } from "@/lib/integrations/config";
import { getWazuhConfig } from "@/lib/integrations/wazuh-config";
import { createWazuhClient } from "@/lib/integrations/wazuh-api";
import { createWazuhIndexerClient } from "@/lib/integrations/wazuh-indexer-api";
import { pingEdge, EdgeClientError } from "@/lib/vuln/scanner-edge-client";
import { getFeatureStatus } from "@/lib/patch/feature";
import { getNetServicesState } from "@/lib/network-services/feature";
import { probeBridgeWithAuth } from "@/lib/network-services/client";
import { safeDecrypt } from "@/lib/crypto";
import { classifyDiskUsage } from "@/lib/integrations/wazuh-health-thresholds";
import { getMeshCreds } from "@/lib/integrations/meshcentral/config";
import { MeshControlClient } from "@/lib/integrations/meshcentral/control-client";
import type { ModuleKey } from "./registry";

export type ModuleHealthStatus =
  | "ok"
  | "warning"
  | "error"
  | "stale"
  | "never"
  | "unknown";

export type ModuleVerdict = "ok" | "degraded" | "fail";

/** Azione di riparazione machine-readable (consumata da /repair + UI). */
export type ModuleRepairAction =
  | "reconfigure_wazuh"
  | "check_edge_cert"
  | "reconfigure_edge"
  | "reconfigure_librenms"
  | "reconfigure_graylog"
  | "reconfigure_net_services"
  | null;

export interface ModuleHealth {
  key: ModuleKey;
  // Campi storici (back-compat con modules-grid.tsx)
  status: ModuleHealthStatus;
  message: string | null;
  lastSync: string | null;
  probedAt: string;
  // Campi nuovi (F2): verità L7 normalizzata
  reachable: boolean;
  authOk: boolean;
  lastSyncAt: string | null;
  verdict: ModuleVerdict;
  detail: string | null;
  repairAction: ModuleRepairAction;
}

const TTL_MS = 60_000;
const PROBE_TIMEOUT_MS = 8_000;

interface CacheEntry {
  value: ModuleHealth[];
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

/** Invalida la cache health per un tenant (dopo import/config o force probe). */
export function invalidateModulesHealth(tenantCode: string): void {
  cache.delete(tenantCode);
}

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

/** Come withTimeout ma scarta il probe con reject (evita Promise.reject() eager). */
function withTimeoutReject<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

/** verdict → status storico (per i consumer che usano ancora `status`). */
function verdictToStatus(v: ModuleVerdict, configured: boolean): ModuleHealthStatus {
  if (!configured) return "never";
  if (v === "ok") return "ok";
  if (v === "degraded") return "warning";
  return "error";
}

/** Costruisce un ModuleHealth normalizzato (riempie sia i campi nuovi sia gli storici). */
function mk(
  key: ModuleKey,
  probedAt: string,
  opts: {
    reachable: boolean;
    authOk: boolean;
    verdict: ModuleVerdict;
    detail: string | null;
    lastSyncAt?: string | null;
    repairAction?: ModuleRepairAction;
    configured?: boolean;
  },
): ModuleHealth {
  const configured = opts.configured ?? true;
  return {
    key,
    status: verdictToStatus(opts.verdict, configured),
    message: opts.detail,
    lastSync: opts.lastSyncAt ?? null,
    probedAt,
    reachable: opts.reachable,
    authOk: opts.authOk,
    lastSyncAt: opts.lastSyncAt ?? null,
    verdict: opts.verdict,
    detail: opts.detail,
    repairAction: opts.repairAction ?? null,
  };
}

// ── Probe: meshcentral (RMM) ─────────────────────────────────────────────────
/**
 * Verifica in un colpo solo le tre cose che rendono l'RMM utilizzabile:
 * il server risponde, il service account si autentica sul control WebSocket, e
 * il device group configurato esiste ancora la' sopra. Riporta anche l'ultimo
 * `meshcentral_sync` riuscito: un server sano con il sync fermo e' comunque un
 * problema (cfr. incidente 2026-07-05, 11 giorni di sync fermo non visti).
 *
 * NB: usa `listMeshes()`, che fino alla v0.3.132 andava sempre in timeout —
 * MeshCentral risponde a 'meshes' con il solo `tag`, senza `responseid`.
 */
async function probeMeshcentral(tenantCode: string, probedAt: string): Promise<ModuleHealth> {
  const creds = getMeshCreds();
  const lastSyncAt =
    (
      getTenantDb(tenantCode)
        .prepare(
          `SELECT last_run FROM scheduled_jobs
            WHERE job_type = 'meshcentral_sync' AND network_id IS NULL`,
        )
        .get() as { last_run: string | null } | undefined
    )?.last_run ?? null;

  if (!creds) {
    return mk("meshcentral", probedAt, {
      reachable: false,
      authOk: false,
      verdict: "fail",
      detail: "MeshCentral non configurato",
      configured: false,
    });
  }

  const client = new MeshControlClient(creds);
  try {
    const meshes = await withTimeoutReject(
      client.listMeshes(),
      PROBE_TIMEOUT_MS,
      "control.ashx 'meshes' timeout",
    );
    // Se rispondiamo qui, il server e' raggiungibile E il service account e'
    // autenticato: control.ashx chiude la connessione (action 'close') se l'auth
    // fallisce, quindi una risposta valida implica entrambe le cose.
    const groupOk = meshes.some((m) => m.meshId === creds.meshId);
    if (!groupOk) {
      return mk("meshcentral", probedAt, {
        reachable: true,
        authOk: true,
        verdict: "degraded",
        detail:
          "Device group configurato non presente sul server: gli agenti non verranno associati",
        lastSyncAt,
      });
    }
    const nodes = getTenantDb(tenantCode)
      .prepare("SELECT COUNT(*) AS n, SUM(conn) AS c FROM mc_node")
      .get() as { n: number; c: number | null };
    return mk("meshcentral", probedAt, {
      reachable: true,
      authOk: true,
      verdict: "ok",
      detail: `${nodes.n} endpoint, ${nodes.c ?? 0} connessi`,
      lastSyncAt,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // L'auth fallita si manifesta come chiusura della connessione, non come 401.
    const authIssue = /auth|noauth|close/i.test(msg);
    return mk("meshcentral", probedAt, {
      reachable: !authIssue,
      authOk: false,
      verdict: "fail",
      detail: authIssue
        ? `Autenticazione MeshCentral fallita: ${msg}`
        : `MeshCentral non raggiungibile: ${msg}`,
      lastSyncAt,
    });
  } finally {
    // Senza close() le richieste in volo restano appese e il socket perde.
    client.close();
  }
}

// ── Probe: edge ──────────────────────────────────────────────────────────────
function probeEdge(tenantCode: string, probedAt: string): Promise<ModuleHealth> {
  const row = getTenantDb(tenantCode)
    .prepare(
      "SELECT base_url, token_encrypted, cert_pin, last_sync_at FROM vuln_scanners ORDER BY id LIMIT 1",
    )
    .get() as
    | { base_url: string; token_encrypted: string; cert_pin: string | null; last_sync_at: string | null }
    | undefined;

  if (!row) {
    return Promise.resolve(
      mk("edge", probedAt, {
        reachable: false, authOk: false, verdict: "fail",
        detail: "Scanner-Edge non configurato", configured: false,
      }),
    );
  }
  const token = safeDecrypt(row.token_encrypted);
  if (!token) {
    return Promise.resolve(
      mk("edge", probedAt, {
        reachable: false, authOk: false, verdict: "fail",
        detail: "Token edge non decifrabile (ENCRYPTION_KEY cambiata?)",
        repairAction: "reconfigure_edge", lastSyncAt: row.last_sync_at,
      }),
    );
  }
  return pingEdge(row.base_url, token, row.cert_pin)
    .then(() =>
      mk("edge", probedAt, {
        reachable: true, authOk: true, verdict: "ok", detail: null, lastSyncAt: row.last_sync_at,
      }),
    )
    .catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : "errore";
      const status = e instanceof EdgeClientError ? e.status : 0;
      const certIssue = /pin|cert|SPKI|fingerprint/i.test(msg);
      return mk("edge", probedAt, {
        reachable: status !== 0,
        authOk: status !== 401 && status !== 403,
        verdict: "fail",
        detail: msg,
        repairAction: certIssue ? "check_edge_cert" : "reconfigure_edge",
        lastSyncAt: row.last_sync_at,
      });
    });
}

// ── Probe: wazuh (manager + indexer) ─────────────────────────────────────────
async function probeWazuh(probedAt: string): Promise<ModuleHealth> {
  const cfg = getWazuhConfig();
  if (!cfg.enabled || !cfg.url) {
    return mk("wazuh", probedAt, {
      reachable: false, authOk: false, verdict: "fail",
      detail: "Wazuh non configurato", configured: false,
    });
  }
  const mgr = createWazuhClient({
    url: cfg.url, username: cfg.username, password: cfg.password, verifyTls: cfg.verifyTls,
  });
  if (!mgr) {
    return mk("wazuh", probedAt, {
      reachable: false, authOk: false, verdict: "fail",
      detail: "Config Wazuh incompleta (url/user/password)", repairAction: "reconfigure_wazuh",
    });
  }

  let mgrReach = false, mgrAuth = false, mgrErr: string | null = null;
  try {
    await withTimeoutReject(mgr.ping(), PROBE_TIMEOUT_MS, "Timeout manager");
    mgrReach = true; mgrAuth = true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "errore";
    mgrErr = msg;
    mgrReach = !/ECONN|ENOTFOUND|EHOSTUNREACH|Timeout|fetch failed/i.test(msg);
    mgrAuth = false;
  }

  // Indexer (opzionale): se configurato lo verifichiamo per distinguere degraded.
  let idxOk = true, idxErr: string | null = null;
  if (cfg.indexerUrl) {
    const idx = createWazuhIndexerClient({
      url: cfg.indexerUrl, username: cfg.indexerUsername, password: cfg.indexerPassword, verifyTls: cfg.verifyTls,
    });
    if (idx) {
      try {
        await withTimeoutReject(idx.ping(), PROBE_TIMEOUT_MS, "Timeout indexer");
        idxOk = true;
      } catch (e) {
        idxOk = false;
        idxErr = e instanceof Error ? e.message : "errore indexer";
      }
    }
  }

  let verdict: ModuleVerdict, detail: string | null;
  if (mgrReach && mgrAuth && idxOk) {
    verdict = "ok"; detail = null;
  } else if (mgrReach && mgrAuth && !idxOk) {
    verdict = "degraded"; detail = `Manager OK, indexer KO: ${idxErr ?? "non raggiungibile"}`;
  } else {
    verdict = "fail"; detail = mgrErr ?? "Manager non raggiungibile";
  }
  return mk("wazuh", probedAt, {
    reachable: mgrReach, authOk: mgrAuth, verdict, detail, repairAction: "reconfigure_wazuh",
  });
}

// ── Probe: librenms / graylog (fetch HTTP, come test-connection) ──────────────
async function probeHttpIntegration(
  key: "librenms" | "graylog",
  probedAt: string,
): Promise<ModuleHealth> {
  const cfg = getIntegrationConfig(key);
  const repair: ModuleRepairAction = key === "librenms" ? "reconfigure_librenms" : "reconfigure_graylog";
  if (cfg.mode === "disabled" || !cfg.url) {
    return mk(key, probedAt, {
      reachable: false, authOk: false, verdict: "fail", detail: "Non configurato", configured: false,
    });
  }
  const base = cfg.url.replace(/\/$/, "");
  const testUrl = key === "librenms" ? `${base}/api/v0/devices?limit=1` : `${base}/api/`;
  const headers: Record<string, string> =
    key === "librenms" && cfg.apiToken ? { "X-Auth-Token": cfg.apiToken } : {};
  try {
    const res = await withTimeoutReject(
      fetch(testUrl, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS), headers }),
      PROBE_TIMEOUT_MS + 1_000,
      "Timeout",
    );
    const reachable = res.status < 500;
    const authOk = res.status < 400;
    return mk(key, probedAt, {
      reachable, authOk,
      verdict: authOk ? "ok" : "fail",
      detail: authOk ? null : `HTTP ${res.status}`,
      repairAction: authOk ? null : repair,
    });
  } catch (e) {
    return mk(key, probedAt, {
      reachable: false, authOk: false, verdict: "fail",
      detail: e instanceof Error ? e.message : "errore", repairAction: repair,
    });
  }
}

// ── Probe: network_services (bridge) ─────────────────────────────────────────
async function probeNetServices(tenantCode: string, probedAt: string): Promise<ModuleHealth> {
  const net = await getNetServicesState(tenantCode);
  if (!net.enabled) {
    return mk("network_services", probedAt, {
      reachable: false, authOk: false, verdict: "fail", detail: "Non installato", configured: false,
    });
  }
  if (!net.configured) {
    return mk("network_services", probedAt, {
      reachable: false, authOk: false, verdict: "fail",
      detail: "Config mancante", repairAction: "reconfigure_net_services",
    });
  }
  const probe = await withTimeout(
    probeBridgeWithAuth(net.apiUrl, net.apiToken),
    PROBE_TIMEOUT_MS,
    { ok: false as const, error: "Timeout probe bridge" },
  );
  return mk("network_services", probedAt, {
    reachable: probe.ok,
    authOk: probe.ok,
    verdict: probe.ok ? "ok" : "fail",
    detail: probe.ok ? null : probe.error,
    repairAction: probe.ok ? null : "reconfigure_net_services",
  });
}

// ── Probe: patch_management (modulo locale) ──────────────────────────────────
async function probePatch(tenantCode: string, probedAt: string): Promise<ModuleHealth> {
  const st = await getFeatureStatus(tenantCode, "patch_management");
  return mk("patch_management", probedAt, {
    reachable: st.enabled, authOk: st.enabled,
    verdict: st.enabled ? "ok" : "fail",
    detail: st.enabled ? "Modulo locale, nessun servizio esterno" : "Non installato",
    configured: st.enabled,
  });
}

// ── Probe: sistema appliance (disco + Docker) ────────────────────────────────
/**
 * Salute della macchina che ospita DA-IPAM. Il disco pieno è la morte
 * silenziosa delle appliance: DTS 2026-07-28 e PX-NAS 2026-07-30 si sono
 * fermate (build falliti, SQLite in "disk I/O error") senza che la griglia
 * moduli desse alcun segnale. Le soglie sono le stesse della fascia Wazuh
 * (`classifyDiskUsage`, ambra ≥85% / rosso ≥95%): un solo concetto di
 * "disco pieno" in tutto il prodotto.
 */
export interface ApplianceProbeReading {
  disk: { usePercent: number; freeGb: number } | { error: string };
  docker: { state: "attivo" | "assente" | "giu"; detail: string };
}

/** Composizione pura verdetto+messaggio: testabile senza I/O. */
export function composeApplianceHealth(reading: ApplianceProbeReading): {
  verdict: ModuleVerdict;
  detail: string;
} {
  const rank: Record<ModuleVerdict, number> = { ok: 0, degraded: 1, fail: 2 };
  const worst = (a: ModuleVerdict, b: ModuleVerdict): ModuleVerdict => (rank[b] > rank[a] ? b : a);

  let diskVerdict: ModuleVerdict;
  let diskLabel: string;
  if ("error" in reading.disk) {
    // Non sapere quanto disco resta non è "ok": è esattamente lo stato in cui
    // eravamo durante i due incident. Ma nemmeno "fail": il filesystem
    // potrebbe essere sano e il probe no.
    diskVerdict = "degraded";
    diskLabel = `disco non leggibile (${reading.disk.error})`;
  } else {
    diskVerdict = classifyDiskUsage(reading.disk.usePercent);
    diskLabel = `disco ${reading.disk.usePercent}% occupato (${reading.disk.freeGb} GB liberi)`;
  }

  // Docker assente non è un guasto (host senza container); demone
  // irraggiungibile sì — è il caso da-va-ovh 2026-07-29: docker giù dal boot
  // e l'intero stack Greenbone spento per 3 giorni.
  const dockerVerdict: ModuleVerdict = reading.docker.state === "giu" ? "fail" : "ok";

  return {
    verdict: worst(diskVerdict, dockerVerdict),
    detail: `${diskLabel} · ${reading.docker.detail}`,
  };
}

function probeDockerDaemon(): Promise<ApplianceProbeReading["docker"]> {
  return new Promise((resolve) => {
    execFile("docker", ["version", "--format", "{{.Server.Version}}"], { timeout: 5000 }, (err, stdout, stderr) => {
      if (!err) {
        resolve({ state: "attivo", detail: `Docker ${stdout.trim()} attivo` });
        return;
      }
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        resolve({ state: "assente", detail: "Docker non installato" });
        return;
      }
      const why = (stderr || err.message || "errore sconosciuto").trim().slice(0, 120);
      resolve({ state: "giu", detail: `demone Docker non raggiungibile: ${why}` });
    });
  });
}

async function probeAppliance(probedAt: string): Promise<ModuleHealth> {
  let disk: ApplianceProbeReading["disk"];
  try {
    const s = await statfs("/");
    const total = s.blocks * s.bsize;
    // `bavail` = spazio per processi non-root, lo stesso che vede `df` (e che
    // vedono npm/SQLite quando falliscono): `bfree` mentirebbe per ottimismo.
    const avail = s.bavail * s.bsize;
    disk = {
      usePercent: total > 0 ? Math.round(((total - avail) / total) * 100) : 0,
      freeGb: Math.round((avail / 1e9) * 10) / 10,
    };
  } catch (e) {
    disk = { error: e instanceof Error ? e.message : "errore sconosciuto" };
  }
  const dockerTimeoutFallback: ApplianceProbeReading["docker"] = {
    state: "giu",
    detail: "timeout interrogando il demone Docker",
  };
  const docker = await withTimeout(probeDockerDaemon(), PROBE_TIMEOUT_MS, dockerTimeoutFallback);
  const { verdict, detail } = composeApplianceHealth({ disk, docker });
  return mk("appliance", probedAt, {
    reachable: true,
    authOk: true,
    verdict,
    detail,
  });
}

async function compute(tenantCode: string): Promise<ModuleHealth[]> {
  const probedAt = new Date().toISOString();
  // I probe per-modulo sono indipendenti → in parallelo (ognuno bounded).
  // allSettled (NON all): se un probe RIGETTA (es. lettura DB fuori try su
  // disk-full / integrity-check failed) NON deve abbattere l'intera health API
  // né la home dashboard SSR che la consuma. Il probe fallito → verdict "fail".
  const tasks: Array<[ModuleKey, Promise<ModuleHealth>]> = [
    ["edge", withTenant(tenantCode, () => probeEdge(tenantCode, probedAt))],
    ["wazuh", probeWazuh(probedAt)],
    ["librenms", probeHttpIntegration("librenms", probedAt)],
    ["graylog", probeHttpIntegration("graylog", probedAt)],
    ["network_services", probeNetServices(tenantCode, probedAt)],
    ["patch_management", probePatch(tenantCode, probedAt)],
    ["meshcentral", withTenant(tenantCode, () => probeMeshcentral(tenantCode, probedAt))],
    ["appliance", probeAppliance(probedAt)],
  ];
  const settled = await Promise.allSettled(tasks.map(([, p]) => p));
  const byKey = {} as Record<ModuleKey, ModuleHealth>;
  settled.forEach((res, i) => {
    const key = tasks[i][0];
    if (res.status === "fulfilled") {
      byKey[key] = res.value;
    } else {
      const reason = res.reason instanceof Error ? res.reason.message : String(res.reason);
      byKey[key] = mk(key, probedAt, {
        reachable: false,
        authOk: false,
        verdict: "fail",
        detail: `probe error: ${reason}`,
      });
    }
  });
  // NB: questa lista e' la SORGENTE di cio' che esce dall'API. Aggiungere un
  // probe a `tasks` senza aggiungerlo qui lo fa girare e ne butta il risultato
  // (successo silenzioso: nessun errore, il modulo semplicemente non compare).
  // Ricavarla da `tasks` invece di riscriverla a mano rende impossibile lo
  // sfasamento, e mantiene l'ordine di dichiarazione.
  return tasks.map(([key]) => byKey[key]).filter(Boolean);
}

/**
 * Stato di salute dei moduli per il tenant.
 * @param opts.force bypassa la cache (re-probe live).
 * @param opts.only limita il risultato a un singolo modulo (force consigliato).
 */
export async function getModulesHealth(
  tenantCode: string,
  opts?: { force?: boolean; only?: ModuleKey },
): Promise<ModuleHealth[]> {
  const now = Date.now();
  if (!opts?.force) {
    const cached = cache.get(tenantCode);
    if (cached && cached.expiresAt > now) {
      return opts?.only ? cached.value.filter((h) => h.key === opts.only) : cached.value;
    }
  }
  const value = await compute(tenantCode);
  cache.set(tenantCode, { value, expiresAt: now + TTL_MS });
  return opts?.only ? value.filter((h) => h.key === opts.only) : value;
}
