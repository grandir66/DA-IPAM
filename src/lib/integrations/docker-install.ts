/**
 * Installa Docker Engine sul server locale tramite lo script ufficiale get.docker.com.
 * Richiede che il processo giri come root o con sudo disponibile senza password.
 * Usato dalla UI quando Docker non è presente.
 */
import { execFile as _execFile } from "child_process";
import { promisify } from "util";
import { appendLog, updateJob } from "./job-store";
import { isDockerAvailable } from "./docker";

const execFile = promisify(_execFile);

export async function installDocker(jobId: string): Promise<void> {
  const log = (line: string) => appendLog(jobId, line);

  try {
    updateJob(jobId, { phase: "pulling" });
    log("[docker-install] Verifica se Docker è già presente...");

    if (await isDockerAvailable()) {
      log("[docker-install] Docker è già installato.");
      updateJob(jobId, { phase: "done", finishedAt: new Date().toISOString() });
      return;
    }

    log("[docker-install] Download script di installazione ufficiale (get.docker.com)...");
    updateJob(jobId, { phase: "creating" });

    // Scarica lo script
    const scriptRes = await fetch("https://get.docker.com", { signal: AbortSignal.timeout(30_000) });
    if (!scriptRes.ok) throw new Error(`Download script fallito: HTTP ${scriptRes.status}`);
    const script = await scriptRes.text();

    // Scrivi lo script in un file temp
    const fs = await import("fs/promises");
    const os = await import("os");
    const path = await import("path");
    const tmpDir = os.tmpdir();
    const scriptPath = path.join(tmpDir, "install-docker.sh");
    await fs.writeFile(scriptPath, script, { mode: 0o700 });
    log(`[docker-install] Script salvato in ${scriptPath}`);

    updateJob(jobId, { phase: "starting" });
    log("[docker-install] Esecuzione script di installazione (richiede privilegi root)...");
    log("[docker-install] Questo può richiedere 1-3 minuti...");

    const { stdout, stderr } = await execFile("sh", [scriptPath], {
      timeout: 300_000,
      maxBuffer: 10 * 1024 * 1024,
    });

    if (stdout) stdout.split("\n").forEach((l) => { if (l.trim()) log(`[install] ${l.trim()}`); });
    if (stderr) stderr.split("\n").forEach((l) => { if (l.trim()) log(`[install] ${l.trim()}`); });

    // Cleanup
    await fs.unlink(scriptPath).catch(() => {});

    updateJob(jobId, { phase: "waiting" });
    log("[docker-install] Verifica installazione...");
    // Aspetta qualche secondo perché il daemon parta
    await new Promise((r) => setTimeout(r, 5000));

    const ok = await isDockerAvailable();
    if (!ok) throw new Error("Docker installato ma non risponde. Potrebbe essere necessario riavviare il server.");

    updateJob(jobId, { phase: "done", finishedAt: new Date().toISOString() });
    log("[docker-install] Docker installato correttamente!");
    log("[docker-install] Ricarica la pagina per vedere le opzioni di installazione.");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    updateJob(jobId, { phase: "error", error: msg, finishedAt: new Date().toISOString() });
    log(`[error] ${msg}`);
    log("[error] Se il server non ha i privilegi root, installa Docker manualmente:");
    log("[error] curl -fsSL https://get.docker.com | sh");
    log("[error] sudo usermod -aG docker $USER");
  }
}
