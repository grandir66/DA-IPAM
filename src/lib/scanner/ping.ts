import { execFile } from "child_process";
import { promisify } from "util";
import type { PingResult } from "@/types";

const execFileAsync = promisify(execFile);

export type EsitoPing = "vivo" | "nessuna_risposta" | "sconosciuto";

/**
 * Classifica l'esito di un `ping -c 1` dall'errore di `execFile` (T3-19, INV-2).
 * Funzione pura: la piattaforma è un argomento, così le prove coprono Linux e
 * macOS da qualunque macchina.
 *
 * - nessun errore → vivo;
 * - processo terminato per timeout (`killed`/segnale) → nessuna risposta;
 * - Linux (iputils): exit 1 = nessuna risposta, exit 2 = errore → sconosciuto;
 * - macOS: exit 2 = nessuna risposta, altri codici (sysexits) → sconosciuto;
 * - spawn fallito (ENOENT, EACCES, …) o forma non riconosciuta → sconosciuto.
 *
 * «Sconosciuto» non è «host spento»: il chiamante non deve usarlo per marcare
 * offline.
 */
export function classifyPingError(
  err: unknown,
  platform: NodeJS.Platform,
): { esito: EsitoPing; errore?: string } {
  if (err == null) return { esito: "vivo" };
  if (typeof err !== "object") return { esito: "sconosciuto", errore: "ping: errore non riconosciuto" };
  const e = err as { code?: unknown; killed?: unknown; signal?: unknown };
  if (e.killed === true || (typeof e.signal === "string" && e.signal.length > 0)) {
    return { esito: "nessuna_risposta" };
  }
  if (typeof e.code === "string") {
    return { esito: "sconosciuto", errore: `ping non eseguibile (${e.code})` };
  }
  if (typeof e.code === "number") {
    const nessunaRisposta = platform === "darwin" ? e.code === 2 : e.code === 1;
    if (nessunaRisposta) return { esito: "nessuna_risposta" };
    return { esito: "sconosciuto", errore: `ping uscito con codice ${e.code}` };
  }
  return { esito: "sconosciuto", errore: "ping: errore non riconosciuto" };
}

export async function pingHost(ip: string, timeoutMs: number = 2000): Promise<PingResult> {
  const timeoutSec = Math.ceil(timeoutMs / 1000);
  const startTime = Date.now();

  try {
    // macOS uses -W (ms), Linux uses -W (seconds)
    const isMac = process.platform === "darwin";
    const args = isMac
      ? ["-c", "1", "-W", String(timeoutMs), ip]
      : ["-c", "1", "-W", String(timeoutSec), ip];

    const { stdout, stderr } = await execFileAsync("ping", args, {
      timeout: timeoutMs + 1000,
      encoding: "utf8",
    });
    const latency = Date.now() - startTime;
    const combined = `${stdout}\n${stderr}`;
    const ttlMatch = combined.match(/ttl[=\s]+(\d+)/i);
    const ttl = ttlMatch ? parseInt(ttlMatch[1], 10) : null;

    return { ip, alive: true, latency_ms: latency, ttl };
  } catch (err) {
    const { esito, errore } = classifyPingError(err, process.platform);
    if (esito === "sconosciuto") {
      return { ip, alive: false, latency_ms: null, ttl: null, error: errore ?? "ping: esito sconosciuto" };
    }
    return { ip, alive: false, latency_ms: null, ttl: null };
  }
}

export async function pingSweep(
  ips: string[],
  concurrency: number = 50,
  onProgress?: (scanned: number, found: number) => void
): Promise<PingResult[]> {
  const results: PingResult[] = [];
  let active = 0;
  let index = 0;
  let found = 0;

  return new Promise((resolve) => {
    function next() {
      while (active < concurrency && index < ips.length) {
        const currentIndex = index++;
        active++;

        pingHost(ips[currentIndex]).catch((): PingResult => ({
          ip: ips[currentIndex], alive: false, latency_ms: null, error: "ping: errore inatteso",
        })).then((result) => {
          results.push(result);
          active--;
          if (result.alive) found++;
          onProgress?.(results.length, found);

          if (results.length === ips.length) {
            resolve(results);
          } else {
            next();
          }
        });
      }
    }

    if (ips.length === 0) {
      resolve([]);
    } else {
      next();
    }
  });
}
