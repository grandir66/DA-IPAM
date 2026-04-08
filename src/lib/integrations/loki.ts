import { appendLog, updateJob } from "./job-store";
import { spawnDockerStream, execDockerCommand } from "./docker";
import { setIntegrationConfig } from "./config";

const LOKI_IMAGE = "grafana/loki:latest";
const SEC_OPT = ["--security-opt", "apparmor=unconfined"];

export async function installLoki(jobId: string, containerName: string): Promise<void> {
  const log = (line: string) => appendLog(jobId, line);

  try {
    updateJob(jobId, { phase: "pulling" });
    log(`[pull] Scaricamento immagine ${LOKI_IMAGE}...`);
    await spawnDockerStream(["pull", LOKI_IMAGE], log, false);

    updateJob(jobId, { phase: "creating" });
    log("[create] Creazione container Loki...");

    try {
      await execDockerCommand(["rm", "-f", containerName]);
      log(`[create] Container precedente ${containerName} rimosso.`);
    } catch {
      // non esisteva
    }

    await spawnDockerStream(
      [
        "run", "-d",
        "--name", containerName,
        "--restart", "unless-stopped",
        "-p", "3100:3100",
        ...SEC_OPT,
        LOKI_IMAGE,
        "-config.file=/etc/loki/local-config.yaml",
      ],
      log
    );

    updateJob(jobId, { phase: "waiting" });
    log("[wait] Attesa avvio Loki (max 60s)...");
    await waitForHttp("http://localhost:3100/ready", 60, log);

    setIntegrationConfig("loki", {
      mode: "managed",
      url: "http://localhost:3100",
      containerName,
    });

    updateJob(jobId, { phase: "done", finishedAt: new Date().toISOString() });
    log("[done] Loki installato correttamente su http://localhost:3100");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    updateJob(jobId, { phase: "error", error: msg, finishedAt: new Date().toISOString() });
    log(`[error] ${msg}`);
  }
}

async function waitForHttp(url: string, maxSeconds: number, log: (l: string) => void): Promise<void> {
  const deadline = Date.now() + maxSeconds * 1000;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt++;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (res.ok || res.status < 500) {
        log(`[wait] Servizio raggiungibile (tentativo ${attempt})`);
        return;
      }
    } catch {
      // non ancora pronto
    }
    log(`[wait] Tentativo ${attempt}... attesa 5s`);
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error(`Servizio non raggiungibile dopo ${maxSeconds}s`);
}
