/**
 * Controlli SMB scritti da zero (Nety è GPL-3.0). Non passa da `probes/smb2.ts`:
 * quel probe si ferma alla CHALLENGE e non deve mai completare un login.
 *
 * Qui: NEGOTIATE SMB1; sessione anonima / Guest; tree-connect a share note;
 * PeekNamedPipe MS17-010 solo se chiesto (levetta).
 */
import net from "node:net";
import { buildNtlmNegotiateMessage } from "@/lib/scanner/probes/smb2";

const TETTO = 64 * 1024;
const STATUS_SUCCESS = 0x00000000;
const STATUS_MORE_PROCESSING = 0xc0000016;
const STATUS_INSUFF_SERVER_RESOURCES = 0xc0000205;
const SHARE_NOTE = ["C$", "Users", "Public", "share", "data", "Shared"] as const;

export interface EsitoSmbControllo {
  smbv1?: boolean;
  smb_null?: boolean;
  smb_guest?: boolean;
  smb_share_anon?: string[];
  ms17_010?: boolean;
}

function nbss(payload: Buffer): Buffer {
  const h = Buffer.alloc(4);
  h.writeUIntBE(payload.length, 1, 3);
  return Buffer.concat([h, payload]);
}

function connetti(ip: string, porta: number, ms: number): Promise<net.Socket | null> {
  return new Promise((resolve) => {
    const s = net.connect({ host: ip, port: porta });
    const t = setTimeout(() => {
      s.destroy();
      resolve(null);
    }, ms);
    s.once("connect", () => {
      clearTimeout(t);
      resolve(s);
    });
    s.once("error", () => {
      clearTimeout(t);
      s.destroy();
      resolve(null);
    });
  });
}

function leggiNbss(sock: net.Socket, ms: number): Promise<Buffer | null> {
  return new Promise((resolve) => {
    let buf = Buffer.alloc(0);
    const fine = (r: Buffer | null) => {
      clearTimeout(timer);
      sock.off("data", on);
      sock.off("error", err);
      sock.off("close", err);
      resolve(r);
    };
    const timer = setTimeout(() => fine(null), ms);
    const err = () => fine(buf.length >= 4 ? buf : null);
    const on = (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      if (buf.length < 4) return;
      const n = buf.readUIntBE(1, 3);
      if (n > TETTO) return fine(null);
      if (buf.length >= 4 + n) fine(buf.subarray(4, 4 + n));
    };
    sock.on("data", on);
    sock.once("error", err);
    sock.once("close", err);
  });
}

/** NEGOTIATE SMB1 con solo «NT LM 0.12». */
export function pacchettoSmb1Negotiate(): Buffer {
  const dialects = Buffer.from("\x02NT LM 0.12\0", "binary");
  const h = Buffer.alloc(32);
  h[0] = 0xff;
  h.write("SMB", 1);
  h[4] = 0x72;
  h[13] = 0x18;
  h.writeUInt16LE(0x4801, 14);
  h.writeUInt16LE(1, 26);
  h.writeUInt16LE(1, 30);
  const coda = Buffer.alloc(3);
  coda.writeUInt16LE(dialects.length, 1);
  return nbss(Buffer.concat([h, coda, dialects]));
}

export function smbv1Accettato(risp: Buffer): boolean {
  if (risp.length < 35 || risp[0] !== 0xff || risp[4] !== 0x72) return false;
  const status = risp.readUInt32LE(5);
  if (status !== 0) return false;
  const idx = risp.readUInt16LE(33);
  return idx !== 0xffff;
}

export async function provaSmbv1(ip: string, porta: number, ms: number): Promise<boolean> {
  const s = await connetti(ip, porta, ms);
  if (!s) return false;
  try {
    s.write(pacchettoSmb1Negotiate());
    const r = await leggiNbss(s, ms);
    return r ? smbv1Accettato(r) : false;
  } finally {
    s.destroy();
  }
}

function smb2Header(cmd: number, mid: number, sid = BigInt(0)): Buffer {
  const h = Buffer.alloc(64);
  h.write("\xfeSMB", 0, "latin1");
  h.writeUInt16LE(64, 4);
  h.writeUInt16LE(cmd, 12);
  h.writeUInt16LE(1, 14);
  h.writeUInt32LE(Number(mid & 0xffffffff), 24);
  h.writeBigUInt64LE(sid, 40);
  return h;
}

function smb2Negotiate(): Buffer {
  const dialects = [0x0202, 0x0210, 0x0300, 0x0302];
  const body = Buffer.alloc(36 + dialects.length * 2);
  body.writeUInt16LE(36, 0);
  body.writeUInt16LE(dialects.length, 2);
  body.writeUInt16LE(1, 4);
  let o = 36;
  for (const d of dialects) {
    body.writeUInt16LE(d, o);
    o += 2;
  }
  return nbss(Buffer.concat([smb2Header(0, 0), body]));
}

function spnegoInit(): Buffer {
  const ntlm = buildNtlmNegotiateMessage();
  const spnegoOid = Buffer.from([0x06, 0x06, 0x2b, 0x06, 0x01, 0x05, 0x05, 0x02]);
  const ntlmOid = Buffer.from([0x06, 0x0a, 0x2b, 0x06, 0x01, 0x04, 0x01, 0x82, 0x37, 0x02, 0x02, 0x0a]);
  const mech = Buffer.concat([Buffer.from([0x30, ntlmOid.length]), ntlmOid]);
  const mechT = Buffer.concat([Buffer.from([0xa0, mech.length]), mech]);
  const tok = Buffer.concat([Buffer.from([0x04, ntlm.length]), ntlm]);
  const tokT = Buffer.concat([Buffer.from([0xa2, tok.length]), tok]);
  const init = Buffer.concat([mechT, tokT]);
  const seq = Buffer.concat([Buffer.from([0x30, init.length]), init]);
  const neg = Buffer.concat([Buffer.from([0xa0, seq.length]), seq]);
  const inner = Buffer.concat([spnegoOid, neg]);
  return Buffer.concat([Buffer.from([0x60, inner.length]), inner]);
}

function sessionSetup(mid: number, sid: bigint, blob: Buffer): Buffer {
  const body = Buffer.alloc(24 + blob.length);
  body.writeUInt16LE(25, 0);
  body.writeUInt8(1, 3);
  body.writeUInt16LE(64 + 24, 12);
  body.writeUInt16LE(blob.length, 14);
  blob.copy(body, 24);
  return nbss(Buffer.concat([smb2Header(0x0001, mid, sid), body]));
}

/** Type 3 NTLM con utente e password vuoti, o Guest. */
export function ntlmAuthenticate(utente = ""): Buffer {
  const user = Buffer.from(utente, "utf16le");
  const fisso = 64;
  const msg = Buffer.alloc(fisso + user.length);
  msg.write("NTLMSSP\0", 0, "latin1");
  msg.writeUInt32LE(3, 8);
  const campo = (o: number, len: number, off: number) => {
    msg.writeUInt16LE(len, o);
    msg.writeUInt16LE(len, o + 2);
    msg.writeUInt32LE(off, o + 4);
  };
  campo(12, 0, fisso); // Lm
  campo(20, 0, fisso); // Nt
  campo(28, 0, fisso); // Domain
  campo(36, user.length, fisso); // User
  campo(44, 0, fisso); // Workstation
  campo(52, 0, fisso); // SessionKey
  msg.writeUInt32LE(0x00088205, 60);
  user.copy(msg, fisso);
  return msg;
}

function spnegoAuth(ntlm: Buffer): Buffer {
  const oct = Buffer.concat([Buffer.from([0x04, ntlm.length]), ntlm]);
  const tok = Buffer.concat([Buffer.from([0xa2, oct.length]), oct]);
  const seq = Buffer.concat([Buffer.from([0x30, tok.length]), tok]);
  return Buffer.concat([Buffer.from([0xa1, seq.length]), seq]);
}

function smb2Status(msg: Buffer): number | null {
  if (msg.length < 12 || msg[0] !== 0xfe) return null;
  return msg.readUInt32LE(8);
}

function smb2Sid(msg: Buffer): bigint {
  return msg.length >= 48 ? msg.readBigUInt64LE(40) : BigInt(0);
}

function treeConnect(ip: string, share: string, mid: number, sid: bigint): Buffer {
  const path = Buffer.from(`\\\\${ip}\\${share}`, "utf16le");
  const body = Buffer.alloc(8 + path.length);
  body.writeUInt16LE(9, 0);
  body.writeUInt16LE(64 + 8, 4);
  body.writeUInt16LE(path.length, 6);
  path.copy(body, 8);
  return nbss(Buffer.concat([smb2Header(0x0003, mid, sid), body]));
}

async function sessioneSmb2(
  ip: string,
  porta: number,
  ms: number,
  utente: string,
): Promise<{ sid: bigint; sock: net.Socket } | null> {
  const s = await connetti(ip, porta, ms);
  if (!s) return null;
  try {
    s.write(smb2Negotiate());
    const neg = await leggiNbss(s, ms);
    if (!neg || smb2Status(neg) !== STATUS_SUCCESS) {
      s.destroy();
      return null;
    }
    s.write(sessionSetup(1, BigInt(0), spnegoInit()));
    const ch = await leggiNbss(s, ms);
    if (!ch || smb2Status(ch) !== STATUS_MORE_PROCESSING) {
      s.destroy();
      return null;
    }
    const sid = smb2Sid(ch);
    s.write(sessionSetup(2, sid, spnegoAuth(ntlmAuthenticate(utente))));
    const auth = await leggiNbss(s, ms);
    if (!auth || smb2Status(auth) !== STATUS_SUCCESS) {
      s.destroy();
      return null;
    }
    return { sid: smb2Sid(auth) || sid, sock: s };
  } catch {
    s.destroy();
    return null;
  }
}

async function shareAperte(ip: string, sess: { sid: bigint; sock: net.Socket }, ms: number): Promise<string[]> {
  const out: string[] = [];
  let mid = 3;
  for (const nome of SHARE_NOTE) {
    sess.sock.write(treeConnect(ip, nome, mid++, sess.sid));
    const r = await leggiNbss(sess.sock, ms);
    if (r && smb2Status(r) === STATUS_SUCCESS) out.push(nome);
  }
  return out;
}

export async function provaSmbSessioni(
  ip: string,
  porta: number,
  ms: number,
): Promise<Pick<EsitoSmbControllo, "smb_null" | "smb_guest" | "smb_share_anon">> {
  const info: Pick<EsitoSmbControllo, "smb_null" | "smb_guest" | "smb_share_anon"> = {};
  const anon = await sessioneSmb2(ip, porta, ms, "");
  if (anon) {
    info.smb_null = true;
    const share = await shareAperte(ip, anon, ms);
    anon.sock.destroy();
    if (share.length > 0) info.smb_share_anon = share;
  }
  const guest = await sessioneSmb2(ip, porta, ms, "Guest");
  if (guest) {
    info.smb_guest = true;
    if (!info.smb_share_anon) {
      const share = await shareAperte(ip, guest, ms);
      if (share.length > 0) info.smb_share_anon = share;
    }
    guest.sock.destroy();
  }
  return info;
}

/**
 * MS17-010: TRANSACTION PeekNamedPipe su FID 0 (check pubblico).
 * STATUS_INSUFF_SERVER_RESOURCES = non patchato; ACCESS_DENIED = patchato.
 */
export function peekNamedPipeSmb1(tid: number, uid: number, mid: number): Buffer {
  const h = Buffer.alloc(32);
  h[0] = 0xff;
  h.write("SMB", 1);
  h[4] = 0x25; // TRANSACTION
  h[13] = 0x18;
  h.writeUInt16LE(0x4801, 14);
  h.writeUInt16LE(tid, 24);
  h.writeUInt16LE(uid, 28);
  h.writeUInt16LE(mid, 30);
  const words = Buffer.alloc(33);
  words[0] = 16;
  words.writeUInt16LE(0x400, 7);
  words[27] = 2;
  words.writeUInt16LE(0x0023, 29);
  words.writeUInt16LE(0, 31);
  const nome = Buffer.from("\\PIPE\\\0", "binary");
  const bcc = Buffer.alloc(2 + nome.length);
  bcc.writeUInt16LE(nome.length, 0);
  nome.copy(bcc, 2);
  return nbss(Buffer.concat([h, words, bcc]));
}

export function ms17DaStatus(status: number): boolean {
  return status === STATUS_INSUFF_SERVER_RESOURCES;
}

function smb1SessionSetupAnon(): Buffer {
  const h = Buffer.alloc(32);
  h[0] = 0xff;
  h.write("SMB", 1);
  h[4] = 0x73; // SESSION_SETUP_ANDX
  h[13] = 0x18;
  h.writeUInt16LE(0x4801, 14);
  h.writeUInt16LE(1, 26);
  h.writeUInt16LE(2, 30);
  const w = Buffer.alloc(1 + 26);
  w[0] = 13;
  w[1] = 0xff; // no further AndX
  w.writeUInt16LE(65535, 5); // MaxBuffer
  w.writeUInt16LE(2, 7); // MaxMpx
  w.writeUInt16LE(1, 9); // VcNumber
  w.writeUInt32LE(0, 15); // ANSI pwd len empty → offset Cap
  w.writeUInt16LE(0, 15);
  w.writeUInt16LE(0, 17); // unicode pwd len
  w.writeUInt32LE(0x40, 23); // capabilities UNICODE? skip: 0
  const acc = Buffer.from("\0Windows 6.1\0DA-IPAM\0", "binary");
  const bcc = Buffer.alloc(2 + acc.length);
  bcc.writeUInt16LE(acc.length, 0);
  acc.copy(bcc, 2);
  return nbss(Buffer.concat([h, w, bcc]));
}

function smb1TreeIpc(ip: string, uid: number): Buffer {
  const h = Buffer.alloc(32);
  h[0] = 0xff;
  h.write("SMB", 1);
  h[4] = 0x75; // TREE_CONNECT_ANDX
  h[13] = 0x18;
  h.writeUInt16LE(0x4801, 14);
  h.writeUInt16LE(uid, 28);
  h.writeUInt16LE(3, 30);
  const w = Buffer.alloc(1 + 8);
  w[0] = 4;
  w[1] = 0xff;
  const path = `\\\\${ip}\\IPC$\0`;
  const extra = Buffer.from(`\x00${path}IPC\0`, "binary");
  const bcc = Buffer.alloc(2 + extra.length);
  bcc.writeUInt16LE(extra.length, 0);
  extra.copy(bcc, 2);
  return nbss(Buffer.concat([h, w, bcc]));
}

export async function provaMs17010(ip: string, porta: number, ms: number): Promise<boolean> {
  const s = await connetti(ip, porta, ms);
  if (!s) return false;
  try {
    s.write(pacchettoSmb1Negotiate());
    const neg = await leggiNbss(s, ms);
    if (!neg || !smbv1Accettato(neg)) return false;
    s.write(smb1SessionSetupAnon());
    const sess = await leggiNbss(s, ms);
    if (!sess || sess.length < 32 || sess.readUInt32LE(5) !== 0) return false;
    const uid = sess.readUInt16LE(28);
    s.write(smb1TreeIpc(ip, uid));
    const tree = await leggiNbss(s, ms);
    if (!tree || tree.length < 32 || tree.readUInt32LE(5) !== 0) return false;
    const tid = tree.readUInt16LE(24);
    s.write(peekNamedPipeSmb1(tid, uid, 4));
    const peek = await leggiNbss(s, ms);
    if (!peek || peek.length < 9) return false;
    return ms17DaStatus(peek.readUInt32LE(5));
  } finally {
    s.destroy();
  }
}

export async function sondaSmb(ip: string, porta: number, ms: number, ms17: boolean): Promise<EsitoSmbControllo> {
  const info: EsitoSmbControllo = {};
  try {
    if (await provaSmbv1(ip, porta, ms)) info.smbv1 = true;
  } catch {
    /* SMB1 muto */
  }
  try {
    Object.assign(info, await provaSmbSessioni(ip, porta, ms));
  } catch {
    /* sessione rifiutata */
  }
  if (ms17) {
    try {
      if (await provaMs17010(ip, porta, ms)) info.ms17_010 = true;
    } catch {
      /* PeekNamedPipe non applicabile */
    }
  }
  return info;
}
