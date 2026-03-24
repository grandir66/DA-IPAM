import { createServer } from "http";
import { createServer as createSecureServer } from "https";
import { readFileSync, existsSync, writeFileSync } from "fs";
import { randomBytes } from "crypto";
import { join } from "path";
import next from "next";

// ── Ensure AUTH_SECRET & ENCRYPTION_KEY exist before Next.js boots ──
// On a fresh install .env.local may not exist yet. We generate the keys
// eagerly so that NextAuth can sign JWTs from the very first login
// (without requiring a server restart after /setup).
(function ensureEnvSecrets() {
  const envPath = join(process.cwd(), ".env.local");
  let content = "";
  if (existsSync(envPath)) {
    content = readFileSync(envPath, "utf-8");
  }
  let dirty = false;
  if (!content.includes("ENCRYPTION_KEY")) {
    const key = randomBytes(32).toString("hex");
    content += `\nENCRYPTION_KEY=${key}\n`;
    process.env.ENCRYPTION_KEY = key;
    dirty = true;
  } else if (!process.env.ENCRYPTION_KEY) {
    const m = content.match(/^ENCRYPTION_KEY=(.+)$/m);
    if (m) process.env.ENCRYPTION_KEY = m[1].trim();
  }
  if (!content.includes("AUTH_SECRET")) {
    const secret = randomBytes(32).toString("hex");
    content += `AUTH_SECRET=${secret}\n`;
    process.env.AUTH_SECRET = secret;
    dirty = true;
  } else if (!process.env.AUTH_SECRET) {
    const m = content.match(/^AUTH_SECRET=(.+)$/m);
    if (m) process.env.AUTH_SECRET = m[1].trim();
  }
  if (dirty) {
    writeFileSync(envPath, content.replace(/^\n+/, ""));
    console.log("> Generated missing secrets in .env.local");
  }
})();

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
      createSecureServer(options, (req, res) => {
        handle(req, res);
      }).listen(port, hostname, () => {
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
    createServer((req, res) => {
      handle(req, res);
    }).listen(port, hostname, () => {
      console.log(`> DA-INVENT ready on http://0.0.0.0:${port} (anche http://localhost:${port})`);
      initCron();
    });
  }

  function initCron() {
    import("./src/lib/cron/scheduler").then(({ initializeScheduler }) => {
      initializeScheduler();
      console.log("> Cron scheduler initialized");
    }).catch((error) => {
      console.error("CRITICAL: Failed to initialize scheduler — cron jobs will NOT run:", error);
    });
  }
});
