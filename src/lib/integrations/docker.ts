import { execFile as _execFile, spawn } from "child_process";
import { promisify } from "util";

const execFile = promisify(_execFile);

export async function isDockerAvailable(): Promise<boolean> {
  try {
    await execFile("docker", ["info", "--format", "{{.ServerVersion}}"], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

export interface ExecResult {
  stdout: string;
  stderr: string;
}

/**
 * Esegue un comando docker con argomenti come array (nessuna shell injection).
 * Lancia un errore se il processo esce con codice != 0.
 */
export async function execDockerCommand(args: string[]): Promise<ExecResult> {
  const result = await execFile("docker", args, {
    timeout: 120_000,
    maxBuffer: 5 * 1024 * 1024,
  });
  return { stdout: result.stdout, stderr: result.stderr };
}

/**
 * Esegue un comando docker in streaming, invocando onLine per ogni riga di output.
 * Risolve con il codice di uscita.
 */
export function spawnDockerStream(
  args: string[],
  onLine: (line: string) => void
): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });

    const handleData = (data: Buffer) => {
      const text = data.toString();
      text.split("\n").forEach((l) => {
        const trimmed = l.trim();
        if (trimmed) onLine(trimmed);
      });
    };

    proc.stdout.on("data", handleData);
    proc.stderr.on("data", handleData);

    proc.on("error", reject);
    proc.on("close", (code) => resolve(code ?? 0));
  });
}

export async function getContainerStatus(containerName: string): Promise<{
  running: boolean;
  image: string;
  uptime: string;
  health: string;
} | null> {
  try {
    const { stdout } = await execDockerCommand([
      "inspect",
      "--format",
      "{{.State.Running}}|{{.Config.Image}}|{{.State.StartedAt}}|{{.State.Health.Status}}",
      containerName,
    ]);
    const parts = stdout.trim().split("|");
    return {
      running: parts[0] === "true",
      image: parts[1] ?? "",
      uptime: parts[2] ?? "",
      health: parts[3] ?? "",
    };
  } catch {
    return null;
  }
}
