/**
 * Probe SSDP/UPnP passivo per attribuzione (fase 3 §4.5): M-SEARCH **unicast**
 * (mai multicast/broadcast, per non generare traffico di scoperta su tutta la
 * LAN) verso <ip>:1900 (`ST: ssdp:all`, `MX: 1`, `MAN: "ssdp:discover"`).
 * Se la risposta contiene `LOCATION`, e SOLO se punta allo stesso host target
 * (mai seguire un redirect verso un altro IP/hostname — sarebbe un probe verso
 * un bersaglio diverso da quello autorizzato), effettua una GET dell'XML di
 * descrizione device con timeout e limite di dimensione. Nessuna eccezione
 * propagata: qualunque anomalia produce `null`.
 */
import net from "net";
import dgram from "dgram";
import { XMLParser } from "fast-xml-parser";

export interface SsdpFinding {
  st: string | null;
  server: string | null;
  location: string | null;
  manufacturer: string | null;
  modelName: string | null;
  deviceType: string | null;
}

const DEFAULT_TIMEOUT_MS = 2000;
const SSDP_PORT = 1900;
const MAX_XML_BYTES = 64 * 1024;

interface SsdpHeaders {
  st: string | null;
  server: string | null;
  usn: string | null;
  location: string | null;
}

/**
 * Parsing case-insensitive delle header HTTP-like della risposta SSDP (righe
 * "Header: value" separate da CRLF, come una risposta HTTP senza body).
 * Esportata per i test: e' la parte di parsing piu' fragile, merita input
 * costruiti a mano (righe fuori ordine, header duplicati, CRLF mancanti).
 */
export function parseSsdpHeaders(raw: Buffer | string): SsdpHeaders {
  const text = Buffer.isBuffer(raw) ? raw.toString("latin1") : raw;
  const lines = text.split(/\r\n|\n/).slice(1); // scarta la status line ("HTTP/1.1 200 OK")
  const headers: Record<string, string> = {};
  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    if (!key) continue;
    headers[key] = line.slice(idx + 1).trim();
  }
  return {
    st: headers["st"] ?? null,
    server: headers["server"] ?? null,
    usn: headers["usn"] ?? null,
    location: headers["location"] ?? null,
  };
}

function buildMSearch(ip: string): Buffer {
  const msg =
    `M-SEARCH * HTTP/1.1\r\n` +
    `HOST: ${ip}:${SSDP_PORT}\r\n` +
    `MAN: "ssdp:discover"\r\n` +
    `MX: 1\r\n` +
    `ST: ssdp:all\r\n` +
    `\r\n`;
  return Buffer.from(msg, "latin1");
}

/** Invia l'M-SEARCH e attende il primo datagramma di risposta entro il timeout. */
function collectSsdpResponse(ip: string, timeoutMs: number): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const socket = dgram.createSocket("udp4");
    let settled = false;
    const finish = (result: Buffer | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        // già chiuso
      }
      resolve(result);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    socket.on("message", (msg) => finish(msg));
    socket.on("error", () => finish(null));
    socket.once("listening", () => {
      try {
        socket.send(buildMSearch(ip), SSDP_PORT, ip);
      } catch {
        finish(null);
      }
    });
    try {
      socket.bind(0);
    } catch {
      finish(null);
    }
  });
}

/**
 * Verifica che `location` punti effettivamente all'host target: non seguiamo
 * MAI un redirect verso un altro IP/hostname (probe unicast, un solo target
 * autorizzato per invocazione).
 */
function locationHostMatches(location: string, ip: string): boolean {
  try {
    return new URL(location).hostname === ip;
  } catch {
    return false;
  }
}

function connectPlain(host: string, port: number, timeoutMs: number): Promise<net.Socket | null> {
  return new Promise((resolve) => {
    let settled = false;
    const socket = net.connect({ host, port });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(null);
    }, timeoutMs);
    socket.once("connect", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(null);
    });
  });
}

/** GET grezza sul socket gia' connesso: max MAX_XML_BYTES, poi chiude. Mai eccezioni. */
function requestXmlOverSocket(socket: net.Socket, host: string, path: string, timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    const chunks: Buffer[] = [];
    let total = 0;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      const raw = Buffer.concat(chunks);
      const sep = raw.indexOf("\r\n\r\n");
      resolve(sep === -1 ? null : raw.subarray(sep + 4).toString("utf8"));
    };
    const timer = setTimeout(finish, timeoutMs);
    socket.on("data", (chunk: Buffer) => {
      if (total >= MAX_XML_BYTES) return;
      chunks.push(chunk);
      total += chunk.length;
      if (total >= MAX_XML_BYTES) finish();
    });
    socket.on("end", finish);
    socket.on("close", finish);
    socket.on("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(null);
    });
    try {
      socket.write(
        `GET ${path} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\nUser-Agent: DA-INVENT-probe/1.0\r\nAccept: text/xml\r\n\r\n`
      );
    } catch {
      finish();
    }
  });
}

async function fetchDeviceXml(location: string, timeoutMs: number): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(location);
  } catch {
    return null;
  }
  const port = url.port ? Number(url.port) : 80;
  const path = `${url.pathname}${url.search}` || "/";
  const socket = await connectPlain(url.hostname, port, timeoutMs);
  if (!socket) return null;
  return requestXmlOverSocket(socket, url.hostname, path, timeoutMs);
}

function firstNonEmptyString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** Parsing dell'XML di descrizione device UPnP (`<root><device>...`). Mai eccezioni. */
function parseDeviceXml(xml: string): { manufacturer: string | null; modelName: string | null; deviceType: string | null } {
  try {
    const parser = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true });
    const parsed: unknown = parser.parse(xml);
    const device = (parsed as { root?: { device?: Record<string, unknown> } })?.root?.device;
    return {
      manufacturer: firstNonEmptyString(device?.manufacturer),
      modelName: firstNonEmptyString(device?.modelName),
      deviceType: firstNonEmptyString(device?.deviceType),
    };
  } catch {
    return { manufacturer: null, modelName: null, deviceType: null };
  }
}

/**
 * M-SEARCH unicast verso <ip>:1900; se la risposta ha `LOCATION` e punta allo
 * stesso host, GET dell'XML di descrizione device (timeout e limite di
 * dimensione indipendenti dal primo round-trip UDP). Ritorna `null` se non
 * arriva nessuna risposta entro il timeout o su qualunque errore.
 */
export async function probeSsdp(ip: string, opts?: { timeoutMs?: number }): Promise<SsdpFinding | null> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  try {
    const resp = await collectSsdpResponse(ip, timeoutMs);
    if (!resp) return null;
    const headers = parseSsdpHeaders(resp);

    let manufacturer: string | null = null;
    let modelName: string | null = null;
    let deviceType: string | null = null;

    if (headers.location && locationHostMatches(headers.location, ip)) {
      const xml = await fetchDeviceXml(headers.location, timeoutMs).catch(() => null);
      if (xml) {
        const parsed = parseDeviceXml(xml);
        manufacturer = parsed.manufacturer;
        modelName = parsed.modelName;
        deviceType = parsed.deviceType;
      }
    }

    return { st: headers.st, server: headers.server, location: headers.location, manufacturer, modelName, deviceType };
  } catch {
    return null;
  }
}
