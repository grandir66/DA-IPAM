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
export async function execDockerCommand(args: string[], opzioni: OpzioniDocker = {}): Promise<ExecResult> {
  const p = execFile("docker", args, {
    timeout: opzioni.timeout ?? 120_000,
    maxBuffer: 5 * 1024 * 1024,
    env: ambienteDocker(opzioni.env),
  });
  if (opzioni.input !== undefined) p.child.stdin?.end(opzioni.input);
  const result = await p;
  return { stdout: result.stdout, stderr: result.stderr };
}

/**
 * Opzioni di un comando docker. `env` serve a passare un segreto a un
 * container senza metterlo fra gli argomenti: si scrive `-e NOME` (senza
 * `=valore`) e il client docker prende il valore dal proprio ambiente, così
 * il segreto non compare nella riga di comando né in un messaggio d'errore
 * che la riporta (SEC-13).
 */
export interface OpzioniDocker {
  env?: Record<string, string>;
  timeout?: number;
  /** Testo sullo standard input (con `docker exec -i`): per un SQL che porta un segreto. */
  input?: string;
}

function ambienteDocker(extra?: Record<string, string>): NodeJS.ProcessEnv | undefined {
  return extra ? { ...process.env, ...extra } : undefined;
}

/** Docker come dipendenza iniettabile delle installazioni (prove con docker finto). */
export interface DockerIniettabile {
  /** Lancia un errore se il comando esce con codice != 0. */
  exec(args: string[], opzioni?: OpzioniDocker): Promise<ExecResult>;
  stream(
    args: string[],
    onLine: (line: string) => void,
    opzioni?: OpzioniDocker & { throwOnError?: boolean },
  ): Promise<number>;
}

export const dockerReale: DockerIniettabile = {
  exec: (args, opzioni) => execDockerCommand(args, opzioni),
  stream: (args, onLine, opzioni) =>
    spawnDockerStream(args, onLine, opzioni?.throwOnError ?? true, opzioni?.env),
};

/**
 * Esegue un comando docker in streaming, invocando onLine per ogni riga di output.
 * Risolve con il codice di uscita.
 */
/**
 * Esegue un comando docker in streaming, invocando onLine per ogni riga di output.
 * Lancia un errore se il processo esce con codice != 0 (a meno che throwOnError=false).
 */
export function spawnDockerStream(
  args: string[],
  onLine: (line: string) => void,
  throwOnError = true,
  env?: Record<string, string>,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"], env: ambienteDocker(env) });

    const outputLines: string[] = [];

    const handleData = (data: Buffer) => {
      const text = data.toString();
      text.split("\n").forEach((l) => {
        const trimmed = l.trim();
        if (trimmed) {
          onLine(trimmed);
          outputLines.push(trimmed);
        }
      });
    };

    proc.stdout.on("data", handleData);
    proc.stderr.on("data", handleData);

    proc.on("error", reject);
    proc.on("close", (code) => {
      const exitCode = code ?? 0;
      if (throwOnError && exitCode !== 0) {
        const lastLines = outputLines.slice(-5).join(" | ");
        reject(new Error(`docker ${args[0]} uscito con codice ${exitCode}: ${lastLines}`));
      } else {
        resolve(exitCode);
      }
    });
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
