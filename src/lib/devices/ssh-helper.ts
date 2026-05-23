/**
 * Wrapper retrocompatibile sopra `ssh-transport.ts`. Mantiene l'API storica
 * `sshExec` / `sshExecViaShell` / `SshOptions` / `SshResult` per non rompere i
 * call site esistenti. Tutta la logica di connessione (tryKeyboard, auth handler,
 * error mapping) vive in `ssh-transport.ts`.
 */

import { sshExec as sshExecTransport, withSshClient } from "./ssh-transport";
import type { SshOptions, SshResult } from "./ssh-transport";

export type { SshOptions, SshResult } from "./ssh-transport";
export { SshError, mapSshError, connectSsh, sshTryConnect } from "./ssh-transport";
export type { SshErrorKind, SshErrorInfo, MapSshErrorContext } from "./ssh-transport";

export async function sshExec(options: SshOptions, command: string): Promise<SshResult> {
  return sshExecTransport(options, command);
}

/**
 * Esegue comando via shell interattiva per dispositivi che non supportano exec
 * (es. HP ProCurve, Aruba, HP Comware). Gestisce paginazione "--More--" e prompt.
 */
export async function sshExecViaShell(options: SshOptions, command: string): Promise<SshResult> {
  const commandTimeout = options.timeout ?? 45000;

  return withSshClient(options, (conn) => new Promise<SshResult>((resolve, reject) => {
    conn.shell((err, stream) => {
      if (err) return reject(err);

      let stdout = "";
      let stderr = "";
      let commandSent = false;
      let finished = false;

      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        const cleanStdout = stdout
          .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")
          .replace(/--More--\s*/g, "")
          .replace(/-- More --\s*/g, "")
          .replace(/\x08+\s*\x08*/g, "");
        resolve({ stdout: cleanStdout, stderr, code: 0 });
      };

      const timeout = setTimeout(finish, commandTimeout);

      const isComplete = (): boolean => {
        if (!commandSent) return false;
        const clean = stdout.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
        const lines = clean.trim().split("\n");
        const last = (lines[lines.length - 1] || lines[lines.length - 2] || "").trim();
        if (last.length < 80 && last.length > 0) {
          if (last.endsWith("#") || last.endsWith("# ") || last.endsWith(">") || last.endsWith("> ")) return true;
          if (last.match(/^<[^>]+>$/)) return true;
          if (last.match(/^\[[^\]]+\]$/)) return true;
        }
        return false;
      };

      stream.on("data", (data: Buffer) => {
        stdout += data.toString();
        if (!commandSent) return;
        if (isComplete()) finish();
      });
      stream.stderr?.on("data", (data: Buffer) => { stderr += data.toString(); });
      stream.on("close", () => finish());

      setTimeout(() => {
        if (!commandSent) {
          commandSent = true;
          stream.write(command + "\n");
        }
      }, 800);
    });
  }));
}
