/**
 * Accesso alla CLI Ubiquiti/UniFi via SSH.
 * Il percorso dipende dal modello:
 * - Alcuni: "cli" → prompt → "enable" → prompt # (comandi quasi standard)
 * - Altri: "telnet 127.0.0.1" → prompt (UBNT) > → "enable" → (UBNT) #
 */

import type { SshOptions } from "./ssh-helper";

const UBNT_PROMPT_RE = /\(UBNT\)\s*[#>]/;
const UBNT_HASH_RE = /\(UBNT\)\s*#/;
/** Prompt CLI generico (alcuni modelli mostrano > o # senza prefisso UBNT) */
const CLI_PROMPT_RE = /\(UBNT\)\s*[#>]|^\s*[#>]\s*$|^\S+\s*[#>]\s*$/m;
const SHELL_READY_RE = /\$ |# |Enter 'help'|BusyBox|built-in shell/;
const NOT_FOUND_RE = /not found|command not found|No such file|: not found/i;

function cleanOutput(s: string): string {
  return s
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

/**
 * Esegue un comando sulla CLI Ubiquiti.
 * Prova prima "cli" + "enable" (alcuni modelli), poi "telnet 127.0.0.1" + "enable" se cli non esiste.
 */
export async function unifiCliExec(
  options: SshOptions,
  command: string,
  timeoutMs = 30000
): Promise<string> {
  const { Client } = await import("ssh2");

  return new Promise((resolve, reject) => {
    const conn = new Client();
    let buffer = "";
    let step = 0;
    const commandTimeout = timeoutMs;

    conn.on("ready", () => {
      conn.shell((err, stream) => {
        if (err) {
          conn.end();
          return reject(err);
        }

        let finished = false;
        const finish = (result: string) => {
          if (finished) return;
          finished = true;
          clearTimeout(timeout);
          conn.end();
          resolve(cleanOutput(result));
        };

        const timeout = setTimeout(() => finish(buffer), commandTimeout);

        const send = (data: string) => {
          stream.write(data + "\n");
        };

        stream.on("data", (data: Buffer) => {
          buffer += data.toString();
          const clean = cleanOutput(buffer);

          if (step === 0 && (SHELL_READY_RE.test(clean) || clean.length > 80)) {
            step = 1;
            setTimeout(() => send("cli"), 400);
          } else if (step === 1) {
            if (CLI_PROMPT_RE.test(clean) || UBNT_PROMPT_RE.test(clean)) {
              step = 2;
              setTimeout(() => send("enable"), 250);
            } else if (NOT_FOUND_RE.test(clean)) {
              setTimeout(() => send("telnet 127.0.0.1"), 300);
            }
          } else if (step === 2 && (UBNT_HASH_RE.test(clean) || /#\s*$/.test(clean))) {
            step = 3;
            setTimeout(() => send("terminal length 0"), 200);
          } else if (step === 3 && (UBNT_HASH_RE.test(clean) || /#\s*$/.test(clean))) {
            step = 4;
            setTimeout(() => send(command), 200);
          } else if (step === 4) {
            const cmdFirst = command.split("\n")[0].trim();
            const hashPrompt = UBNT_HASH_RE.test(clean) || /#\s*$/.test(clean);
            if (clean.includes(cmdFirst) && hashPrompt) {
              const lines = clean.split("\n");
              const startIdx = lines.findIndex((l) => l.includes(cmdFirst));
              const afterCmd = lines.slice(startIdx + 1);
              const endIdx = afterCmd.findIndex((l) => UBNT_HASH_RE.test(l) || /#\s*$/.test(l));
              const outLines = endIdx >= 0 ? afterCmd.slice(0, endIdx) : afterCmd;
              const output = outLines
                .join("\n")
                .replace(/--More--\s*/g, "")
                .replace(/^\s+|\s+$/g, "");
              finish(output);
            }
          }
        });
        stream.stderr?.on("data", (data: Buffer) => { buffer += data.toString(); });
        stream.on("close", () => { if (!finished) finish(buffer); });
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
        kex: ["curve25519-sha256", "curve25519-sha256@libssh.org", "ecdh-sha2-nistp256", "ecdh-sha2-nistp384", "ecdh-sha2-nistp521", "diffie-hellman-group-exchange-sha256", "diffie-hellman-group14-sha256", "diffie-hellman-group14-sha1"],
      },
    });
  });
}
