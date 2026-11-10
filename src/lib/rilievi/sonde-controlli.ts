/**
 * Prove senza credenziali (e login di fabbrica solo se chiesti) sulle porte
 * già aperte. Scritte da zero: Nety è GPL-3.0, se ne riprende l'idea.
 */
import dgram from "node:dgram";
import net from "node:net";
import * as snmp from "net-snmp";
import { provaVersioniSnmp } from "@/lib/protocols/snmp-sessione";
import type { InfoControllo } from "./controlli";
import { sondaSmb } from "./smb-controlli";

const TETTO = 16 * 1024;
const OID_SYSDESCR = "1.3.6.1.2.1.1.1.0";

export interface OpzioniControllo {
  timeoutMs?: number;
  proveFabbrica?: boolean;
  tentativiRestanti?: number;
}

export interface EsitoSondaControllo {
  info: InfoControllo | null;
  tentativiUsati: number;
}

export const PORTE_CONTROLLO = new Set([
  21, 23, 139, 161, 389, 445, 623, 1433, 2049, 2181, 2375, 2379, 3306, 5432, 5900, 5901, 5984, 5985, 5986, 6000, 6379,
  8530, 9200, 10250, 11211, 27017,
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
  const i = buf.indexOf(Buffer.from([0x61]));
  if (i < 0) return false;
  return buf.includes(Buffer.from([0x0a, 0x01, 0x00]), i);
}

export async function provaLdapAnonimo(ip: string, porta: number, ms: number): Promise<boolean> {
  const r = await conTesto(ip, porta, ms, LDAP_BIND_ANONIMO, (b) => b.includes(0x61));
  return r ? ldapBindRiuscito(r) : false;
}

export function redisSenzaAuth(buf: Buffer): boolean {
  const t = buf.toString("latin1");
  if (/^-NOAUTH/i.test(t) || /^-ERR.*auth/i.test(t)) return false;
  return /^\+PONG/m.test(t);
}

export async function provaRedis(ip: string, porta: number, ms: number): Promise<boolean> {
  const r = await conTesto(ip, porta, ms, "PING\r\n", (b) => b.includes(0x0a));
  return r ? redisSenzaAuth(r) : false;
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

export function vncSenzaAuthDaHandshake(banner: Buffer, tipi: Buffer): boolean {
  const ident = banner.toString("latin1").split("\n")[0] ?? "";
  if (!ident.startsWith("RFB ")) return false;
  if (/RFB 003\.003/.test(ident)) {
    if (tipi.length < 4) return false;
    return tipi.readUInt32BE(0) === 1;
  }
  if (tipi.length < 1) return false;
  const n = tipi[0];
  if (n < 1 || tipi.length < 1 + n) return false;
  return tipi.subarray(1, 1 + n).includes(1);
}

export async function provaVnc(ip: string, porta: number, ms: number): Promise<boolean> {
  const s = await connetti(ip, porta, ms);
  if (!s) return false;
  try {
    const banner = await leggi(s, ms, (b) => b.includes(0x0a));
    if (!banner.toString("latin1").startsWith("RFB ")) return false;
    s.write("RFB 003.008\n");
    const tipi = await leggi(s, ms, (b) => b.length >= 1);
    return vncSenzaAuthDaHandshake(banner, tipi);
  } finally {
    s.destroy();
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

async function httpGet(
  ip: string,
  porta: number,
  https: boolean,
  ms: number,
  extraHeader?: string,
  percorso = "/",
): Promise<{ code: number; corpo: string } | null> {
  const tls = https ? await import("node:tls") : null;
  const extra = extraHeader ? `${extraHeader}\r\n` : "";
  const req = `GET ${percorso} HTTP/1.1\r\nHost: ${ip}\r\n${extra}User-Agent: DA-IPAM\r\nConnection: close\r\n\r\n`;
  const sock: net.Socket | null = https
    ? await new Promise((resolve) => {
        const s = tls!.connect({ host: ip, port: porta, rejectUnauthorized: false, ALPNProtocols: ["http/1.1"] });
        const timer = setTimeout(() => {
          s.destroy();
          resolve(null);
        }, ms);
        s.once("secureConnect", () => {
          clearTimeout(timer);
          resolve(s);
        });
        s.once("error", () => {
          clearTimeout(timer);
          s.destroy();
          resolve(null);
        });
      })
    : await connetti(ip, porta, ms);
  if (!sock) return null;
  try {
    sock.write(req);
    const r = await leggi(sock, ms, (b) => b.includes("\r\n\r\n") || b.length > 2048);
    const testo = r.toString("latin1");
    const m = /^HTTP\/\d(?:\.\d)?\s+(\d{3})/.exec(testo);
    if (!m) return null;
    const i = testo.indexOf("\r\n\r\n");
    return { code: Number(m[1]), corpo: i >= 0 ? testo.slice(i + 4, i + 400) : "" };
  } finally {
    sock.destroy();
  }
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
  return r != null && r.code >= 200 && r.code < 400 && indizio.test(r.corpo);
}

export async function provaPercorsiHttp(ip: string, porta: number, ms: number): Promise<Pick<InfoControllo, "actuator" | "git_env">> {
  const https = porta === 443 || porta === 8443;
  const out: Pick<InfoControllo, "actuator" | "git_env"> = {};
  const git = await httpGet(ip, porta, https, ms, undefined, "/.git/HEAD");
  if (git && git.code === 200 && /ref: /.test(git.corpo)) out.git_env = ".git/HEAD";
  if (!out.git_env) {
    const env = await httpGet(ip, porta, https, ms, undefined, "/.env");
    if (env && env.code === 200 && /=/.test(env.corpo) && !/</.test(env.corpo.slice(0, 80))) out.git_env = ".env";
  }
  const act = await httpGet(ip, porta, https, ms, undefined, "/actuator/health");
  if (act && act.code === 200 && /status|UP/i.test(act.corpo)) out.actuator = true;
  return out;
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

export function ipmiPong(buf: Buffer): boolean {
  return buf.length >= 12 && buf[0] === 0x06 && buf[3] === 0x06 && buf[8] === 0x40;
}

export async function provaIpmi(ip: string, ms: number): Promise<{ esposto: boolean; cipher0: boolean }> {
  const esposto = await new Promise<boolean>((resolve) => {
    const s = dgram.createSocket("udp4");
    const t = setTimeout(() => {
      s.close();
      resolve(false);
    }, ms);
    s.once("message", (m) => {
      clearTimeout(t);
      s.close();
      resolve(ipmiPong(m));
    });
    s.once("error", () => {
      clearTimeout(t);
      s.close();
      resolve(false);
    });
    s.send(RMCP_PING, 623, ip, (e) => {
      if (e) {
        clearTimeout(t);
        s.close();
        resolve(false);
      }
    });
  });
  return { esposto, cipher0: false };
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

/** LOGIN7 sa con password vuota; LOGINACK (0xAD) = successo. */
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
    const user = Buffer.from("sa", "utf16le");
    const pass = tdsPassword("");
    const app = Buffer.from("DA-IPAM", "utf16le");
    const fisso = 94;
    const payload = Buffer.alloc(fisso + user.length + pass.length + app.length);
    payload.writeUInt32LE(payload.length, 0);
    payload.writeUInt32LE(0x71000001, 4);
    payload.writeUInt32LE(4096, 8);
    payload.writeUInt32LE(fisso, 36);
    payload.writeUInt16LE(user.length / 2, 38);
    payload.writeUInt32LE(fisso + user.length, 40);
    payload.writeUInt16LE(pass.length / 2, 42);
    payload.writeUInt32LE(fisso + user.length + pass.length, 44);
    payload.writeUInt16LE(app.length / 2, 46);
    user.copy(payload, fisso);
    pass.copy(payload, fisso + user.length);
    app.copy(payload, fisso + user.length + pass.length);
    const pkt = Buffer.alloc(8 + payload.length);
    pkt[0] = 0x10;
    pkt[1] = 0x01;
    pkt.writeUInt16BE(pkt.length, 2);
    payload.copy(pkt, 8);
    s.write(pkt);
    const r2 = await leggi(s, ms, (b) => b.length >= 9);
    return r2.length >= 9 && r2[8] === 0xad;
  } finally {
    s.destroy();
  }
}

function controlloHaEsito(info: InfoControllo): boolean {
  return Boolean(
    info.ldap_anonimo ||
      info.redis_aperto ||
      info.mongo_aperto ||
      info.nfs_risponde ||
      info.snmp_public ||
      info.vnc_senza_auth ||
      info.fabbrica ||
      info.smbv1 ||
      info.smb_null ||
      info.smb_guest ||
      (info.smb_share_anon && info.smb_share_anon.length) ||
      info.memcached ||
      info.zookeeper ||
      info.elasticsearch ||
      info.docker ||
      info.etcd ||
      info.couchdb ||
      info.kubelet ||
      info.actuator ||
      info.git_env ||
      info.x11 ||
      info.ms17_010 ||
      info.ipmi_esposto ||
      info.ipmi_cipher0,
  );
}

/**
 * Una porta: prove senza login sempre; FTP/HTTP/DB/MS17/IPMI solo con
 * `proveFabbrica`, e solo se restano tentativi per l'host.
 */
export async function sondaControllo(ip: string, porta: number, opz: OpzioniControllo = {}): Promise<EsitoSondaControllo> {
  const ms = opz.timeoutMs ?? 2500;
  const info: InfoControllo = {};
  let tentativiUsati = 0;
  let restanti = opz.tentativiRestanti ?? 0;
  const https = porta === 443 || porta === 8443;

  try {
    if (porta === 389) {
      if (await provaLdapAnonimo(ip, porta, ms)) info.ldap_anonimo = true;
    } else if (porta === 6379) {
      if (await provaRedis(ip, porta, ms)) info.redis_aperto = true;
    } else if (porta === 27017) {
      if (await provaMongo(ip, porta, ms)) info.mongo_aperto = true;
    } else if (porta === 2049) {
      if (await provaNfs(ip, porta, ms)) info.nfs_risponde = true;
    } else if (porta === 161) {
      const sys = await provaSnmpPublic(ip, ms);
      if (sys) info.snmp_public = sys;
    } else if (porta === 5900 || porta === 5901) {
      if (await provaVnc(ip, porta, ms)) info.vnc_senza_auth = true;
    } else if (porta === 445 || porta === 139) {
      Object.assign(info, await sondaSmb(ip, porta, ms, opz.proveFabbrica === true));
    } else if (porta === 11211) {
      if (await provaMemcached(ip, porta, ms)) info.memcached = true;
    } else if (porta === 2181) {
      if (await provaZookeeper(ip, porta, ms)) info.zookeeper = true;
    } else if (porta === 9200) {
      if (await httpJsonSenzaAuth(ip, porta, false, "/", ms, /cluster_name|tagline|You Know, for Search/i)) info.elasticsearch = true;
    } else if (porta === 2375) {
      if (await httpJsonSenzaAuth(ip, porta, false, "/version", ms, /ApiVersion|Version/i)) info.docker = true;
    } else if (porta === 2379) {
      if (await httpJsonSenzaAuth(ip, porta, false, "/version", ms, /etcdcluster|etcdserver/i)) info.etcd = true;
    } else if (porta === 5984) {
      if (await httpJsonSenzaAuth(ip, porta, false, "/", ms, /couchdb/i)) info.couchdb = true;
    } else if (porta === 10250) {
      if (await httpJsonSenzaAuth(ip, porta, true, "/runningpods/", ms, /items|kind/i)) info.kubelet = true;
    } else if (porta === 6000) {
      if (await provaX11(ip, porta, ms)) info.x11 = true;
    } else if (opz.proveFabbrica && porta === 623) {
      const ipmi = await provaIpmi(ip, ms);
      if (ipmi.esposto) info.ipmi_esposto = true;
      if (ipmi.cipher0) info.ipmi_cipher0 = true;
    } else if (opz.proveFabbrica && porta === 21 && restanti > 0) {
      tentativiUsati += 1;
      restanti -= 1;
      if (await provaFtpAnonimo(ip, porta, ms)) info.fabbrica = { servizio: "ftp", utente: "anonymous" };
    } else if (opz.proveFabbrica && porta === 3306 && restanti > 0) {
      tentativiUsati += 1;
      restanti -= 1;
      if (await provaMysqlRootVuoto(ip, porta, ms)) info.fabbrica = { servizio: "mysql", utente: "root" };
    } else if (opz.proveFabbrica && porta === 5432 && restanti > 0) {
      tentativiUsati += 1;
      restanti -= 1;
      if (await provaPostgresFabbrica(ip, porta, ms)) info.fabbrica = { servizio: "postgres", utente: "postgres" };
    } else if (opz.proveFabbrica && porta === 1433 && restanti > 0) {
      tentativiUsati += 1;
      restanti -= 1;
      if (await provaMssqlSa(ip, porta, ms)) info.fabbrica = { servizio: "mssql", utente: "sa" };
    }

    const httpish = porta === 80 || porta === 443 || porta === 8080 || porta === 8443 || porta === 8000 || porta === 8888;
    if (httpish) {
      Object.assign(info, await provaPercorsiHttp(ip, porta, ms));
    }
    if (opz.proveFabbrica && restanti > 0 && httpish) {
      const stato = await httpGet(ip, porta, https, ms);
      if (stato?.code === 401) {
        for (const l of LOGIN_FABBRICA_HTTP) {
          if (restanti <= 0) break;
          tentativiUsati += 1;
          restanti -= 1;
          const auth = `Authorization: Basic ${Buffer.from(`${l.utente}:${l.password}`).toString("base64")}`;
          const r = await httpGet(ip, porta, https, ms, auth);
          if (r && r.code >= 200 && r.code < 400) {
            info.fabbrica = { servizio: "http", utente: l.utente };
            break;
          }
        }
      }
    }
  } catch {
    // una porta che parla un altro protocollo non ferma il giro
  }

  return { info: controlloHaEsito(info) ? info : null, tentativiUsati };
}
