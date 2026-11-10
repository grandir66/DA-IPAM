/**
 * Prove senza credenziali (e login di fabbrica solo se chiesti) sulle porte
 * già aperte. Scritte da zero: Nety è GPL-3.0, se ne riprende l'idea.
 */
import net from "node:net";
import * as snmp from "net-snmp";
import { provaVersioniSnmp } from "@/lib/protocols/snmp-sessione";
import type { InfoControllo } from "./controlli";

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

export const PORTE_CONTROLLO = new Set([21, 161, 389, 2049, 5900, 5901, 6379, 27017]);

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

async function httpGet(ip: string, porta: number, https: boolean, ms: number, extraHeader?: string): Promise<number | null> {
  const tls = https ? await import("node:tls") : null;
  const extra = extraHeader ? `${extraHeader}\r\n` : "";
  const req = `GET / HTTP/1.1\r\nHost: ${ip}\r\n${extra}User-Agent: DA-IPAM\r\nConnection: close\r\n\r\n`;
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
    const r = await leggi(sock, ms, (b) => b.includes("\r\n"));
    const m = /^HTTP\/\d(?:\.\d)?\s+(\d{3})/.exec(r.toString("latin1"));
    return m ? Number(m[1]) : null;
  } finally {
    sock.destroy();
  }
}

const LOGIN_FABBRICA_HTTP: ReadonlyArray<{ utente: string; password: string }> = [
  { utente: "admin", password: "admin" },
  { utente: "admin", password: "password" },
];

/**
 * Una porta: LDAP/Redis/Mongo/NFS/SNMP/VNC sempre; FTP e Basic HTTP solo con
 * `proveFabbrica`, e solo se restano tentativi per l'host.
 */
export async function sondaControllo(ip: string, porta: number, opz: OpzioniControllo = {}): Promise<EsitoSondaControllo> {
  const ms = opz.timeoutMs ?? 2500;
  const info: InfoControllo = {};
  let tentativiUsati = 0;
  let restanti = opz.tentativiRestanti ?? 0;

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
    } else if (opz.proveFabbrica && porta === 21 && restanti > 0) {
      tentativiUsati += 1;
      restanti -= 1;
      if (await provaFtpAnonimo(ip, porta, ms)) info.fabbrica = { servizio: "ftp", utente: "anonymous" };
    } else if (opz.proveFabbrica && restanti > 0) {
      const https = porta === 443 || porta === 8443;
      const stato = await httpGet(ip, porta, https, ms);
      if (stato === 401) {
        for (const l of LOGIN_FABBRICA_HTTP) {
          if (restanti <= 0) break;
          tentativiUsati += 1;
          restanti -= 1;
          const auth = `Authorization: Basic ${Buffer.from(`${l.utente}:${l.password}`).toString("base64")}`;
          const code = await httpGet(ip, porta, https, ms, auth);
          if (code != null && code >= 200 && code < 400) {
            info.fabbrica = { servizio: "http", utente: l.utente };
            break;
          }
        }
      }
    }
  } catch {
    // una porta che parla un altro protocollo non ferma il giro
  }

  const vuoto =
    !info.ldap_anonimo &&
    !info.redis_aperto &&
    !info.mongo_aperto &&
    !info.nfs_risponde &&
    info.snmp_public == null &&
    !info.vnc_senza_auth &&
    !info.fabbrica;
  return { info: vuoto ? null : info, tentativiUsati };
}
