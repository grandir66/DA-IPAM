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

import { execFile, type ExecFileException, type ExecFileOptionsWithStringEncoding } from "child_process";

import { probeTcpPort, type TcpProbeResult } from "./tcp-precheck";
import { formatWinrmError, type WinrmErrorCode } from "./winrm-errors";
import { findBridgePython } from "./find-bridge-python";
import { risolvi } from "../percorsi";

const TIMEOUT_MS = 90_000;
const TCP_PRECHECK_TIMEOUT_MS = 3000;
const BRIDGE_SCRIPT = risolvi(process.cwd(), "src/lib/devices/wmi-bridge.py");

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

/** Tetto della prova leggera di identità: una macchina che non risponde non ferma la scansione. */
const TIMEOUT_IDENTITA_MS = 20_000;

export type OpzioniExecFile = ExecFileOptionsWithStringEncoding;

/**
 * Punti di ingresso sostituibili dalle prove: `execFile`, il controllo della 135 e la ricerca di Python.
 * In produzione valgono sempre `DIPENDENZE_REALI`; nessuna firma pubblica esistente li richiede.
 */
export interface DipendenzeWmi {
  execFile: (
    file: string,
    args: readonly string[],
    opts: OpzioniExecFile,
    cb: (error: ExecFileException | null, stdout: string, stderr: string) => void,
  ) => { stdin: { write(chunk: string): unknown; end(): unknown } | null };
  probeTcpPort: (host: string, port: number, timeoutMs?: number) => Promise<TcpProbeResult>;
  trovaPython: () => string;
}

const DIPENDENZE_REALI: DipendenzeWmi = {
  execFile: (file, args, opts, cb) => execFile(file, [...args], opts, cb),
  probeTcpPort,
  trovaPython: findBridgePython,
};

export interface WmiIdentita {
  hostname: string;
  dominio: string | null;
}

/** Controlla la porta RPC 135: se non è aperta, WmiError subito (TCP_CLOSED / TCP_TIMEOUT). */
async function controllaPorta135(host: string, deps: DipendenzeWmi): Promise<void> {
  const probe = await deps.probeTcpPort(host, 135, TCP_PRECHECK_TIMEOUT_MS);
  if (probe.state === "open") return;
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

/**
 * Lancia il bridge Python passando l'input (password compresa) su stdin e ritorna il campo `data` della risposta.
 * `timeoutMs` è il tetto: allo scadere execFile uccide il processo e l'errore è `BRIDGE_TIMEOUT`.
 */
export function eseguiBridge(
  input: Record<string, unknown>,
  timeoutMs: number,
  deps: DipendenzeWmi = DIPENDENZE_REALI,
): Promise<WmiProbeData> {
  return new Promise((resolve, reject) => {
    const pythonBin = deps.trovaPython();

    const child = deps.execFile(
      pythonBin,
      [BRIDGE_SCRIPT],
      { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024, encoding: "utf-8" },
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
              message: `Il bridge WMI ha superato i ${Math.round(timeoutMs / 1000)}s.`,
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

    child.stdin?.write(JSON.stringify(input));
    child.stdin?.end();
  });
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
  await controllaPorta135(host, DIPENDENZE_REALI);
  return eseguiBridge({ host, username, password }, TIMEOUT_MS);
}

/**
 * Prova leggera: una sola query su Win32_ComputerSystem (nome e dominio), tetto di 20 secondi.
 * Serve al motore di scansione per sapere se l'account entra, senza il peso della batteria completa.
 * Solo lettura. Password solo su stdin.
 */
export async function runWmiIdentita(
  host: string,
  username: string,
  password: string,
  deps: DipendenzeWmi = DIPENDENZE_REALI,
): Promise<WmiIdentita> {
  await controllaPorta135(host, deps);
  const data = await eseguiBridge({ host, username, password, solo_identita: true }, TIMEOUT_IDENTITA_MS, deps);
  const hostname = typeof data.hostname === "string" ? data.hostname.trim() : "";
  if (!hostname) {
    throw new WmiError({
      code: "UNKNOWN",
      message: `Il bridge WMI non ha restituito il nome di ${host}.`,
      original: JSON.stringify(data),
    });
  }
  const dominio = typeof data.domain === "string" && data.domain.trim() ? data.domain.trim() : null;
  return { hostname, dominio };
}
