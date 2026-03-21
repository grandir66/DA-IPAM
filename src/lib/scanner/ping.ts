import { execFile } from "child_process";
import { promisify } from "util";
import type { PingResult } from "@/types";

const execFileAsync = promisify(execFile);

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
  } catch {
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

        pingHost(ips[currentIndex]).then((result) => {
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
