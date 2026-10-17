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
 *
 * Spento ≠ guasto (passo 4 del piano di solidità, 16/10): un modulo spento o mai
 * configurato dice `off` e non chiama niente; prima diceva `fail` e si confondeva
 * con un guasto vero. Un modulo che non ha niente da sondare (Patch Management, tutto
 * locale) dice `unverified`, non `ok` dedotto dall'interruttore.
 *
 * Accanto alla verifica dell'API c'è quella dell'«apertura per il browser»
 * (passo 4b, 16/10): `verificaAperturaModulo`, su richiesta e mai per un modulo
 * spento. Motore in `apertura-browser.ts`, URL per modulo in `apertura-bersagli.ts`.
 */
import { statfs } from "node:fs/promises";
import { execFile } from "node:child_process";
import { withTenant, getTenantDb } from "@/lib/db-tenant";
import { getIntegrationConfig } from "@/lib/integrations/config";
import { readUnifiHealth } from "@/lib/integrations/unifi-health";
import { getWazuhConfig } from "@/lib/integrations/wazuh-config";
import { createWazuhClient } from "@/lib/integrations/wazuh-api";
import { createWazuhIndexerClient } from "@/lib/integrations/wazuh-indexer-api";
import { pingEdge, EdgeClientError } from "@/lib/vuln/scanner-edge-client";
import { getFeatureStatus } from "@/lib/patch/feature";
import { getNetServicesState } from "@/lib/network-services/feature";
import { probeBridgeWithAuth } from "@/lib/network-services/client";
import { leggiServiziBridge, verdettoBridge, type SaluteServizio } from "@/lib/network-services/salute";
import { parseDbDate } from "@/lib/db-date";
import { safeDecrypt } from "@/lib/crypto";
import { classifyDiskUsage } from "@/lib/integrations/wazuh-health-thresholds";
import { getMeshCreds } from "@/lib/integrations/meshcentral/config";
import { MeshControlClient } from "@/lib/integrations/meshcentral/control-client";
import type { ModuleKey } from "./registry";
import type { VerificaApertura } from "./apertura-browser";
import { verificheAperturaDelModulo } from "./apertura-bersagli";

export type ModuleHealthStatus =
  | "ok"
  | "warning"
  | "error"
  | "stale"
  | "never"
  | "unknown";

/**
 * Verdetto di una sonda che ha misurato qualcosa. È anche il vocabolario della
 * salute nel segnale verso DA-Link (`dalink/fatti.ts`) e delle notifiche.
 */
export type ModuleVerdict = "ok" | "degraded" | "fail";

/**
 * Verdetto mostrato per un modulo: quelli misurati più due che non sono un esito
 * di sonda:
 *  - `off`: modulo spento o mai configurato. Nessuna chiamata, nessun errore;
 *  - `unverified`: modulo acceso ma senza niente da sondare («locale, non verificato»).
 */
export type ModuleHealthVerdict = ModuleVerdict | "off" | "unverified";

/** Il verdetto viene da una misura (non `off`, non `unverified`). */
export function isMeasuredVerdict(v: ModuleHealthVerdict): v is ModuleVerdict {
  return v === "ok" || v === "degraded" || v === "fail";
}

/** Azione di riparazione machine-readable (consumata da /repair + UI). */
export type ModuleRepairAction =
  | "reconfigure_wazuh"
  | "check_edge_cert"
  | "reconfigure_edge"
  | "reconfigure_librenms"
  | "reconfigure_graylog"
  | "reconfigure_net_services"
  | "reconfigure_unifi"
  | "check_unifi_cert"
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
  verdict: ModuleHealthVerdict;
  detail: string | null;
  repairAction: ModuleRepairAction;
  /** Solo Network Services: il verdetto di ciascun servizio del bridge. */
  servizi?: SaluteServizio[];
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

/**
 * verdict → status storico (per i consumer che usano ancora `status`, come la
 * dashboard). `off` e `unverified` → «never»: nessuna verifica fatta, quindi
 * fuori dal conteggio di errori e avvisi.
 */
function verdictToStatus(v: ModuleHealthVerdict): ModuleHealthStatus {
  if (v === "ok") return "ok";
  if (v === "degraded") return "warning";
  if (v === "fail") return "error";
  return "never";
}

/** Costruisce un ModuleHealth normalizzato (riempie sia i campi nuovi sia gli storici). */
function mk(
  key: ModuleKey,
  probedAt: string,
  opts: {
    reachable: boolean;
    authOk: boolean;
    verdict: ModuleHealthVerdict;
    detail: string | null;
    lastSyncAt?: string | null;
    repairAction?: ModuleRepairAction;
    servizi?: SaluteServizio[];
  },
): ModuleHealth {
  return {
    key,
    status: verdictToStatus(opts.verdict),
    message: opts.detail,
    lastSync: opts.lastSyncAt ?? null,
    probedAt,
    reachable: opts.reachable,
    authOk: opts.authOk,
    lastSyncAt: opts.lastSyncAt ?? null,
    verdict: opts.verdict,
    detail: opts.detail,
    repairAction: opts.repairAction ?? null,
    ...(opts.servizi ? { servizi: opts.servizi } : {}),
  };
}

/** Un modulo spento: nessuna sonda partita, nessun errore. */
function spento(key: ModuleKey, probedAt: string, detail: string, lastSyncAt: string | null = null): ModuleHealth {
  return mk(key, probedAt, { reachable: false, authOk: false, verdict: "off", detail, lastSyncAt });
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

  // Spento dall'interruttore del modulo: non si chiama il server, anche se i
  // parametri di collegamento sono rimasti (prima la sonda girava lo stesso).
  const feature = await getFeatureStatus(tenantCode, "meshcentral");
  if (!feature.enabled) return spento("meshcentral", probedAt, "Spento", lastSyncAt);
  if (!creds) {
    return mk("meshcentral", probedAt, {
      reachable: false,
      authOk: false,
      verdict: "fail",
      detail: "MeshCentral acceso ma non configurato (URL, MeshID o credenziali mancanti)",
      lastSyncAt,
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

  if (!row) return Promise.resolve(spento("edge", probedAt, "Scanner-Edge non configurato"));
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
  if (!cfg.enabled) return spento("wazuh", probedAt, "Wazuh non configurato");
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
  if (cfg.mode === "disabled") return spento(key, probedAt, "Non configurato");
  if (!cfg.url) {
    return mk(key, probedAt, {
      reachable: false, authOk: false, verdict: "fail", detail: "Acceso ma senza URL", repairAction: repair,
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
  if (!net.enabled) return spento("network_services", probedAt, "Non installato");
  if (!net.configured) {
    return mk("network_services", probedAt, {
      reachable: false, authOk: false, verdict: "fail",
      detail: "Config mancante", repairAction: "reconfigure_net_services",
    });
  }
  const probe = await withTimeout<Awaited<ReturnType<typeof probeBridgeWithAuth>>>(
    probeBridgeWithAuth(net.apiUrl, net.apiToken),
    PROBE_TIMEOUT_MS,
    { ok: false, error: "Timeout probe bridge" },
  );
  return composeNetServicesHealth(probedAt, net.source, probe);
}

/**
 * Verdetto di Network Services dalla risposta del bridge: il contenuto di
 * `/api/v1/status` dà un verdetto per servizio (Unbound, AdGuard, PowerDNS, Kea),
 * non basta più il codice HTTP. Con la configurazione dalle variabili d'ambiente
 * il dettaglio lo dice: la disinstallazione da DA-IPAM non spegne il modulo (MOD-19).
 */
export function composeNetServicesHealth(
  probedAt: string,
  source: "database" | "env" | null,
  probe: { ok: true; corpo: unknown } | { ok: false; error: string },
): ModuleHealth {
  const daEnv = source === "env" ? " (configurazione dalle variabili d'ambiente)" : "";
  if (!probe.ok) {
    return mk("network_services", probedAt, {
      reachable: false,
      authOk: false,
      verdict: "fail",
      detail: `${probe.error}${daEnv}`,
      repairAction: "reconfigure_net_services",
    });
  }
  const servizi = leggiServiziBridge(probe.corpo);
  const { verdict, detail } = verdettoBridge(servizi);
  return mk("network_services", probedAt, {
    reachable: true,
    authOk: true,
    verdict,
    detail: `${detail}${daEnv}`,
    ...(servizi ? { servizi } : {}),
  });
}

// ── Probe: controller di rete (UniFi) ────────────────────────────────────────
/**
 * Non contatta i controller (ADR 0007): legge l'esito dell'ultima lettura di
 * ciascuno, dettagli in `readUnifiHealth`. Nessun controller acceso =
 * «Non configurato» (`off`), non un errore.
 */
async function probeUnifi(probedAt: string): Promise<ModuleHealth> {
  const r = readUnifiHealth();
  return mk("unifi", probedAt, {
    reachable: r.reachable,
    authOk: r.authOk,
    verdict: r.verdict,
    detail: r.detail,
    repairAction: r.repair,
    lastSyncAt: r.lastSyncAt,
  });
}

// ── Probe: patch_management (modulo locale) ──────────────────────────────────
/**
 * Patch Management non ha un servizio da interrogare: acceso non vuol dire che
 * funzioni. Prima diceva `ok` dall'interruttore; ora dice che non è verificato.
 */
export function composePatchHealth(probedAt: string, enabled: boolean): ModuleHealth {
  if (!enabled) return spento("patch_management", probedAt, "Non installato");
  return mk("patch_management", probedAt, {
    reachable: true,
    authOk: true,
    verdict: "unverified",
    detail: "Modulo locale: nessun servizio esterno da interrogare",
  });
}

async function probePatch(tenantCode: string, probedAt: string): Promise<ModuleHealth> {
  const st = await getFeatureStatus(tenantCode, "patch_management");
  return composePatchHealth(probedAt, st.enabled);
}

// ── Probe: inventory_agent (inventari spinti dagli agenti) ───────────────────
/**
 * Gli agenti mandano l'inventario ogni 6 ore di base (da 1 a 168 ore,
 * `normalizePushIntervalHours`): la salute è l'età dell'ultimo inventario
 * ricevuto, non l'interruttore. Fino a 48 ore è fresco (copre un fine
 * settimana a PC spenti); oltre 8 giorni, più dell'intervallo massimo, nessun
 * agente sta più mandando niente.
 */
export const INVENTARIO_FRESCO_ORE = 48;
export const INVENTARIO_FERMO_ORE = 8 * 24;

export function composeInventoryAgentHealth(
  probedAt: string,
  lettura: { enabled: boolean; ultimoInventario: string | null; endpoint: number; nowMs: number },
): ModuleHealth {
  if (!lettura.enabled) return spento("inventory_agent", probedAt, "Non installato");
  const base = { reachable: true, authOk: true, lastSyncAt: lettura.ultimoInventario };
  if (!lettura.ultimoInventario) {
    return mk("inventory_agent", probedAt, {
      ...base,
      verdict: "degraded",
      detail: "Nessun inventario ricevuto finora: installa l'agente su almeno un computer",
    });
  }
  const ms = parseDbDate(lettura.ultimoInventario).getTime();
  if (Number.isNaN(ms)) {
    return mk("inventory_agent", probedAt, {
      ...base,
      verdict: "degraded",
      detail: `Data dell'ultimo inventario non leggibile: ${lettura.ultimoInventario}`,
    });
  }
  const ore = Math.max(0, Math.floor((lettura.nowMs - ms) / 3_600_000));
  const eta = ore < 1 ? "meno di un'ora fa" : ore < 48 ? `${ore} ore fa` : `${Math.floor(ore / 24)} giorni fa`;
  const detail = `Ultimo inventario ${eta} (${lettura.endpoint} computer)`;
  const verdict: ModuleVerdict =
    ore <= INVENTARIO_FRESCO_ORE ? "ok" : ore <= INVENTARIO_FERMO_ORE ? "degraded" : "fail";
  return mk("inventory_agent", probedAt, { ...base, verdict, detail });
}

async function probeInventoryAgent(tenantCode: string, probedAt: string): Promise<ModuleHealth> {
  const st = await getFeatureStatus(tenantCode, "inventory_agent");
  if (!st.enabled) {
    return composeInventoryAgentHealth(probedAt, { enabled: false, ultimoInventario: null, endpoint: 0, nowMs: Date.now() });
  }
  const db = getTenantDb(tenantCode);
  // Le tabelle nascono al primo inventario ricevuto (`migrateInventoryAgentSchema`).
  const tabella = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'inv_agent_endpoint'")
    .get();
  const riga = tabella
    ? (db
        .prepare("SELECT MAX(last_seen_at) AS ultimo, COUNT(*) AS n FROM inv_agent_endpoint")
        .get() as { ultimo: string | null; n: number })
    : { ultimo: null, n: 0 };
  return composeInventoryAgentHealth(probedAt, {
    enabled: true,
    ultimoInventario: riga.ultimo,
    endpoint: riga.n,
    nowMs: Date.now(),
  });
}

// ── Probe: sistema appliance (disco + Docker) ────────────────────────────────
/**
 * Salute della macchina che ospita DA-IPAM. Il disco pieno è la morte
 * silenziosa delle appliance: cliente A 2026-07-28 e PX-NAS 2026-07-30 si sono
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

/**
 * I moduli con una sonda, nell'ordine in cui escono da `getModulesHealth`.
 * La rotta /api/modules/health accetta solo questi; la prova
 * `modules/__tests__/unifi-module.test.ts` controlla che `compute` li produca
 * tutti e soli.
 */
export const PROBED_MODULE_KEYS: readonly ModuleKey[] = [
  "edge",
  "wazuh",
  "librenms",
  "graylog",
  "network_services",
  "patch_management",
  "inventory_agent",
  "meshcentral",
  "unifi",
  "appliance",
];

async function compute(tenantCode: string, only?: ModuleKey): Promise<ModuleHealth[]> {
  const probedAt = new Date().toISOString();
  // I probe per-modulo sono indipendenti → in parallelo (ognuno bounded).
  // allSettled (NON all): se un probe RIGETTA (es. lettura DB fuori try su
  // disk-full / integrity-check failed) NON deve abbattere l'intera health API
  // né la home dashboard SSR che la consuma. Il probe fallito → verdict "fail".
  const all: Array<[ModuleKey, () => Promise<ModuleHealth>]> = [
    ["edge", () => withTenant(tenantCode, () => probeEdge(tenantCode, probedAt))],
    ["wazuh", () => probeWazuh(probedAt)],
    ["librenms", () => probeHttpIntegration("librenms", probedAt)],
    ["graylog", () => probeHttpIntegration("graylog", probedAt)],
    ["network_services", () => probeNetServices(tenantCode, probedAt)],
    ["patch_management", () => probePatch(tenantCode, probedAt)],
    ["inventory_agent", () => withTenant(tenantCode, () => probeInventoryAgent(tenantCode, probedAt))],
    ["meshcentral", () => withTenant(tenantCode, () => probeMeshcentral(tenantCode, probedAt))],
    ["unifi", () => withTenant(tenantCode, () => probeUnifi(probedAt))],
    ["appliance", () => probeAppliance(probedAt)],
  ];
  // `only`: parte SOLO la sonda chiesta. La notifica disco dell'appliance
  // (`only: "appliance"` ogni 30 minuti) non deve diventare una raffica di
  // sonde di rete sugli altri moduli.
  const tasks: Array<[ModuleKey, Promise<ModuleHealth>]> = all
    .filter(([key]) => !only || key === only)
    .map(([key, run]) => [key, run()]);
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
 * @param opts.only esegue la sonda di un solo modulo (force consigliato); la
 *   voce si aggiorna anche nella cache completa, se c'è, senza allungarla.
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
  // Con `only` parte solo quella sonda (vedi `compute`): la notifica disco
  // dell'appliance forza `only: "appliance"` ogni 30 minuti e non deve
  // diventare una raffica di sonde sugli altri moduli.
  const value = await compute(tenantCode, opts?.only);
  if (!opts?.only) {
    cache.set(tenantCode, { value, expiresAt: now + TTL_MS });
    return value;
  }
  const cached = cache.get(tenantCode);
  if (cached && cached.expiresAt > now) {
    const fresh = new Map(value.map((h) => [h.key, h]));
    cache.set(tenantCode, { value: cached.value.map((h) => fresh.get(h.key) ?? h), expiresAt: cached.expiresAt });
  }
  return value;
}

// ── Apertura per il browser (passo 4b) ───────────────────────────────────────

export interface AperturaModulo {
  key: ModuleKey;
  /**
   * - `spento`: modulo spento o mai configurato, nessuna chiamata;
   * - `senza_interfaccia`: il modulo non ha un'interfaccia da aprire (pagine native);
   * - `verificato`: `verifiche` contiene l'esito per ogni interfaccia.
   */
  stato: "spento" | "senza_interfaccia" | "verificato";
  /** Verdetto dell'API nello stesso momento (la riga «API» accanto a questa). */
  verdettoApi: ModuleHealthVerdict;
  dettaglioApi: string | null;
  verifiche: VerificaApertura[];
  verificatoIl: string;
}

/**
 * Prova l'apertura delle interfacce di un modulo come farebbe il browser aperto
 * su `origineDaIpam`. Un modulo spento resta intoccato: nessuna chiamata verso
 * di lui (il verdetto `off` della sua sonda non ne fa).
 */
export async function verificaAperturaModulo(
  tenantCode: string,
  key: ModuleKey,
  origineDaIpam: string | null,
): Promise<AperturaModulo> {
  const verificatoIl = new Date().toISOString();
  const [salute] = await getModulesHealth(tenantCode, { only: key });
  const verdettoApi: ModuleHealthVerdict = salute?.verdict ?? "off";
  const base = { key, verdettoApi, dettaglioApi: salute?.detail ?? null, verificatoIl };
  if (!salute || verdettoApi === "off") return { ...base, stato: "spento", verifiche: [] };
  const verifiche = await withTenant(tenantCode, () => verificheAperturaDelModulo(key, tenantCode, origineDaIpam));
  return { ...base, stato: verifiche.length ? "verificato" : "senza_interfaccia", verifiche };
}
