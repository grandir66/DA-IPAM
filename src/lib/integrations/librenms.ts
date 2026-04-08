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
 * Esegue un comando dentro un container Docker senza lanciare eccezione.
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
      maxBuffer: 2 * 1024 * 1024,
    });
    return { stdout: r.stdout, stderr: r.stderr, ok: true };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string };
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", ok: false };
  }
}

/**
 * Genera un API token per LibreNMS inserendolo direttamente nel DB MariaDB.
 *
 * Flusso:
 *  1. Attende che MariaDB abbia applicato le migrazioni (tabella users esiste)
 *  2. Crea utente admin se non esiste (con hash bcrypt)
 *  3. Genera token random e lo inserisce in api_tokens
 */
async function generateLibreNMSToken(
  containerName: string,
  log: (l: string) => void
): Promise<string | null> {
  const dbContainer = `${containerName}-db`;

  // ── Attende che le migrazioni DB siano complete ───────────────────────────
  log("[token] Attesa completamento migrazioni DB (max 3 min)...");
  const migrateDeadline = Date.now() + 180_000;
  let migrationsDone = false;
  while (Date.now() < migrateDeadline) {
    const check = await dockerExecSafe(dbContainer, [
      "mysql", "-ulibrenms", `-p${DB_PASSWORD}`, "librenms",
      "-se", "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='librenms' AND table_name='api_tokens';",
    ]);
    if (check.stdout.trim() === "1") {
      log("[token] Schema DB pronto.");
      migrationsDone = true;
      break;
    }
    log("[token] Schema non ancora pronto, attesa 10s...");
    await new Promise((r) => setTimeout(r, 10_000));
  }
  if (!migrationsDone) {
    log("[token] Timeout attesa schema DB.");
    return null;
  }

  // ── Verifica/crea utente admin ────────────────────────────────────────────
  const uidCheck = await dockerExecSafe(dbContainer, [
    "mysql", "-ulibrenms", `-p${DB_PASSWORD}`, "librenms",
    "-se", "SELECT user_id FROM users WHERE username='admin' LIMIT 1;",
  ]);
  let userId = uidCheck.stdout.trim();

  if (!userId || isNaN(Number(userId))) {
    log("[token] Utente admin non trovato, creazione...");
    try {
      // LibreNMS usa Laravel bcrypt (cost 10). Usa il modulo bcrypt già presente nell'app.
      const bcrypt = await import("bcrypt");
      const hash = await bcrypt.hash("admin", 10);

      // Legge le colonne effettive della tabella users per costruire un INSERT compatibile
      const colsRes = await dockerExecSafe(dbContainer, [
        "mysql", "-ulibrenms", `-p${DB_PASSWORD}`, "librenms",
        "-se", "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='librenms' AND TABLE_NAME='users' ORDER BY ORDINAL_POSITION;",
      ]);
      const existingCols = new Set(colsRes.stdout.trim().split("\n").map((c) => c.trim()).filter(Boolean));
      log(`[token] Colonne users: ${[...existingCols].join(", ")}`);

      // Costruisce INSERT con solo le colonne effettivamente presenti
      // "level" è stato rimosso nelle versioni moderne di LibreNMS (sostituito dal sistema roles)
      const required: Array<[string, string]> = [
        ["username", "'admin'"],
        ["password", `'${hash}'`],
        ["realname", "'Administrator'"],
        ["email",    "'admin@localhost'"],
        ["enabled",  "1"],
      ];
      const optional: Array<[string, string]> = [
        ["level",             "10"],   // versioni legacy
        ["auth_type",         "'mysql'"],
        ["auth_id",           "''"],
        ["can_modify_passwd", "1"],
        ["descr",             "'DA-INVENT auto'"],
      ];
      const colDefs: Array<[string, string]> = [...required];
      for (const [col, val] of optional) {
        if (existingCols.has(col)) colDefs.push([col, val]);
      }

      const cols   = colDefs.map(([c]) => c).join(", ");
      const values = colDefs.map(([, v]) => v).join(", ");
      const sql    = `INSERT IGNORE INTO users (${cols}) VALUES (${values});`;

      const insertUser = await dockerExecSafe(dbContainer, [
        "mysql", "-ulibrenms", `-p${DB_PASSWORD}`, "librenms", "-e", sql,
      ]);
      if (!insertUser.ok) {
        const errOut = (insertUser.stderr || insertUser.stdout).trim().substring(0, 400);
        log(`[token] INSERT utente fallito: ${errOut}`);
      }

      // Rilegge user_id
      const uid2 = await dockerExecSafe(dbContainer, [
        "mysql", "-ulibrenms", `-p${DB_PASSWORD}`, "librenms",
        "-se", "SELECT user_id FROM users WHERE username='admin' LIMIT 1;",
      ]);
      userId = uid2.stdout.trim();
      if (!userId || isNaN(Number(userId))) {
        log("[token] Impossibile creare utente admin nel DB.");
        return null;
      }
      log(`[token] Utente admin creato (user_id=${userId}, password=admin).`);

      // ── Assegna ruolo admin (sistema Laravel Spatie Permissions) ──────────
      // Nelle versioni moderne di LibreNMS il livello è gestito tramite roles/model_has_roles
      const roleAssign = await dockerExecSafe(dbContainer, [
        "mysql", "-ulibrenms", `-p${DB_PASSWORD}`, "librenms",
        "-e",
        `INSERT IGNORE INTO model_has_roles (role_id, model_type, model_id)
         SELECT r.id, 'App\\\\Models\\\\User', ${userId}
         FROM roles r WHERE r.name IN ('admin','superadmin','Administrator') LIMIT 1;`,
      ]);
      if (roleAssign.ok) {
        log("[token] Ruolo admin assegnato via model_has_roles.");
      } else {
        // Tabella non presente (versione legacy con colonna level) — non critico
        log("[token] model_has_roles non disponibile (versione legacy), level già impostato.");
      }
    } catch (err) {
      log(`[token] Errore creazione utente: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  } else {
    log(`[token] Utente admin esistente (user_id=${userId}).`);
  }

  // ── Inserisce token in api_tokens ─────────────────────────────────────────
  try {
    const crypto = await import("crypto");
    const token = crypto.randomBytes(20).toString("hex"); // 40 char hex

    const ins = await dockerExecSafe(dbContainer, [
      "mysql", "-ulibrenms", `-p${DB_PASSWORD}`, "librenms",
      "-e",
      `INSERT INTO api_tokens (user_id, token_hash, description, disabled)
       VALUES (${userId}, '${token}', 'DA-INVENT auto', 0);`,
    ]);

    if (!ins.ok) {
      log(`[token] Inserimento token: ${(ins.stderr || ins.stdout).trim().substring(0, 400)}`);
      return null;
    }

    log(`[token] Token inserito: ${token.substring(0, 8)}...`);
    return token;
  } catch (err) {
    log(`[token] Errore inserimento token: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
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
