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
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import {
  buildNtlmNegotiateMessage,
  parseNtlmChallenge,
  probeSmb2,
  type NtlmChallengeInfo,
  type Smb2Finding,
} from "@/lib/scanner/probes/smb2";
import { probeRdpNtlm } from "@/lib/scanner/probes/rdp-ntlm";
import { ntlmDaGssORaw, wrapNtlmInSpnego } from "./ntlm-spnego";

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
  /** SHA-256 dell'host key (blob SSH), esadecimale minuscolo. Null se la stretta di mano si ferma agli algoritmi. */
  fingerprint: string | null;
}

/** Nome, dominio e versione OS dalla CHALLENGE NTLM: il server li manda prima di qualsiasi login. */
export interface InfoNtlm {
  netbios: string | null;
  dominio_netbios: string | null;
  dns_computer: string | null;
  dominio_dns: string | null;
  versione_os: string | null;
  fonte: "smb" | "http" | "rdp";
  /** SMB: true se il server esige la firma dei messaggi. */
  smb_signing?: boolean;
  /** RDP: true se il server ha scelto CredSSP (NLA). */
  rdp_nla?: boolean;
  /** RDP: false se il server ha scelto il protocollo Standard, senza TLS. */
  rdp_tls?: boolean;
}

/** Come è stato riconosciuto ciò che risponde: la prova, non la tabella delle porte. */
export type MetodoSonda = "ssh" | "http" | "tls-http" | "tls" | "banner" | "silenzio" | "ntlm";

export interface EsitoSonda {
  metodo: MetodoSonda;
  banner: string | null;
  tls: InfoTls | null;
  http: InfoHttp | null;
  ssh: InfoSsh | null;
  ntlm?: InfoNtlm | null;
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
  return { kex: liste[0], hostkey: liste[1], cifrari: liste[2], mac: liste[4], fingerprint: null };
}

const KEX_CURVE = ["curve25519-sha256", "curve25519-sha256@libssh.org"] as const;

function paddingSsh(lunghezzaPayload: number): number {
  let p = (3 - (lunghezzaPayload % 8) + 8) % 8;
  if (p < 4) p += 8;
  return p;
}

/** Pacchetto SSH in chiaro (prima di NEWKEYS): length, padding_length, payload, padding. */
export function pacchettoSsh(payload: Buffer): Buffer {
  const pad = paddingSsh(payload.length);
  const packetLength = 1 + payload.length + pad;
  const out = Buffer.alloc(4 + packetLength);
  out.writeUInt32BE(packetLength, 0);
  out[4] = pad;
  payload.copy(out, 5);
  randomBytes(pad).copy(out, 5 + payload.length);
  return out;
}

function stringaSsh(s: string | Buffer): Buffer {
  const b = typeof s === "string" ? Buffer.from(s, "latin1") : s;
  const n = Buffer.alloc(4);
  n.writeUInt32BE(b.length);
  return Buffer.concat([n, b]);
}

function leggiStringaSsh(buf: Buffer, o: number): { v: Buffer; o: number } | null {
  if (o + 4 > buf.length) return null;
  const n = buf.readUInt32BE(o);
  if (n < 0 || o + 4 + n > buf.length) return null;
  return { v: buf.subarray(o + 4, o + 4 + n), o: o + 4 + n };
}

/** KEXINIT del cliente: chiediamo solo curve25519, così la risposta porta l'host key. */
export function kexinitCliente(): Buffer {
  const cookie = randomBytes(16);
  const liste = [
    KEX_CURVE.join(","),
    "ssh-ed25519,rsa-sha2-512,rsa-sha2-256,ecdsa-sha2-nistp256",
    "aes128-ctr",
    "aes128-ctr",
    "hmac-sha2-256",
    "hmac-sha2-256",
    "none",
    "none",
    "",
    "",
  ];
  const parti: Buffer[] = [Buffer.from([20]), cookie];
  for (const l of liste) parti.push(stringaSsh(l));
  parti.push(Buffer.from([0]), Buffer.alloc(4));
  return pacchettoSsh(Buffer.concat(parti));
}

/** SHA-256 del blob della host key (stesso dato che `ssh-keyscan` firma). */
export function improntaHostkey(blob: Buffer): string {
  return createHash("sha256").update(blob).digest("hex");
}

/**
 * Host key dal pacchetto SSH_MSG_KEX_ECDH_REPLY (RFC 5656 §4). `null` se il
 * pacchetto non è completo o non è il tipo 31.
 */
export function hostkeyDaKexEcdhReply(buf: Buffer): Buffer | null {
  if (buf.length < 6) return null;
  const lungh = buf.readUInt32BE(0);
  if (lungh < 2 || buf.length < 4 + lungh) return null;
  const pad = buf[4];
  if (pad < 4 || 1 + pad >= lungh) return null;
  const payload = buf.subarray(5, 4 + lungh - pad);
  if (payload.length < 1 || payload[0] !== 31) return null;
  const s = leggiStringaSsh(payload, 1);
  return s && s.v.length > 0 ? s.v : null;
}

export function kexCurve25519(liste: string[]): string | null {
  for (const nome of KEX_CURVE) {
    if (liste.includes(nome)) return nome;
  }
  return null;
}

function chiaveX25519(): Buffer | null {
  try {
    const { publicKey } = generateKeyPairSync("x25519");
    const der = publicKey.export({ type: "spki", format: "der" });
    return der.subarray(-32);
  } catch {
    return null;
  }
}

/** Dopo il KEXINIT del server: mandiamo il nostro e l'ECDH INIT, leggiamo l'host key. */
async function improntaSshDaSocket(sock: net.Socket, kex: string[], ms: number): Promise<string | null> {
  if (!kexCurve25519(kex)) return null;
  const pub = chiaveX25519();
  if (!pub) return null;
  sock.write(Buffer.concat([kexinitCliente(), pacchettoSsh(Buffer.concat([Buffer.from([30]), stringaSsh(pub)]))]));
  const grezzo = await leggi(sock, ms, (b) => b.length >= 6 && b.length >= 4 + b.readUInt32BE(0));
  const hostkey = hostkeyDaKexEcdhReply(grezzo);
  return hostkey ? improntaHostkey(hostkey) : null;
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

function headerDi(headers: Record<string, string>, nome: string): string | null {
  const k = Object.keys(headers).find((x) => x.toLowerCase() === nome);
  return k ? headers[k] : null;
}

function testoNtlm(s: string | null | undefined): string | null {
  const t = typeof s === "string" ? s.trim() : "";
  return t ? t : null;
}

export function infoNtlmDaChallenge(
  c: Pick<NtlmChallengeInfo, "version" | "nbComputerName" | "nbDomainName" | "dnsComputerName" | "dnsDomainName">,
  fonte: InfoNtlm["fonte"],
): InfoNtlm {
  return {
    netbios: testoNtlm(c.nbComputerName),
    dominio_netbios: testoNtlm(c.nbDomainName),
    dns_computer: testoNtlm(c.dnsComputerName),
    dominio_dns: testoNtlm(c.dnsDomainName),
    versione_os: testoNtlm(c.version),
    fonte,
  };
}

export function infoNtlmDaSmb2(f: Smb2Finding): InfoNtlm {
  return {
    netbios: testoNtlm(f.netbiosName),
    dominio_netbios: testoNtlm(f.nbDomainName),
    dns_computer: testoNtlm(f.dnsComputerName),
    dominio_dns: testoNtlm(f.dnsDomain),
    versione_os: testoNtlm(f.osVersion),
    fonte: "smb",
    smb_signing: f.signingRequired,
  };
}

/** L'intestazione WWW-Authenticate invita a NTLM o a Negotiate (IIS spesso offre solo Negotiate). */
export function ntlmOfferto(headers: Record<string, string>): boolean {
  const v = headerDi(headers, "www-authenticate") ?? "";
  return /(^|[\s,])(ntlm|negotiate)(\s|$|,)/i.test(v);
}

function ntlmEspicito(headers: Record<string, string>): boolean {
  const v = headerDi(headers, "www-authenticate") ?? "";
  return /(^|[\s,])ntlm(\s|$|,)/i.test(v);
}

function blobDaBase64(s: string): Buffer | null {
  try {
    const buf = Buffer.from(s, "base64");
    return buf.length > 0 ? buf : null;
  } catch {
    return null;
  }
}

/** Estrae il blob Type 2 da `WWW-Authenticate: NTLM <base64>` o `Negotiate <base64 SPNEGO>`. */
export function ntlmChallengeDaWwwAuthenticate(headers: Record<string, string>): Buffer | null {
  const v = headerDi(headers, "www-authenticate") ?? "";
  const ntlm = /\bNTLM\s+([A-Za-z0-9+/=]+)/i.exec(v);
  if (ntlm) {
    const raw = blobDaBase64(ntlm[1]);
    return raw ? ntlmDaGssORaw(raw) ?? raw : null;
  }
  const neg = /\bNegotiate\s+([A-Za-z0-9+/=]+)/i.exec(v);
  if (!neg) return null;
  const raw = blobDaBase64(neg[1]);
  return raw ? ntlmDaGssORaw(raw) : null;
}

const RICHIESTA_HTTP_AUTH = (ip: string, schema: string, token: string) =>
  `GET / HTTP/1.1\r\nHost: ${ip}\r\nUser-Agent: DA-IPAM\r\nAccept: */*\r\nAuthorization: ${schema} ${token}\r\nConnection: close\r\n\r\n`;

/** Seconda richiesta HTTP: Type 1 NTLM (o SPNEGO se c'è solo Negotiate). Nessun Type 3, nessuna password. */
export async function ntlmDaHttp(
  ip: string,
  porta: number,
  scheme: "http" | "https",
  ms: number,
  headersPrima?: Record<string, string>,
): Promise<InfoNtlm | null> {
  const type1 = buildNtlmNegotiateMessage();
  const usaNegotiate = headersPrima ? !ntlmEspicito(headersPrima) : false;
  const token = (usaNegotiate ? wrapNtlmInSpnego(type1) : type1).toString("base64");
  const schema = usaNegotiate ? "Negotiate" : "NTLM";
  const sock = scheme === "https" ? await connettiTls(ip, porta, ms) : await connetti(ip, porta, ms);
  if (!sock) return null;
  try {
    sock.write(RICHIESTA_HTTP_AUTH(ip, schema, token));
    const grezzo = await leggi(sock, ms, (b) => b.includes("\r\n\r\n"));
    const http = leggiRispostaHttp(grezzo, scheme);
    if (!http) return null;
    const buf = ntlmChallengeDaWwwAuthenticate(http.headers);
    if (!buf) return null;
    const c = parseNtlmChallenge(buf);
    return c ? infoNtlmDaChallenge(c, "http") : null;
  } finally {
    sock.destroy();
  }
}

async function magariNtlmHttp(
  esito: EsitoSonda,
  ip: string,
  porta: number,
  scheme: "http" | "https",
  ms: number,
): Promise<void> {
  if (esito.ntlm || !esito.http || !ntlmOfferto(esito.http.headers)) return;
  try {
    esito.ntlm = await ntlmDaHttp(ip, porta, scheme, ms, esito.http.headers);
  } catch {
    // una 401 NTLM che non risponde al Type 1 non ferma la sonda
  }
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
  const esito: EsitoSonda = { metodo: "silenzio", banner: null, tls: null, http: null, ssh: null, ntlm: null, prodotto: null, versione: null };

  // 445: NTLMSSP NEGOTIATE anonimo, si legge la CHALLENGE. Nessun AUTHENTICATE.
  if (porta === 445) {
    try {
      const smb = await probeSmb2(ip, { timeoutMs: ms });
      if (smb) {
        esito.metodo = "ntlm";
        esito.ntlm = infoNtlmDaSmb2(smb);
        esito.versione = esito.ntlm.versione_os;
        return esito;
      }
    } catch {
      // SMB muto: si prova comunque banner/HTTP come sulle altre porte
    }
  }

  // 3389: X.224 + TLS + CredSSP, stessa CHALLENGE, sempre senza password.
  if (porta === 3389) {
    try {
      const rdp = await probeRdpNtlm(ip, { timeoutMs: ms });
      if (rdp) {
        esito.metodo = "ntlm";
        esito.ntlm = rdp.challenge
          ? { ...infoNtlmDaChallenge(rdp.challenge, "rdp"), rdp_nla: rdp.nla, rdp_tls: rdp.tls }
          : {
              netbios: null,
              dominio_netbios: null,
              dns_computer: null,
              dominio_dns: null,
              versione_os: null,
              fonte: "rdp",
              rdp_nla: rdp.nla,
              rdp_tls: rdp.tls,
            };
        esito.versione = esito.ntlm.versione_os;
        return esito;
      }
    } catch {
      // RDP muto o senza CredSSP: si prova TLS come sulle altre porte
    }
  }

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
        const fingerprint = kex ? await improntaSshDaSocket(s1, kex.kex, ms) : null;
        esito.ssh = {
          ident,
          kex: kex?.kex ?? [],
          hostkey: kex?.hostkey ?? [],
          cifrari: kex?.cifrari ?? [],
          mac: kex?.mac ?? [],
          fingerprint,
        };
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
      if (!vuoleTls(http)) {
        await magariNtlmHttp(esito, ip, porta, "http", ms);
        return esito;
      }
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
      await magariNtlmHttp(esito, ip, porta, "https", ms);
    }
    return esito;
  } finally {
    s2.destroy();
  }
}

/** La porta TCP accetta la connessione? Si chiude subito, senza scrivere niente. */
export async function portaAperta(ip: string, porta: number, ms = 700): Promise<boolean> {
  const s = await connetti(ip, porta, ms);
  if (!s) return false;
  s.destroy();
  return true;
}
