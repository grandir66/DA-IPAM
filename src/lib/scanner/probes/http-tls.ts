/**
 * Probe HTTP/HTTPS passivo per attribuzione (Fase 3 §4.5): GET / grezza sulle porte
 * web note già APERTE (mai su porte chiuse), + certificato TLS (CN/SAN/issuer) via
 * `tls.connect({ rejectUnauthorized:false })`. Nessuna autenticazione, nessuna
 * eccezione propagata: un fallimento per-porta produce solo "nessun finding" per
 * quella porta, mai il crash dell'intero probe.
 */
import net from "net";
import tls from "tls";

export interface HttpTlsFinding {
  port: number;
  scheme: "http" | "https";
  server: string | null; // header Server
  title: string | null; // <title> (max 120 char, trim)
  realm: string | null; // WWW-Authenticate realm
  location: string | null; // redirect Location
  tlsSubjectCn: string | null;
  tlsSan: string[];
  tlsIssuer: string | null;
}

/** Porte web note su cui provare una GET (spec §4.5 Task 1). */
const CANDIDATE_PORTS = [80, 443, 8080, 8443, 9443, 7080, 8006, 5000, 5001, 631, 9100, 8000, 8081] as const;

/**
 * Porte convenzionalmente TLS per le famiglie di dispositivi target: Proxmox (8006),
 * Synology DSM https (5001), appliance generiche (443/8443/9443). Le altre candidate
 * sono tentate in chiaro: un falso negativo qui produce solo un finding vuoto per
 * quella porta (nessuna eccezione), non un errore.
 */
const HTTPS_PORTS = new Set<number>([443, 8443, 9443, 8006, 5001]);

const DEFAULT_TIMEOUT_MS = 2000;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_TITLE_LEN = 120;

interface RawHttpResponse {
  headers: Record<string, string>;
  body: string;
}

/** RDN multi-valore (CN puo' essere string[] nel tipo Node): usa il primo valore. */
function firstString(v: string | string[] | undefined): string | null {
  if (v === undefined) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

function parseSan(subjectaltname: string | undefined): string[] {
  if (!subjectaltname) return [];
  return subjectaltname
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const m = s.match(/^(?:DNS|IP Address):(.+)$/);
      return m ? m[1].trim() : s;
    });
}

function parseHttpResponse(raw: Buffer): RawHttpResponse | null {
  const sep = raw.indexOf("\r\n\r\n");
  if (sep === -1) return null;
  const headerText = raw.subarray(0, sep).toString("latin1");
  const bodyBuf = raw.subarray(sep + 4);
  const lines = headerText.split("\r\n").slice(1); // scarta la status line
  const headers: Record<string, string> = {};
  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
  }
  return { headers, body: bodyBuf.toString("utf8") };
}

function extractTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  if (!m) return null;
  const t = m[1].replace(/\s+/g, " ").trim();
  return t ? t.slice(0, MAX_TITLE_LEN) : null;
}

function extractRealm(wwwAuthenticate: string | undefined): string | null {
  if (!wwwAuthenticate) return null;
  const m = wwwAuthenticate.match(/realm="([^"]*)"/i);
  return m ? m[1] : null;
}

/** GET / grezza sul socket già connesso: max MAX_BODY_BYTES, poi chiude. Mai eccezioni. */
function requestOverSocket(socket: net.Socket, host: string, timeoutMs: number): Promise<RawHttpResponse | null> {
  return new Promise((resolve) => {
    let settled = false;
    const chunks: Buffer[] = [];
    let total = 0;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(parseHttpResponse(Buffer.concat(chunks)));
    };
    const timer = setTimeout(finish, timeoutMs);
    socket.on("data", (chunk: Buffer) => {
      if (total >= MAX_BODY_BYTES) return;
      chunks.push(chunk);
      total += chunk.length;
      if (total >= MAX_BODY_BYTES) finish();
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
        `GET / HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\nUser-Agent: DA-INVENT-probe/1.0\r\nAccept: */*\r\n\r\n`
      );
    } catch {
      finish();
    }
  });
}

function connectPlain(ip: string, port: number, timeoutMs: number): Promise<net.Socket | null> {
  return new Promise((resolve) => {
    let settled = false;
    const socket = net.connect({ host: ip, port });
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

function connectTls(ip: string, port: number, timeoutMs: number): Promise<tls.TLSSocket | null> {
  return new Promise((resolve) => {
    let settled = false;
    const socket = tls.connect({ host: ip, port, servername: ip, rejectUnauthorized: false });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(null);
    }, timeoutMs);
    socket.once("secureConnect", () => {
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

async function probeOnePort(ip: string, port: number, timeoutMs: number): Promise<HttpTlsFinding | null> {
  const scheme: "http" | "https" = HTTPS_PORTS.has(port) ? "https" : "http";
  try {
    let tlsSubjectCn: string | null = null;
    let tlsSan: string[] = [];
    let tlsIssuer: string | null = null;
    let socket: net.Socket;

    if (scheme === "https") {
      const tlsSocket = await connectTls(ip, port, timeoutMs);
      if (!tlsSocket) return null;
      const cert = tlsSocket.getPeerCertificate();
      if (cert && Object.keys(cert).length > 0) {
        tlsSubjectCn = firstString(cert.subject?.CN);
        tlsIssuer = firstString(cert.issuer?.CN);
        tlsSan = parseSan(cert.subjectaltname);
      }
      socket = tlsSocket;
    } else {
      const plain = await connectPlain(ip, port, timeoutMs);
      if (!plain) return null;
      socket = plain;
    }

    const resp = await requestOverSocket(socket, ip, timeoutMs);
    if (!resp) {
      // Connessione riuscita ma nessuna risposta HTTP valida entro il timeout (es.
      // porta non-HTTP come 9100/JetDirect raw): se comunque abbiamo il certificato
      // TLS, e' gia' un'evidenza utile.
      if (tlsSubjectCn || tlsIssuer || tlsSan.length > 0) {
        return { port, scheme, server: null, title: null, realm: null, location: null, tlsSubjectCn, tlsSan, tlsIssuer };
      }
      return null;
    }
    return {
      port,
      scheme,
      server: resp.headers["server"] ?? null,
      title: extractTitle(resp.body),
      realm: extractRealm(resp.headers["www-authenticate"]),
      location: resp.headers["location"] ?? null,
      tlsSubjectCn,
      tlsSan,
      tlsIssuer,
    };
  } catch {
    return null;
  }
}

/**
 * Prova GET / sull'intersezione tra `openPorts` e le porte web note. Mai porte
 * chiuse. Nessuna eccezione propagata: fallimenti per-porta producono solo
 * l'assenza del relativo finding.
 */
export async function probeHttpTls(
  ip: string,
  openPorts: number[],
  opts?: { timeoutMs?: number }
): Promise<HttpTlsFinding[]> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const openSet = new Set(openPorts);
  const targets = CANDIDATE_PORTS.filter((p) => openSet.has(p));
  if (targets.length === 0) return [];

  const results = await Promise.all(
    targets.map((port) => probeOnePort(ip, port, timeoutMs).catch(() => null))
  );
  return results.filter((r): r is HttpTlsFinding => r !== null);
}
