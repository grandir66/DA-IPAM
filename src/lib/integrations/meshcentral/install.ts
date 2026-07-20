/**
 * Provisioning COMPLETO di MeshCentral dalla UI (come installLibreNMS).
 *
 * Prima di questo modulo, "installa" dalla pagina Moduli faceva solo tre cose:
 * creava le tabelle, accendeva il flag e invalidava la cache. Nessun container,
 * nessuna utenza, nessun parametro: il modulo risultava "installato" ma era
 * inservibile, e completarlo richiedeva `da-appliance add-module meshcentral`
 * da riga di comando. Segnalato dall'utente il 2026-07-20 su 192.168.4.8.
 *
 * Qui il flusso e' quello che l'utente si aspetta: un solo pulsante fa tutto.
 *   pull immagine → config.json → container → service account → device group
 *   → config cifrata in DA-IPAM → job di sync → self-check del login-token
 *
 * Tutta questa procedura esisteva gia' in Deploy-Appliance/modules/meshcentral.sh
 * (installazione da CLI su appliance nuove). Le due strade DEVONO restare
 * allineate: se cambia l'immagine o il formato di config.json, vanno aggiornate
 * entrambe. Sono tenute vicine di proposito — stessi valori, stessi commenti.
 */
import { randomBytes } from "crypto";
import { execDockerCommand, spawnDockerStream, isDockerAvailable } from "@/lib/integrations/docker";
import { appendLog, updateJob } from "@/lib/integrations/job-store";
import { withTenant, getTenantDb } from "@/lib/db-tenant";
import { reloadTenantScheduler } from "@/lib/cron/scheduler";
import { saveMeshConfig, type MeshCreds } from "./config";
import { MeshControlClient } from "./control-client";
import { loginTokenSelfCheck } from "./login-token";
import { applyMcSchemaMigrations } from "./schema";
import { meshProbeStatus } from "./tls-fetch";
import { installMeshFeature } from "./feature";

/**
 * ghcr.io/ylianst/meshcentral:latest @ 2026-07-16 — verificato in produzione.
 * PINNATO PER DIGEST, mai `:latest`: MeshCentral cambia il codec del login-token
 * fra le versioni, e un'immagine che si aggiorna da sola romperebbe il launch-out
 * (DA-IPAM cifra il token con la chiave a 80 byte e il server deve decifrarlo con
 * lo stesso schema). Aggiornare = cambiare questo digest consapevolmente, qui E
 * in Deploy-Appliance/modules/meshcentral.sh.
 */
const MC_IMAGE =
  "ghcr.io/ylianst/meshcentral@sha256:449926ba9d916feda942ba7bfa28c7a9ba891ee9767a78737b20a83a8cc2eb2d";

const CONTAINER = "meshcentral";
const APP_DIR = "/opt/meshcentral";
const SERVICE_USER = "svc-daipam";
const DEVICE_GROUP = "Domarc Endpoints";

export interface MeshInstallOptions {
  /** Password del service account. Generata dal chiamante se assente. */
  adminPassword: string;
  /** Titolo mostrato nella console MeshCentral (personalizzabile dal wizard). */
  title: string;
  /** Sottotitolo. */
  subtitle: string;
  /** Porta HTTPS del server MeshCentral. */
  port: number;
  /**
   * Host/IP con cui il BROWSER dell'operatore raggiunge l'appliance. Finisce sia
   * nel certificato sia in allowedFramingOrigins: con "localhost" il controllo
   * remoto si aprirebbe verso il PC dell'operatore. Lo passa la UI usando
   * window.location.hostname.
   */
  host: string;
  /** Codice tenant su cui salvare la config (il job gira fuori dalla request). */
  tenantCode: string;
}

/** Chiave a 80 byte = 160 hex. config.ts rifiuta lunghezze diverse. */
export function generateLoginTokenKey(): string {
  return randomBytes(80).toString("hex");
}

/** Password robusta per il service account (nessun umano deve digitarla). */
export function generateServicePassword(): string {
  // Alfabeto senza caratteri ambigui e senza quelli che romperebbero il quoting
  // nella CLI di MeshCentral (eseguita via docker run con argomenti array).
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = randomBytes(24);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

function buildConfigJson(opts: MeshInstallOptions, loginTokenKey: string): string {
  return JSON.stringify(
    {
      settings: {
        Cert: opts.host,
        Port: opts.port,
        RedirPort: 8081,
        AllowLoginToken: true,
        // Consente a DA-IPAM (e SOLO a lui) di incorporare la sessione remota in
        // un iframe: emette `CSP: frame-ancestors 'self' https://<host>` e toglie
        // X-Frame-Options solo per quell'origine. NON usare `AllowFraming: true`,
        // che rimuove la protezione anti-clickjacking per qualunque sito.
        // E' l'origine del BROWSER (DA-IPAM dietro nginx, 443), non la :4443.
        allowedFramingOrigins: `https://${opts.host}`,
        LoginCookieEncryptionKey: loginTokenKey,
        SelfUpdate: false,
        AgentPong: 300,
        TlsOffload: false,
      },
      domains: {
        "": {
          Title: opts.title,
          Title2: opts.subtitle,
          NewAccounts: false,
          UserNameIsEmail: false,
        },
      },
    },
    null,
    2,
  );
}

/**
 * Attende che il server risponda sulla porta HTTPS. Sonda via 127.0.0.1
 * (loopback = self-host → meshProbeStatus accetta il cert self-signed appena
 * generato). Qualunque status HTTP = server su.
 */
async function waitForServer(port: number, log: (l: string) => void, maxSeconds = 180): Promise<boolean> {
  for (let i = 0; i < maxSeconds; i += 3) {
    const status = await meshProbeStatus(`https://127.0.0.1:${port}/`, 2500).catch(() => 0);
    if (status > 0) return true;
    await new Promise((r) => setTimeout(r, 3000));
    if (i % 30 === 0 && i > 0) log(`[wait] server non ancora pronto (${i}s)...`);
  }
  return false;
}

export async function installMeshCentral(jobId: string, opts: MeshInstallOptions): Promise<void> {
  const log = (line: string) => appendLog(jobId, line);
  const loginTokenKey = generateLoginTokenKey();

  try {
    updateJob(jobId, { phase: "pulling" });

    if (!(await isDockerAvailable())) {
      throw new Error(
        "Docker non disponibile sul server: installalo da Impostazioni → Integrazioni prima di procedere.",
      );
    }

    log(`[pull] Scaricamento immagine MeshCentral (digest pinnato)...`);
    // throwOnError=false: docker pull scrive il progresso su stderr ma esce 0.
    await spawnDockerStream(["pull", MC_IMAGE], log, false);

    // ── CONFIG.JSON ──────────────────────────────────────────────────────────
    updateJob(jobId, { phase: "creating" });
    log(`[config] Scrittura configurazione (host ${opts.host}, porta ${opts.port})...`);
    const fs = await import("fs/promises");
    await fs.mkdir(`${APP_DIR}/meshcentral-data`, { recursive: true });
    await fs.mkdir(`${APP_DIR}/meshcentral-files`, { recursive: true });
    await fs.writeFile(
      `${APP_DIR}/meshcentral-data/config.json`,
      buildConfigJson(opts, loginTokenKey),
      { mode: 0o600 },
    );

    // ── CONTAINER ────────────────────────────────────────────────────────────
    try {
      await execDockerCommand(["rm", "-f", CONTAINER]);
      log(`[create] Container precedente rimosso.`);
    } catch {
      /* non esisteva */
    }

    log(`[create] Avvio container MeshCentral...`);
    // DYNAMIC_CONFIG=false: AllowLoginToken e LoginCookieEncryptionKey vivono in
    // config.json, l'entrypoint NON deve rigenerarlo.
    await spawnDockerStream(
      [
        "run",
        "-d",
        "--name",
        CONTAINER,
        "--restart",
        "unless-stopped",
        "-p",
        `${opts.port}:${opts.port}`,
        "-e",
        "DYNAMIC_CONFIG=false",
        "-e",
        "CONFIG_FILE=/opt/meshcentral/meshcentral-data/config.json",
        "-e",
        "ALLOW_NEW_ACCOUNTS=false",
        "-v",
        `${APP_DIR}/meshcentral-data:/opt/meshcentral/meshcentral-data`,
        "-v",
        `${APP_DIR}/meshcentral-files:/opt/meshcentral/meshcentral-files`,
        MC_IMAGE,
      ],
      log,
    );

    updateJob(jobId, { phase: "starting" });
    log(`[wait] Attesa avvio del server...`);
    if (!(await waitForServer(opts.port, log))) {
      throw new Error(`Il server MeshCentral non risponde sulla porta ${opts.port}`);
    }
    log(`[wait] Server attivo.`);

    // ── SERVICE ACCOUNT ──────────────────────────────────────────────────────
    // A container FERMO: MeshCentral usa NeDB (file JSON append-only) e la CLI
    // apre il DB direttamente — due scrittori lo corromperebbero. Il comando
    // stesso avvisa: "This command will only work if MeshCentral is stopped".
    log(`[account] Creazione service account '${SERVICE_USER}'...`);
    await execDockerCommand(["stop", CONTAINER]);

    // --entrypoint node E' OBBLIGATORIO: l'immagine ha
    // ENTRYPOINT ['/bin/bash','/opt/meshcentral/entrypoint.sh'] e senza override
    // gli argomenti vengono ignorati, l'entrypoint avvia un SECONDO server e il
    // comando non esce MAI (hang verificato il 2026-07-17).
    const cliArgs = (args: string[]) => [
      "run",
      "--rm",
      "--entrypoint",
      "node",
      "-w",
      "/opt/meshcentral",
      "-v",
      `${APP_DIR}/meshcentral-data:/opt/meshcentral/meshcentral-data`,
      MC_IMAGE,
      "meshcentral/meshcentral.js",
      ...args,
    ];
    await execDockerCommand(
      cliArgs([
        "--createaccount",
        SERVICE_USER,
        "--pass",
        opts.adminPassword,
        "--email",
        `${SERVICE_USER}@localhost`,
      ]),
    );
    await execDockerCommand(cliArgs(["--adminaccount", SERVICE_USER]));
    log(`[account] Service account creato e promosso ad amministratore.`);

    await execDockerCommand(["start", CONTAINER]);
    if (!(await waitForServer(opts.port, log))) {
      throw new Error("Il server non riparte dopo la creazione dell'account");
    }

    // ── DEVICE GROUP ─────────────────────────────────────────────────────────
    updateJob(jobId, { phase: "waiting" });
    log(`[group] Creazione gruppo dispositivi '${DEVICE_GROUP}'...`);
    const serverUrl = `https://${opts.host}:${opts.port}`;

    // Le tabelle devono esistere prima di scriverci la config.
    withTenant(opts.tenantCode, () => applyMcSchemaMigrations(getTenantDb(opts.tenantCode)));

    // Credenziali costruite IN MEMORIA, non rilette dal DB: a questo punto le
    // abbiamo gia' tutte. Il giro dal database non servirebbe e sarebbe pure
    // sbagliato — getMeshCreds() richiede un mesh_id NON vuoto, e il gruppo lo
    // stiamo creando proprio adesso: salvare una config con meshId="" per poi
    // rileggerla restituiva null e faceva fallire l'installazione qui
    // ("Config MeshCentral non leggibile dopo il salvataggio", colto dal primo
    // collaudo reale su 192.168.4.8). Cosi' la config si scrive UNA volta sola,
    // a valle, gia' completa.
    const creds: MeshCreds = {
      serverUrl,
      domain: "",
      meshId: "",
      serviceUser: SERVICE_USER,
      loginTokenKey: Buffer.from(loginTokenKey, "hex"),
      adminUser: SERVICE_USER,
      adminPass: opts.adminPassword,
    };

    const client = new MeshControlClient(creds);
    let meshId: string;
    try {
      const existing = await client.listMeshes();
      const found = existing.find((m) => m.name === DEVICE_GROUP);
      if (found) {
        log(`[group] Gruppo già presente.`);
        meshId = found.meshId;
      } else {
        meshId = await client.addMesh(DEVICE_GROUP);
        log(`[group] Gruppo creato.`);
      }
    } finally {
      client.close();
    }

    // ── CONFIG DEFINITIVA + JOB DI SYNC ──────────────────────────────────────
    withTenant(opts.tenantCode, () => {
      saveMeshConfig({
        serverUrl,
        domain: "",
        meshId,
        serviceUser: SERVICE_USER,
        loginTokenKey,
        adminUser: SERVICE_USER,
        adminPass: opts.adminPassword,
      });
      const db = getTenantDb(opts.tenantCode);
      const existing = db
        .prepare(
          "SELECT id FROM scheduled_jobs WHERE job_type = 'meshcentral_sync' AND network_id IS NULL",
        )
        .get() as { id: number } | undefined;
      if (!existing) {
        db.prepare(
          `INSERT INTO scheduled_jobs (network_id, job_type, interval_minutes, enabled)
           VALUES (NULL, 'meshcentral_sync', 15, 1)`,
        ).run();
      }
      reloadTenantScheduler(opts.tenantCode);
    });
    log(`[config] Parametri salvati in DA-IPAM (segreti cifrati) e sync ogni 15 minuti.`);

    // ── SELF-CHECK ───────────────────────────────────────────────────────────
    // Verifica che il codec del login-token sia allineato: se fallisce, il
    // controllo remoto non funzionera' mai. Warning soft, non blocca l'install.
    const selfCheck = await withTenant(opts.tenantCode, () => loginTokenSelfCheck()).catch(
      () => false,
    );
    log(
      selfCheck
        ? `[verify] Self-check login-token OK: il controllo remoto è pronto.`
        : `[verify] ATTENZIONE: self-check del login-token fallito — il controllo remoto potrebbe non funzionare.`,
    );

    // Flag modulo acceso SOLO ORA: se lo si accendesse all'inizio, un fallimento
    // a meta' lascerebbe il modulo "installato" ma inservibile — esattamente il
    // problema che questo file esiste per risolvere.
    withTenant(opts.tenantCode, () => installMeshFeature());
    log(`[done] MeshCentral installato e configurato su ${serverUrl}`);
    updateJob(jobId, { phase: "done", finishedAt: new Date().toISOString() });
    return;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`[error] ${message}`);
    // Rollback best-effort: senza, un fallimento a metà lascia un container con
    // `--restart unless-stopped` che RIPARTE a ogni reboot mentre la UI dice
    // "non installato" (il flag si accende solo a fine corsa), e la dir dati con
    // il service account nel NeDB — che farebbe fallire un retry sul
    // `--createaccount` (utente già presente). Ripulendo, il tentativo successivo
    // riparte pulito. Individuato dall'audit di completezza (2026-07-20).
    log(`[rollback] Rimozione container e dati dell'installazione fallita...`);
    await execDockerCommand(["rm", "-f", CONTAINER]).catch(() => {});
    try {
      const fs = await import("fs/promises");
      await fs.rm(APP_DIR, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
    updateJob(jobId, {
      phase: "error",
      error: message,
      finishedAt: new Date().toISOString(),
    });
  }
}
