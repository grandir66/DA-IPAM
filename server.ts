import { createServer } from "http";
import { createServer as createSecureServer } from "https";
import { readFileSync } from "fs";
import next from "next";

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
      }).listen(port, () => {
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
        }).listen(httpPort, () => {
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
    }).listen(port, () => {
      console.log(`> DA-INVENT ready on http://localhost:${port}`);
      initCron();
    });
  }

  function initCron() {
    import("./src/lib/cron/scheduler").then(({ initializeScheduler }) => {
      initializeScheduler();
    }).catch((error) => {
      console.error("Failed to initialize scheduler:", error);
    });
  }
});
