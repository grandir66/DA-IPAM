import { appendLog, updateJob } from "./job-store";
import { spawnDockerStream, execDockerCommand } from "./docker";
import { setIntegrationConfig } from "./config";
import { execFile as _execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(_execFile);

const GRAYLOG_IMAGE    = "graylog/graylog:6.0";
const OPENSEARCH_IMAGE = "opensearchproject/opensearch:2.12.0";
const MONGODB_IMAGE    = "mongo:6.0";
const SEC_OPT          = ["--security-opt", "apparmor=unconfined"];

/** Esegue un comando dentro un container, senza lanciare eccezione. */
async function containerExec(
  name: string,
  cmd: string[],
  timeoutMs = 20_000
): Promise<{ out: string; ok: boolean }> {
  try {
    const r = await execFileAsync("docker", ["exec", name, ...cmd], {
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
    });
    return { out: (r.stdout + r.stderr).trim(), ok: true };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    return { out: (e.stdout ?? e.stderr ?? "").trim(), ok: false };
  }
}

/** Attende che MongoDB sia pronto (ping). */
async function waitForMongo(name: string, maxMs: number, log: (l: string) => void): Promise<void> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const { ok } = await containerExec(name, [
      "mongosh", "--quiet", "--eval", "db.adminCommand({ping:1})",
    ]);
    if (ok) { log("[wait] MongoDB pronto."); return; }
    log("[wait] MongoDB non ancora pronto, attesa 5s...");
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error("MongoDB non pronto dopo il timeout.");
}

/**
 * Attende che OpenSearch sia pronto controllando i log del container dal host.
 * L'immagine OpenSearch 2.12.0 (Amazon Linux 2023) non include curl/wget.
 */
async function waitForOpenSearch(name: string, maxMs: number, log: (l: string) => void): Promise<void> {
  const { execFile: _ef } = await import("child_process");
  const { promisify } = await import("util");
  const execFile = promisify(_ef);
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try {
      const r = await execFile("docker", ["logs", "--tail", "300", name], {
        timeout: 10_000,
        maxBuffer: 4 * 1024 * 1024,
      });
      const output = r.stdout + r.stderr;

      // Fail-fast: vm.max_map_count troppo basso → OpenSearch si chiude subito
      if (output.includes("max virtual memory areas vm.max_map_count")) {
        throw new Error(
          "OpenSearch non può avviarsi: vm.max_map_count troppo basso sul server. " +
          "Esegui: sysctl -w vm.max_map_count=262144  (e aggiungi in /etc/sysctl.conf per renderlo permanente)"
        );
      }

      // OpenSearch scrive "publish_address" o "bound_addresses" quando l'HTTP layer è attivo
      if (
        output.includes("publish_address") ||
        output.includes("bound_addresses") ||
        output.includes("started") && output.includes("9200")
      ) {
        log("[wait] OpenSearch pronto.");
        return;
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes("vm.max_map_count")) throw err;
      /* container non ancora avviato — continua */
    }
    log("[wait] OpenSearch non ancora pronto, attesa 10s...");
    await new Promise((r) => setTimeout(r, 10_000));
  }
  throw new Error("OpenSearch non pronto dopo il timeout.");
}

/**
 * Verifica che vm.max_map_count sia ≥ 262144 (requisito OpenSearch).
 * Se è troppo basso, prova a impostarlo con sysctl (richiede privilegi root sul server).
 * Se non riesce, lancia un'eccezione con le istruzioni.
 */
async function ensureMaxMapCount(log: (l: string) => void): Promise<void> {
  const { readFile } = await import("fs/promises");
  let current = 0;
  try {
    const raw = await readFile("/proc/sys/vm/max_map_count", "utf8");
    current = parseInt(raw.trim(), 10);
  } catch {
    // Non siamo su Linux (es. macOS/Docker Desktop): OpenSearch gestisce da solo
    log("[sysctl] Impossibile leggere /proc/sys/vm/max_map_count — skip check (non Linux).");
    return;
  }

  if (current >= 262144) {
    log(`[sysctl] vm.max_map_count=${current} — OK.`);
    return;
  }

  log(`[sysctl] vm.max_map_count=${current} troppo basso (minimo 262144). Tentativo di impostazione...`);
  try {
    await execFileAsync("sysctl", ["-w", "vm.max_map_count=262144"], { timeout: 10_000 });
    log("[sysctl] vm.max_map_count=262144 impostato.");
  } catch {
    throw new Error(
      `vm.max_map_count=${current} è troppo basso per OpenSearch. ` +
      `Esegui sul server (come root): sysctl -w vm.max_map_count=262144 ` +
      `Per renderlo permanente aggiungi "vm.max_map_count=262144" in /etc/sysctl.conf`
    );
  }
}

/** Attende che Graylog risponda su /api/system/liveness (endpoint ufficiale health check). */
async function waitForGraylog(internalUrl: string, maxMs: number, log: (l: string) => void): Promise<void> {
  const deadline = Date.now() + maxMs;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt++;
    try {
      const res = await fetch(`${internalUrl}/api/system/liveness`, {
        signal: AbortSignal.timeout(6000),
      });
      if (res.ok) {
        log(`[wait] Graylog pronto (tentativo ${attempt}).`);
        return;
      }
      log(`[wait] Tentativo ${attempt} — HTTP ${res.status}, attesa 10s...`);
    } catch {
      log(`[wait] Tentativo ${attempt} — non raggiungibile, attesa 10s...`);
    }
    await new Promise((r) => setTimeout(r, 10_000));
  }
  throw new Error(`Graylog non raggiungibile dopo ${maxMs / 1000}s`);
}

export async function installGraylog(
  jobId: string,
  containerName: string,
  adminPassword = "admin",
  serverUrl = "http://localhost:9000"
): Promise<void> {
  const log = (line: string) => appendLog(jobId, line);
  const network  = "da-graylog-net";
  const hostPort = (() => { try { return new URL(serverUrl).port || "9000"; } catch { return "9000"; } })();
  const internalUrl = `http://localhost:${hostPort}`;

  try {
    updateJob(jobId, { phase: "pulling" });
    log("[pull] Scaricamento immagini (MongoDB + OpenSearch + Graylog)...");
    await spawnDockerStream(["pull", MONGODB_IMAGE],    log, false);
    await spawnDockerStream(["pull", OPENSEARCH_IMAGE], log, false);
    await spawnDockerStream(["pull", GRAYLOG_IMAGE],    log, false);

    updateJob(jobId, { phase: "creating" });

    // ── Rete ──────────────────────────────────────────────────────────────────
    try {
      await execDockerCommand(["network", "create", network]);
      log(`[net] Rete '${network}' creata.`);
    } catch {
      log(`[net] Rete '${network}' già esistente.`);
    }

    // ── Rimuove container precedenti ──────────────────────────────────────────
    for (const c of [containerName, "da-graylog-opensearch", "da-graylog-mongo"]) {
      try { await execDockerCommand(["rm", "-f", c]); } catch { /* non esisteva */ }
    }

    // ── MongoDB ───────────────────────────────────────────────────────────────
    log("[create] Avvio MongoDB...");
    await spawnDockerStream([
      "run", "-d",
      "--name", "da-graylog-mongo",
      "--network", network,
      "--restart", "unless-stopped",
      ...SEC_OPT,
      MONGODB_IMAGE,
    ], log);

    // ── vm.max_map_count — requisito OpenSearch ───────────────────────────────
    // --sysctl vm.max_map_count non è consentito dal Docker daemon standard.
    // Leggiamo il valore dall'host e proviamo a impostarlo via sysctl se troppo basso.
    await ensureMaxMapCount(log);

    // ── OpenSearch ────────────────────────────────────────────────────────────
    log("[create] Avvio OpenSearch...");
    await spawnDockerStream([
      "run", "-d",
      "--name", "da-graylog-opensearch",
      "--network", network,
      "--restart", "unless-stopped",
      // ulimit richiesto da OpenSearch per prestazioni ottimali
      "--ulimit", "memlock=-1:-1",
      "--ulimit", "nofile=65536:65536",
      ...SEC_OPT,
      "-e", "discovery.type=single-node",
      // OpenSearch 2.12+: disabilita il plugin security e lo script di configurazione demo
      // (altrimenti richiede OPENSEARCH_INITIAL_ADMIN_PASSWORD e non si avvia)
      "-e", "DISABLE_SECURITY_PLUGIN=true",
      "-e", "DISABLE_INSTALL_DEMO_CONFIG=true",
      "-e", "OPENSEARCH_JAVA_OPTS=-Xms1g -Xmx1g",
      OPENSEARCH_IMAGE,
    ], log);

    // ── Attende MongoDB e OpenSearch ──────────────────────────────────────────
    updateJob(jobId, { phase: "waiting" });
    log("[wait] Attesa MongoDB (max 60s)...");
    await waitForMongo("da-graylog-mongo", 60_000, log);
    log("[wait] Attesa OpenSearch (max 3 min)...");
    await waitForOpenSearch("da-graylog-opensearch", 180_000, log);

    // ── Graylog ───────────────────────────────────────────────────────────────
    log("[create] Avvio Graylog...");
    const { createHash } = await import("crypto");
    const rootPasswordSha2 = createHash("sha256").update(adminPassword).digest("hex");
    // Password secret: minimo 16 char, consigliati 64+ (usato per cifratura interna)
    const passwordSecret = "dainvent-graylog-secret-pepper-2024-abcdef0123456789abcdef01234567";

    await spawnDockerStream([
      "run", "-d",
      "--name", containerName,
      "--network", network,
      "--restart", "unless-stopped",
      "-p", `${hostPort}:9000`,
      "-p", "12201:12201/udp",
      ...SEC_OPT,
      "-e", `GRAYLOG_PASSWORD_SECRET=${passwordSecret}`,
      "-e", `GRAYLOG_ROOT_PASSWORD_SHA2=${rootPasswordSha2}`,
      "-e", `GRAYLOG_HTTP_EXTERNAL_URI=${serverUrl}/`,
      "-e", "GRAYLOG_ELASTICSEARCH_HOSTS=http://da-graylog-opensearch:9200",
      "-e", "GRAYLOG_MONGODB_URI=mongodb://da-graylog-mongo:27017/graylog",
      "-e", "GRAYLOG_JAVA_OPTS=-Xms1g -Xmx1g",
      GRAYLOG_IMAGE,
    ], log);

    // ── Attende Graylog ────────────────────────────────────────────────────────
    log("[wait] Attesa Graylog pronto — primo avvio può richiedere 2-4 min...");
    await waitForGraylog(internalUrl, 300_000, log);

    // ── API Token ─────────────────────────────────────────────────────────────
    log("[token] Generazione API token...");
    const apiToken = await generateGraylogToken(internalUrl, "admin", adminPassword, log);

    setIntegrationConfig("graylog", {
      mode: "managed",
      url: serverUrl,
      username: "admin",
      password: adminPassword,
      adminPassword,
      apiToken: apiToken ?? "",
      containerName,
    });

    updateJob(jobId, { phase: "done", finishedAt: new Date().toISOString() });
    if (apiToken) {
      log(`[done] Graylog installato e configurato su ${serverUrl}`);
      log("[done] API token generato e salvato automaticamente.");
    } else {
      log(`[done] Graylog installato su ${serverUrl}`);
      log("[warn] Token automatico fallito. Crea un token in Graylog → System → Users → admin → API Tokens.");
    }
    log(`[done] Credenziali: utente=admin  password=${adminPassword}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    updateJob(jobId, { phase: "error", error: msg, finishedAt: new Date().toISOString() });
    log(`[error] ${msg}`);
  }
}

/**
 * Crea un API token in Graylog via REST API con credenziali admin (Basic Auth).
 * Endpoint ufficiale: POST /api/users/{username}/tokens/{tokenName}
 */
async function generateGraylogToken(
  baseUrl: string,
  username: string,
  password: string,
  log: (l: string) => void
): Promise<string | null> {
  const tokenName = `da-invent-${Date.now()}`;
  const url = `${baseUrl}/api/users/${encodeURIComponent(username)}/tokens/${encodeURIComponent(tokenName)}`;
  const deadline = Date.now() + 120_000; // 2 min per ottenere il token

  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": "Basic " + Buffer.from(`${username}:${password}`).toString("base64"),
          "Accept": "application/json",
          "X-Requested-By": "DA-INVENT",
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        const data = (await res.json()) as { token?: string };
        if (data.token) {
          log("[token] Token Graylog generato.");
          return data.token;
        }
      }
      log(`[token] HTTP ${res.status} — retry tra 10s...`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`[token] ${msg.substring(0, 80)} — retry tra 10s...`);
    }
    await new Promise((r) => setTimeout(r, 10_000));
  }
  return null;
}
