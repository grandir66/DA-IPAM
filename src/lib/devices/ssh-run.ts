/**
 * Esecuzione comandi SSH tramite paramiko (Python subprocess).
 *
 * Sidecar `ssh-bridge.py`: input JSON da stdin, output JSON da stdout.
 * Auth: **solo password** (riusa `credentials.encrypted_password`).
 * Niente key auth, niente known_hosts strict (AutoAddPolicy).
 * Mai loggare la password.
 */

import { execFile } from "child_process";
import path from "path";
import { findBridgePython } from "./find-bridge-python";

const HARD_TIMEOUT_MS = 120_000;
const BRIDGE_SCRIPT = path.resolve(
  process.cwd(),
  "src/lib/devices/ssh-bridge.py"
);

export interface SshRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface SshRunOptions {
  host: string;
  port: number;
  username: string;
  password: string;
  command: string;
  timeoutSec?: number;
}

/**
 * Esegue un comando shell su un host Linux via SSH (paramiko bridge).
 *
 * Risolve con `{ stdout, stderr, exitCode }`. Rigetta con `Error(message)`
 * in caso di errore di connessione/auth/timeout: il chiamante mappa su
 * `software_scans.status='error'`/`timeout`.
 */
export function runSshCommand(opts: SshRunOptions): Promise<SshRunResult> {
  return new Promise((resolve, reject) => {
    const pythonBin = findBridgePython();
    const timeoutSec =
      opts.timeoutSec && opts.timeoutSec > 0 ? Math.trunc(opts.timeoutSec) : 60;

    const payload = JSON.stringify({
      host: opts.host,
      port: opts.port,
      username: opts.username,
      password: opts.password,
      command: opts.command,
      timeout_sec: timeoutSec,
    });

    const child = execFile(
      pythonBin,
      [BRIDGE_SCRIPT],
      {
        timeout: Math.min(HARD_TIMEOUT_MS, (timeoutSec + 10) * 1000),
        maxBuffer: 10 * 1024 * 1024,
        encoding: "utf-8",
      },
      (error, stdout) => {
        if (error && !stdout) {
          const msg = error.message || "Errore esecuzione SSH bridge";
          if (msg.includes("ENOENT")) {
            reject(
              new Error(
                `Python non trovato: ${pythonBin}. Installa paramiko: python3 -m pip install paramiko`
              )
            );
          } else if (
            msg.includes("ETIMEDOUT") ||
            msg.includes("timeout") ||
            error.killed
          ) {
            reject(new Error("Timeout: il dispositivo non ha risposto."));
          } else {
            reject(new Error(msg));
          }
          return;
        }

        const trimmed = (stdout || "").trim();
        if (!trimmed) {
          reject(new Error("Output vuoto dal bridge SSH"));
          return;
        }

        try {
          const result = JSON.parse(trimmed) as {
            error?: string;
            stdout?: string;
            stderr?: string;
            exit_code?: number;
          };
          if (result.error) {
            reject(new Error(result.error));
            return;
          }
          resolve({
            stdout: result.stdout ?? "",
            stderr: result.stderr ?? "",
            exitCode: typeof result.exit_code === "number" ? result.exit_code : -1,
          });
        } catch {
          reject(
            new Error(
              `Output non valido dal bridge SSH: ${trimmed.substring(0, 200)}`
            )
          );
        }
      }
    );

    try {
      child.stdin?.write(payload);
      child.stdin?.end();
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}
