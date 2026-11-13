/**
 * Prove senza credenziali (e login di fabbrica solo se chiesti) sulle porte
 * già aperte. Scritte da zero: Nety è GPL-3.0, se ne riprende l'idea.
 */
import { randomBytes } from "node:crypto";
import dgram from "node:dgram";
import net from "node:net";
import { request as richiestaHttp } from "node:http";
import { request as richiestaHttps } from "node:https";
import * as snmp from "net-snmp";
import { apriSessioneCommunity, provaVersioniSnmp } from "@/lib/protocols/snmp-sessione";
import type { InfoControllo } from "./controlli";
import { sondaSmb } from "./smb-controlli";
import { provaTlsAttivo } from "./tls-attivo";
import { AGENTE_NEUTRO } from "@/lib/scanner/identita-neutra";
import {
  provaDnsAxfr,
  provaIpmiRakp,
  provaNfsExportStella,
  provaNtpMonlist,
  provaRsync,
  provaSmtpVrfy,
  provaSshPasswordOfferta,
  provaTftp,
} from "./sonde-extra";

const TETTO = 16 * 1024;
const OID_SYSDESCR = "1.3.6.1.2.1.1.1.0";

export interface OpzioniControllo {
  timeoutMs?: number;
  proveFabbrica?: boolean;
  consumaTentativo?: () => boolean;
  /** La porta parla TLS (certificato già letto): si provano versioni vecchie e cifrari deboli. */
  tls?: boolean;
}

export interface EsitoSondaControllo {
  info: InfoControllo | null;
  tentativiUsati: number;
}

export const PORTE_CONTROLLO = new Set([
  21, 22, 23, 25, 53, 69, 111, 123, 135, 139, 161, 389, 445, 512, 513, 514, 623, 631, 873, 1433, 2049, 2181, 2375, 2379,
  3306, 5432, 5900, 5901, 5984, 5985, 5986, 6000, 6379, 8530, 9200, 10250, 11211, 27017,
]);

function connetti(ip: string, porta: number, ms: number): Promise<net.Socket | null> {
  return new Promise((resolve) => {
    const sock = net.connect({ host: ip, port: porta });
    const timer = setTimeout(() => {
      sock.destroy();
      resolve(null);
    }, ms);
    sock.once("connect", () => {
      clearTimeout(timer);
      resolve(sock);
    });
    sock.once("error", () => {
      clearTimeout(timer);
      sock.destroy();
      resolve(null);
    });
  });
}

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
      if (tot >= TETTO || (fine && fine(Buffer.concat(parti)))) chiudi();
    };
    const timer = setTimeout(chiudi, ms);
    sock.on("data", suDati);
    sock.once("end", chiudi);
    sock.once("close", chiudi);
    sock.once("error", chiudi);
  });
}

async function conTesto(ip: string, porta: number, ms: number, invio: string | Buffer, fine?: (b: Buffer) => boolean): Promise<Buffer | null> {
  const s = await connetti(ip, porta, ms);
  if (!s) return null;
  try {
    s.write(invio);
    const r = await leggi(s, ms, fine);
    return r.length > 0 ? r : null;
  } finally {
    s.destroy();
  }
}

/** Bind LDAP v3 anonimo (DN e password vuoti). */
export const LDAP_BIND_ANONIMO = Buffer.from([0x30, 0x0c, 0x02, 0x01, 0x01, 0x60, 0x07, 0x02, 0x01, 0x03, 0x04, 0x00, 0x80, 0x00]);

export function ldapBindRiuscito(buf: Buffer): boolean {
  return ldapResultCode(buf) === 0;
}

/** resultCode del BindResponse (byte dopo 0x0a 0x01). 13 = confidentialityRequired. */
export function ldapResultCode(buf: Buffer): number | null {
  const i = buf.indexOf(0x61);
  if (i < 0) return null;
  const j = buf.indexOf(Buffer.from([0x0a, 0x01]), i);
  if (j < 0 || j + 2 >= buf.length) return null;
  return buf[j + 2]!;
}

async function provaLdapAnonimo(ip: string, porta: number, ms: number): Promise<boolean | undefined> {
  const r = await conTesto(ip, porta, ms, LDAP_BIND_ANONIMO, (b) => ldapResultCode(b) !== null);
  const codice = r ? ldapResultCode(r) : null;
  return codice === null ? undefined : codice === 0;
}

export function redisSenzaAuth(buf: Buffer): boolean {
  return /^\+PONG\r?\n/.test(buf.toString("latin1"));
}

export async function provaRedis(ip: string, porta: number, ms: number): Promise<boolean | undefined> {
  const r = await conTesto(ip, porta, ms, "PING\r\n", (b) => b.includes(0x0a));
  if (!r) return undefined;
  if (redisSenzaAuth(r)) return true;
  return /^-(NOAUTH|NOPERM)\b/i.test(r.toString("latin1")) ? false : undefined;
}

function bsonDocumento(campi: Array<{ nome: string; valore: number }>): Buffer {
  const parti: Buffer[] = [];
  for (const c of campi) {
    const key = Buffer.from(`${c.nome}\0`, "utf8");
    const el = Buffer.alloc(1 + key.length + 4);
    el[0] = 0x10;
    key.copy(el, 1);
    el.writeInt32LE(c.valore, 1 + key.length);
    parti.push(el);
  }
  const corpo = Buffer.concat(parti);
  const doc = Buffer.alloc(4 + corpo.length + 1);
  doc.writeInt32LE(doc.length, 0);
  corpo.copy(doc, 4);
  doc[doc.length - 1] = 0;
  return doc;
}

/** OP_QUERY `{ listDatabases: 1 }` su admin.$cmd. */
export function pacchettoMongoListDatabases(): Buffer {
  const coll = Buffer.from("admin.$cmd\0");
  const doc = bsonDocumento([{ nome: "listDatabases", valore: 1 }]);
  const dopoHeader = 4 + coll.length + 4 + 4 + doc.length;
  const tot = 16 + dopoHeader;
  const buf = Buffer.alloc(tot);
  buf.writeInt32LE(tot, 0);
  buf.writeInt32LE(1, 4);
  buf.writeInt32LE(0, 8);
  buf.writeInt32LE(2004, 12);
  buf.writeInt32LE(0, 16);
  coll.copy(buf, 20);
  buf.writeInt32LE(0, 20 + coll.length);
  buf.writeInt32LE(-1, 24 + coll.length);
  doc.copy(buf, 28 + coll.length);
  return buf;
}

export function mongoSenzaAuth(buf: Buffer): boolean {
  if (buf.length < 36) return false;
  const opcode = buf.readInt32LE(12);
  if (opcode !== 1) return false;
  const nDocs = buf.readInt32LE(32);
  if (nDocs <= 0) return false;
  const testo = buf.toString("latin1");
  if (/not authorized|unauthorized|authentication is required/i.test(testo)) return false;
  return /listDatabases|ok\x00/.test(testo) || testo.includes("databases");
}

export async function provaMongo(ip: string, porta: number, ms: number): Promise<boolean> {
  const r = await conTesto(ip, porta, ms, pacchettoMongoListDatabases(), (b) => b.length >= 36);
  return r ? mongoSenzaAuth(r) : false;
}

export function rpcCall(xid: number, prog: number, vers: number, proc: number): Buffer {
  const b = Buffer.alloc(40);
  b.writeUInt32BE(xid, 0);
  b.writeUInt32BE(0, 4);
  b.writeUInt32BE(2, 8);
  b.writeUInt32BE(prog, 12);
  b.writeUInt32BE(vers, 16);
  b.writeUInt32BE(proc, 20);
  return b;
}

export function rpcSuTcp(payload: Buffer): Buffer {
  const h = Buffer.alloc(4);
  h.writeUInt32BE((payload.length | 0x80000000) >>> 0, 0);
  return Buffer.concat([h, payload]);
}

export function nfsNullAccettato(buf: Buffer): boolean {
  if (buf.length < 28) return false;
  const record = buf[0] & 0x80 ? buf.subarray(4) : buf;
  if (record.length < 24) return false;
  const reply = record.readUInt32BE(4);
  const stato = record.readUInt32BE(8);
  return reply === 1 && stato === 0;
}

export async function provaNfs(ip: string, porta: number, ms: number): Promise<boolean> {
  const pkt = rpcSuTcp(rpcCall(0xda190003, 100003, 3, 0));
  const r = await conTesto(ip, porta, ms, pkt, (b) => b.length >= 28);
  return r ? nfsNullAccettato(r) : false;
}

function vncVersione(banner: Buffer): string | null {
  const r = /^RFB 003\.(\d{3})\n$/.exec(banner.toString("latin1"));
  if (!r) return null;
  return r[1] === "007" || r[1] === "008" ? r[1] : "003";
}

function vncTipiOfferti(versione: string, tipi: Buffer): number[] {
  if (versione === "003") {
    if (tipi.length < 4) return [];
    const tipo = tipi.readUInt32BE(0);
    return tipo === 0 ? [] : [tipo];
  }
  const n = tipi[0] ?? 0;
  return n > 0 && tipi.length >= 1 + n ? [...tipi.subarray(1, 1 + n)] : [];
}

export function vncSenzaAuthDaHandshake(banner: Buffer, tipi: Buffer): boolean {
  const versione = vncVersione(banner);
  return versione !== null && vncTipiOfferti(versione, tipi).includes(1);
}

/** Tipo 2 = password VNC (DES a 8 caratteri). */
export function vncAuthDeboleDaHandshake(banner: Buffer, tipi: Buffer): boolean {
  const versione = vncVersione(banner);
  return versione !== null && vncTipiOfferti(versione, tipi).includes(2);
}

export async function provaVnc(
  ip: string,
  porta: number,
  ms: number,
): Promise<{ none: boolean; debole: boolean } | null> {
  const s = await connetti(ip, porta, ms);
  if (!s) return null;
  try {
    const banner = await leggi(s, ms, (b) => b.includes(0x0a));
    const versione = vncVersione(banner);
    if (!versione) return null;
    s.write(`RFB 003.${versione}\n`);
    const dati = await leggi(s, ms, (b) => versione === "003" ? b.length >= 4 : b.length > (b[0] ?? 0));
    const tipi = vncTipiOfferti(versione, dati);
    if (!tipi.length) return null;
    return { none: tipi.includes(1), debole: tipi.includes(2) };
  } finally {
    s.destroy();
  }
}

const OID_SYSNAME = "1.3.6.1.2.1.1.5.0";

/** GET sysName con community private, poi SET dello stesso valore. */
export async function provaSnmpWrite(ip: string, ms: number): Promise<boolean> {
  try {
    const letto = await provaVersioniSnmp(snmp, ip, "private", {
      port: 161,
      timeoutMs: ms,
      oids: [OID_SYSNAME],
    });
    if (!letto.ok) return false;
    const raw = letto.varbinds[0]?.value;
    const valore = Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw ?? "");
    if (!valore.trim()) return false;
    return await new Promise((resolve) => {
      const session = apriSessioneCommunity(snmp, ip, "private", {
        port: 161,
        timeout: ms,
        retries: 0,
        versione: letto.versione,
      });
      let chiuso = false;
      const fine = (ok: boolean) => {
        if (chiuso) return;
        chiuso = true;
        clearTimeout(t);
        try {
          session.close();
        } catch {
          /* già chiusa */
        }
        resolve(ok);
      };
      const t = setTimeout(() => fine(false), ms + 500);
      session.set([{ oid: OID_SYSNAME, type: 4, value: valore }], (err) => fine(!err));
    });
  } catch {
    return false;
  }
}

export async function provaSnmpPublic(ip: string, ms: number): Promise<string | null> {
  try {
    const esito = await provaVersioniSnmp(snmp, ip, "public", {
      port: 161,
      timeoutMs: ms,
      oids: [OID_SYSDESCR],
    });
    if (!esito.ok) return null;
    const v = esito.varbinds[0]?.value;
    if (typeof v === "string" && v.trim()) return v.trim().slice(0, 400);
    if (Buffer.isBuffer(v) && v.length > 0) return v.toString("utf8").trim().slice(0, 400);
    return v != null ? String(v).slice(0, 400) : "ok";
  } catch {
    return null;
  }
}

function rigaFtp(buf: Buffer): string {
  return buf.toString("latin1");
}

export async function provaFtpAnonimo(ip: string, porta: number, ms: number): Promise<boolean> {
  const s = await connetti(ip, porta, ms);
  if (!s) return false;
  try {
    const banner = await leggi(s, ms, (b) => b.includes(0x0a));
    if (!/^220/m.test(rigaFtp(banner))) return false;
    s.write("USER anonymous\r\n");
    const u = await leggi(s, ms, (b) => b.includes(0x0a));
    const tu = rigaFtp(u);
    if (/^230/m.test(tu)) return true;
    if (!/^331/m.test(tu)) return false;
    s.write("PASS da-ipam@\r\n");
    const p = await leggi(s, ms, (b) => b.includes(0x0a));
    return /^230/m.test(rigaFtp(p));
  } finally {
    s.destroy();
  }
}

function httpGet(
  ip: string,
  porta: number,
  https: boolean,
  ms: number,
  authorization?: string,
  percorso = "/",
): Promise<{ code: number; corpo: string; challenge: string } | null> {
  return new Promise((resolve) => {
    const request = https ? richiestaHttps : richiestaHttp;
    const headers = { "User-Agent": AGENTE_NEUTRO, ...(authorization ? { Authorization: authorization } : {}) };
    const req = request({ hostname: ip, port: porta, path: percorso, headers, agent: false, rejectUnauthorized: false }, (res) => {
      const code = res.statusCode ?? 0;
      const challenge = res.headers["www-authenticate"] ?? "";
      const parti: Buffer[] = [];
      let bytes = 0;
      const termina = () => {
        clearTimeout(timer);
        resolve({ code, corpo: Buffer.concat(parti).toString("utf8"), challenge });
      };
      res.on("data", (chunk: Buffer) => {
        parti.push(chunk.subarray(0, TETTO - bytes));
        bytes += chunk.length;
        if (bytes >= TETTO) {
          termina();
          req.destroy();
        }
      });
      res.once("end", termina);
      res.once("error", () => {
        clearTimeout(timer);
        resolve(null);
      });
    });
    const timer = setTimeout(() => {
      req.destroy();
      resolve(null);
    }, ms);
    req.once("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
    req.end();
  });
}

const LOGIN_FABBRICA_HTTP: ReadonlyArray<{ utente: string; password: string }> = [
  { utente: "admin", password: "admin" },
  { utente: "admin", password: "password" },
];

export function memcachedAperto(buf: Buffer): boolean {
  return /STAT /m.test(buf.toString("latin1"));
}

export async function provaMemcached(ip: string, porta: number, ms: number): Promise<boolean> {
  const r = await conTesto(ip, porta, ms, "stats\r\n", (b) => b.includes("END") || b.length > 64);
  return r ? memcachedAperto(r) : false;
}

export async function provaZookeeper(ip: string, porta: number, ms: number): Promise<boolean> {
  const r = await conTesto(ip, porta, ms, "ruok", (b) => b.length >= 4);
  return r ? r.toString("latin1").includes("imok") : false;
}

async function httpJsonSenzaAuth(ip: string, porta: number, https: boolean, percorso: string, ms: number, indizio: RegExp): Promise<boolean> {
  const r = await httpGet(ip, porta, https, ms, undefined, percorso);
  return r != null && r.code >= 200 && r.code < 300 && indizio.test(r.corpo);
}

function schemiHttp(porta: number): boolean[] {
  if (porta === 80 || porta === 8080 || porta === 8000 || porta === 8888) return [false];
  if (porta === 443 || porta === 8443 || porta === 9443) return [true, false];
  return [false, true];
}

function accessoNegato(code: number): boolean {
  return code === 401 || code === 403 || code === 404 || code === 410;
}

async function percorsiSuSchema(
  ip: string,
  porta: number,
  https: boolean,
  ms: number,
): Promise<Pick<InfoControllo, "actuator_health" | "git_env">> {
  const out: Pick<InfoControllo, "actuator_health" | "git_env"> = {};
  const git = await httpGet(ip, porta, https, ms, undefined, "/.git/HEAD");
  if (git?.code === 200 && /^(?:ref: refs\/[\w./-]+|[0-9a-f]{40}|[0-9a-f]{64})\s*$/.test(git.corpo)) {
    out.git_env = ".git/HEAD";
  } else {
    const env = await httpGet(ip, porta, https, ms, undefined, "/.env");
    if (env?.code === 200 && /^(?:export +)?[A-Za-z_][A-Za-z0-9_]*\s*=/m.test(env.corpo) && !/^\s*</.test(env.corpo)) {
      out.git_env = ".env";
    } else if (git && env && accessoNegato(git.code) && accessoNegato(env.code)) {
      out.git_env = null;
    }
  }
  const act = await httpGet(ip, porta, https, ms, undefined, "/actuator/health");
  if (act?.code === 200) {
    try {
      const body = JSON.parse(act.corpo) as { status?: unknown } | null;
      if (typeof body?.status === "string" && /^(UP|DOWN|OUT_OF_SERVICE|UNKNOWN)$/.test(body.status)) {
        out.actuator_health = true;
      }
    } catch {
      // Una pagina HTML o una risposta incompleta non è evidenza di Actuator.
    }
  } else if (act && accessoNegato(act.code)) out.actuator_health = false;
  return out;
}

/** Prova anche le porte non standard già riconosciute come HTTP. */
export async function provaPercorsiHttp(ip: string, porta: number, ms: number): Promise<Pick<InfoControllo, "actuator_health" | "git_env">> {
  const esiti = [];
  for (const https of schemiHttp(porta)) esiti.push(await percorsiSuSchema(ip, porta, https, ms));
  const git = esiti.find((x) => x.git_env)?.git_env;
  return {
    ...(git ? { git_env: git } : esiti.every((x) => x.git_env === null) ? { git_env: null } : {}),
    ...(esiti.some((x) => x.actuator_health === true) ? { actuator_health: true }
      : esiti.every((x) => x.actuator_health === false) ? { actuator_health: false } : {}),
  };
}

export function adcsDaHttp(code: number, corpo: string): boolean {
  return code === 200 && /certificate services|microsoft certificate|certfnsh\.asp|certcarc\.asp/i.test(corpo);
}

export function jenkinsScriptDaHttp(code: number, corpo: string): boolean {
  return code === 200 && /script console/i.test(corpo) && /<textarea\b/i.test(corpo);
}

async function provaAdcs(ip: string, porta: number, ms: number): Promise<boolean> {
  for (const https of schemiHttp(porta)) {
    const r = await httpGet(ip, porta, https, ms, undefined, "/certsrv/");
    if (r && adcsDaHttp(r.code, r.corpo)) return true;
  }
  return false;
}

async function provaJenkinsScript(ip: string, porta: number, ms: number): Promise<boolean> {
  for (const https of schemiHttp(porta)) {
    const r = await httpGet(ip, porta, https, ms, undefined, "/script");
    if (r && jenkinsScriptDaHttp(r.code, r.corpo)) return true;
  }
  return false;
}

export function x11Accettato(buf: Buffer): boolean {
  return buf.length >= 8 && buf[0] === 1;
}

export async function provaX11(ip: string, porta: number, ms: number): Promise<boolean> {
  // Connection setup little-endian, byte-order l, unused, proto 11.0
  const req = Buffer.from([0x6c, 0x00, 0x0b, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
  const r = await conTesto(ip, porta, ms, req, (b) => b.length >= 8);
  return r ? x11Accettato(r) : false;
}

export const RMCP_PING = Buffer.from([0x06, 0x00, 0xff, 0x06, 0x00, 0x00, 0x11, 0xbe, 0x80, 0x00, 0x00, 0x00]);

/** RMCP+ Open Session con cipher suite 0 (auth/integrity/conf = none). */
export function pacchettoIpmiOpenSessionCipher0(): Buffer {
  const payload = Buffer.alloc(32);
  payload[2] = 0x04;
  payload.writeUInt32LE(0xa0a1a2a3, 4);
  payload[8] = 0x00;
  payload[11] = 0x08;
  payload[16] = 0x01;
  payload[19] = 0x08;
  payload[24] = 0x02;
  payload[27] = 0x08;
  const pkt = Buffer.alloc(48);
  pkt[0] = 0x06;
  pkt[2] = 0xff;
  pkt[3] = 0x07;
  pkt[4] = 0x06;
  pkt[5] = 0x10;
  pkt.writeUInt16LE(32, 14);
  payload.copy(pkt, 16);
  return pkt;
}

export function ipmiPong(buf: Buffer): boolean {
  return buf.length >= 12 && buf[0] === 0x06 && buf[3] === 0x06 && buf[8] === 0x40;
}

/** Open Session Response: payload type 0x11, status 0x00 = cipher 0 accettato. */
export function ipmiCipher0Accettato(buf: Buffer): boolean {
  if (buf.length < 18) return false;
  if (buf[0] !== 0x06 || buf[4] !== 0x06) return false;
  if ((buf[5]! & 0x3f) !== 0x11) return false;
  return buf[17] === 0x00;
}

function udpScambio(ip: string, porta: number, req: Buffer, ms: number, accetta: (b: Buffer) => boolean): Promise<boolean> {
  return new Promise((resolve) => {
    const s = dgram.createSocket("udp4");
    const t = setTimeout(() => {
      s.close();
      resolve(false);
    }, ms);
    s.once("message", (m) => {
      clearTimeout(t);
      s.close();
      resolve(accetta(m));
    });
    s.once("error", () => {
      clearTimeout(t);
      s.close();
      resolve(false);
    });
    s.send(req, porta, ip, (e) => {
      if (e) {
        clearTimeout(t);
        s.close();
        resolve(false);
      }
    });
  });
}

export async function provaIpmi(ip: string, ms: number, porta = 623): Promise<{ esposto: boolean; cipher0: boolean }> {
  const esposto = await udpScambio(ip, porta, RMCP_PING, ms, ipmiPong);
  if (!esposto) return { esposto: false, cipher0: false };
  const cipher0 = await udpScambio(ip, porta, pacchettoIpmiOpenSessionCipher0(), ms, ipmiCipher0Accettato);
  return { esposto, cipher0 };
}

function mysqlLenenc(buf: Buffer): { n: number; o: number } | null {
  if (buf.length < 4) return null;
  return { n: buf.readUInt8(0) + (buf.readUInt8(1) << 8) + (buf.readUInt8(2) << 16), o: 4 };
}

export async function provaMysqlRootVuoto(ip: string, porta: number, ms: number): Promise<boolean> {
  const s = await connetti(ip, porta, ms);
  if (!s) return false;
  try {
    const hs = await leggi(s, ms, (b) => b.length >= 5);
    const L = mysqlLenenc(hs);
    if (!L || hs[4] !== 0x0a) return false;
    const user = Buffer.from("root\0");
    const body = Buffer.alloc(32 + user.length + 2);
    body.writeUInt32LE(0x000aa285, 0);
    body.writeUInt32LE(0x01000000, 4);
    body[8] = 33;
    user.copy(body, 32);
    body[32 + user.length] = 0;
    const pkt = Buffer.alloc(4 + body.length);
    pkt.writeUInt8(body.length & 0xff, 0);
    pkt.writeUInt8((body.length >> 8) & 0xff, 1);
    pkt[3] = 1;
    body.copy(pkt, 4);
    s.write(pkt);
    const r = await leggi(s, ms, (b) => b.length >= 5);
    return r.length >= 5 && r[4] === 0x00;
  } finally {
    s.destroy();
  }
}

export async function provaPostgresFabbrica(ip: string, porta: number, ms: number): Promise<boolean> {
  const s = await connetti(ip, porta, ms);
  if (!s) return false;
  try {
    const payload = Buffer.from("\0\x03\0\0user\0postgres\0database\0postgres\0\0");
    const msg = Buffer.alloc(4 + payload.length);
    msg.writeInt32BE(msg.length, 0);
    payload.copy(msg, 4);
    s.write(msg);
    const r = await leggi(s, ms, (b) => b.length >= 9);
    if (r.length < 9) return false;
    const tipo = String.fromCharCode(r[0]);
    if (tipo === "R" && r.readInt32BE(5) === 0) return true; // AuthenticationOk
    if (tipo === "R" && r.readInt32BE(5) === 3) {
      const pwd = Buffer.from("postgres");
      const p = Buffer.alloc(5 + pwd.length + 1);
      p[0] = 0x70;
      p.writeInt32BE(p.length - 1, 1);
      pwd.copy(p, 5);
      s.write(p);
      const r2 = await leggi(s, ms, (b) => b.length >= 9);
      return r2.length >= 9 && r2[0] === 0x52 && r2.readInt32BE(5) === 0;
    }
    return false;
  } finally {
    s.destroy();
  }
}

function tdsPassword(s: string): Buffer {
  const b = Buffer.from(s, "utf16le");
  for (let i = 0; i < b.length; i++) {
    const c = b[i]! ^ 0xa5;
    b[i] = ((c << 4) | (c >> 4)) & 0xff;
  }
  return b;
}

/** LOGIN7 sa / password vuota (TDS 7.1). */
export function pacchettoLogin7Sa(): Buffer {
  // Nome della postazione dichiarato nella prova: neutro, non il nome del programma (identita-neutra.ts).
  const host = Buffer.from("CLIENT", "utf16le");
  const user = Buffer.from("sa", "utf16le");
  const pass = tdsPassword("");
  const app = Buffer.from("DA-IPAM", "utf16le");
  const fisso = 94;
  const dati = Buffer.concat([host, user, pass, app]);
  const payload = Buffer.alloc(fisso + dati.length);
  payload.writeUInt32LE(payload.length, 0);
  payload.writeUInt32LE(0x71000001, 4);
  payload.writeUInt32LE(4096, 8);
  payload[24] = 0xe0;
  payload[25] = 0x03;
  const campo = (o: number, ib: number, cch: number) => {
    payload.writeUInt16LE(ib, o);
    payload.writeUInt16LE(cch, o + 2);
  };
  let ib = fisso;
  campo(36, ib, host.length / 2);
  ib += host.length;
  campo(40, ib, user.length / 2);
  ib += user.length;
  campo(44, ib, pass.length / 2);
  ib += pass.length;
  campo(48, ib, app.length / 2);
  dati.copy(payload, fisso);
  const pkt = Buffer.alloc(8 + payload.length);
  pkt[0] = 0x10;
  pkt[1] = 0x01;
  pkt.writeUInt16BE(pkt.length, 2);
  payload.copy(pkt, 8);
  return pkt;
}

/** Token LOGINACK (0xAD) nel flusso TDS; ERROR (0xAA) = rifiuto. */
export function tdsLoginRiuscito(buf: Buffer): boolean {
  if (buf.length < 9) return false;
  let i = 8;
  while (i < buf.length) {
    const tok = buf[i];
    if (tok === 0xad) return true;
    if (tok === 0xaa || tok === 0xfd || tok === 0xff) return false;
    if (i + 3 > buf.length) return false;
    i += 3 + buf.readUInt16LE(i + 1);
  }
  return false;
}

export async function provaMssqlSa(ip: string, porta: number, ms: number): Promise<boolean> {
  const s = await connetti(ip, porta, ms);
  if (!s) return false;
  try {
    const pre = Buffer.alloc(8);
    pre[0] = 0x12;
    pre[1] = 0x01;
    pre.writeUInt16BE(8, 2);
    s.write(pre);
    await leggi(s, ms, (b) => b.length >= 8);
    s.write(pacchettoLogin7Sa());
    const r2 = await leggi(s, ms, (b) => b.length >= 9);
    return tdsLoginRiuscito(r2);
  } finally {
    s.destroy();
  }
}

/**
 * Una porta: prove senza login sempre; FTP/HTTP/DB/MS17/IPMI solo con
 * `proveFabbrica`, e solo se restano tentativi per l'host.
 */
export async function sondaControllo(ip: string, porta: number, opz: OpzioniControllo = {}): Promise<EsitoSondaControllo> {
  const ms = opz.timeoutMs ?? 2500;
  const info: InfoControllo = {};
  let tentativiUsati = 0;
  const https = porta === 443 || porta === 8443;
  const tentaLogin = () => {
    if (!opz.proveFabbrica || !opz.consumaTentativo?.()) return false;
    tentativiUsati += 1;
    return true;
  };

  try {
    if (porta === 389) {
      const anonimo = await provaLdapAnonimo(ip, porta, ms);
      if (anonimo !== undefined) info.ldap_anonimo = anonimo;
    } else if (porta === 6379) {
      const aperto = await provaRedis(ip, porta, ms);
      if (aperto !== undefined) info.redis_aperto = aperto;
    } else if (porta === 27017) {
      if (await provaMongo(ip, porta, ms)) info.mongo_aperto = true;
    } else if (porta === 2049 || porta === 111) {
      if (porta === 2049 && (await provaNfs(ip, porta, ms))) info.nfs_risponde = true;
      const pubblico = await provaNfsExportStella(ip, ms);
      if (pubblico !== undefined) info.nfs_export_pubblico = pubblico;
    } else if (porta === 161) {
      const sys = await provaSnmpPublic(ip, ms);
      if (sys) info.snmp_public = sys;
      if (opz.proveFabbrica && (await provaSnmpWrite(ip, ms))) info.snmp_write = true;
    } else if (porta === 5900 || porta === 5901) {
      const vnc = await provaVnc(ip, porta, ms);
      if (vnc) {
        info.vnc_senza_auth = vnc.none;
        info.vnc_auth_debole = vnc.debole;
      }
    } else if (porta === 445 || porta === 139) {
      Object.assign(info, await sondaSmb(ip, porta, ms, opz.proveFabbrica === true));
    } else if (porta === 11211) {
      if (await provaMemcached(ip, porta, ms)) info.memcached = true;
    } else if (porta === 2181) {
      if (await provaZookeeper(ip, porta, ms)) info.zookeeper = true;
    } else if (porta === 9200) {
      if (await httpJsonSenzaAuth(ip, porta, false, "/", ms, /cluster_name|tagline|You Know, for Search/i)) info.elasticsearch = true;
    } else if (porta === 2375) {
      if (await httpJsonSenzaAuth(ip, porta, false, "/version", ms, /"ApiVersion"\s*:\s*"/i)) info.docker = true;
    } else if (porta === 2379) {
      if (await httpJsonSenzaAuth(ip, porta, false, "/version", ms, /etcdcluster|etcdserver/i)) info.etcd = true;
    } else if (porta === 5984) {
      if (await httpJsonSenzaAuth(ip, porta, false, "/", ms, /couchdb/i)) info.couchdb = true;
    } else if (porta === 10250) {
      if (await httpJsonSenzaAuth(ip, porta, true, "/runningpods/", ms, /items|kind/i)) info.kubelet = true;
    } else if (porta === 6000) {
      if (await provaX11(ip, porta, ms)) info.x11 = true;
    } else if (porta === 22) {
      if (await provaSshPasswordOfferta(ip, porta, ms)) info.ssh_password = true;
    } else if (porta === 53) {
      if (await provaDnsAxfr(ip, porta, ms)) info.dns_axfr = true;
    } else if (porta === 69) {
      if (await provaTftp(ip, ms)) info.tftp = true;
    } else if (porta === 123) {
      if (await provaNtpMonlist(ip, ms)) info.ntp_monlist = true;
    } else if (porta === 873) {
      if (await provaRsync(ip, porta, ms)) info.rsync = true;
    } else if (porta === 25) {
      if (await provaSmtpVrfy(ip, porta, ms)) info.smtp_vrfy = true;
    } else if (opz.proveFabbrica && porta === 623) {
      const ipmi = await provaIpmi(ip, ms);
      if (ipmi.esposto) info.ipmi_esposto = true;
      if (ipmi.cipher0) {
        info.ipmi_cipher0 = true;
        if (await provaIpmiRakp(ip, ms, porta)) info.ipmi_rakp = true;
      }
    } else if (porta === 21 && tentaLogin()) {
      if (await provaFtpAnonimo(ip, porta, ms)) info.fabbrica = { servizio: "ftp", utente: "anonymous" };
    } else if (porta === 3306 && tentaLogin()) {
      if (await provaMysqlRootVuoto(ip, porta, ms)) info.fabbrica = { servizio: "mysql", utente: "root" };
    } else if (porta === 5432 && tentaLogin()) {
      if (await provaPostgresFabbrica(ip, porta, ms)) info.fabbrica = { servizio: "postgres", utente: "postgres" };
    } else if (porta === 1433 && tentaLogin()) {
      if (await provaMssqlSa(ip, porta, ms)) info.fabbrica = { servizio: "mssql", utente: "sa" };
    }

    // RDP (3389) vuole prima la trattativa X.224: lì la prova a mano non parla.
    if (opz.tls && porta !== 3389) {
      const t = await provaTlsAttivo(ip, porta, ms, randomBytes(32));
      if (t.vecchi.length) info.tls_vecchi = t.vecchi;
      if (t.deboli.length) info.tls_cifrari_deboli = t.deboli;
    }

    const httpish =
      porta === 80 || porta === 443 || porta === 8080 || porta === 8443 || porta === 8000 || porta === 8888 || porta === 631;
    if (httpish || !PORTE_CONTROLLO.has(porta)) {
      Object.assign(info, await provaPercorsiHttp(ip, porta, ms));
      if (await provaAdcs(ip, porta, ms)) info.adcs_enrollment = true;
    }
    if (opz.proveFabbrica && httpish && (await provaJenkinsScript(ip, porta, ms))) info.jenkins_script_console = true;
    if (opz.proveFabbrica && httpish) {
      const stato = await httpGet(ip, porta, https, ms);
      if (stato?.code === 401 && /(?:^|,)\s*Basic(?:\s|$)/i.test(stato.challenge)) {
        for (const l of LOGIN_FABBRICA_HTTP) {
          if (!tentaLogin()) break;
          const auth = `Authorization: Basic ${Buffer.from(`${l.utente}:${l.password}`).toString("base64")}`;
          const r = await httpGet(ip, porta, https, ms, auth);
          if (r && r.code >= 200 && r.code < 300) {
            info.fabbrica = { servizio: "http", utente: l.utente };
            break;
          }
        }
      }
    }
  } catch {
    // una porta che parla un altro protocollo non ferma il giro
  }

  return { info: Object.keys(info).length > 0 ? info : null, tentativiUsati };
}
