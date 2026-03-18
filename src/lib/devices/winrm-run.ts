/**
 * Esecuzione comandi WinRM tramite pywinrm (Python subprocess).
 *
 * WinRM su HTTP richiede SPNEGO session encryption (NTLM + message sealing)
 * che pywinrm gestisce nativamente. Il bridge Python è in winrm-bridge.py.
 */

import { execFile } from "child_process";
import path from "path";

const TIMEOUT_MS = 120_000;
const BRIDGE_SCRIPT = path.resolve(
  process.cwd(),
  "src/lib/devices/winrm-bridge.py"
);

function findPython(): string {
  if (process.env.WINRM_PYTHON) return process.env.WINRM_PYTHON;
  const fs = require("fs");
  const cwd = process.cwd();
  const home = process.env.HOME || "/root";
  const candidates = [
    path.join(home, ".da-invent-venv", "bin", "python3"),
    path.join(home, ".da-inventory-venv", "bin", "python3"),
    path.join(home, ".da-ipam-venv", "bin", "python3"),
    path.join(cwd, ".venv", "bin", "python3"),
    "/opt/dadude-agent/venv/bin/python3",
    "/usr/bin/python3",
  ];
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch {}
  }
  return "python3";
}

export function runWinrmCommand(
  host: string,
  port: number,
  username: string,
  password: string,
  command: string,
  usePowershell: boolean
): Promise<string> {
  return new Promise((resolve, reject) => {
    const pythonBin = findPython();
    const input = JSON.stringify({ host, port, username, password, command, usePowershell });

    const child = execFile(
      pythonBin,
      [BRIDGE_SCRIPT],
      { timeout: TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024, encoding: "utf-8" },
      (error, stdout, stderr) => {
        if (error && !stdout) {
          const msg = error.message || "Errore esecuzione WinRM bridge";
          if (msg.includes("ENOENT")) {
            reject(new Error(`Python non trovato: ${pythonBin}. Installa pywinrm: python3 -m pip install pywinrm requests-ntlm`));
          } else if (msg.includes("ETIMEDOUT") || msg.includes("timeout") || error.killed) {
            reject(new Error("Timeout: il dispositivo non ha risposto."));
          } else {
            reject(new Error(msg));
          }
          return;
        }

        try {
          const result = JSON.parse(stdout.trim());
          if (result.error) {
            reject(new Error(result.error));
            return;
          }

          const bridgeStdout = (result.stdout || "").trim();
          const bridgeStderr = (result.stderr || "").trim();
          const output = bridgeStdout || bridgeStderr;

          resolve(output);
        } catch {
          reject(new Error(`Output non valido dal bridge WinRM: ${stdout.substring(0, 200)}`));
        }
      }
    );

    child.stdin?.write(input);
    child.stdin?.end();
  });
}
