import { createServer } from "http";
import { createServer as createSecureServer } from "https";
import { readFileSync } from "fs";
import next from "next";
import { ensureEnvSecrets, assertContainerSecretsConfigured } from "./src/lib/env-secrets";
import { logEncryptionKeyHealthAtBoot } from "./src/lib/encryption-key-health";
import { attachSshTerminalWs } from "./src/lib/ssh-terminal/ws-handler";

// ── Segreti: container = compose .env host; systemd = .env.local (install.sh) ──
assertContainerSecretsConfigured();
ensureEnvSecrets();
logEncryptionKeyHealthAtBoot();

// ── Global error handlers — prevent silent crashes ──
process.on("uncaughtException", (err) => {
  console.error("FATAL uncaughtException — il processo continua ma potrebbe essere instabile:", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("WARN unhandledRejection:", reason);
});

const dev = process.env.NODE_ENV !== "production";
const hostname = "0.0.0.0";
const port = parseInt(process.env.PORT || "3001", 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const tlsCert = process.env.TLS_CERT;
  const tlsKey = process.env.TLS_KEY;

  if (tlsCert && tlsKey) {
    try {
      const options = {
        cert: readFileSync(tlsCert),
        key: readFileSync(tlsKey),
      };
      const httpsServer = createSecureServer(options, (req, res) => {
        handle(req, res);
      });
      attachSshTerminalWs(httpsServer); // terminale SSH web (/ws/ssh)
      httpsServer.listen(port, hostname, () => {
        console.log(`> DA-INVENT ready on https://localhost:${port}`);
        initCron();
      });

      // Optional HTTP redirect
      if (process.env.TLS_REDIRECT === "true") {
        const httpPort = parseInt(process.env.HTTP_PORT || "80", 10);
        createServer((req, res) => {
          const host = req.headers.host?.replace(`:${httpPort}`, `:${port}`) || `localhost:${port}`;
          res.writeHead(301, { Location: `https://${host}${req.url}` });
          res.end();
        }).listen(httpPort, hostname, () => {
          console.log(`> HTTP redirect on port ${httpPort} → https://localhost:${port}`);
        });
      }
    } catch (err) {
      console.error("Errore caricamento certificati TLS:", err);
      console.log("Avvio in modalità HTTP...");
      startHttp();
    }
  } else {
    if (!dev) console.warn("⚠ ATTENZIONE: Server avviato in HTTP. Configura TLS_CERT e TLS_KEY per HTTPS.");
    startHttp();
  }

  function startHttp() {
    const httpServer = createServer((req, res) => {
      handle(req, res);
    });
    attachSshTerminalWs(httpServer); // terminale SSH web (/ws/ssh)
    httpServer.listen(port, hostname, () => {
      console.log(`> DA-INVENT ready on http://0.0.0.0:${port} (anche http://localhost:${port})`);
      initCron();
    });
  }

  function initCron() {
    // da-vault (piano 2026-10-23): sblocco del vault e cache di OpenBao, solo con un interruttore acceso (spenti di
    // serie: l'avvio resta quello di oggi). Prima dello scheduler: i job col vault bloccato restano in pausa.
    if (process.env.DA_VAULT_LOCALE === "1" || process.env.DA_VAULT_OPENBAO === "1") {
      import("./src/lib/vault/avvio").then(({ avviaVault }) => avviaVault()).catch((error) => {
        console.error("CRITICAL: avvio del vault fallito — credenziali non leggibili, scansioni in pausa:", error);
      });
    }

    // Boot migration prima dello scheduler: garantisce che ogni tenant abbia
    // known_host_check sui propri network e nessun fast_scan rischioso schedulato.
    // Vedi src/lib/cron/scheduler-defaults.ts e incident cliente A 2026-05-25.
    import("./src/lib/cron/scheduler-defaults").then(({ applySchedulerBootMigration }) => {
      try { applySchedulerBootMigration(); }
      catch (e) { console.error("WARNING: scheduler boot migration failed:", e); }
    }).catch((error) => {
      console.error("WARNING: scheduler-defaults module load failed:", error);
    });

    // Segreti delle installazioni LibreNMS/Graylog fatte prima di T3-27: se
    // manca la copia cifrata nell'hub, la legge dall'ambiente del container
    // (sola lettura) e la salva. Non blocca l'avvio.
    import("./src/lib/integrations/segreti-migrazione").then(({ migraSegretiInstallazioniAllAvvio }) =>
      migraSegretiInstallazioniAllAvvio(),
    ).catch((error) => {
      console.error("WARNING: migrazione dei segreti delle installazioni fallita:", error);
    });

    import("./src/lib/cron/scheduler").then(({ initializeScheduler }) => {
      initializeScheduler();
      console.log("> Cron scheduler initialized");
    }).catch((error) => {
      console.error("CRITICAL: Failed to initialize scheduler — cron jobs will NOT run:", error);
    });

    // Backup scheduler hub-level (separato dal scheduler per-tenant sopra).
    // Nightly snapshot di hub.db + tenant DBs. Vedi src/lib/backup/scheduler.ts.
    import("./src/lib/backup/scheduler").then(({ initializeBackupScheduler }) => {
      initializeBackupScheduler();
      console.log("> Backup scheduler initialized");
    }).catch((error) => {
      console.error("WARNING: Backup scheduler init failed (backup nightly NON attivo):", error);
    });

    // Notifica salute appliance (disco/Docker) ogni 30 min, indipendente
    // dalla UI: l'incident cliente A 2026-07-28 (disco 100%) è passato inosservato
    // proprio perché nessuno aveva la dashboard aperta.
    import("./src/lib/modules/appliance-health-notify").then(({ initializeApplianceHealthNotifier }) => {
      initializeApplianceHealthNotifier();
      console.log("> Appliance health notifier initialized");
    }).catch((error) => {
      console.error("WARNING: appliance health notifier init failed:", error);
    });

    // Allarme sulle sincronizzazioni ferme, ogni 30 min. Stesso motivo del
    // precedente, incidente diverso: il 2026-09-02 tutti i job di un tenant
    // hanno fallito per 4h40 senza che nessun canale lo dicesse.
    import("./src/lib/health/scheduler-health-notify").then(({ initializeSchedulerHealthNotifier }) => {
      initializeSchedulerHealthNotifier();
      console.log("> Scheduler health notifier initialized");
    }).catch((error) => {
      console.error("WARNING: scheduler health notifier init failed:", error);
    });

    // Chocolatey automatico sugli host Windows con credenziale WinRM (21/10/2026):
    // giro notturno alle 02:00 per chi non ce l'ha o ha un tentativo fallito.
    // Interruttore nella pagina del modulo Patch Management (acceso di default).
    import("node-cron").then(async ({ default: cron }) => {
      const { giroNotturnoChoco } = await import("./src/lib/patch/choco-automatico");
      cron.schedule("0 2 * * *", () => {
        void giroNotturnoChoco();
      });
      console.log("> Chocolatey automatico: giro notturno alle 02:00");
    }).catch((error) => {
      console.error("WARNING: giro notturno di Chocolatey non avviato:", error);
    });

    // Dati sugli exploit per la pagina Vulnerabilità (22/10/2026): CISA KEV, Exploit-DB ed
    // EPSS alle 06:00, e 90 s dopo l'avvio se mancano o hanno più di 26 ore. Acceso di
    // default, levetta in Opzioni (automatismo.feed_exploit).
    import("./src/lib/vuln/exploit-feed/job").then(({ avviaFeedExploit }) => {
      avviaFeedExploit();
      console.log("> Dati sugli exploit: scaricamento alle 06:00");
    }).catch((error) => {
      console.error("WARNING: scaricamento dei dati sugli exploit non avviato:", error);
    });

    // Chi si collega ai PC (23/10/2026, piano assegnatari da AD): Wazuh e WinRM ogni ora al
    // minuto 17. Spento di serie, si accende per cliente in Opzioni (automatismo.accessi_pc).
    import("./src/lib/assegnatari/job").then(({ avviaGiroAccessi }) => {
      avviaGiroAccessi();
      console.log("> Accessi ai PC: giro orario (solo i clienti che l'hanno acceso)");
    }).catch((error) => {
      console.error("WARNING: giro degli accessi ai PC non avviato:", error);
    });

    // Segnale di vita verso DA-Link (tappa C1 NetBird). Spento finché non esiste
    // /etc/dalink/oggetto.env, scritto dal comando d'installazione di DA-Link:
    // senza quel file nessun giro arriva alla rete.
    import("./src/lib/dalink/segnale-job").then(({ avviaSegnaleDalink }) => {
      avviaSegnaleDalink();
    }).catch((error) => {
      console.error("WARNING: segnale DA-Link non avviato:", error);
    });

    // Invio di AD Health e inventario all'hub DA-Vul-can (A-IPAM). Spento finché
    // /etc/dalink/oggetto.env non ha VULCAN_TOKEN: ogni tic legge il file e, senza
    // gettone, si ferma lì (niente DB, niente rete). Un secondo avvio non crea altri timer.
    import("./src/lib/vulcan/job").then(({ avviaInvioVulcan }) => {
      avviaInvioVulcan();
      console.log("> Invio a DA-Vul-can: timer avviati (spenti senza VULCAN_TOKEN)");
    }).catch((error) => {
      console.error("WARNING: invio a DA-Vul-can non avviato:", error);
    });
  }
});
