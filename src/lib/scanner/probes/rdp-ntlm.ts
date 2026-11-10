/**
 * NTLM da RDP (porta 3389) senza autenticarsi.
 *
 * X.224 Connection Request con RDP_NEG_REQ (SSL|HYBRID) → TLS → CredSSP TSRequest
 * con NTLMSSP NEGOTIATE (Type 1). Si legge la CHALLENGE (Type 2) e si chiude.
 * Nessun Type 3, nessuna password: stesso vincolo di `smb2.ts`.
 */
import net from "node:net";
import tls from "node:tls";
import { buildNtlmNegotiateMessage, parseNtlmChallenge, type NtlmChallengeInfo } from "./smb2";
import { credsspTsRequest, ntlmDaGssORaw, wrapNtlmInSpnego } from "@/lib/servizi-rete/ntlm-spnego";

const PROTOCOL_SSL = 0x00000001;
const PROTOCOL_HYBRID = 0x00000002;
const PROTOCOL_HYBRID_EX = 0x00000008;
const TETTO = 64 * 1024;

/** Connection Request X.224 + RDP_NEG_REQ (SSL e CredSSP). Esportata per le prove. */
export function rdpConnectionRequest(): Buffer {
  const cookie = Buffer.from("Cookie: mstshash=DA-IPAM\r\n", "ascii");
  const neg = Buffer.alloc(8);
  neg[0] = 0x01; // TYPE_RDP_NEG_REQ
  neg.writeUInt16LE(8, 2);
  neg.writeUInt32LE(PROTOCOL_SSL | PROTOCOL_HYBRID, 4);
  const dopoLi = Buffer.concat([Buffer.from([0xe0, 0x00, 0x00, 0x00, 0x00, 0x00]), cookie, neg]);
  const tpdu = Buffer.concat([Buffer.from([dopoLi.length]), dopoLi]);
  const tpkt = Buffer.concat([Buffer.from([0x03, 0x00, 0x00, 0x00]), tpdu]);
  tpkt.writeUInt16BE(tpkt.length, 2);
  return tpkt;
}

/** selectedProtocol da un Connection Confirm; null se non c'è TLS/CredSSP. */
export function protocolloRdpDaConferma(buf: Buffer): number | null {
  if (buf.length < 4 || buf[0] !== 0x03) return null;
  const lungh = buf.readUInt16BE(2);
  if (lungh < 11 || buf.length < Math.min(lungh, 11)) return null;
  const i = buf.indexOf(Buffer.from([0x02, 0x00, 0x08, 0x00])); // TYPE_RDP_NEG_RSP
  if (i < 0 || i + 8 > buf.length) return null;
  return buf.readUInt32LE(i + 4);
}

function connetti(ip: string, porta: number, ms: number): Promise<net.Socket | null> {
  return new Promise((resolve) => {
    const sock = net.connect({ host: ip, port: porta });
    const timer = setTimeout(() => { sock.destroy(); resolve(null); }, ms);
    sock.once("connect", () => { clearTimeout(timer); resolve(sock); });
    sock.once("error", () => { clearTimeout(timer); sock.destroy(); resolve(null); });
  });
}

function leggi(sock: net.Socket | tls.TLSSocket, ms: number, abbastanza: (b: Buffer) => boolean): Promise<Buffer> {
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
      if (tot >= TETTO || abbastanza(Buffer.concat(parti))) chiudi();
    };
    const timer = setTimeout(chiudi, ms);
    sock.on("data", suDati);
    sock.once("end", chiudi);
    sock.once("close", chiudi);
    sock.once("error", chiudi);
  });
}

function startTls(sock: net.Socket, ms: number): Promise<tls.TLSSocket | null> {
  return new Promise((resolve) => {
    const tlsSock = tls.connect({ socket: sock, rejectUnauthorized: false });
    const timer = setTimeout(() => { tlsSock.destroy(); resolve(null); }, ms);
    tlsSock.once("secureConnect", () => { clearTimeout(timer); resolve(tlsSock); });
    tlsSock.once("error", () => { clearTimeout(timer); tlsSock.destroy(); resolve(null); });
  });
}

/** NLA (CredSSP) se il server ha scelto HYBRID o HYBRID_EX. */
export function rdpNlaRichiesta(proto: number): boolean {
  return (proto & (PROTOCOL_HYBRID | PROTOCOL_HYBRID_EX)) !== 0;
}

export interface EsitoRdpNtlm {
  challenge: NtlmChallengeInfo | null;
  nla: boolean;
}

export async function probeRdpNtlm(ip: string, opts?: { timeoutMs?: number; port?: number }): Promise<EsitoRdpNtlm | null> {
  const ms = opts?.timeoutMs ?? 4000;
  const porta = opts?.port ?? 3389;
  const s1 = await connetti(ip, porta, ms);
  if (!s1) return null;
  let tlsSock: tls.TLSSocket | null = null;
  try {
    s1.write(rdpConnectionRequest());
    const cc = await leggi(s1, ms, (b) => b.length >= 4 && b.length >= b.readUInt16BE(2));
    const proto = protocolloRdpDaConferma(cc);
    if (proto === null) return null;
    const nla = rdpNlaRichiesta(proto);
    if ((proto & (PROTOCOL_SSL | PROTOCOL_HYBRID | PROTOCOL_HYBRID_EX)) === 0) {
      return { challenge: null, nla: false };
    }
    tlsSock = await startTls(s1, ms);
    if (!tlsSock) return { challenge: null, nla };
    const type1 = wrapNtlmInSpnego(buildNtlmNegotiateMessage());
    tlsSock.write(credsspTsRequest(type1));
    const risp = await leggi(tlsSock, ms, (b) => ntlmDaGssORaw(b) !== null);
    const ntlm = ntlmDaGssORaw(risp);
    return { challenge: ntlm ? parseNtlmChallenge(ntlm) : null, nla };
  } catch {
    return null;
  } finally {
    tlsSock?.destroy();
    s1.destroy();
  }
}
