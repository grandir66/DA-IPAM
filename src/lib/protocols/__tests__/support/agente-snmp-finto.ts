/**
 * Agente SNMP finto su UDP locale, per le prove delle versioni.
 *
 * Risponde SOLO nelle versioni indicate: alle altre tace, come gli AP Ubiquiti
 * di DTS (2026-10-15) che in v2c vanno in timeout e in v1 rispondono. Registra
 * la versione di ogni richiesta, così una prova dice con quale versione il
 * codice vero (sessione net-snmp compresa) ha parlato.
 *
 * GET: gli OID noti tornano come OCTET STRING. Un OID assente in v2c torna
 * noSuchObject; in v1 l'intero GET fallisce con NoSuchName (error-status 2),
 * come un agente v1 vero. GETNEXT/GETBULK: fine vista (v2c) o NoSuchName (v1).
 */
import dgram from "node:dgram";
import type { AddressInfo } from "node:net";

type Versione = "1" | "2c";

export interface RichiestaVista {
  versione: Versione;
  tipo: "get" | "getnext" | "getbulk" | "altro";
  oids: string[];
}

export interface AgenteFinto {
  porta: number;
  richieste: RichiestaVista[];
  versioniViste(): Versione[];
  chiudi(): Promise<void>;
}

interface Tlv {
  tag: number;
  start: number; // inizio del valore
  end: number; // fine del valore
  raw: Buffer; // TLV completo
}

function leggiTlv(buf: Buffer, off: number): Tlv {
  const tag = buf[off];
  let len = buf[off + 1];
  let p = off + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    len = 0;
    for (let i = 0; i < n; i++) len = (len << 8) | buf[p + i];
    p += n;
  }
  return { tag, start: p, end: p + len, raw: buf.subarray(off, p + len) };
}

function figli(buf: Buffer, t: Tlv): Tlv[] {
  const out: Tlv[] = [];
  let p = t.start;
  while (p < t.end) {
    const c = leggiTlv(buf, p);
    out.push(c);
    p = c.end;
  }
  return out;
}

function lunghezza(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  if (n < 0x100) return Buffer.from([0x81, n]);
  return Buffer.from([0x82, n >> 8, n & 0xff]);
}

function tlv(tag: number, ...parti: Buffer[]): Buffer {
  const v = Buffer.concat(parti);
  return Buffer.concat([Buffer.from([tag]), lunghezza(v.length), v]);
}

const intero = (n: number) => Buffer.from([0x02, 0x01, n]);

function oidTesto(buf: Buffer, t: Tlv): string {
  const b = buf.subarray(t.start, t.end);
  const parti = [Math.floor(b[0] / 40), b[0] % 40];
  let v = 0;
  for (let i = 1; i < b.length; i++) {
    v = (v << 7) | (b[i] & 0x7f);
    if (!(b[i] & 0x80)) {
      parti.push(v);
      v = 0;
    }
  }
  return parti.join(".");
}

export async function avviaAgenteFinto(opzioni: {
  versioni: Versione[];
  valori: Record<string, string>;
  porta?: number;
}): Promise<AgenteFinto> {
  const richieste: RichiestaVista[] = [];
  const sock = dgram.createSocket("udp4");

  sock.on("message", (msg, rinfo) => {
    try {
      const msgTlv = leggiTlv(msg, 0);
      const [verTlv, comTlv, pduTlv] = figli(msg, msgTlv);
      const versione: Versione = msg[verTlv.start] === 1 ? "2c" : "1";
      const [reqId, , , vbList] = figli(msg, pduTlv);
      const varbinds = figli(msg, vbList).map((vb) => figli(msg, vb)[0]);
      const oids = varbinds.map((o) => oidTesto(msg, o));
      const tipo = pduTlv.tag === 0xa0 ? "get" : pduTlv.tag === 0xa1 ? "getnext" : pduTlv.tag === 0xa5 ? "getbulk" : "altro";
      richieste.push({ versione, tipo, oids });
      if (!opzioni.versioni.includes(versione)) return; // tace, come in v2c gli AP di DTS

      let errStatus = 0;
      let errIndex = 0;
      const risposte: Buffer[] = [];
      varbinds.forEach((oidTlv, i) => {
        const oid = oids[i];
        let valore: Buffer;
        if (tipo === "get" && oid in opzioni.valori) {
          valore = tlv(0x04, Buffer.from(opzioni.valori[oid], "utf8"));
        } else if (versione === "2c") {
          valore = Buffer.from([tipo === "get" ? 0x80 : 0x82, 0x00]); // noSuchObject / endOfMibView
        } else {
          if (!errStatus) {
            errStatus = 2; // NoSuchName
            errIndex = i + 1;
          }
          valore = Buffer.from([0x05, 0x00]);
        }
        risposte.push(tlv(0x30, oidTlv.raw, valore));
      });
      if (errStatus) {
        // v1: tutto o niente, si rimandano i varbind come sono arrivati
        risposte.length = 0;
        for (const vb of figli(msg, vbList)) risposte.push(vb.raw);
      }
      const pdu = tlv(0xa2, reqId.raw, intero(errStatus), intero(errIndex), tlv(0x30, ...risposte));
      sock.send(tlv(0x30, verTlv.raw, comTlv.raw, pdu), rinfo.port, rinfo.address);
    } catch {
      /* pacchetto non capito: si tace */
    }
  });

  await new Promise<void>((resolve, reject) => {
    sock.once("error", reject);
    sock.bind(opzioni.porta ?? 0, "127.0.0.1", () => resolve());
  });

  return {
    porta: (sock.address() as AddressInfo).port,
    richieste,
    versioniViste: () => richieste.map((r) => r.versione),
    chiudi: () => new Promise<void>((resolve) => sock.close(() => resolve())),
  };
}
