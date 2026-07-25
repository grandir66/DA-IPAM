/**
 * Optional Naabu TCP pre-pass wrapper.
 * Fail-soft: missing binary / spawn errors → empty Map / false (never throw).
 */
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/** Level-1 TCP hint ports (UDP stays with nmap). */
export const DEFAULT_NAABU_PORTS = "22,80,443,445,3389,161,554,623,9100";

const DEFAULT_BIN = "naabu";
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_RATE = 1000;

export type NaabuPortHit = { ip: string; port: number };

export function parseNaabuJsonLine(line: string): NaabuPortHit | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const obj = JSON.parse(trimmed) as Record<string, unknown>;
    const ip =
      typeof obj.ip === "string"
        ? obj.ip
        : typeof obj.host === "string"
          ? obj.host
          : null;
    const portRaw = obj.port;
    const port =
      typeof portRaw === "number"
        ? portRaw
        : typeof portRaw === "string"
          ? Number(portRaw)
          : NaN;
    if (!ip || !Number.isFinite(port) || port <= 0) return null;
    return { ip, port: Math.trunc(port) };
  } catch {
    return null;
  }
}

export function mergeNaabuPortMap(hits: NaabuPortHit[]): Map<string, number[]> {
  const map = new Map<string, Set<number>>();
  for (const { ip, port } of hits) {
    let set = map.get(ip);
    if (!set) {
      set = new Set();
      map.set(ip, set);
    }
    set.add(port);
  }
  const out = new Map<string, number[]>();
  for (const [ip, set] of map) {
    out.set(ip, [...set].sort((a, b) => a - b));
  }
  return out;
}

export async function isNaabuAvailable(binPath?: string): Promise<boolean> {
  const bin = binPath?.trim() || DEFAULT_BIN;
  try {
    await execFileAsync(bin, ["-version"], { timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

export async function runNaabuTcpPorts(
  targets: string[],
  opts?: {
    binPath?: string;
    ports?: string;
    rate?: number;
    timeoutMs?: number;
  }
): Promise<Map<string, number[]>> {
  const hosts = targets.map((t) => t.trim()).filter(Boolean);
  if (hosts.length === 0) return new Map();

  const bin = opts?.binPath?.trim() || DEFAULT_BIN;
  const ports = opts?.ports?.trim() || DEFAULT_NAABU_PORTS;
  const rate = opts?.rate ?? DEFAULT_RATE;
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const args = [
    "-host",
    hosts.join(","),
    "-p",
    ports,
    "-rate",
    String(rate),
    "-json",
    "-silent",
  ];

  try {
    const { stdout } = await execFileAsync(bin, args, {
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
    });
    const hits: NaabuPortHit[] = [];
    for (const line of stdout.split(/\r?\n/)) {
      const hit = parseNaabuJsonLine(line);
      if (hit) hits.push(hit);
    }
    return mergeNaabuPortMap(hits);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`[naabu] unavailable or failed, fallback nmap: ${msg.slice(0, 120)}`);
    return new Map();
  }
}
