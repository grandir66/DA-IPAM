/**
 * Lettura di una chiave privata SSH per il trasporto ssh2 (tappa 2
 * credenziali, T14, D6 = (a), 16/10).
 *
 * D6 dice i formati: OpenSSH e PEM (RSA, ECDSA, ed25519), passphrase
 * facoltativa. ssh2 legge da solo l'OpenSSH (cifrato o no), il PEM PKCS#1 di
 * RSA e il PEM SEC1 di ECDSA; non legge il PEM PKCS#8 («BEGIN PRIVATE KEY»,
 * «BEGIN ENCRYPTED PRIVATE KEY»), che per una ed25519 è l'unico PEM. Quello lo
 * apre `node:crypto` e lo si riscrive, in memoria, in un formato che ssh2
 * legge: PKCS#1 per RSA, SEC1 per ECDSA, OpenSSH per ed25519.
 *
 * Una chiave che non si legge è un rifiuto col motivo in italiano, prima di
 * aprire qualunque connessione: dentro l'authHandler ssh2 la salterebbe in
 * silenzio («Skipping invalid key auth attempt») e l'errore diventerebbe un
 * accesso rifiutato. Il motivo non contiene mai la chiave né la passphrase.
 */
import { createPrivateKey, randomBytes, type JsonWebKey, type KeyObject } from "node:crypto";
import { utils, type ParsedKey } from "ssh2";

export type EsitoChiave = { ok: true; chiave: ParsedKey } | { ok: false; motivo: string };

const PKCS8 = /-----BEGIN (?:ENCRYPTED )?PRIVATE KEY-----/;

function stringaSsh(b: Buffer): Buffer {
  const l = Buffer.alloc(4);
  l.writeUInt32BE(b.length);
  return Buffer.concat([l, b]);
}

function uint32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
}

/** Una ed25519 nel formato OpenSSH, non cifrato (vive solo in memoria, per ssh2). */
function opensshEd25519(seme: Buffer, pubblica: Buffer): string {
  const tipo = Buffer.from("ssh-ed25519");
  const blobPubblico = Buffer.concat([stringaSsh(tipo), stringaSsh(pubblica)]);
  const controllo = randomBytes(4);
  let privata = Buffer.concat([
    controllo,
    controllo,
    stringaSsh(tipo),
    stringaSsh(pubblica),
    stringaSsh(Buffer.concat([seme, pubblica])),
    stringaSsh(Buffer.alloc(0)), // commento
  ]);
  for (let i = 1; privata.length % 8 !== 0; i++) privata = Buffer.concat([privata, Buffer.from([i])]);
  const corpo = Buffer.concat([
    Buffer.from("openssh-key-v1\0"),
    stringaSsh(Buffer.from("none")),
    stringaSsh(Buffer.from("none")),
    stringaSsh(Buffer.alloc(0)),
    uint32(1),
    stringaSsh(blobPubblico),
    stringaSsh(privata),
  ]);
  const righe = corpo.toString("base64").match(/.{1,70}/g) ?? [];
  return `-----BEGIN OPENSSH PRIVATE KEY-----\n${righe.join("\n")}\n-----END OPENSSH PRIVATE KEY-----\n`;
}

/** PEM PKCS#8 → un formato che ssh2 legge, oppure il motivo. */
function daPkcs8(testo: string, passphrase: string | undefined): { ok: true; testo: string } | { ok: false; motivo: string } {
  const cifrata = testo.includes("BEGIN ENCRYPTED PRIVATE KEY");
  if (cifrata && !passphrase) return { ok: false, motivo: "la chiave è cifrata e manca la passphrase" };
  let k: KeyObject;
  try {
    k = createPrivateKey({ key: testo, format: "pem", ...(passphrase ? { passphrase } : {}) });
  } catch {
    return { ok: false, motivo: cifrata ? "passphrase sbagliata o chiave rovinata" : "formato non riconosciuto (PEM PKCS#8 illeggibile)" };
  }
  switch (k.asymmetricKeyType) {
    case "rsa":
      return { ok: true, testo: String(k.export({ type: "pkcs1", format: "pem" })) };
    case "ec":
      return { ok: true, testo: String(k.export({ type: "sec1", format: "pem" })) };
    case "ed25519": {
      const jwk = k.export({ format: "jwk" }) as JsonWebKey;
      if (!jwk.d || !jwk.x) return { ok: false, motivo: "formato non riconosciuto (ed25519 senza parte privata)" };
      return { ok: true, testo: opensshEd25519(Buffer.from(jwk.d, "base64url"), Buffer.from(jwk.x, "base64url")) };
    }
    default:
      return { ok: false, motivo: `algoritmo non supportato (${k.asymmetricKeyType ?? "sconosciuto"}): servono RSA, ECDSA o ed25519` };
  }
}

/** Il motivo, in italiano, di un errore di ssh2 su una chiave. */
function motivoDi(e: Error): string {
  const m = e.message.toLowerCase();
  if (m.includes("no passphrase given")) return "la chiave è cifrata e manca la passphrase";
  if (m.includes("bad passphrase") || m.includes("integrity check failed") || m.includes("bad decrypt")) return "passphrase sbagliata";
  return "formato non riconosciuto (servono OpenSSH o PEM: RSA, ECDSA, ed25519)";
}

/**
 * Legge una chiave privata SSH (testo com'è nell'archivio) con la sua
 * passphrase facoltativa. Non lancia.
 */
export function leggiChiavePrivata(testo: string, passphrase?: string | null): EsitoChiave {
  const pass = passphrase || undefined;
  let sorgente = testo;
  if (PKCS8.test(testo)) {
    const c = daPkcs8(testo, pass);
    if (!c.ok) return c;
    sorgente = c.testo;
  }
  const k = utils.parseKey(sorgente, pass);
  if (k instanceof Error) return { ok: false, motivo: motivoDi(k) };
  if (!k.isPrivateKey()) return { ok: false, motivo: "è la chiave pubblica: serve la privata" };
  return { ok: true, chiave: k };
}
