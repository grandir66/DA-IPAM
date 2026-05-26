/**
 * TCP pre-check veloce.
 *
 * Risolve il problema "pywinrm va in timeout 120s per host irraggiungibile":
 * facciamo una connect() su una o più porte con timeout breve, e se nessuna
 * risponde restituiamo subito una classificazione (TCP_CLOSED / TCP_TIMEOUT)
 * senza buttare via 2 minuti per ogni device.
 */

import net from "net";

export type TcpProbeResult =
  | { state: "open"; port: number; rttMs: number }
  | { state: "refused"; port: number; rttMs: number }
  | { state: "timeout"; port: number; rttMs: number }
  | { state: "error"; port: number; error: string; rttMs: number };

/**
 * Prova una singola porta TCP. Non lancia: ritorna sempre un risultato.
 */
export function probeTcpPort(host: string, port: number, timeoutMs = 3000): Promise<TcpProbeResult> {
  return new Promise((resolve) => {
    const start = Date.now();
    const socket = new net.Socket();
    let settled = false;

    const finish = (result: TcpProbeResult) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch { /* noop */ }
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => {
      finish({ state: "open", port, rttMs: Date.now() - start });
    });
    socket.once("timeout", () => {
      finish({ state: "timeout", port, rttMs: Date.now() - start });
    });
    socket.once("error", (err: NodeJS.ErrnoException) => {
      // ECONNREFUSED = RST esplicito = porta chiusa con stack TCP raggiungibile
      // EHOSTUNREACH / ENETUNREACH = routing rotto
      // EAI_AGAIN / ENOTFOUND = DNS
      if (err.code === "ECONNREFUSED") {
        finish({ state: "refused", port, rttMs: Date.now() - start });
      } else {
        finish({ state: "error", port, error: err.code || err.message, rttMs: Date.now() - start });
      }
    });

    try {
      socket.connect(port, host);
    } catch (e) {
      finish({ state: "error", port, error: String(e), rttMs: Date.now() - start });
    }
  });
}

/**
 * Prova più porte in parallelo. Restituisce tutti i risultati nell'ordine richiesto.
 */
export async function probeTcpPorts(host: string, ports: number[], timeoutMs = 3000): Promise<TcpProbeResult[]> {
  return Promise.all(ports.map((p) => probeTcpPort(host, p, timeoutMs)));
}

/**
 * Sintesi delle porte WinRM (5985 HTTP, 5986 HTTPS):
 * - `open`: almeno una porta in ascolto
 * - `closed`: tutte le porte hanno restituito RST (host vivo, servizio non attivo)
 * - `timeout`: nessuna risposta TCP (firewall drop o host down)
 * - `mixed`: combinazione (raro: ad es. 5986 chiusa, 5985 timeout)
 */
export interface WinrmReachability {
  reachable: boolean;
  summary: "open" | "closed" | "timeout" | "mixed";
  results: TcpProbeResult[];
}

export async function checkWinrmReachability(host: string, timeoutMs = 3000): Promise<WinrmReachability> {
  const results = await probeTcpPorts(host, [5985, 5986], timeoutMs);
  const anyOpen = results.some((r) => r.state === "open");
  const allRefused = results.every((r) => r.state === "refused");
  const allTimeout = results.every((r) => r.state === "timeout");

  if (anyOpen) return { reachable: true, summary: "open", results };
  if (allRefused) return { reachable: false, summary: "closed", results };
  if (allTimeout) return { reachable: false, summary: "timeout", results };
  return { reachable: false, summary: "mixed", results };
}
