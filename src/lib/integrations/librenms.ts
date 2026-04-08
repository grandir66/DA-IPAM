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
 * Esegue un comando arbitrario dentro il container via `docker exec`,
 * senza lanciare eccezione in caso di exit code != 0.
 * Utile per comandi che potrebbero fallire legittimamente.
 */
async function dockerExecSafe(
  containerName: string,
  cmd: string[]
): Promise<{ stdout: string; stderr: string; ok: boolean }> {
  const { execFile: _execFile } = await import("child_process");
  const { promisify } = await import("util");
  const execFile = promisify(_execFile);
  try {
    const r = await execFile("docker", ["exec", containerName, ...cmd], {
      timeout: 30_000,
      maxBuffer: 1 * 1024 * 1024,
    });
    return { stdout: r.stdout, stderr: r.stderr, ok: true };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string };
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", ok: false };
  }
}

/**
 * Estrae un token hex da una stringa di output.
 * LibreNMS stampa qualcosa come: "API Token: <token>" oppure solo "<token>"
 */
function extractToken(output: string): string | null {
  const combined = output.replace(/\s+/g, " ");
  // Cerca stringa hex di almeno 32 caratteri
  const match = combined.match(/\b([a-f0-9]{32,})\b/i);
  return match ? match[1] : null;
}

/**
 * Genera un API token per l'utente "admin" dentro il container LibreNMS.
 *
 * Strategia:
 *  1. Crea utente admin (se non esiste) via `lnms user:add`
 *  2. Genera token via `lnms user:api-token` (prova path multipli)
 *  3. Fallback: inserimento diretto nel DB MariaDB
 */
async function generateLibreNMSToken(
  containerName: string,
  log: (l: string) => void
): Promise<string | null> {
  const dbContainer = `${containerName}-db`;

  // Attende che il container sia effettivamente pronto (lnms potrebbe non rispondere subito)
  await new Promise((r) => setTimeout(r, 5_000));

  // Candidate commands for lnms (different paths used in different image versions)
  const lnmsCandidates = [
    ["/opt/librenms/lnms"],
    ["lnms"],
    ["php", "/opt/librenms/artisan"],
  ];

  // ── Step 1: crea utente admin se non esiste ──────────────────────────────
  log("[token] Verifica/creazione utente admin...");
  for (const lnms of lnmsCandidates) {
    const r = await dockerExecSafe(containerName, [
      ...lnms, "user:add", "admin", "--role=admin", "--password=admin",
    ]);
    if (r.ok || r.stdout.includes("already exists") || r.stderr.includes("already exists")) {
      log("[token] Utente admin pronto.");
      break;
    }
  }

  // ── Step 2: genera token via lnms ────────────────────────────────────────
  log("[token] Generazione token via lnms...");
  for (const lnms of lnmsCandidates) {
    const r = await dockerExecSafe(containerName, [
      ...lnms, "user:api-token", "admin",
    ]);
    const combined = r.stdout + " " + r.stderr;
    const token = extractToken(combined);
    if (token) {
      log(`[token] Token ottenuto via ${lnms.join(" ")}: ${token.substring(0, 8)}...`);
      return token;
    }
    if (r.ok || r.stdout.trim()) {
      log(`[token] Output ${lnms[0]}: ${combined.trim().substring(0, 100)}`);
    }
  }

  // ── Step 3: fallback — inserimento diretto nel DB ─────────────────────────
  log("[token] Fallback: inserimento token direttamente nel database...");
  try {
    const crypto = await import("crypto");
    const token = crypto.randomBytes(20).toString("hex"); // 40 char hex

    // Recupera user_id di admin
    const uidRes = await dockerExecSafe(dbContainer, [
      "mysql", "-ulibrenms", `-p${DB_PASSWORD}`, "librenms",
      "-se", "SELECT user_id FROM users WHERE username='admin' LIMIT 1;",
    ]);
    const userId = uidRes.stdout.trim();

    if (!userId || isNaN(Number(userId))) {
      // Crea utente admin direttamente nel DB (hash bcrypt di "admin")
      // LibreNMS usa bcrypt con cost=10; usiamo una hash precomputata
      const bcrypt = await import("bcrypt");
      const hash = await bcrypt.hash("admin", 10);
      await dockerExecSafe(dbContainer, [
        "mysql", "-ulibrenms", `-p${DB_PASSWORD}`, "librenms",
        "-e", `INSERT IGNORE INTO users (username, password, level, realname, email) VALUES ('admin', '${hash}', 10, 'Administrator', 'admin@localhost');`,
      ]);
      // Riprova userId
      const uid2 = await dockerExecSafe(dbContainer, [
        "mysql", "-ulibrenms", `-p${DB_PASSWORD}`, "librenms",
        "-se", "SELECT user_id FROM users WHERE username='admin' LIMIT 1;",
      ]);
      const uid = uid2.stdout.trim();
      if (!uid || isNaN(Number(uid))) throw new Error("utente admin non trovato nel DB");

      await dockerExecSafe(dbContainer, [
        "mysql", "-ulibrenms", `-p${DB_PASSWORD}`, "librenms",
        "-e", `INSERT INTO api_tokens (user_id, token_hash, description) VALUES (${uid}, '${token}', 'DA-INVENT auto');`,
      ]);
    } else {
      await dockerExecSafe(dbContainer, [
        "mysql", "-ulibrenms", `-p${DB_PASSWORD}`, "librenms",
        "-e", `INSERT INTO api_tokens (user_id, token_hash, description) VALUES (${userId}, '${token}', 'DA-INVENT auto');`,
      ]);
    }

    log(`[token] Token inserito nel DB: ${token.substring(0, 8)}...`);
    return token;
  } catch (err) {
    log(`[token] Fallback DB fallito: ${err instanceof Error ? err.message : String(err)}`);
  }

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
