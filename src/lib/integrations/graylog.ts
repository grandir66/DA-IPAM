import { appendLog, updateJob } from "./job-store";
import { spawnDockerStream, execDockerCommand } from "./docker";
import { setIntegrationConfig } from "./config";

const GRAYLOG_IMAGE = "graylog/graylog:6.0";
const OPENSEARCH_IMAGE = "opensearchproject/opensearch:2.12.0";
const MONGODB_IMAGE = "mongo:6.0";
const SEC_OPT = ["--security-opt", "apparmor=unconfined"];

export async function installGraylog(jobId: string, containerName: string): Promise<void> {
  const log = (line: string) => appendLog(jobId, line);
  const network = "da-graylog-net";

  try {
    updateJob(jobId, { phase: "pulling" });
    log(`[pull] Scaricamento immagini Graylog (OpenSearch + MongoDB + Graylog)...`);
    await spawnDockerStream(["pull", OPENSEARCH_IMAGE], log, false);
    await spawnDockerStream(["pull", MONGODB_IMAGE], log, false);
    await spawnDockerStream(["pull", GRAYLOG_IMAGE], log, false);

    updateJob(jobId, { phase: "creating" });

    // Crea rete Docker se non esiste
    try {
      await execDockerCommand(["network", "create", network]);
      log(`[net] Rete Docker '${network}' creata.`);
    } catch {
      log(`[net] Rete '${network}' già esistente.`);
    }

    // OpenSearch
    try { await execDockerCommand(["rm", "-f", "da-graylog-opensearch"]); } catch { /* ok */ }
    log("[create] Avvio OpenSearch...");
    await spawnDockerStream(
      [
        "run", "-d",
        "--name", "da-graylog-opensearch",
        "--network", network,
        "--restart", "unless-stopped",
        ...SEC_OPT,
        "-e", "discovery.type=single-node",
        "-e", "plugins.security.disabled=true",
        "-e", "action.auto_create_index=false",
        OPENSEARCH_IMAGE,
      ],
      log
    );

    // MongoDB
    try { await execDockerCommand(["rm", "-f", "da-graylog-mongo"]); } catch { /* ok */ }
    log("[create] Avvio MongoDB...");
    await spawnDockerStream(
      [
        "run", "-d",
        "--name", "da-graylog-mongo",
        "--network", network,
        "--restart", "unless-stopped",
        ...SEC_OPT,
        MONGODB_IMAGE,
      ],
      log
    );

    // Graylog
    try { await execDockerCommand(["rm", "-f", containerName]); } catch { /* ok */ }
    log("[create] Avvio Graylog...");
    const passwordSecret = "somepasswordpepper1234567890abcdef12345678";
    // SHA-256 di "admin" — usato come default, cambiare dopo il primo accesso
    const rootPasswordSha2 = "8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918";

    await spawnDockerStream(
      [
        "run", "-d",
        "--name", containerName,
        "--network", network,
        "--restart", "unless-stopped",
        "-p", "9000:9000",
        "-p", "12201:12201/udp",
        "-p", "514:514/udp",
        ...SEC_OPT,
        "-e", `GRAYLOG_PASSWORD_SECRET=${passwordSecret}`,
        "-e", `GRAYLOG_ROOT_PASSWORD_SHA2=${rootPasswordSha2}`,
        "-e", "GRAYLOG_HTTP_EXTERNAL_URI=http://localhost:9000/",
        "-e", "GRAYLOG_ELASTICSEARCH_HOSTS=http://da-graylog-opensearch:9200",
        "-e", "GRAYLOG_MONGODB_URI=mongodb://da-graylog-mongo:27017/graylog",
        GRAYLOG_IMAGE,
      ],
      log
    );

    updateJob(jobId, { phase: "waiting" });
    log("[wait] Attesa avvio Graylog (max 180s)...");
    await waitForHttp("http://localhost:9000/api/", 180, log);

    // ── API TOKEN AUTOMATICO ─────────────────────────────────────────────────
    log("[token] Generazione API token automatica...");
    const apiToken = await generateGraylogToken("http://localhost:9000", "admin", "admin", log);

    setIntegrationConfig("graylog", {
      mode: "managed",
      url: "http://localhost:9000",
      username: "admin",
      password: "admin",
      apiToken: apiToken ?? "",
      containerName,
    });

    updateJob(jobId, { phase: "done", finishedAt: new Date().toISOString() });
    if (apiToken) {
      log("[done] Graylog installato e configurato automaticamente su http://localhost:9000");
      log("[done] API token generato e salvato — nessuna configurazione manuale necessaria.");
    } else {
      log("[done] Graylog installato su http://localhost:9000");
      log("[warn] Token automatico fallito. Crea un token in Graylog → System → Users → admin → API Tokens.");
    }
    log("[done] Credenziali default: admin / admin (cambiarle subito)");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    updateJob(jobId, { phase: "error", error: msg, finishedAt: new Date().toISOString() });
    log(`[error] ${msg}`);
  }
}

/**
 * Crea un API token in Graylog via REST con credenziali admin.
 * Endpoint: POST /api/users/{username}/tokens/{tokenName}
 */
async function generateGraylogToken(
  baseUrl: string,
  username: string,
  password: string,
  log: (l: string) => void
): Promise<string | null> {
  const tokenName = `da-invent-${Date.now()}`;
  const url = `${baseUrl}/api/users/${encodeURIComponent(username)}/tokens/${encodeURIComponent(tokenName)}`;
  const deadline = Date.now() + 60_000;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": "Basic " + Buffer.from(`${username}:${password}`).toString("base64"),
          "Accept": "application/json",
          "X-Requested-By": "DA-INVENT",
        },
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const data = (await res.json()) as { token?: string };
        if (data.token) {
          log(`[token] Token Graylog generato.`);
          return data.token;
        }
      }
      log(`[token] Risposta HTTP ${res.status} — retry tra 10s...`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`[token] ${msg.substring(0, 80)} — retry tra 10s...`);
    }
    await new Promise((r) => setTimeout(r, 10_000));
  }
  return null;
}

async function waitForHttp(url: string, maxSeconds: number, log: (l: string) => void): Promise<void> {
  const deadline = Date.now() + maxSeconds * 1000;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt++;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
      if (res.ok || res.status < 500) {
        log(`[wait] Servizio raggiungibile (tentativo ${attempt})`);
        return;
      }
    } catch {
      // non ancora pronto
    }
    log(`[wait] Tentativo ${attempt}... attesa 5s`);
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error(`Servizio non raggiungibile dopo ${maxSeconds}s`);
}
