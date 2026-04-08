import { appendLog, updateJob } from "./job-store";
import { spawnDockerStream, execDockerCommand } from "./docker";
import { setIntegrationConfig } from "./config";

const LIBRENMS_IMAGE = "librenms/librenms:latest";

export async function installLibreNMS(jobId: string, containerName: string): Promise<void> {
  const log = (line: string) => appendLog(jobId, line);

  try {
    updateJob(jobId, { phase: "pulling" });
    log(`[pull] Scaricamento immagine ${LIBRENMS_IMAGE}...`);
    await spawnDockerStream(["pull", LIBRENMS_IMAGE], log);

    updateJob(jobId, { phase: "creating" });
    log("[create] Creazione container LibreNMS...");

    // Rimuovi il container precedente se esiste
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
        "-p", "8090:8000",
        "-e", "APP_KEY=base64:TGGLpPFMtGHB2I3SFUevQCkIHkrmbXR6b+x5W7jf8jA=",
        "-e", "DB_HOST=127.0.0.1",
        "-e", "LIBRENMS_SNMP_COMMUNITY=public",
        LIBRENMS_IMAGE,
      ],
      log
    );

    updateJob(jobId, { phase: "waiting" });
    log("[wait] Attesa avvio servizio LibreNMS (max 60s)...");
    await waitForHttp("http://localhost:8090", 60, log);

    // Aggiorna config: mode=managed, url default
    setIntegrationConfig("librenms", {
      mode: "managed",
      url: "http://localhost:8090",
      containerName,
    });

    updateJob(jobId, { phase: "done", finishedAt: new Date().toISOString() });
    log("[done] LibreNMS installato correttamente su http://localhost:8090");
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
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
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
