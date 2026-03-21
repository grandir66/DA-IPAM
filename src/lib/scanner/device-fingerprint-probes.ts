/**
 * Probe attivi per fingerprinting (HTTP/HTTPS, banner SSH, SMB opzionale).
 * Timeout brevi, max 5 host in parallelo gestito dal chiamante.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import http from "http";
import https from "https";
import net from "net";

const execFileAsync = promisify(execFile);

/** URL limitati (4× timeout = troppo lento su scan Nmap con molti host). */
function buildHttpProbeUrls(ip: string): string[] {
  return [`http://${ip}`, `https://${ip}`];
}

function httpProbeTimeoutMs(): number {
  const n = parseInt(process.env.DA_INVENT_FINGERPRINT_HTTP_TIMEOUT_MS || "2200", 10);
  return Math.min(8000, Math.max(800, Number.isNaN(n) ? 2200 : n));
}

function sshProbeTimeoutMs(): number {
  const n = parseInt(process.env.DA_INVENT_FINGERPRINT_SSH_TIMEOUT_MS || "2200", 10);
  return Math.min(8000, Math.max(800, Number.isNaN(n) ? 2200 : n));
}

function smbProbeTimeoutMs(): number {
  const n = parseInt(process.env.DA_INVENT_FINGERPRINT_SMB_TIMEOUT_MS || "4500", 10);
  return Math.min(8000, Math.max(1500, Number.isNaN(n) ? 4500 : n));
}

export interface HttpProbeResult {
  url: string;
  server: string | null;
  title: string | null;
  snippet: string;
}

function stripHtmlTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m ? m[1].trim().slice(0, 200) : null;
}

function extractKeywords(text: string): string[] {
  const lower = text.toLowerCase();
  const keys = [
    "proxmox",
    "pve",
    "synology",
    "diskstation",
    "qnap",
    "qts",
    "unifi",
    "ubiquiti",
    "ubnt",
    "routeros",
    "mikrotik",
    "vmware",
    "esxi",
    "vsphere",
    "hikvision",
    "dahua",
    "truenas",
    "pfsense",
    "opnsense",
    "ilo",
    "integrated",
    "stormshield",
    "zabbix",
    "wazuh",
    "asterisk",
    "3cx",
    "jetdirect",
    "aruba",
    "procurve",
  ];
  const found: string[] = [];
  for (const k of keys) {
    if (lower.includes(k)) found.push(k);
  }
  return found;
}

/** GET http(s) con timeout, ignora certificati self-signed su HTTPS. */
function httpGet(url: string, timeoutMs: number): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(
      url,
      {
        timeout: timeoutMs,
        rejectUnauthorized: false,
        headers: { Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8", "User-Agent": "DA-INVENT/1.0" },
      },
      (res) => {
        let body = "";
        res.on("data", (c: Buffer) => {
          body += c.toString("utf8");
          if (body.length > 8000) res.destroy();
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: body.slice(0, 2000) }));
        res.on("error", reject);
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
  });
}

/**
 * Prova URL in ordine: http, https, poi porte note.
 * Restituisce il primo risultato utile (status 200-499 con body).
 */
export async function probeHttpBanners(ip: string, timeoutMs?: number): Promise<HttpProbeResult | null> {
  const ms = timeoutMs ?? httpProbeTimeoutMs();
  const unique = buildHttpProbeUrls(ip);

  for (const url of unique) {
    try {
      const r = await httpGet(url, ms);
      if (r.status >= 200 && r.status < 600) {
        const server = (r.headers["server"] as string | undefined) ?? null;
        const title = stripHtmlTitle(r.body);
        const snippet = r.body.replace(/\s+/g, " ").slice(0, 500);
        if (server || title || snippet.length > 20) {
          return { url, server, title, snippet };
        }
      }
    } catch {
      /* next */
    }
  }
  return null;
}

/** Legge banner SSH (prime righe) senza autenticare. */
export async function probeSshBanner(ip: string, timeoutMs: number = 4000): Promise<string | null> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: ip, port: 22, timeout: timeoutMs });
    let buf = "";
    const t = setTimeout(() => {
      socket.destroy();
      resolve(buf.trim().slice(0, 400) || null);
    }, timeoutMs);
    socket.on("data", (d: Buffer) => {
      buf += d.toString("utf8");
      if (buf.includes("\n") || buf.length > 512) {
        clearTimeout(t);
        socket.destroy();
        resolve(buf.trim().slice(0, 400));
      }
    });
    socket.on("error", () => {
      clearTimeout(t);
      resolve(null);
    });
    socket.on("timeout", () => {
      clearTimeout(t);
      socket.destroy();
      resolve(buf.trim().slice(0, 400) || null);
    });
  });
}

/** nmap --script smb-os-discovery (solo se 445 è aperta). Default 7s (prima 20s bloccava scan lunghi). */
export async function probeSmbOsDiscovery(ip: string, timeoutMs?: number): Promise<string | null> {
  const ms = timeoutMs ?? smbProbeTimeoutMs();
  try {
    const { stdout } = await execFileAsync(
      "nmap",
      ["-p", "445", "--script", "smb-os-discovery", ip],
      { timeout: ms, maxBuffer: 2 * 1024 * 1024 }
    );
    const s = String(stdout);
    if (!s.includes("smb-os-discovery") && !s.includes("OS:")) return null;
    return s.slice(0, 1500);
  } catch {
    return null;
  }
}

export async function runActiveProbes(input: {
  ip: string;
  openTcpPorts: number[];
  enableSmb?: boolean;
  /**
   * Scan SNMP-only o profilo senza porte TCP: prova comunque HTTP(S) su URL noti e SSH:22
   * (le porte non sono note ma il dispositivo risponde a SNMP).
   */
  probeCommonWeb?: boolean;
}): Promise<{
  http: HttpProbeResult | null;
  sshBanner: string | null;
  smbRaw: string | null;
  httpKeywords: string[];
}> {
  const { ip, openTcpPorts } = input;
  const probeFallback = input.probeCommonWeb === true && openTcpPorts.length === 0;
  const has22 = openTcpPorts.includes(22) || probeFallback;
  const has445 = openTcpPorts.includes(445);

  const httpMs = httpProbeTimeoutMs();
  const sshMs = sshProbeTimeoutMs();
  const [http, sshBanner] = await Promise.all([
    openTcpPorts.length > 0 || probeFallback ? probeHttpBanners(ip, httpMs) : Promise.resolve(null),
    has22 ? probeSshBanner(ip, sshMs) : Promise.resolve(null),
  ]);

  let httpKeywords: string[] = [];
  if (http) {
    const blob = `${http.server ?? ""} ${http.title ?? ""} ${http.snippet}`;
    httpKeywords = extractKeywords(blob);
  }

  let smbRaw: string | null = null;
  if (has445 && input.enableSmb !== false) {
    smbRaw = await probeSmbOsDiscovery(ip, smbProbeTimeoutMs());
  }

  return { http, sshBanner, smbRaw, httpKeywords };
}
