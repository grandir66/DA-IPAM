/**
 * Esecuzione query WMI/DCOM via impacket (Python subprocess).
 *
 * Fallback usato quando WinRM su 5985/5986 non è raggiungibile. Trasporto su
 * porta 135 (RPC endpoint mapper) + porte dinamiche RPC. Auth NTLM via
 * username/password.
 *
 * Limitazioni vs WinRM: solo WQL su Win32_* / SecurityCenter2 — niente registry,
 * niente DirectorySearcher AD, niente script PowerShell.
 */

import { execFile } from "child_process";
import path from "path";

import { probeTcpPort } from "./tcp-precheck";
import { formatWinrmError, type WinrmErrorCode } from "./winrm-errors";
import { findBridgePython } from "./find-bridge-python";

const TIMEOUT_MS = 90_000;
const TCP_PRECHECK_TIMEOUT_MS = 3000;
const BRIDGE_SCRIPT = path.resolve(process.cwd(), "src/lib/devices/wmi-bridge.py");

export class WmiError extends Error {
  code: WinrmErrorCode;
  hint?: string;
  original?: string;
  constructor(info: { code: WinrmErrorCode; message: string; hint?: string; original?: string }) {
    super(formatWinrmError(info));
    this.name = "WmiError";
    this.code = info.code;
    this.hint = info.hint;
    this.original = info.original;
  }
}

export interface WmiProbeData {
  // Stessa shape del Record<string, unknown> prodotto dallo script PowerShell
  // — sottoinsieme. I campi mancanti rispetto a WinRM:
  // installed_software_count, key_software, user_profiles, logged_on_users,
  // server_roles, license_*, last_logged_on_user (registry).
  [key: string]: unknown;
  _probe_transport?: "wmi/dcom";
}

/**
 * Esegue la batteria di query WMI sul target Windows.
 * Pre-controlla la porta 135 (RPC). Se chiusa/timeout, ritorna subito WmiError.
 */
export async function runWmiProbe(
  host: string,
  username: string,
  password: string,
): Promise<WmiProbeData> {
  const probe = await probeTcpPort(host, 135, TCP_PRECHECK_TIMEOUT_MS);
  if (probe.state !== "open") {
    const code: WinrmErrorCode = probe.state === "refused" ? "TCP_CLOSED" : "TCP_TIMEOUT";
    throw new WmiError({
      code,
      message: `Porta RPC 135 non disponibile su ${host} (${probe.state}). WMI fallback non possibile.`,
      hint: probe.state === "refused"
        ? "Sul target: verifica che il servizio 'Remote Procedure Call (RPC)' sia avviato e che il firewall permetta in ingresso 'Windows Management Instrumentation (WMI-In)'."
        : "Firewall sta droppando i pacchetti RPC — verifica regole per il profilo di rete attivo.",
      original: JSON.stringify(probe),
    });
  }

  return new Promise((resolve, reject) => {
    const pythonBin = findBridgePython();
    const input = JSON.stringify({ host, username, password });

    const child = execFile(
      pythonBin,
      [BRIDGE_SCRIPT],
      { timeout: TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024, encoding: "utf-8" },
      (error, stdout, _stderr) => {
        if (error && !stdout) {
          const msg = error.message || "Errore esecuzione WMI bridge";
          if (msg.includes("ENOENT")) {
            reject(new WmiError({
              code: "PYWINRM_MISSING",
              message: `Python non trovato: ${pythonBin}.`,
              hint: "Esegui scripts/install.sh oppure: ~/.da-invent-venv/bin/pip install impacket",
              original: msg,
            }));
          } else if (msg.includes("ETIMEDOUT") || error.killed) {
            reject(new WmiError({
              code: "BRIDGE_TIMEOUT",
              message: `Il bridge WMI ha superato i ${Math.round(TIMEOUT_MS / 1000)}s.`,
              original: msg,
            }));
          } else {
            reject(new WmiError({ code: "UNKNOWN", message: msg, original: msg }));
          }
          return;
        }

        try {
          const parsed = JSON.parse(stdout.trim());
          if (parsed.error) {
            const code = (typeof parsed.errorCode === "string" ? parsed.errorCode : "UNKNOWN") as WinrmErrorCode;
            reject(new WmiError({
              code,
              message: String(parsed.error),
              original: String(parsed.error),
            }));
            return;
          }
          const data = (parsed.data && typeof parsed.data === "object") ? parsed.data as WmiProbeData : {};
          resolve(data);
        } catch {
          reject(new WmiError({
            code: "UNKNOWN",
            message: `Output non valido dal bridge WMI: ${stdout.substring(0, 200)}`,
            original: stdout,
          }));
        }
      }
    );

    child.stdin?.write(input);
    child.stdin?.end();
  });
}
