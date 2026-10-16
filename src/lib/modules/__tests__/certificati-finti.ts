/**
 * Certificati X.509 v3 generati in memoria per le prove (passo 4b, 16/10/2026):
 * autorità finta, certificati firmati da lei o autofirmati, con i nomi (SAN) e le
 * date che servono. Stesso modello di `integrations/__tests__/unifi-api.test.ts`
 * (DER scritto a mano, ECDSA P-256), esteso con versione 3 ed estensioni.
 * Niente openssl: gira uguale sul Mac, sulla VM e in CI.
 */
import { generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import { isIPv4 } from "node:net";

const tlv = (tag: number, content: Buffer): Buffer => {
  const n = content.length;
  let len: Buffer;
  if (n < 0x80) len = Buffer.from([n]);
  else {
    const hex = n.toString(16);
    const b = Buffer.from(hex.length % 2 ? `0${hex}` : hex, "hex");
    len = Buffer.concat([Buffer.from([0x80 | b.length]), b]);
  }
  return Buffer.concat([Buffer.from([tag]), len, content]);
};
const seq = (...items: Buffer[]): Buffer => tlv(0x30, Buffer.concat(items));
const oid = (hex: string): Buffer => Buffer.from(hex, "hex");

const ECDSA_SHA256 = seq(oid("06082a8648ce3d040302"));
const OID_CN = oid("0603550403");
const OID_SAN = oid("0603551d11");
const OID_BASIC = oid("0603551d13");
const OID_KEY_USAGE = oid("0603551d0f");
const VERO = tlv(0x01, Buffer.from([0xff]));

function nome(cn: string): Buffer {
  return seq(tlv(0x31, seq(OID_CN, tlv(0x0c, Buffer.from(cn)))));
}

function tempo(d: Date): Buffer {
  return tlv(0x17, Buffer.from(`${d.toISOString().replace(/[-:T]/g, "").slice(2, 14)}Z`));
}

function san(nomi: string[]): Buffer {
  const voci = nomi.map((n) =>
    isIPv4(n) ? tlv(0x87, Buffer.from(n.split(".").map(Number))) : tlv(0x82, Buffer.from(n)),
  );
  return seq(OID_SAN, tlv(0x04, seq(...voci)));
}

function pem(der: Buffer): string {
  const b64 = der.toString("base64").match(/.{1,64}/g) ?? [];
  return `-----BEGIN CERTIFICATE-----\n${b64.join("\n")}\n-----END CERTIFICATE-----\n`;
}

export interface Firmatario {
  nome: Buffer;
  chiave: KeyObject;
  /** PEM del certificato dell'autorità (da passare come `ca`). */
  cert: string;
}

export interface CertificatoFinto {
  /** Chiave privata PEM (per `https.createServer`). */
  key: string;
  cert: string;
}

interface Opzioni {
  cn: string;
  /** Nomi DNS e IPv4 nel subjectAltName. */
  nomi?: string[];
  dal?: Date;
  al?: Date;
  /** Firmato da un'autorità; assente = autofirmato. */
  firmatoDa?: Firmatario;
}

function costruisci(o: Opzioni & { ca?: boolean }): { der: Buffer; chiave: KeyObject } {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const now = Date.now();
  const dal = o.dal ?? new Date(now - 3_600_000);
  const al = o.al ?? new Date(now + 30 * 86_400_000);
  const seriale = randomBytes(8);
  seriale[0] = (seriale[0]! & 0x7f) | 0x01;
  const soggetto = nome(o.cn);
  const estensioni: Buffer[] = [];
  if (o.ca) {
    estensioni.push(seq(OID_BASIC, VERO, tlv(0x04, seq(VERO))));
    // keyCertSign + cRLSign
    estensioni.push(seq(OID_KEY_USAGE, VERO, tlv(0x04, tlv(0x03, Buffer.from([0x01, 0x06])))));
  }
  if (o.nomi?.length) estensioni.push(san(o.nomi));
  const tbs = seq(
    tlv(0xa0, tlv(0x02, Buffer.from([0x02]))),
    tlv(0x02, seriale),
    ECDSA_SHA256,
    o.firmatoDa?.nome ?? soggetto,
    seq(tempo(dal), tempo(al)),
    soggetto,
    publicKey.export({ type: "spki", format: "der" }),
    ...(estensioni.length ? [tlv(0xa3, seq(...estensioni))] : []),
  );
  const firma = sign("sha256", tbs, o.firmatoDa?.chiave ?? privateKey);
  const der = seq(tbs, ECDSA_SHA256, tlv(0x03, Buffer.concat([Buffer.from([0]), firma])));
  return { der, chiave: privateKey };
}

/** Autorità finta (la «CA di DA-Link» delle prove). */
export function autoritaFinta(cn = "CA finta di prova"): Firmatario {
  const { der, chiave } = costruisci({ cn, ca: true, al: new Date(Date.now() + 365 * 86_400_000) });
  return { nome: nome(cn), chiave, cert: pem(der) };
}

/** Certificato di server, autofirmato o firmato da `firmatoDa`. */
export function certificatoFinto(o: Opzioni): CertificatoFinto {
  const { der, chiave } = costruisci(o);
  return { key: chiave.export({ type: "pkcs8", format: "pem" }).toString(), cert: pem(der) };
}
