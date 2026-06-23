/**
 * Esecuzione comandi WinRM tramite pywinrm (Python subprocess).
 *
 * Catena di trasporto: Kerberos → NTLM → CredSSP → Basic
 * - Kerberos: auto-kinit con credenziali + auto-setup krb5.conf dal realm AD
 * - NTLM: SPNEGO session encryption via pyspnego + requests-ntlm
 * - CredSSP: fallback se NTLM rifiutato
 * - Basic: ultimo tentativo (richiede AllowUnencrypted=true)
 */

import { execFile } from "child_process";
import path from "path";

import { checkWinrmReachability } from "./tcp-precheck";
import { classifyWinrmError, formatWinrmError, type WinrmErrorCode } from "./winrm-errors";
import { findBridgePython } from "./find-bridge-python";

const TIMEOUT_MS = 120_000;
const TCP_PRECHECK_TIMEOUT_MS = 3000;

/**
 * Errore WinRM strutturato. Il chiamante può ispezionare `.code` per decidere
 * se vale la pena attivare un fallback (es. WMI su 135) o se è inutile (auth
 * fallita = stesse credenziali falliranno anche su WMI).
 */
export class WinrmError extends Error {
  code: WinrmErrorCode;
  hint?: string;
  transport?: string;
  original?: string;
  constructor(info: { code: WinrmErrorCode; message: string; hint?: string; transport?: string; original?: string }) {
    super(formatWinrmError(info));
    this.name = "WinrmError";
    this.code = info.code;
    this.hint = info.hint;
    this.transport = info.transport;
    this.original = info.original;
  }
}
const BRIDGE_SCRIPT = path.resolve(
  process.cwd(),
  "src/lib/devices/winrm-bridge.py"
);

/**
 * Esegue un comando su un host Windows tramite WinRM.
 * @param realm - Dominio AD (es. "azienda.local") per Kerberos auto-kinit. Opzionale.
 */
export async function runWinrmCommand(
  host: string,
  port: number,
  username: string,
  password: string,
  command: string,
  usePowershell: boolean,
  realm?: string
): Promise<string> {
  // Pre-check TCP: se le porte WinRM non rispondono, evitiamo i 120s di pywinrm
  // e restituiamo subito una WinrmError classificata. Test entrambe le porte
  // (5985 HTTP e 5986 HTTPS) in parallelo, 3s di timeout: ~3s totali invece di 120s.
  const reach = await checkWinrmReachability(host, TCP_PRECHECK_TIMEOUT_MS);
  if (!reach.reachable) {
    if (reach.summary === "closed") {
      throw new WinrmError({
        code: "TCP_CLOSED",
        message: `Porte WinRM 5985/5986 chiuse su ${host} (RST).`,
        hint: "Sul target Windows (PowerShell admin): winrm quickconfig -force ; verifica regola firewall 'Windows Remote Management (HTTP-In)' su tutti i profili.",
        original: JSON.stringify(reach.results),
      });
    }
    if (reach.summary === "timeout") {
      throw new WinrmError({
        code: "TCP_TIMEOUT",
        message: `Nessuna risposta TCP da ${host} su 5985/5986 (firewall drop o host irraggiungibile).`,
        hint: "Conferma ping OK, regola firewall attiva anche su profilo Public, network profile non Public se policy lo blocca.",
        original: JSON.stringify(reach.results),
      });
    }
    throw new WinrmError({
      code: "TCP_TIMEOUT",
      message: `Porte WinRM non disponibili su ${host} (stato misto: ${reach.results.map(r => `${r.port}=${r.state}`).join(", ")}).`,
      original: JSON.stringify(reach.results),
    });
  }

  return new Promise((resolve, reject) => {
    const pythonBin = findBridgePython();
    // R1 2026-06-23: WinRM con local-admin NON-builtin richiede il prefisso '.\'
    // (LocalAccountTokenFilterPolicy) per ottenere un token elevato; senza, 401
    // → l'host Windows contribuiva VUOTO ma lo scan risultava "ok". Prefissiamo
    // '.\' SOLO a username "bare": niente per UPN (user@dominio), DOMAIN\user, o
    // se c'è un realm Kerberos (login di dominio).
    const authUser = (!username.includes("\\") && !username.includes("@") && !(realm && realm.trim()))
      ? `.\\${username}`
      : username;
    const input = JSON.stringify({
      host, port, username: authUser, password, command, usePowershell,
      realm: realm || "",
    });

    const child = execFile(
      pythonBin,
      [BRIDGE_SCRIPT],
      { timeout: TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024, encoding: "utf-8" },
      (error, stdout, _stderr) => {
        if (error && !stdout) {
          const msg = error.message || "Errore esecuzione WinRM bridge";
          if (msg.includes("ENOENT")) {
            reject(new WinrmError({
              code: "PYWINRM_MISSING",
              message: `Python non trovato: ${pythonBin}.`,
              hint: "Esegui scripts/install.sh oppure rebuild immagine Docker (deploy/docker/setup-winrm-venv.sh).",
              original: msg,
            }));
          } else if (msg.includes("ETIMEDOUT") || msg.includes("timeout") || error.killed) {
            reject(new WinrmError({
              code: "BRIDGE_TIMEOUT",
              message: `Il bridge WinRM ha superato i ${Math.round(TIMEOUT_MS / 1000)}s — il target è raggiungibile in TCP ma non completa la sessione (auth lentissima o config WinRM rotta).`,
              hint: "Sul target: winrm enumerate winrm/config/Listener ; verifica che il servizio WinRM non sia bloccato in MaxConcurrentOperations.",
              original: msg,
            }));
          } else {
            reject(new WinrmError({ ...classifyWinrmError(msg), original: msg }));
          }
          return;
        }

        try {
          const result = JSON.parse(stdout.trim());
          if (result.error) {
            // Il bridge Python emette errorCode esplicito da v0.2.560+. Se presente,
            // fidati di quello (più affidabile del fingerprint sul testo italiano);
            // altrimenti retrocompat via classifier.
            const fallback = classifyWinrmError(String(result.error));
            const explicitCode = typeof result.errorCode === "string" && result.errorCode
              ? (result.errorCode as WinrmErrorCode)
              : fallback.code;
            reject(new WinrmError({
              code: explicitCode,
              message: fallback.message,
              hint: fallback.hint,
              transport: typeof result.transport === "string" ? result.transport : fallback.transport,
              original: String(result.error),
            }));
            return;
          }

          const bridgeStdout = (result.stdout || "").trim();
          const bridgeStderr = (result.stderr || "").trim();

          // stderr NON è output valido: messaggi come "bad command name
          // hostname (line 1 column 1)" arrivano in stderr quando il PowerShell
          // remoto (Constrained Language / vecchia versione) rifiuta il
          // cmdlet. Mai passare stderr al chiamante come fosse stdout — è la
          // causa storica di hostname corrotti in DB.
          if (!bridgeStdout && bridgeStderr) {
            reject(new WinrmError({
              code: "WSMAN_FAULT",
              message: `WinRM ha risposto solo su stderr: ${bridgeStderr.slice(0, 200)}`,
              hint: "PowerShell remoto in Constrained Language o cmdlet non disponibile. Verifica versione PS sul target.",
              original: bridgeStderr,
            }));
            return;
          }

          resolve(bridgeStdout);
        } catch {
          reject(new WinrmError({
            code: "UNKNOWN",
            message: `Output non valido dal bridge WinRM: ${stdout.substring(0, 200)}`,
            original: stdout,
          }));
        }
      }
    );

    child.stdin?.write(input);
    child.stdin?.end();
  });
}
