import { appendLog, updateJob } from "./job-store";
import { dockerReale, type DockerIniettabile, type OpzioniDocker } from "./docker";
import { leggiSegretiLibreNMS, salvaSegretiLibreNMS, setIntegrationConfig } from "./config";
import type { ComponentConfig } from "./types";
import {
  generaSegretiLibreNMS,
  mascheraSegreti,
  type SegretiLibreNMS,
} from "./segreti-installazione";

const LIBRENMS_IMAGE = "librenms/librenms:latest";
const MARIADB_IMAGE = "mariadb:10.11";
const REDIS_IMAGE = "redis:7-alpine";
const NETWORK = "da-librenms-net";

// --security-opt apparmor=unconfined bypassa problemi AppArmor su Ubuntu/Debian
const SEC_OPT = ["--security-opt", "apparmor=unconfined"];

/**
 * Dipendenze dell'installazione, iniettabili per le prove (docker finto,
 * attese istantanee). I segreti arrivano ai container solo per ambiente:
 * negli argomenti c'è `-e NOME`, il valore sta in `env` (vedi OpzioniDocker).
 */
export interface DipendenzeLibreNMS {
  docker: DockerIniettabile;
  attendi: (ms: number) => Promise<void>;
  fetch: typeof fetch;
  ora: () => number;
  registro: (jobId: string, riga: string) => void;
  aggiornaJob: typeof updateJob;
  salvaConfig: (cfg: Partial<ComponentConfig>) => void;
  salvaSegreti: (s: SegretiLibreNMS) => void;
  leggiSegreti: () => SegretiLibreNMS | null;
  generaSegreti: () => SegretiLibreNMS;
}

export const dipendenzeLibreNMSReali: DipendenzeLibreNMS = {
  docker: dockerReale,
  attendi: (ms) => new Promise((r) => setTimeout(r, ms)),
  fetch: (...a) => fetch(...a),
  ora: () => Date.now(),
  registro: appendLog,
  aggiornaJob: updateJob,
  salvaConfig: (cfg) => setIntegrationConfig("librenms", cfg),
  salvaSegreti: salvaSegretiLibreNMS,
  leggiSegreti: leggiSegretiLibreNMS,
  generaSegreti: generaSegretiLibreNMS,
};

/** `docker exec` che non lancia: l'esito sta in `ok`. */
async function dockerExecSafe(
  d: DipendenzeLibreNMS,
  containerName: string,
  cmd: string[],
  { asUser, timeout = 30_000, env, input }: { asUser?: string; timeout?: number; env?: Record<string, string>; input?: string } = {}
): Promise<{ stdout: string; stderr: string; ok: boolean }> {
  const userArgs = asUser ? ["--user", asUser] : [];
  const envArgs = Object.keys(env ?? {}).flatMap((k) => ["-e", k]);
  const stdinArgs = input !== undefined ? ["-i"] : [];
  try {
    const r = await d.docker.exec(
      ["exec", ...stdinArgs, ...userArgs, ...envArgs, containerName, ...cmd],
      { timeout, env, input },
    );
    return { stdout: r.stdout, stderr: r.stderr, ok: true };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string };
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", ok: false };
  }
}

/**
 * Esegue una query sul database MariaDB di LibreNMS. La password passa per
 * `MYSQL_PWD` nell'ambiente, mai come `-p` fra gli argomenti (che si leggono
 * nella lista dei processi e nei messaggi d'errore).
 */
async function sqlLibreNMS(
  d: DipendenzeLibreNMS,
  containerName: string,
  dbPassword: string,
  flag: "-se" | "-e",
  sql: string,
): Promise<{ stdout: string; stderr: string; ok: boolean }> {
  return dockerExecSafe(d, `${containerName}-db`, ["mysql", "-ulibrenms", "librenms", flag, sql], {
    env: { MYSQL_PWD: dbPassword },
  });
}

/** Come sqlLibreNMS, ma l'SQL passa sullo standard input: serve quando porta un segreto (il token). */
async function sqlLibreNMSDaStdin(
  d: DipendenzeLibreNMS,
  containerName: string,
  dbPassword: string,
  sql: string,
): Promise<{ stdout: string; stderr: string; ok: boolean }> {
  return dockerExecSafe(d, `${containerName}-db`, ["mysql", "-ulibrenms", "librenms"], {
    env: { MYSQL_PWD: dbPassword },
    input: sql,
  });
}

/**
 * Comando di manutenzione sul database di un'installazione esistente: legge
 * la password salvata cifrata (scritta dall'installazione o, per le
 * installazioni precedenti, dalla migrazione all'avvio). Senza password
 * salvata non indovina un valore: risponde con un errore esplicito.
 */
export async function eseguiSqlLibreNMS(
  containerName: string,
  sql: string,
  d: DipendenzeLibreNMS = dipendenzeLibreNMSReali,
): Promise<{ ok: true; stdout: string } | { ok: false; errore: string }> {
  const segreti = d.leggiSegreti();
  if (!segreti) {
    return { ok: false, errore: "Password del database di LibreNMS non salvata: installazione da migrare o da reinstallare" };
  }
  const r = await sqlLibreNMS(d, containerName, segreti.dbPassword, "-se", sql);
  if (!r.ok) {
    return { ok: false, errore: mascheraSegreti((r.stderr || r.stdout).trim(), [segreti.dbPassword]).slice(0, 400) };
  }
  return { ok: true, stdout: r.stdout };
}

export async function installLibreNMS(
  jobId: string,
  containerName: string,
  adminPassword: string,
  serverUrl = "http://localhost:8090",
  d: DipendenzeLibreNMS = dipendenzeLibreNMSReali,
): Promise<void> {
  const segreti = d.generaSegreti();
  let apiTokenGenerato: string | null = null;
  // Seconda difesa: nessuna riga del registro porta un segreto, anche se
  // arrivasse dall'output di un comando.
  const log = (line: string) =>
    d.registro(jobId, mascheraSegreti(line, [
      segreti.dbPassword, segreti.dbRootPassword, segreti.appKey, adminPassword, apiTokenGenerato,
    ]));
  const run = (args: string[], env?: OpzioniDocker["env"], throwOnError = true) =>
    d.docker.stream(args, log, { env, throwOnError });
  const dbContainer = `${containerName}-db`;
  const redisContainer = `${containerName}-redis`;
  // Sidecar dispatcher: container separato che esegue il polling.
  // L'immagine librenms/librenms in modalità SIDECAR_DISPATCHER=1 skippa il web
  // setup e lancia librenms-service.py — è il modo ufficiale (vedi
  // /etc/cont-init.d/05-svc-dispatcher.sh nell'image). Senza questo container
  // i grafici restano vuoti perché nessuno popola gli RRD in /data/rrd.
  const dispatcherContainer = `${containerName}-dispatcher`;
  // Porta host ricavata dall'URL (es. http://192.168.1.10:8090 → 8090)
  const hostPort = (() => { try { return new URL(serverUrl).port || "8090"; } catch { return "8090"; } })();

  try {
    // ── PULL ──────────────────────────────────────────────────────────────────
    d.aggiornaJob(jobId, { phase: "pulling" });
    log(`[pull] Scaricamento immagini (MariaDB, Redis, LibreNMS)...`);
    // throwOnError=false per pull: docker pull scrive progress su stderr ma esce 0
    await run(["pull", MARIADB_IMAGE], undefined, false);
    await run(["pull", REDIS_IMAGE], undefined, false);
    await run(["pull", LIBRENMS_IMAGE], undefined, false);

    // ── RETE ─────────────────────────────────────────────────────────────────
    d.aggiornaJob(jobId, { phase: "creating" });
    try {
      await d.docker.exec(["network", "create", NETWORK]);
      log(`[net] Rete Docker '${NETWORK}' creata.`);
    } catch {
      log(`[net] Rete '${NETWORK}' già esistente.`);
    }

    // ── CLEANUP CONTAINER PRECEDENTI ─────────────────────────────────────────
    for (const c of [containerName, dbContainer, redisContainer, dispatcherContainer]) {
      try {
        await d.docker.exec(["rm", "-f", c]);
        log(`[create] Container '${c}' rimosso.`);
      } catch { /* non esisteva */ }
    }

    // Segreti nuovi salvati cifrati PRIMA di creare i container: se
    // l'installazione si ferma a metà, i container che esistono hanno i
    // segreti che l'hub conosce.
    d.salvaSegreti(segreti);
    log("[create] Segreti dell'installazione generati e salvati cifrati.");
    const envDb = { DB_PASSWORD: segreti.dbPassword };

    // ── MARIADB ───────────────────────────────────────────────────────────────
    log("[create] Avvio MariaDB...");
    await run(
      [
        "run", "-d",
        "--name", dbContainer,
        "--network", NETWORK,
        "--restart", "unless-stopped",
        ...SEC_OPT,
        "-e", "MYSQL_ROOT_PASSWORD",
        "-e", "MYSQL_DATABASE=librenms",
        "-e", "MYSQL_USER=librenms",
        "-e", "MYSQL_PASSWORD",
        MARIADB_IMAGE,
      ],
      { MYSQL_ROOT_PASSWORD: segreti.dbRootPassword, MYSQL_PASSWORD: segreti.dbPassword },
    );

    // ── REDIS ─────────────────────────────────────────────────────────────────
    log("[create] Avvio Redis...");
    await run(
      [
        "run", "-d",
        "--name", redisContainer,
        "--network", NETWORK,
        "--restart", "unless-stopped",
        ...SEC_OPT,
        REDIS_IMAGE,
      ],
    );

    // Piccola pausa per far avviare MariaDB prima di LibreNMS
    log("[create] Attesa avvio MariaDB (15s)...");
    await d.attendi(15_000);

    // ── LIBRENMS ──────────────────────────────────────────────────────────────
    log("[create] Avvio LibreNMS...");
    await run(
      [
        "run", "-d",
        "--name", containerName,
        "--network", NETWORK,
        "--restart", "unless-stopped",
        "-p", `${hostPort}:8000`,
        ...SEC_OPT,
        "-e", "APP_KEY",
        "-e", `DB_HOST=${dbContainer}`,
        "-e", "DB_PORT=3306",
        "-e", "DB_USER=librenms",
        "-e", "DB_PASSWORD",
        "-e", "DB_NAME=librenms",
        "-e", `REDIS_HOST=${redisContainer}`,
        "-e", "REDIS_PORT=6379",
        "-e", `BASE_URL=${serverUrl}`,
        LIBRENMS_IMAGE,
      ],
      { ...envDb, APP_KEY: segreti.appKey },
    );

    // ── WAIT ─────────────────────────────────────────────────────────────────
    // LibreNMS fa migrazioni DB al primo avvio → può richiedere 3-5 minuti.
    // waitForHttp si ferma appena nginx risponde (può essere ancora in setup),
    // per questo usiamo waitForLibreNMSReady che verifica l'API reale.
    d.aggiornaJob(jobId, { phase: "waiting" });
    log("[wait] Attesa avvio LibreNMS — prime migrazioni DB richiedono 3-5 minuti...");
    // Il check interno usa sempre localhost (dal server stesso)
    const internalUrl = `http://localhost:${hostPort}`;
    await waitForLibreNMSReady(d, internalUrl, 360, log);
    // Extra attesa: l'API risponde prima che il web layer (sessioni/cache) sia pronto
    log("[wait] Warm-up aggiuntivo 30s per sessioni e cache...");
    await d.attendi(30_000);

    // ── FIX APP_URL ─────────────────────────────────────────────────────────
    // La default `.env` dell'image LibreNMS imposta APP_URL=/, che fa generare
    // redirect rotti dopo login (404 al return). Sovrascriviamo via /data/.env
    // (Laravel legge il valore più recente, e l'init script appende /data/.env
    // a /opt/librenms/.env, quindi vince il nostro valore). Niente bisogno di
    // restart: artisan config:clear basta.
    log(`[config] Set APP_URL=${serverUrl} in /data/.env...`);
    try {
      await d.docker.exec([
        "exec", containerName, "sh", "-c",
        `grep -q '^APP_URL=' /data/.env 2>/dev/null && sed -i 's|^APP_URL=.*|APP_URL=${serverUrl}|' /data/.env || echo 'APP_URL=${serverUrl}' >> /data/.env`,
      ]);
      await d.docker.exec(["exec", containerName, "sh", "-c", `grep -q '^APP_URL=' /opt/librenms/.env && sed -i 's|^APP_URL=.*|APP_URL=${serverUrl}|' /opt/librenms/.env || echo 'APP_URL=${serverUrl}' >> /opt/librenms/.env`]);
      await d.docker.exec(["exec", "--user", "librenms", containerName, "/opt/librenms/artisan", "config:clear"]);
      log("[config] APP_URL configurato, cache pulita.");
    } catch (e) {
      log(`[warn] Fix APP_URL fallito (non blocca): ${e instanceof Error ? e.message : String(e)}`);
    }

    // ── DISPATCHER (SIDECAR) ─────────────────────────────────────────────────
    // Lanciato DOPO che il web ha completato le migrazioni e creato /data/.env:
    // l'init script /etc/cont-init.d/05-svc-dispatcher.sh richiede che
    // /data/.env esista già (lo legge per recuperare APP_KEY e NODE_ID).
    // Condivide volume /data con il web, stessa network, stessi DB/REDIS env.
    log("[create] Avvio LibreNMS dispatcher (sidecar — polling, alerts, discovery)...");
    await run(
      [
        "run", "-d",
        "--name", dispatcherContainer,
        "--network", NETWORK,
        "--restart", "unless-stopped",
        // Volume condiviso col web: stesso /data, contiene rrd, plugins, .env
        "--volumes-from", containerName,
        ...SEC_OPT,
        "-e", `DB_HOST=${dbContainer}`,
        "-e", "DB_PORT=3306",
        "-e", "DB_USER=librenms",
        "-e", "DB_PASSWORD",
        "-e", "DB_NAME=librenms",
        "-e", `REDIS_HOST=${redisContainer}`,
        "-e", "REDIS_PORT=6379",
        "-e", "SIDECAR_DISPATCHER=1",
        "-e", "DISPATCHER_NODE_ID=dispatcher1",
        LIBRENMS_IMAGE,
      ],
      envDb,
    );
    log("[create] Dispatcher avviato — entro 5 min i primi RRD saranno popolati.");

    // ── API TOKEN AUTOMATICO ─────────────────────────────────────────────────
    log("[token] Generazione API token automatica via docker exec...");
    const apiToken = await generateLibreNMSToken(d, containerName, segreti.dbPassword, log, adminPassword, (t) => {
      apiTokenGenerato = t;
    });

    d.salvaConfig({
      mode: "managed",
      url: serverUrl,
      apiToken: apiToken ?? "",
      adminPassword,
      containerName,
    });

    d.aggiornaJob(jobId, { phase: "done", finishedAt: new Date().toISOString() });
    if (apiToken) {
      log(`[done] LibreNMS installato e configurato automaticamente su ${serverUrl}`);
      log("[done] API token generato e salvato — nessuna configurazione manuale necessaria.");
    } else {
      log(`[done] LibreNMS installato su ${serverUrl}`);
      log("[warn] Generazione token automatica fallita. Vai in LibreNMS → Impostazioni → API Token per creare un token manualmente.");
    }
    log("[done] Utente: admin. La password è salvata cifrata: la mostra la card dell'integrazione agli admin.");
  } catch (err) {
    const msg = mascheraSegreti(err instanceof Error ? err.message : String(err), [
      segreti.dbPassword, segreti.dbRootPassword, segreti.appKey, adminPassword, apiTokenGenerato,
    ]);
    d.aggiornaJob(jobId, { phase: "error", error: msg, finishedAt: new Date().toISOString() });
    log(`[error] ${msg}`);
  }
}

/**
 * Genera un API token per LibreNMS inserendolo direttamente nel DB MariaDB.
 *
 * Flusso:
 *  1. Attende che MariaDB abbia applicato le migrazioni (tabella users esiste)
 *  2. Crea utente admin se non esiste
 *  3. Genera token random e lo inserisce in api_tokens
 *
 * La password admin passa per la variabile `DA_LNMS_ADMIN_PW` e la espande la
 * shell del container: non sta fra gli argomenti di `docker exec`.
 */
async function generateLibreNMSToken(
  d: DipendenzeLibreNMS,
  containerName: string,
  dbPassword: string,
  log: (l: string) => void,
  adminPassword: string,
  annunciaToken: (token: string) => void,
): Promise<string | null> {
  const sql = (q: string) => sqlLibreNMS(d, containerName, dbPassword, "-se", q);
  const envAdmin = { DA_LNMS_ADMIN_PW: adminPassword };

  // ── Attende che le migrazioni DB siano complete ───────────────────────────
  log("[token] Attesa completamento migrazioni DB (max 3 min)...");
  const migrateDeadline = d.ora() + 180_000;
  let migrationsDone = false;
  while (d.ora() < migrateDeadline) {
    const check = await sql(
      "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='librenms' AND table_name='api_tokens';",
    );
    if (check.stdout.trim() === "1") {
      log("[token] Schema DB pronto.");
      migrationsDone = true;
      break;
    }
    log("[token] Schema non ancora pronto, attesa 10s...");
    await d.attendi(10_000);
  }
  if (!migrationsDone) {
    log("[token] Timeout attesa schema DB.");
    return null;
  }

  // ── Crea utente admin via lnms user:add (metodo ufficiale LibreNMS) ─────
  log("[token] Creazione utente admin via lnms user:add...");
  const addUser = await dockerExecSafe(
    d,
    containerName,
    ["sh", "-c", 'exec lnms user:add --no-interaction -p "$DA_LNMS_ADMIN_PW" -r admin admin'],
    { asUser: "librenms", timeout: 60_000, env: envAdmin }
  );
  const addOut = (addUser.stdout + addUser.stderr).trim();
  if (addOut) log(`[token] lnms user:add: ${addOut.substring(0, 200)}`);

  // Legge user_id dal DB
  const uidCheck = await sql("SELECT user_id FROM users WHERE username='admin' LIMIT 1;");
  let userId = uidCheck.stdout.trim();

  if (!userId || isNaN(Number(userId))) {
    log("[token] Utente non trovato dopo lnms user:add, tentativo diretto via adduser.php...");
    // Fallback: adduser.php (metodo legacy, disponibile nelle versioni precedenti)
    const addLegacy = await dockerExecSafe(
      d,
      containerName,
      ["sh", "-c", 'exec php /opt/librenms/adduser.php admin "$DA_LNMS_ADMIN_PW" 10 admin@localhost'],
      { asUser: "librenms", timeout: 30_000, env: envAdmin }
    );
    const legOut = (addLegacy.stdout + addLegacy.stderr).trim();
    if (legOut) log(`[token] adduser.php: ${legOut.substring(0, 200)}`);

    // Rilegge
    const uid2 = await sql("SELECT user_id FROM users WHERE username='admin' LIMIT 1;");
    userId = uid2.stdout.trim();
  }

  if (!userId || isNaN(Number(userId))) {
    log("[token] Impossibile creare utente admin.");
    return null;
  }
  log(`[token] Utente admin pronto (user_id=${userId}).`);

  // ── Inserisce token in api_tokens ─────────────────────────────────────────
  try {
    const crypto = await import("crypto");
    const token = crypto.randomBytes(20).toString("hex"); // 40 char hex
    annunciaToken(token);

    // Il token sta nell'SQL: passa sullo standard input, non fra gli argomenti.
    const ins = await sqlLibreNMSDaStdin(
      d,
      containerName,
      dbPassword,
      `INSERT INTO api_tokens (user_id, token_hash, description, disabled)
       VALUES (${Number(userId)}, '${token}', 'DA-INVENT auto', 0);\n`,
    );

    if (!ins.ok) {
      log(`[token] Inserimento token: ${(ins.stderr || ins.stdout).trim().substring(0, 400)}`);
      return null;
    }

    log("[token] Token inserito e salvato cifrato.");
    return token;
  } catch (err) {
    log(`[token] Errore inserimento token: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Attende che LibreNMS sia completamente pronto (migrazioni DB incluse).
 * Controlla l'endpoint /api/v0/ che ritorna JSON solo quando l'app è operativa
 * (401 Unauthorized = pronto; 200 con JSON = pronto; 502/503 = ancora in avvio).
 */
async function waitForLibreNMSReady(
  d: DipendenzeLibreNMS,
  baseUrl: string,
  maxSeconds: number,
  log: (l: string) => void,
): Promise<void> {
  const deadline = d.ora() + maxSeconds * 1000;
  let attempt = 0;
  while (d.ora() < deadline) {
    attempt++;
    try {
      const res = await d.fetch(`${baseUrl}/api/v0/`, { signal: AbortSignal.timeout(6000) });
      // 401 = l'app risponde ma richiede autenticazione → pronta
      // 200 = risponde con dati JSON → pronta
      if (res.status === 401 || res.status === 200) {
        log(`[wait] LibreNMS pronto (tentativo ${attempt}, HTTP ${res.status})`);
        return;
      }
      // 302 verso /login = nginx su, app forse pronta — accetta anche questo
      if (res.status === 302 || res.status === 301) {
        log(`[wait] LibreNMS pronto (tentativo ${attempt}, redirect login)`);
        return;
      }
      log(`[wait] Tentativo ${attempt} — HTTP ${res.status}, attesa 15s...`);
    } catch {
      log(`[wait] Tentativo ${attempt} — non raggiungibile, attesa 15s...`);
    }
    await d.attendi(15_000);
  }
  throw new Error(`LibreNMS non raggiungibile dopo ${maxSeconds}s`);
}
