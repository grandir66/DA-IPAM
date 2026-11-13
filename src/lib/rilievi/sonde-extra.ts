/**
 * Terza ondata di controlli (DNS, TFTP, NTP, rsync, SMTP, NFS export, Smart Install…).
 * Scritte da zero: Nety è GPL-3.0.
 */
import dgram from "node:dgram";
import net from "node:net";
import { Client as SshClient, type ConnectConfig } from "ssh2";
import { NOME_HOST_NEUTRO, UTENTE_NEUTRO } from "@/lib/scanner/identita-neutra";

function rpcCall(xid: number, prog: number, vers: number, proc: number): Buffer {
  const b = Buffer.alloc(40);
  b.writeUInt32BE(xid, 0);
  b.writeUInt32BE(0, 4);
  b.writeUInt32BE(2, 8);
  b.writeUInt32BE(prog, 12);
  b.writeUInt32BE(vers, 16);
  b.writeUInt32BE(proc, 20);
  return b;
}

function rpcSuTcp(payload: Buffer): Buffer {
  const h = Buffer.alloc(4);
  h.writeUInt32BE((payload.length | 0x80000000) >>> 0, 0);
  return Buffer.concat([h, payload]);
}

const TETTO = 16 * 1024;

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

function udpScambio(ip: string, porta: number, req: Buffer, ms: number): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const s = dgram.createSocket("udp4");
    const t = setTimeout(() => {
      s.close();
      resolve(null);
    }, ms);
    s.once("message", (m) => {
      clearTimeout(t);
      s.close();
      resolve(m);
    });
    s.once("error", () => {
      clearTimeout(t);
      s.close();
      resolve(null);
    });
    s.send(req, porta, ip, (e) => {
      if (e) {
        clearTimeout(t);
        s.close();
        resolve(null);
      }
    });
  });
}

export function dnsNome(etichetta: string): Buffer {
  const parti = etichetta.replace(/\.$/, "").split(".").filter(Boolean);
  const out: Buffer[] = [];
  for (const p of parti) {
    const b = Buffer.from(p, "ascii");
    out.push(Buffer.from([b.length]), b);
  }
  out.push(Buffer.from([0]));
  return Buffer.concat(out);
}

/** Query AXFR (tipo 252) su TCP. */
export function pacchettoDnsAxfr(zona: string): Buffer {
  const q = dnsNome(zona);
  const msg = Buffer.alloc(12 + q.length + 4);
  msg.writeUInt16BE(0xda19, 0);
  msg.writeUInt16BE(0x0100, 2);
  msg.writeUInt16BE(1, 4);
  q.copy(msg, 12);
  msg.writeUInt16BE(252, 12 + q.length);
  msg.writeUInt16BE(1, 12 + q.length + 2);
  const tcp = Buffer.alloc(2 + msg.length);
  tcp.writeUInt16BE(msg.length, 0);
  msg.copy(tcp, 2);
  return tcp;
}

function dnsFrameCompleto(buf: Buffer): boolean {
  return buf.length >= 2 && buf.length >= 2 + buf.readUInt16BE(0);
}

/** Salta il nome DNS, inclusi i riferimenti compressi, senza inseguire puntatori. */
function dopoNomeDns(msg: Buffer, da: number): number | null {
  let pos = da;
  while (pos < msg.length) {
    const n = msg[pos++]!;
    if (n === 0) return pos;
    if ((n & 0xc0) === 0xc0) {
      if (pos >= msg.length) return null;
      const puntatore = ((n & 0x3f) << 8) | msg[pos]!;
      return puntatore >= 12 && puntatore < pos - 1 ? pos + 1 : null;
    }
    if (n > 63 || pos + n > msg.length) return null;
    pos += n;
  }
  return null;
}

export function dnsAxfrAccettato(buf: Buffer): boolean {
  if (!dnsFrameCompleto(buf)) return false;
  const msg = buf.subarray(2, 2 + buf.readUInt16BE(0));
  if (msg.length < 12 || msg.readUInt16BE(0) !== 0xda19) return false;
  const flags = msg.readUInt16BE(2);
  if ((flags & 0xfa0f) !== 0x8000 || msg.readUInt16BE(6) === 0) return false;
  const domande = msg.readUInt16BE(4);
  if (domande > 1) return false;
  let pos = 12;
  if (domande === 1) {
    const fineNome = dopoNomeDns(msg, pos);
    if (fineNome === null || msg.length < fineNome + 4 || msg.readUInt16BE(fineNome) !== 252 || msg.readUInt16BE(fineNome + 2) !== 1) return false;
    pos = fineNome + 4;
  }
  const rr = dopoNomeDns(msg, pos);
  if (rr === null || msg.length < rr + 10 || msg.readUInt16BE(rr) !== 6 || msg.readUInt16BE(rr + 2) !== 1) return false;
  const lunghezza = msg.readUInt16BE(rr + 8);
  return lunghezza >= 22 && msg.length >= rr + 10 + lunghezza;
}

export async function provaDnsAxfr(ip: string, porta: number, ms: number): Promise<boolean> {
  const ott = ip.split(".");
  if (ott.length !== 4) return false;
  const zona = `${ott[2]}.${ott[1]}.${ott[0]}.in-addr.arpa`;
  const r = await conTesto(ip, porta, ms, pacchettoDnsAxfr(zona), dnsFrameCompleto);
  return r ? dnsAxfrAccettato(r) : false;
}

export function pacchettoTftpRrq(nome = "a"): Buffer {
  return Buffer.concat([Buffer.from([0, 1]), Buffer.from(`${nome}\0netascii\0`, "binary")]);
}

export function tftpRisponde(buf: Buffer): boolean {
  if (buf.length < 4) return false;
  const op = buf.readUInt16BE(0);
  return op === 3 || op === 5; // DATA o ERROR
}

export async function provaTftp(ip: string, ms: number): Promise<boolean> {
  const r = await udpScambio(ip, 69, pacchettoTftpRrq(), ms);
  return r ? tftpRisponde(r) : false;
}

/** NTP mode 7, MON_GETLIST_1 (42). */
export function pacchettoNtpMonlist(): Buffer {
  const b = Buffer.alloc(48);
  b[0] = 0x17; // LI=0 VN=2 mode 7
  b[1] = 0x00;
  b[2] = 0x03;
  b[3] = 42;
  return b;
}

export function ntpMonlistRisponde(buf: Buffer): boolean {
  return buf.length >= 8 && (buf[0]! & 0x07) === 7 && buf[3] === 42 && buf.length > 48;
}

export async function provaNtpMonlist(ip: string, ms: number): Promise<boolean> {
  const r = await udpScambio(ip, 123, pacchettoNtpMonlist(), ms);
  return r ? ntpMonlistRisponde(r) : false;
}

export function rsyncModuli(buf: Buffer): boolean {
  const t = buf.toString("latin1");
  if (!/@RSYNCD:/.test(t)) return false;
  if (/@ERROR/i.test(t)) return false;
  return /@RSYNCD: EXIT/.test(t) || /^[A-Za-z0-9][A-Za-z0-9._@+-]*[\t ]/m.test(t);
}

export async function provaRsync(ip: string, porta: number, ms: number): Promise<boolean> {
  const r = await conTesto(ip, porta, ms, "@RSYNCD: 31.0\n\n", (b) => b.includes(0x0a));
  return r ? rsyncModuli(r) : false;
}

export function smtpVrfyAperto(banner: Buffer, vrfy: Buffer): boolean {
  if (!/^220/m.test(banner.toString("latin1"))) return false;
  return /^250 [^\r\n]+\r\n/m.test(vrfy.toString("latin1"));
}

export async function provaSmtpVrfy(ip: string, porta: number, ms: number): Promise<boolean> {
  const s = await connetti(ip, porta, ms);
  if (!s) return false;
  try {
    const risposta = (b: Buffer) => /^\d{3} [^\r\n]*\r\n/m.test(b.toString("latin1"));
    const banner = await leggi(s, ms, risposta);
    if (!/^220 [^\r\n]*\r\n/m.test(banner.toString("latin1"))) return false;
    s.write(`EHLO ${NOME_HOST_NEUTRO}\r\n`);
    const saluto = await leggi(s, ms, risposta);
    if (!/^250 [^\r\n]*\r\n/m.test(saluto.toString("latin1"))) return false;
    s.write("VRFY postmaster\r\n");
    const v = await leggi(s, ms, risposta);
    return smtpVrfyAperto(banner, v);
  } finally {
    s.destroy();
  }
}

export function portmapGetPort(prog: number, vers: number): Buffer {
  const args = Buffer.alloc(16);
  args.writeUInt32BE(prog, 0);
  args.writeUInt32BE(vers, 4);
  args.writeUInt32BE(6, 8);
  return rpcSuTcp(Buffer.concat([rpcCall(0xda190004, 100000, 2, 3), args]));
}

function rpcCompleto(buf: Buffer): boolean {
  return buf.length >= 4 && buf.length >= 4 + (buf.readUInt32BE(0) & 0x7fffffff);
}

function rpcRisultato(buf: Buffer, xid: number): Buffer | null {
  if (!rpcCompleto(buf) || (buf[0]! & 0x80) === 0) return null;
  const rec = buf.subarray(4, 4 + (buf.readUInt32BE(0) & 0x7fffffff));
  if (rec.length < 24 || rec.readUInt32BE(0) !== xid || rec.readUInt32BE(4) !== 1 || rec.readUInt32BE(8) !== 0) return null;
  const lunghezzaVerificatore = rec.readUInt32BE(16);
  const status = 20 + Math.ceil(lunghezzaVerificatore / 4) * 4;
  if (rec.length < status + 4 || rec.readUInt32BE(status) !== 0) return null;
  return rec.subarray(status + 4);
}

export function portmapPorta(buf: Buffer): number | null {
  const esito = rpcRisultato(buf, 0xda190004);
  if (esito?.length !== 4) return null;
  const porta = esito.readUInt32BE(0);
  return porta > 0 && porta < 65536 ? porta : null;
}

/** MOUNT EXPORT contiene una lista XDR di path, ciascuno con la propria lista di gruppi. */
export function nfsExportStella(buf: Buffer): boolean | undefined {
  const dati = rpcRisultato(buf, 0xda190005);
  if (!dati) return undefined;
  let offset = 0;
  let aperto = false;
  const numero = () => {
    if (offset + 4 > dati.length) return null;
    const valore = dati.readUInt32BE(offset);
    offset += 4;
    return valore;
  };
  const stringa = () => {
    const n = numero();
    if (n === null || offset + Math.ceil(n / 4) * 4 > dati.length) return null;
    const valore = dati.toString("utf8", offset, offset + n);
    offset += Math.ceil(n / 4) * 4;
    return valore;
  };
  for (let exportPresente = numero(); exportPresente !== 0; exportPresente = numero()) {
    if (exportPresente !== 1 || stringa() === null) return undefined;
    let gruppoPresente = numero();
    if (gruppoPresente === 0) aperto = true;
    for (; gruppoPresente !== 0; gruppoPresente = numero()) {
      if (gruppoPresente !== 1) return undefined;
      const gruppo = stringa();
      if (gruppo === null) return undefined;
      if (gruppo === "*") aperto = true;
    }
  }
  return aperto;
}

export async function provaNfsExportStella(ip: string, ms: number): Promise<boolean | undefined> {
  const mappa = await conTesto(ip, 111, ms, portmapGetPort(100005, 3), rpcCompleto);
  const dest = (mappa && portmapPorta(mappa)) || 2049;
  const pkt = rpcSuTcp(rpcCall(0xda190005, 100005, 3, 5));
  const r = await conTesto(ip, dest, ms, pkt, rpcCompleto);
  return r ? nfsExportStella(r) : undefined;
}

export function metodiSshPassword(metodi: string[]): boolean {
  return metodi.includes("password") || metodi.includes("keyboard-interactive");
}

export async function provaSshPasswordOfferta(ip: string, porta: number, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const c = new SshClient();
    let metodi: string[] = [];
    let chiuso = false;
    const fine = () => {
      if (chiuso) return;
      chiuso = true;
      clearTimeout(t);
      try {
        c.end();
      } catch {
        /* già chiuso */
      }
      resolve(metodiSshPassword(metodi));
    };
    const t = setTimeout(fine, ms);
    c.on("error", fine);
    c.on("close", fine);
    const cfg: ConnectConfig = {
      host: ip,
      port: porta,
      username: UTENTE_NEUTRO,
      readyTimeout: ms,
      algorithms: {
        kex: [
          "curve25519-sha256",
          "ecdh-sha2-nistp256",
          "diffie-hellman-group14-sha256",
          "diffie-hellman-group14-sha1",
          "diffie-hellman-group1-sha1",
        ],
        cipher: ["aes128-ctr", "aes256-ctr", "aes128-cbc", "3des-cbc"],
        serverHostKey: ["ssh-ed25519", "ecdsa-sha2-nistp256", "rsa-sha2-256", "ssh-rsa"],
      },
      authHandler: ((methodsLeft, _p, cb) => {
        if (Array.isArray(methodsLeft)) metodi = methodsLeft.map(String);
        if (methodsLeft == null) {
          cb({ type: "none", username: UTENTE_NEUTRO });
          return;
        }
        (cb as unknown as (v: false) => void)(false);
      }) as ConnectConfig["authHandler"],
    };
    c.connect(cfg);
  });
}

/** RAKP Message 1, utente admin, payload type 0x12. */
export function pacchettoIpmiRakp1(): Buffer {
  const user = Buffer.from("admin");
  const payload = Buffer.alloc(28 + user.length);
  payload.writeUInt32LE(0xa0a1a2a3, 4);
  payload[27] = user.length;
  user.copy(payload, 28);
  const pkt = Buffer.alloc(16 + payload.length);
  pkt[0] = 0x06;
  pkt[2] = 0xff;
  pkt[3] = 0x07;
  pkt[4] = 0x06;
  pkt[5] = 0x12;
  pkt.writeUInt16LE(payload.length, 14);
  payload.copy(pkt, 16);
  return pkt;
}

export function ipmiRakp2Accettato(buf: Buffer): boolean {
  if (buf.length < 18) return false;
  if (buf[0] !== 0x06 || buf[4] !== 0x06) return false;
  if ((buf[5]! & 0x3f) !== 0x13) return false;
  return buf[17] === 0x00;
}

export async function provaIpmiRakp(ip: string, ms: number, porta = 623): Promise<boolean> {
  const r = await udpScambio(ip, porta, pacchettoIpmiRakp1(), ms);
  return r ? ipmiRakp2Accettato(r) : false;
}
