/**
 * Sonde senza credenziali su una porta TCP già trovata aperta: banner, HTTP, TLS, SSH.
 *
 * Perché (Riccardo, 09/11/2026): Nety mostra per ogni porta cosa risponde davvero —
 * certificato, risposta HTTP, algoritmi SSH — e come lo ha saputo. DA-IPAM salvava
 * solo il nome di nmap. Queste sonde leggono la stessa cosa con i moduli di Node,
 * in parallelo e senza nmap. Scritte da zero: Nety è GPL-3.0, se ne riprende l'idea.
 *
 * Ogni sonda legge e basta: un GET `/`, una stretta di mano TLS, lo scambio delle
 * versioni SSH. Nessuna credenziale, nessuna scrittura sull'apparato.
 */
import net from "node:net";
import tls from "node:tls";
import { createHash } from "node:crypto";

export interface InfoTls {
  version: string | null;
  cipher: string | null;
  alpn: string | null;
  subject_cn: string | null;
  subject: string | null;
  issuer: string | null;
  sans: string[];
  serial: string | null;
  not_before: string | null;
  not_after: string | null;
  self_signed: boolean;
  expired: boolean;
  key_bits: number | null;
  sha256: string | null;
}

export interface InfoHttp {
  scheme: "http" | "https";
  status_code: number;
  status_text: string;
  title: string | null;
  server: string | null;
  location: string | null;
  content_type: string | null;
  headers: Record<string, string>;
  body_sha256: string | null;
}

export interface InfoSsh {
  ident: string;
  kex: string[];
  hostkey: string[];
  cifrari: string[];
  mac: string[];
}

/** Come è stato riconosciuto ciò che risponde: la prova, non la tabella delle porte. */
export type MetodoSonda = "ssh" | "http" | "tls-http" | "tls" | "banner" | "silenzio";

export interface EsitoSonda {
  metodo: MetodoSonda;
  banner: string | null;
  tls: InfoTls | null;
  http: InfoHttp | null;
  ssh: InfoSsh | null;
  /** Prodotto/versione letti dalla risposta (header Server, identità SSH), se ci sono. */
  prodotto: string | null;
  versione: string | null;
}

const TETTO_BYTE = 64 * 1024;
const TETTO_BANNER = 2048;

export interface OpzioniSonda {
  timeoutMs?: number;
  /** Attesa di un banner spontaneo prima di provare a parlare per primi. */
  attesaBannerMs?: number;
}

/** Testo stampabile: i byte di controllo diventano `\xNN`, così il banner resta leggibile. */
export function testoStampabile(buf: Buffer, tetto = TETTO_BANNER): string {
  let out = "";
  for (const b of buf.subarray(0, tetto)) {
    if (b === 0x0d) out += "\\r";
    else if (b === 0x0a) out += "\\n";
    else if (b >= 0x20 && b < 0x7f) out += String.fromCharCode(b);
    else out += `\\x${b.toString(16).padStart(2, "0")}`;
  }
  return out;
}

/** Legge dal socket finché arriva qualcosa (o fino a `fine`), entro il tempo dato. */
function leggi(sock: net.Socket, ms: number, fine?: (buf: Buffer) => boolean): Promise<Buffer> {
  return new Promise((resolve) => {
    const parti: Buffer[] = [];
    let tot = 0;
    const chiudi = () => {
      clearTimeout(timer);
      sock.off("data", suDati);
      sock.off("end", chiudi);
      sock.off("close", chiudi);
      sock.off("error", chiudi);
      resolve(Buffer.concat(parti));
    };
    const suDati = (d: Buffer) => {
      parti.push(d);
      tot += d.length;
      if (tot >= TETTO_BYTE || (fine && fine(Buffer.concat(parti)))) chiudi();
    };
    const timer = setTimeout(chiudi, ms);
    sock.on("data", suDati);
    sock.once("end", chiudi);
    sock.once("close", chiudi);
    sock.once("error", chiudi);
  });
}

function connetti(ip: string, porta: number, ms: number): Promise<net.Socket | null> {
  return new Promise((resolve) => {
    const sock = net.connect({ host: ip, port: porta });
    const timer = setTimeout(() => { sock.destroy(); resolve(null); }, ms);
    sock.once("connect", () => { clearTimeout(timer); resolve(sock); });
    sock.once("error", () => { clearTimeout(timer); sock.destroy(); resolve(null); });
  });
}

function connettiTls(ip: string, porta: number, ms: number): Promise<tls.TLSSocket | null> {
  return new Promise((resolve) => {
    const sock = tls.connect({
      host: ip,
      port: porta,
      rejectUnauthorized: false,
      // Solo http/1.1: con h2 il server parlerebbe a frame e il GET in testo non avrebbe risposta.
      ALPNProtocols: ["http/1.1"],
      // Un IP non è un nome valido per SNI: Node avvisa e lo scarta, quindi niente servername.
    });
    const timer = setTimeout(() => { sock.destroy(); resolve(null); }, ms);
    sock.once("secureConnect", () => { clearTimeout(timer); resolve(sock); });
    sock.once("error", () => { clearTimeout(timer); sock.destroy(); resolve(null); });
  });
}

function nomeDistinto(o: Record<string, string | string[]> | undefined): string | null {
  if (!o) return null;
  const ordine = ["CN", "OU", "O", "L", "ST", "C"];
  const parti: string[] = [];
  for (const k of ordine) {
    const v = o[k];
    if (v === undefined) continue;
    parti.push(`${k}=${Array.isArray(v) ? v.join("+") : v}`);
  }
  return parti.length > 0 ? parti.join(",") : null;
}

function primo(v: string | string[] | undefined): string | null {
  if (v === undefined) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

function dataIso(s: string | undefined): string | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 19).replace("T", " ");
}

/** Il certificato e la sessione TLS come li vede chi si collega. */
export function leggiTls(sock: tls.TLSSocket, ora = new Date()): InfoTls {
  const cert = sock.getPeerCertificate(false);
  const cipher = sock.getCipher();
  const vuoto = !cert || Object.keys(cert).length === 0;
  const subject = vuoto ? null : nomeDistinto(cert.subject as unknown as Record<string, string | string[]>);
  const issuer = vuoto ? null : nomeDistinto(cert.issuer as unknown as Record<string, string | string[]>);
  const sans = vuoto || !cert.subjectaltname
    ? []
    : cert.subjectaltname.split(",").map((s) => s.trim().replace(/^(DNS|IP Address):/, "")).filter(Boolean);
  const scade = vuoto ? null : new Date(cert.valid_to);
  return {
    version: sock.getProtocol() ?? null,
    cipher: cipher?.standardName ?? cipher?.name ?? null,
    alpn: typeof sock.alpnProtocol === "string" ? sock.alpnProtocol : null,
    subject_cn: vuoto ? null : primo((cert.subject as unknown as Record<string, string | string[]>).CN),
    subject,
    issuer,
    sans,
    serial: vuoto ? null : cert.serialNumber ?? null,
    not_before: vuoto ? null : dataIso(cert.valid_from),
    not_after: vuoto ? null : dataIso(cert.valid_to),
    self_signed: subject !== null && subject === issuer,
    expired: scade !== null && !Number.isNaN(scade.getTime()) && scade.getTime() < ora.getTime(),
    key_bits: vuoto ? null : (cert as unknown as { bits?: number }).bits ?? null,
    sha256: vuoto ? null : (cert.fingerprint256 ?? "").replace(/:/g, "").toLowerCase() || null,
  };
}

/** Interpreta una risposta HTTP/1.x grezza. `null` se non è HTTP. */
export function leggiRispostaHttp(buf: Buffer, scheme: "http" | "https"): InfoHttp | null {
  const testo = buf.toString("latin1");
  const m = /^HTTP\/\d(?:\.\d)?\s+(\d{3})\s*([^\r\n]*)/.exec(testo);
  if (!m) return null;
  const fineTesta = testo.indexOf("\r\n\r\n");
  const testa = fineTesta >= 0 ? testo.slice(0, fineTesta) : testo;
  const corpo = fineTesta >= 0 ? buf.subarray(Buffer.byteLength(testo.slice(0, fineTesta + 4), "latin1")) : Buffer.alloc(0);
  const headers: Record<string, string> = {};
  for (const riga of testa.split("\r\n").slice(1)) {
    const i = riga.indexOf(":");
    if (i <= 0) continue;
    const k = riga.slice(0, i).trim();
    const v = riga.slice(i + 1).trim();
    // I cookie si tengono per nome: il valore può essere un gettone di sessione.
    const valore = /^set-cookie$/i.test(k) ? v.split("=")[0] : v;
    headers[k] = headers[k] ? `${headers[k]}, ${valore}` : valore;
  }
  const h = (nome: string) => {
    const k = Object.keys(headers).find((x) => x.toLowerCase() === nome);
    return k ? headers[k] : null;
  };
  const corpoTesto = corpo.toString("utf8");
  const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(corpoTesto);
  const titolo = t ? t[1].replace(/\s+/g, " ").trim().slice(0, 200) || null : null;
  return {
    scheme,
    status_code: Number(m[1]),
    status_text: m[2].trim(),
    title: titolo,
    server: h("server"),
    location: h("location"),
    content_type: h("content-type"),
    headers,
    body_sha256: corpo.length > 0 ? createHash("sha256").update(corpo).digest("hex") : null,
  };
}

/** Prodotto e versione da «nginx/1.27.5» o «Apache/2.4.58 (Ubuntu)». */
export function prodottoDaServer(server: string | null): { prodotto: string | null; versione: string | null } {
  if (!server) return { prodotto: null, versione: null };
  const m = /^([A-Za-z][\w.+-]*?)(?:\/([\w.+-]+))?(?:\s|$)/.exec(server.trim());
  if (!m) return { prodotto: server.trim().slice(0, 80), versione: null };
  return { prodotto: m[1], versione: m[2] ?? null };
}

/** Prodotto e versione da «SSH-2.0-OpenSSH_9.6p1 Ubuntu-3ubuntu13.5». */
export function prodottoDaSsh(ident: string): { prodotto: string | null; versione: string | null } {
  const sw = ident.replace(/^SSH-[\d.]+-/, "").trim();
  const m = /^([A-Za-z][A-Za-z-]*?)[_-]([\w.]+)/.exec(sw);
  if (!m) return { prodotto: sw.split(/\s/)[0] || null, versione: null };
  return { prodotto: m[1], versione: m[2] };
}

/**
 * Le liste di algoritmi del pacchetto KEXINIT (RFC 4253 §7.1), che il server manda
 * subito dopo lo scambio delle versioni. `null` se il pacchetto non è completo.
 */
export function leggiKexinit(buf: Buffer): Omit<InfoSsh, "ident"> | null {
  if (buf.length < 6) return null;
  const lungh = buf.readUInt32BE(0);
  if (lungh < 2 || buf.length < 4 + lungh) return null;
  if (buf[5] !== 20) return null; // SSH_MSG_KEXINIT
  let p = 6 + 16; // tipo + cookie
  const liste: string[][] = [];
  for (let i = 0; i < 10; i++) {
    if (p + 4 > 4 + lungh) return null;
    const n = buf.readUInt32BE(p);
    p += 4;
    if (p + n > 4 + lungh) return null;
    liste.push(buf.subarray(p, p + n).toString("latin1").split(",").filter(Boolean));
    p += n;
  }
  return { kex: liste[0], hostkey: liste[1], cifrari: liste[2], mac: liste[4] };
}

const RICHIESTA_HTTP = (ip: string) =>
  `GET / HTTP/1.1\r\nHost: ${ip}\r\nUser-Agent: DA-IPAM\r\nAccept: */*\r\nConnection: close\r\n\r\n`;

const finitaTestaHttp = (b: Buffer) => b.includes("</title>") || b.includes("</head>");

async function provaHttpSuSocket(sock: net.Socket, ip: string, ms: number, scheme: "http" | "https"): Promise<{ http: InfoHttp | null; grezzo: Buffer }> {
  sock.write(RICHIESTA_HTTP(ip));
  const grezzo = await leggi(sock, ms, finitaTestaHttp);
  return { http: leggiRispostaHttp(grezzo, scheme), grezzo };
}

/** La risposta in chiaro dice che il servizio vero parla TLS. */
export function vuoleTls(http: InfoHttp): boolean {
  return http.status_code === 400 || (http.location ?? "").toLowerCase().startsWith("https://");
}

function testaDi(grezzo: Buffer): string {
  const i = grezzo.indexOf("\r\n\r\n");
  return testoStampabile(i >= 0 ? grezzo.subarray(0, i + 2) : grezzo);
}

/**
 * Sonda una porta TCP: aspetta un banner; se è SSH legge gli algoritmi; se tace prova
 * HTTP in chiaro, poi TLS (e HTTP dentro TLS). Al massimo tre connessioni per porta.
 */
export async function sondaPorta(ip: string, porta: number, opz: OpzioniSonda = {}): Promise<EsitoSonda | null> {
  const ms = opz.timeoutMs ?? 4000;
  const attesa = opz.attesaBannerMs ?? 1500;
  const esito: EsitoSonda = { metodo: "silenzio", banner: null, tls: null, http: null, ssh: null, prodotto: null, versione: null };

  // 1. Connessione in chiaro: c'è un banner spontaneo?
  const s1 = await connetti(ip, porta, ms);
  if (!s1) return null; // la porta non risponde più
  try {
    const primo = await leggi(s1, attesa, (b) => b.includes(0x0a));
    if (primo.length > 0) {
      const testo = primo.toString("latin1");
      if (testo.startsWith("SSH-")) {
        const ident = testo.split(/\r?\n/)[0].trim();
        s1.write("SSH-2.0-DA-IPAM\r\n");
        const resto = primo.subarray(primo.indexOf(0x0a) + 1);
        const kexBuf = resto.length >= 6 ? resto : Buffer.concat([resto, await leggi(s1, ms, (b) => b.length >= 4 && b.length >= 4 + b.readUInt32BE(0))]);
        const kex = leggiKexinit(kexBuf);
        esito.metodo = "ssh";
        esito.banner = ident;
        esito.ssh = { ident, kex: kex?.kex ?? [], hostkey: kex?.hostkey ?? [], cifrari: kex?.cifrari ?? [], mac: kex?.mac ?? [] };
        Object.assign(esito, prodottoDaSsh(ident));
        return esito;
      }
      esito.metodo = "banner";
      esito.banner = testoStampabile(primo);
      return esito;
    }
    // 2. Tace: proviamo a parlare HTTP sulla stessa connessione.
    const { http, grezzo } = await provaHttpSuSocket(s1, ip, ms, "http");
    if (http) {
      esito.metodo = "http";
      esito.http = http;
      esito.banner = testaDi(grezzo);
      Object.assign(esito, prodottoDaServer(http.server));
      // nginx su una porta TLS risponde 400 «plain HTTP request was sent to HTTPS port»;
      // Proxmox rimanda a https://. In questi due casi il servizio vero è dentro TLS.
      if (!vuoleTls(http)) return esito;
    }
  } finally {
    s1.destroy();
  }

  // 3. Né banner né HTTP in chiaro: TLS?
  const s2 = await connettiTls(ip, porta, ms);
  if (!s2) return esito;
  try {
    const inChiaro = esito.http;
    esito.http = null;
    esito.tls = leggiTls(s2);
    esito.metodo = inChiaro ? "tls-http" : "tls";
    const { http, grezzo } = await provaHttpSuSocket(s2, ip, ms, "https");
    if (http) {
      esito.metodo = "tls-http";
      esito.http = http;
      esito.banner = testaDi(grezzo);
      Object.assign(esito, prodottoDaServer(http.server));
    }
    return esito;
  } finally {
    s2.destroy();
  }
}

/** La porta TCP accetta la connessione? Si chiude subito, senza scrivere niente. */
export async function portaAperta(ip: string, porta: number, ms = 800): Promise<boolean> {
  const s = await connetti(ip, porta, ms);
  if (!s) return false;
  s.destroy();
  return true;
}
