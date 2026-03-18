/**
 * Helper SSH per esecuzione comandi su dispositivi di rete.
 * Usa exec per dispositivi che lo supportano (MikroTik, Cisco, ecc.),
 * shell interattiva per HP ProCurve/Comware che richiedono gestione paginazione/prompt.
 */

export interface SshOptions {
  host: string;
  port?: number;
  username: string;
  password: string;
  timeout?: number;
}

export interface SshResult {
  stdout: string;
  stderr: string;
  code: number;
}

export async function sshExec(options: SshOptions, command: string): Promise<SshResult> {
  const { Client } = await import("ssh2");

  return new Promise((resolve, reject) => {
    const conn = new Client();
    let stdout = "";
    let stderr = "";

    conn.on("ready", () => {
      conn.exec(command, (err, stream) => {
        if (err) {
          conn.end();
          return reject(err);
        }
        stream.on("data", (data: Buffer) => { stdout += data.toString(); });
        stream.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });
        stream.on("close", (code: number) => {
          conn.end();
          resolve({ stdout, stderr, code });
        });
      });
    });
    conn.on("error", reject);
    conn.connect({
      host: options.host,
      port: options.port ?? 22,
      username: options.username,
      password: options.password,
      readyTimeout: options.timeout ?? 10000,
      algorithms: {
        kex: ["diffie-hellman-group14-sha256", "diffie-hellman-group14-sha1", "diffie-hellman-group-exchange-sha256"],
      },
    });
  });
}

/**
 * Esegue comando via shell interattiva per dispositivi che non supportano exec
 * (es. HP ProCurve, Aruba, HP Comware). Gestisce paginazione "--More--" e prompt.
 */
export async function sshExecViaShell(options: SshOptions, command: string): Promise<SshResult> {
  const { Client } = await import("ssh2");

  return new Promise((resolve, reject) => {
    const conn = new Client();
    let stdout = "";
    let stderr = "";
    let commandSent = false;
    const commandTimeout = options.timeout ?? 45000;

    conn.on("ready", () => {
      conn.shell((err, stream) => {
        if (err) {
          conn.end();
          return reject(err);
        }

        let finished = false;
        const finish = () => {
          if (finished) return;
          finished = true;
          clearTimeout(timeout);
          conn.end();
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
    });
    conn.on("error", reject);
    conn.connect({
      host: options.host,
      port: options.port ?? 22,
      username: options.username,
      password: options.password,
      readyTimeout: 10000,
      algorithms: {
        kex: ["diffie-hellman-group14-sha256", "diffie-hellman-group14-sha1", "diffie-hellman-group-exchange-sha256"],
      },
    });
  });
}
