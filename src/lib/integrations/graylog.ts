import { appendLog, updateJob } from "./job-store";
import { dockerReale, type DockerIniettabile, type OpzioniDocker } from "./docker";
import { salvaSegretiGraylog, setIntegrationConfig } from "./config";
import type { ComponentConfig } from "./types";
import { generaSegretiGraylog, mascheraSegreti, type SegretiGraylog } from "./segreti-installazione";
import { execFile as _execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(_execFile);

const GRAYLOG_IMAGE    = "graylog/graylog:6.0";
const OPENSEARCH_IMAGE = "opensearchproject/opensearch:2.12.0";
const MONGODB_IMAGE    = "mongo:6.0";
const SEC_OPT          = ["--security-opt", "apparmor=unconfined"];

/**
 * Dipendenze dell'installazione, iniettabili per le prove (docker finto,
 * attese istantanee). I segreti arrivano al container solo per ambiente:
 * negli argomenti c'è `-e NOME`, il valore sta in `env`.
 */
export interface DipendenzeGraylog {
  docker: DockerIniettabile;
  attendi: (ms: number) => Promise<void>;
  fetch: typeof fetch;
  ora: () => number;
  registro: (jobId: string, riga: string) => void;
  aggiornaJob: typeof updateJob;
  salvaConfig: (cfg: Partial<ComponentConfig>) => void;
  salvaSegreti: (s: SegretiGraylog) => void;
  generaSegreti: () => SegretiGraylog;
  /** Controllo di vm.max_map_count sull'host (requisito di OpenSearch). */
  preparaHost: (log: (l: string) => void) => Promise<void>;
}

/** Esegue un comando dentro un container, senza lanciare eccezione. */
async function containerExec(
  d: DipendenzeGraylog,
  name: string,
  cmd: string[],
  timeoutMs = 20_000
): Promise<{ out: string; ok: boolean }> {
  try {
    const r = await d.docker.exec(["exec", name, ...cmd], { timeout: timeoutMs });
    return { out: (r.stdout + r.stderr).trim(), ok: true };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    return { out: (e.stdout ?? e.stderr ?? "").trim(), ok: false };
  }
}

/** Attende che MongoDB sia pronto (ping). */
async function waitForMongo(d: DipendenzeGraylog, name: string, maxMs: number, log: (l: string) => void): Promise<void> {
  const deadline = d.ora() + maxMs;
  while (d.ora() < deadline) {
    const { ok } = await containerExec(d, name, [
      "mongosh", "--quiet", "--eval", "db.adminCommand({ping:1})",
    ]);
    if (ok) { log("[wait] MongoDB pronto."); return; }
    log("[wait] MongoDB non ancora pronto, attesa 5s...");
    await d.attendi(5000);
  }
  throw new Error("MongoDB non pronto dopo il timeout.");
}

/**
 * Attende che OpenSearch sia pronto controllando i log del container dal host.
 * L'immagine OpenSearch 2.12.0 (Amazon Linux 2023) non include curl/wget.
 */
async function waitForOpenSearch(d: DipendenzeGraylog, name: string, maxMs: number, log: (l: string) => void): Promise<void> {
  const deadline = d.ora() + maxMs;
  while (d.ora() < deadline) {
    try {
      const r = await d.docker.exec(["logs", "--tail", "300", name], { timeout: 10_000 });
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
    await d.attendi(10_000);
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

/**
 * Attende che Graylog sia operativo provando più endpoint.
 * Graylog 6.x non espone /api/system/liveness — usiamo /api/ e la root.
 * Pronto = qualsiasi risposta non-5xx (200, 401, 302, 404 sulla root = nginx up + app up).
 */
async function waitForGraylog(d: DipendenzeGraylog, internalUrl: string, maxMs: number, log: (l: string) => void): Promise<void> {
  const deadline = d.ora() + maxMs;
  let attempt = 0;
  const endpoints = ["/api/", "/"];
  while (d.ora() < deadline) {
    attempt++;
    for (const path of endpoints) {
      try {
        const res = await d.fetch(`${internalUrl}${path}`, {
          signal: AbortSignal.timeout(6000),
          redirect: "manual",   // non seguire redirect — 302 = Graylog pronto
        });
        // Qualsiasi risposta non-5xx indica che Graylog è su e risponde
        if (res.status < 500) {
          log(`[wait] Graylog pronto (tentativo ${attempt}, ${path} → HTTP ${res.status}).`);
          return;
        }
        log(`[wait] Tentativo ${attempt} ${path} — HTTP ${res.status}, attesa 10s...`);
      } catch {
        /* non ancora raggiungibile */
      }
    }
    log(`[wait] Tentativo ${attempt} — Graylog non ancora raggiungibile, attesa 10s...`);
    await d.attendi(10_000);
  }
  throw new Error(`Graylog non raggiungibile dopo ${maxMs / 1000}s`);
}

export const dipendenzeGraylogReali: DipendenzeGraylog = {
  docker: dockerReale,
  attendi: (ms) => new Promise((r) => setTimeout(r, ms)),
  fetch: (...a) => fetch(...a),
  ora: () => Date.now(),
  registro: appendLog,
  aggiornaJob: updateJob,
  salvaConfig: (cfg) => setIntegrationConfig("graylog", cfg),
  salvaSegreti: salvaSegretiGraylog,
  generaSegreti: generaSegretiGraylog,
  preparaHost: ensureMaxMapCount,
};

export async function installGraylog(
  jobId: string,
  containerName: string,
  adminPassword: string,
  serverUrl = "http://localhost:9000",
  d: DipendenzeGraylog = dipendenzeGraylogReali,
): Promise<void> {
  const segreti = d.generaSegreti();
  let apiTokenGenerato: string | null = null;
  const { createHash } = await import("crypto");
  const rootPasswordSha2 = createHash("sha256").update(adminPassword).digest("hex");
  // Seconda difesa: nessuna riga del registro porta un segreto.
  const log = (line: string) =>
    d.registro(jobId, mascheraSegreti(line, [segreti.passwordSecret, adminPassword, rootPasswordSha2, apiTokenGenerato]));
  const run = (args: string[], env?: OpzioniDocker["env"], throwOnError = true) =>
    d.docker.stream(args, log, { env, throwOnError });
  const network  = "da-graylog-net";
  const hostPort = (() => { try { return new URL(serverUrl).port || "9000"; } catch { return "9000"; } })();
  const internalUrl = `http://localhost:${hostPort}`;

  try {
    d.aggiornaJob(jobId, { phase: "pulling" });
    log("[pull] Scaricamento immagini (MongoDB + OpenSearch + Graylog)...");
    await run(["pull", MONGODB_IMAGE],    undefined, false);
    await run(["pull", OPENSEARCH_IMAGE], undefined, false);
    await run(["pull", GRAYLOG_IMAGE],    undefined, false);

    d.aggiornaJob(jobId, { phase: "creating" });

    // ── Rete ──────────────────────────────────────────────────────────────────
    try {
      await d.docker.exec(["network", "create", network]);
      log(`[net] Rete '${network}' creata.`);
    } catch {
      log(`[net] Rete '${network}' già esistente.`);
    }

    // ── Rimuove container precedenti ──────────────────────────────────────────
    for (const c of [containerName, "da-graylog-opensearch", "da-graylog-mongo"]) {
      try { await d.docker.exec(["rm", "-f", c]); } catch { /* non esisteva */ }
    }

    // ── MongoDB ───────────────────────────────────────────────────────────────
    log("[create] Avvio MongoDB...");
    await run([
      "run", "-d",
      "--name", "da-graylog-mongo",
      "--network", network,
      "--restart", "unless-stopped",
      ...SEC_OPT,
      MONGODB_IMAGE,
    ]);

    // ── vm.max_map_count — requisito OpenSearch ───────────────────────────────
    // --sysctl vm.max_map_count non è consentito dal Docker daemon standard.
    // Leggiamo il valore dall'host e proviamo a impostarlo via sysctl se troppo basso.
    await d.preparaHost(log);

    // ── OpenSearch ────────────────────────────────────────────────────────────
    log("[create] Avvio OpenSearch...");
    await run([
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
    ]);

    // ── Attende MongoDB e OpenSearch ──────────────────────────────────────────
    d.aggiornaJob(jobId, { phase: "waiting" });
    log("[wait] Attesa MongoDB (max 60s)...");
    await waitForMongo(d, "da-graylog-mongo", 60_000, log);
    log("[wait] Attesa OpenSearch (max 3 min)...");
    await waitForOpenSearch(d, "da-graylog-opensearch", 180_000, log);

    // ── Graylog ───────────────────────────────────────────────────────────────
    // Segreto interno generato per questa installazione e salvato cifrato
    // prima di creare il container (Graylog vuole almeno 16 caratteri, 64+ consigliati).
    d.salvaSegreti(segreti);
    log("[create] Segreto interno di Graylog generato e salvato cifrato.");
    log("[create] Avvio Graylog...");

    await run([
      "run", "-d",
      "--name", containerName,
      "--network", network,
      "--restart", "unless-stopped",
      "-p", `${hostPort}:9000`,
      "-p", "12201:12201/udp",
      ...SEC_OPT,
      "-e", "GRAYLOG_PASSWORD_SECRET",
      "-e", "GRAYLOG_ROOT_PASSWORD_SHA2",
      "-e", `GRAYLOG_HTTP_EXTERNAL_URI=${serverUrl}/`,
      "-e", "GRAYLOG_ELASTICSEARCH_HOSTS=http://da-graylog-opensearch:9200",
      "-e", "GRAYLOG_MONGODB_URI=mongodb://da-graylog-mongo:27017/graylog",
      "-e", "GRAYLOG_JAVA_OPTS=-Xms1g -Xmx1g",
      GRAYLOG_IMAGE,
    ], { GRAYLOG_PASSWORD_SECRET: segreti.passwordSecret, GRAYLOG_ROOT_PASSWORD_SHA2: rootPasswordSha2 });

    // ── Attende Graylog ────────────────────────────────────────────────────────
    log("[wait] Attesa Graylog pronto — primo avvio può richiedere 2-4 min...");
    await waitForGraylog(d, internalUrl, 300_000, log);
    // Warm-up: l'HTTP server risponde prima che l'API interna (auth, users) sia pronta
    log("[wait] Warm-up 20s per completare inizializzazione API...");
    await d.attendi(20_000);

    // ── API Token ─────────────────────────────────────────────────────────────
    log("[token] Generazione API token...");
    const apiToken = await generateGraylogToken(d, internalUrl, "admin", adminPassword, log);
    apiTokenGenerato = apiToken;

    d.salvaConfig({
      mode: "managed",
      url: serverUrl,
      username: "admin",
      password: adminPassword,
      adminPassword,
      apiToken: apiToken ?? "",
      containerName,
    });

    d.aggiornaJob(jobId, { phase: "done", finishedAt: new Date().toISOString() });
    if (apiToken) {
      log(`[done] Graylog installato e configurato su ${serverUrl}`);
      log("[done] API token generato e salvato automaticamente.");
    } else {
      log(`[done] Graylog installato su ${serverUrl}`);
      log("[warn] Token automatico fallito. Crea un token in Graylog → System → Users → admin → API Tokens.");
    }
    log("[done] Utente: admin. La password è salvata cifrata: la mostra la card dell'integrazione agli admin.");
  } catch (err) {
    const msg = mascheraSegreti(err instanceof Error ? err.message : String(err), [
      segreti.passwordSecret, adminPassword, rootPasswordSha2, apiTokenGenerato,
    ]);
    d.aggiornaJob(jobId, { phase: "error", error: msg, finishedAt: new Date().toISOString() });
    log(`[error] ${msg}`);
  }
}

/**
 * Crea un API token in Graylog via REST API con credenziali admin (Basic Auth).
 * Graylog 6.x usa "local:admin" come userId per l'utente admin built-in.
 * Endpoint: POST /api/users/{userId}/tokens/{tokenName}
 */
async function generateGraylogToken(
  d: DipendenzeGraylog,
  baseUrl: string,
  username: string,
  password: string,
  log: (l: string) => void
): Promise<string | null> {
  const tokenName = `da-invent-${d.ora()}`;
  const deadline = d.ora() + 120_000;

  // Graylog 6.x usa "local:admin" come ID utente nell'endpoint token
  // Le versioni precedenti usano il semplice username (es. "admin")
  const userIds = [`local:${username}`, username];

  while (d.ora() < deadline) {
    for (const userId of userIds) {
      try {
        const url = `${baseUrl}/api/users/${encodeURIComponent(userId)}/tokens/${encodeURIComponent(tokenName)}`;
        const res = await d.fetch(url, {
          method: "POST",
          headers: {
            "Authorization": "Basic " + Buffer.from(`${username}:${password}`).toString("base64"),
            "Accept": "application/json",
            "Content-Type": "application/json",
            "X-Requested-By": "DA-INVENT",
          },
          signal: AbortSignal.timeout(10_000),
        });
        if (res.ok) {
          const data = (await res.json()) as { token?: string };
          if (data.token) {
            log(`[token] Token Graylog generato (userId=${userId}).`);
            return data.token;
          }
        }
        if (res.status !== 404) {
          log(`[token] userId=${userId} → HTTP ${res.status}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log(`[token] ${msg.substring(0, 80)}`);
      }
    }
    log("[token] Retry tra 10s...");
    await d.attendi(10_000);
  }
  return null;
}
