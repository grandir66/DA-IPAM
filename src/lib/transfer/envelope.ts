// src/lib/transfer/envelope.ts
import crypto from "crypto";
import type { BundleManifest } from "./types";
import { BUNDLE_FORMAT_VERSION } from "./types";

const ALGO = "aes-256-gcm";
const IV_LEN = 16;
const TAG_LEN = 16;
const SALT_LEN = 16;
const MAGIC = Buffer.from("DABK", "ascii"); // 4 byte

export function randomSalt(): Buffer {
  return crypto.randomBytes(SALT_LEN);
}

export function deriveTransportKey(passphrase: string, salt: Buffer): Buffer {
  if (!passphrase) throw new Error("Passphrase mancante");
  return crypto.scryptSync(passphrase, salt, 32);
}

/** Campo: ivHex:tagHex:ctHex (stesso formato di crypto.ts ma con chiave esplicita). */
export function encryptFieldWithKey(plaintext: string, key: Buffer): string {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  let ct = cipher.update(plaintext, "utf8", "hex");
  ct += cipher.final("hex");
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${ct}`;
}

export function decryptFieldWithKey(ciphertext: string, key: Buffer): string {
  const parts = ciphertext.split(":");
  if (parts.length !== 3) throw new Error("Formato campo cifrato non valido");
  const iv = Buffer.from(parts[0], "hex");
  const tag = Buffer.from(parts[1], "hex");
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  let pt = decipher.update(parts[2], "hex", "utf8");
  pt += decipher.final("utf8");
  return pt;
}

/** Buffer: iv(16) | ciphertext | tag(16). */
export function encryptBuffer(plaintext: Buffer, key: Buffer): Buffer {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ct, tag]);
}

export function decryptBuffer(blob: Buffer, key: Buffer): Buffer {
  if (blob.length < IV_LEN + TAG_LEN) throw new Error("Blob cifrato troppo corto");
  const iv = blob.subarray(0, IV_LEN);
  const tag = blob.subarray(blob.length - TAG_LEN);
  const ct = blob.subarray(IV_LEN, blob.length - TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

/**
 * Container .dab:
 *   MAGIC(4) | formatVersion(1) | manifestLen(uint32 BE)(4) | manifestJSON | encryptedPayload
 * Il manifest è in CHIARO (no PII/secret): permette di ispezionare il bundle prima di decifrare.
 */
export function writeContainer(manifest: BundleManifest, encryptedPayload: Buffer): Buffer {
  const manifestBuf = Buffer.from(JSON.stringify(manifest), "utf8");
  const header = Buffer.alloc(4 + 1 + 4);
  MAGIC.copy(header, 0);
  header.writeUInt8(BUNDLE_FORMAT_VERSION, 4);
  header.writeUInt32BE(manifestBuf.length, 5);
  return Buffer.concat([header, manifestBuf, encryptedPayload]);
}

export function readContainer(buf: Buffer): { manifest: BundleManifest; encryptedPayload: Buffer } {
  if (buf.length < 9 || !buf.subarray(0, 4).equals(MAGIC)) {
    throw new Error("Non è un bundle DA-IPAM (.dab) valido");
  }
  const version = buf.readUInt8(4);
  if (version !== BUNDLE_FORMAT_VERSION) {
    throw new Error(`Versione bundle ${version} non supportata (atteso ${BUNDLE_FORMAT_VERSION})`);
  }
  const manifestLen = buf.readUInt32BE(5);
  const manifestStart = 9;
  const manifestEnd = manifestStart + manifestLen;
  const manifest = JSON.parse(buf.subarray(manifestStart, manifestEnd).toString("utf8")) as BundleManifest;
  const encryptedPayload = buf.subarray(manifestEnd);
  return { manifest, encryptedPayload };
}
