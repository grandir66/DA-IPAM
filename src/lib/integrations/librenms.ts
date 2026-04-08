import { appendLog, updateJob } from "./job-store";
import { spawnDockerStream, execDockerCommand } from "./docker";
import { setIntegrationConfig } from "./config";

const LIBRENMS_IMAGE = "librenms/librenms:latest";
const MARIADB_IMAGE = "mariadb:10.11";
const REDIS_IMAGE = "redis:7-alpine";
const NETWORK = "da-librenms-net";
const DB_PASSWORD = "librenms_secret_pw";
const APP_KEY = "base64:TGGLpPFMtGHB2I3SFUevQCkIHkrmbXR6b+x5W7jf8jA=";

// --security-opt apparmor=unconfined bypassa problemi AppArmor su Ubuntu/Debian
const SEC_OPT = ["--security-opt", "apparmor=unconfined"];

export async function installLibreNMS(jobId: string, containerName: string): Promise<void> {
  const log = (line: string) => appendLog(jobId, line);
  const dbContainer = `${containerName}-db`;
  const redisContainer = `${containerName}-redis`;

  try {
    // ── PULL ──────────────────────────────────────────────────────────────────
    updateJob(jobId, { phase: "pulling" });
    log(`[pull] Scaricamento immagini (MariaDB, Redis, LibreNMS)...`);
    // throwOnError=false per pull: docker pull scrive progress su stderr ma esce 0
    await spawnDockerStream(["pull", MARIADB_IMAGE], log, false);
    await spawnDockerStream(["pull", REDIS_IMAGE], log, false);
    await spawnDockerStream(["pull", LIBRENMS_IMAGE], log, false);

    // ── RETE ─────────────────────────────────────────────────────────────────
    updateJob(jobId, { phase: "creating" });
    try {
      await execDockerCommand(["network", "create", NETWORK]);
      log(`[net] Rete Docker '${NETWORK}' creata.`);
    } catch {
      log(`[net] Rete '${NETWORK}' già esistente.`);
    }

    // ── CLEANUP CONTAINER PRECEDENTI ─────────────────────────────────────────
    for (const c of [containerName, dbContainer, redisContainer]) {
      try {
        await execDockerCommand(["rm", "-f", c]);
        log(`[create] Container '${c}' rimosso.`);
      } catch { /* non esisteva */ }
    }

    // ── MARIADB ───────────────────────────────────────────────────────────────
    log("[create] Avvio MariaDB...");
    await spawnDockerStream(
      [
        "run", "-d",
        "--name", dbContainer,
        "--network", NETWORK,
        "--restart", "unless-stopped",
        ...SEC_OPT,
        "-e", "MYSQL_ROOT_PASSWORD=root_secret",
        "-e", "MYSQL_DATABASE=librenms",
        "-e", "MYSQL_USER=librenms",
        "-e", `MYSQL_PASSWORD=${DB_PASSWORD}`,
        MARIADB_IMAGE,
      ],
      log
    );

    // ── REDIS ─────────────────────────────────────────────────────────────────
    log("[create] Avvio Redis...");
    await spawnDockerStream(
      [
        "run", "-d",
        "--name", redisContainer,
        "--network", NETWORK,
        "--restart", "unless-stopped",
        ...SEC_OPT,
        REDIS_IMAGE,
      ],
      log
    );

    // Piccola pausa per far avviare MariaDB prima di LibreNMS
    log("[create] Attesa avvio MariaDB (15s)...");
    await new Promise((r) => setTimeout(r, 15_000));

    // ── LIBRENMS ──────────────────────────────────────────────────────────────
    log("[create] Avvio LibreNMS...");
    await spawnDockerStream(
      [
        "run", "-d",
        "--name", containerName,
        "--network", NETWORK,
        "--restart", "unless-stopped",
        "-p", "8090:8000",
        ...SEC_OPT,
        "-e", `APP_KEY=${APP_KEY}`,
        "-e", `DB_HOST=${dbContainer}`,
        "-e", "DB_PORT=3306",
        "-e", "DB_USER=librenms",
        "-e", `DB_PASSWORD=${DB_PASSWORD}`,
        "-e", "DB_NAME=librenms",
        "-e", `REDIS_HOST=${redisContainer}`,
        "-e", "REDIS_PORT=6379",
        "-e", "BASE_URL=http://localhost:8090",
        LIBRENMS_IMAGE,
      ],
      log
    );

    // ── WAIT ─────────────────────────────────────────────────────────────────
    // LibreNMS fa migrazioni DB al primo avvio → può richiedere 3-5 minuti
    updateJob(jobId, { phase: "waiting" });
    log("[wait] Attesa avvio LibreNMS (max 5 minuti — prime migrazioni DB richiedono tempo)...");
    await waitForHttp("http://localhost:8090", 300, log);

    // ── API TOKEN AUTOMATICO ─────────────────────────────────────────────────
    log("[token] Generazione API token automatica via docker exec...");
    const apiToken = await generateLibreNMSToken(containerName, log);

    setIntegrationConfig("librenms", {
      mode: "managed",
      url: "http://localhost:8090",
      apiToken: apiToken ?? "",
      containerName,
    });

    updateJob(jobId, { phase: "done", finishedAt: new Date().toISOString() });
    if (apiToken) {
      log("[done] LibreNMS installato e configurato automaticamente su http://localhost:8090");
      log("[done] API token generato e salvato — nessuna configurazione manuale necessaria.");
    } else {
      log("[done] LibreNMS installato su http://localhost:8090");
      log("[warn] Generazione token automatica fallita. Vai in LibreNMS → Impostazioni → API Token per creare un token manualmente.");
    }
    log("[done] Credenziali default: admin / admin (cambiarle subito)");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    updateJob(jobId, { phase: "error", error: msg, finishedAt: new Date().toISOString() });
    log(`[error] ${msg}`);
  }
}

/**
 * Genera un API token per l'utente "admin" via `docker exec lnms user:api-token`.
 * Ritorna il token oppure null se il comando fallisce.
 */
async function generateLibreNMSToken(
  containerName: string,
  log: (l: string) => void
): Promise<string | null> {
  const { execDockerCommand } = await import("./docker");

  // Ritenta per max 60s nel caso il container non sia ancora del tutto pronto
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const { stdout } = await execDockerCommand([
        "exec", containerName,
        "lnms", "user:api-token", "admin",
      ]);
      // Output atteso: "API Token: <token>" oppure solo "<token>"
      const match = stdout.match(/([a-f0-9]{32,})/i);
      if (match) {
        log(`[token] Token generato con successo.`);
        return match[1];
      }
      // se l'output contiene già un token precedente
      const lines = stdout.trim().split("\n");
      const last = lines[lines.length - 1].trim();
      if (last.length > 20) {
        log(`[token] Token ottenuto: ${last.substring(0, 8)}...`);
        return last;
      }
      log(`[token] Output inatteso: ${stdout.trim().substring(0, 80)}`);
      return null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`[token] Tentativo fallito: ${msg.substring(0, 80)} — nuovo tentativo tra 10s...`);
      await new Promise((r) => setTimeout(r, 10_000));
    }
  }
  log("[token] Impossibile generare il token automaticamente.");
  return null;
}

async function waitForHttp(url: string, maxSeconds: number, log: (l: string) => void): Promise<void> {
  const deadline = Date.now() + maxSeconds * 1000;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt++;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (res.ok || (res.status >= 200 && res.status < 500)) {
        log(`[wait] Servizio raggiungibile (tentativo ${attempt})`);
        return;
      }
    } catch {
      // non ancora pronto
    }
    log(`[wait] Tentativo ${attempt}... attesa 10s`);
    await new Promise((r) => setTimeout(r, 10_000));
  }
  throw new Error(`Servizio non raggiungibile dopo ${maxSeconds}s`);
}
