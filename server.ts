import { createServer } from "http";
import next from "next";

const dev = process.env.NODE_ENV !== "production";
const hostname = "0.0.0.0";
const port = parseInt(process.env.PORT || "3001", 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  createServer((req, res) => {
    handle(req, res);
  }).listen(port, () => {
    console.log(`> DA-IPAM ready on http://localhost:${port}`);

    // Initialize cron scheduler after server is ready
    import("./src/lib/cron/scheduler").then(({ initializeScheduler }) => {
      initializeScheduler();
    }).catch((error) => {
      console.error("Failed to initialize scheduler:", error);
    });
  });
});
