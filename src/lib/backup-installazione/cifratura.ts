/**
 * Cifratura dei backup dell'installazione verso una chiave di recupero (piano di sicurezza 14/11, P0-4).
 *
 * Sull'appliance resta solo la chiave PUBBLICA: basta per cifrare, non per aprire. La privata è un testo da
 * stampare e chiudere in busta (Riccardo, 15/11: una al cliente, una copia su DA-Link). Chi porta via un backup,
 * o l'appliance intera, non lo apre.
 *
 * Schema: X25519 con chiave effimera per file → HKDF-SHA256 → AES-256-GCM a blocchi di 1 MiB. Ogni blocco porta
 * nel dato autenticato l'intestazione, il proprio numero e il segno «ultimo»: un file tagliato, riordinato o
 * toccato è rifiutato. Solo `node:crypto`, niente programmi esterni.
 */
import fs from "node:fs";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  type KeyObject,
} from "node:crypto";

const MAGIA = "DAINVENT-BACKUP 1\n";
const PREFISSO_PRIVATA = "DAINV-RK1";
const PREFISSO_PUBBLICA = "DAINV-PUB1:";
const BLOCCO = 1024 * 1024;
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
// Involucri DER fissi di una chiave X25519 grezza (RFC 8410).
const DER_PRIVATA = Buffer.from("302e020100300506032b656e04220420", "hex");
const DER_PUBBLICA = Buffer.from("302a300506032b656e032100", "hex");

function base32(b: Buffer): string {
  let bit = "";
  for (const x of b) bit += x.toString(2).padStart(8, "0");
  return (bit.match(/.{5}/g) ?? []).map((g) => B32[parseInt(g, 2)]).join("");
}

function daBase32(s: string): Buffer | null {
  let bit = "";
  for (const c of s) {
    const i = B32.indexOf(c);
    if (i < 0) return null;
    bit += i.toString(2).padStart(5, "0");
  }
  return Buffer.from((bit.match(/.{8}/g) ?? []).map((g) => parseInt(g, 2)));
}

const controllo = (grezza: Buffer): Buffer => createHash("sha256").update(PREFISSO_PRIVATA).update(grezza).digest().subarray(0, 3);

function oggettoPubblica(grezza: Buffer): KeyObject {
  return createPublicKey({ key: Buffer.concat([DER_PUBBLICA, grezza]), format: "der", type: "spki" });
}

function grezzaDaOggetto(k: KeyObject): Buffer {
  return (k.export({ format: "der", type: "spki" }) as Buffer).subarray(DER_PUBBLICA.length);
}

function leggiPubblica(testo: string): Buffer {
  const t = testo.trim();
  const grezza = t.startsWith(PREFISSO_PUBBLICA) ? Buffer.from(t.slice(PREFISSO_PUBBLICA.length), "base64") : Buffer.alloc(0);
  if (grezza.length !== 32) throw new Error("La chiave pubblica di recupero non è leggibile");
  return grezza;
}

/** La chiave della busta: maiuscole o minuscole, trattini o spazi. Un errore di copiatura si vede dal controllo. */
function leggiPrivata(testo: string): KeyObject {
  const t = testo.toUpperCase().replace(/[\s-]/g, "");
  const prefisso = PREFISSO_PRIVATA.replace(/-/g, "");
  const dati = t.startsWith(prefisso) ? daBase32(t.slice(prefisso.length)) : null;
  if (!dati || dati.length !== 35 || !dati.subarray(32).equals(controllo(dati.subarray(0, 32)))) {
    throw new Error("La chiave di recupero è stata ricopiata male: ricontrollala sul foglio, gruppo per gruppo");
  }
  return createPrivateKey({ key: Buffer.concat([DER_PRIVATA, dati.subarray(0, 32)]), format: "der", type: "pkcs8" });
}

const sembraPrivata = (testo: string): boolean => testo.toUpperCase().replace(/[\s-]/g, "").startsWith(PREFISSO_PRIVATA.replace(/-/g, ""));

function impronta(grezzaPubblica: Buffer): string {
  return (createHash("sha256").update(grezzaPubblica).digest("hex").slice(0, 16).match(/.{4}/g) ?? []).join("-");
}

/** Genera la coppia. La privata si mostra una volta e non si salva sull'appliance. */
export function generaChiaviRecupero(): { pubblica: string; privata: string; impronta: string } {
  const { publicKey, privateKey } = generateKeyPairSync("x25519");
  const grezza = (privateKey.export({ format: "der", type: "pkcs8" }) as Buffer).subarray(DER_PRIVATA.length);
  const pub = grezzaDaOggetto(publicKey);
  const testo = base32(Buffer.concat([grezza, controllo(grezza)]));
  return {
    pubblica: PREFISSO_PUBBLICA + pub.toString("base64"),
    privata: `${PREFISSO_PRIVATA}-${(testo.match(/.{4}/g) ?? []).join("-")}`,
    impronta: impronta(pub),
  };
}

/** Il nome corto di una coppia, uguale dalla pubblica e dalla privata: dice quale busta apre quale backup. */
export function improntaChiave(testo: string): string {
  return impronta(sembraPrivata(testo) ? grezzaDaOggetto(createPublicKey(leggiPrivata(testo))) : leggiPubblica(testo));
}

type Intestazione = { v: 1; alg: string; effimera: string; sale: string; nonce: string; blocco: number; impronta: string; creato: string };

function chiaveDelFile(segreto: Buffer, i: Intestazione, destinatario: Buffer): Buffer {
  const info = Buffer.concat([Buffer.from("da-invent:backup:v1"), Buffer.from(i.effimera, "base64"), destinatario]);
  return Buffer.from(hkdfSync("sha256", segreto, Buffer.from(i.sale, "base64"), info, 32));
}

function datoAutenticato(impIntestazione: Buffer, n: number, ultimo: boolean): Buffer {
  const b = Buffer.alloc(5);
  b.writeUInt32BE(n, 0);
  b[4] = ultimo ? 1 : 0;
  return Buffer.concat([impIntestazione, b]);
}

function nonceBlocco(prefisso: Buffer, n: number): Buffer {
  const c = Buffer.alloc(4);
  c.writeUInt32BE(n, 0);
  return Buffer.concat([prefisso, c]);
}

/** Cifra `origine` in `destinazione` (permessi 600). Scrive su un file provvisorio e lo rinomina alla fine. */
export function cifraFile(origine: string, destinazione: string, pubblica: string): { impronta: string } {
  const destinatario = leggiPubblica(pubblica);
  const eff = generateKeyPairSync("x25519");
  const intestazione: Intestazione = {
    v: 1,
    alg: "X25519-HKDF-SHA256-AES256GCM",
    effimera: grezzaDaOggetto(eff.publicKey).toString("base64"),
    sale: randomBytes(32).toString("base64"),
    nonce: randomBytes(8).toString("base64"),
    blocco: BLOCCO,
    impronta: impronta(destinatario),
    creato: new Date().toISOString(),
  };
  const riga = Buffer.from(`${JSON.stringify(intestazione)}\n`);
  const imp = createHash("sha256").update(riga).digest();
  const chiave = chiaveDelFile(diffieHellman({ privateKey: eff.privateKey, publicKey: oggettoPubblica(destinatario) }), intestazione, destinatario);
  const prefisso = Buffer.from(intestazione.nonce, "base64");
  const provvisorio = `${destinazione}.parziale`;
  const entra = fs.openSync(origine, "r");
  let esce: number | null = null;
  try {
    esce = fs.openSync(provvisorio, "w", 0o600);
    fs.writeSync(esce, MAGIA);
    fs.writeSync(esce, riga);
    const buf = Buffer.alloc(BLOCCO);
    for (let n = 0; ; n++) {
      const letti = fs.readSync(entra, buf, 0, BLOCCO, null);
      const ultimo = letti === 0;
      const c = createCipheriv("aes-256-gcm", chiave, nonceBlocco(prefisso, n));
      c.setAAD(datoAutenticato(imp, n, ultimo));
      const cifrato = Buffer.concat([c.update(buf.subarray(0, letti)), c.final()]);
      const testa = Buffer.alloc(5);
      testa[0] = ultimo ? 1 : 0;
      testa.writeUInt32BE(letti, 1);
      fs.writeSync(esce, Buffer.concat([testa, cifrato, c.getAuthTag()]));
      if (ultimo) break;
    }
    fs.fsyncSync(esce);
    fs.closeSync(esce);
    esce = null;
    fs.renameSync(provvisorio, destinazione);
  } catch (e) {
    if (esce !== null) fs.closeSync(esce);
    fs.rmSync(provvisorio, { force: true });
    throw e;
  } finally {
    fs.closeSync(entra);
  }
  return { impronta: intestazione.impronta };
}

function leggiEsatto(fd: number, n: number): Buffer {
  const b = Buffer.alloc(n);
  let fatto = 0;
  while (fatto < n) {
    const l = fs.readSync(fd, b, fatto, n - fatto, null);
    if (l === 0) throw new Error("Backup troncato: il file finisce prima della fine");
    fatto += l;
  }
  return b;
}

function leggiRiga(fd: number, massimo: number): Buffer {
  const pezzi: Buffer[] = [];
  for (let i = 0; i < massimo; i++) {
    const b = leggiEsatto(fd, 1);
    pezzi.push(b);
    if (b[0] === 10) return Buffer.concat(pezzi);
  }
  throw new Error("Non è un backup di DA-IPAM");
}

/** Apre un backup con la chiave della busta. Se qualcosa non torna non lascia nessun file in `destinazione`. */
export function decifraFile(origine: string, destinazione: string, privata: string): { creato: string; impronta: string } {
  const chiavePrivata = leggiPrivata(privata);
  const mia = grezzaDaOggetto(createPublicKey(chiavePrivata));
  const entra = fs.openSync(origine, "r");
  const provvisorio = `${destinazione}.parziale`;
  let esce: number | null = null;
  try {
    if (leggiRiga(entra, MAGIA.length).toString() !== MAGIA) throw new Error("Non è un backup di DA-IPAM");
    const riga = leggiRiga(entra, 4096);
    let i: Intestazione;
    try {
      i = JSON.parse(riga.toString()) as Intestazione;
    } catch {
      throw new Error("Backup manomesso o rovinato: intestazione illeggibile");
    }
    if (i.v !== 1 || i.blocco !== BLOCCO) throw new Error("Backup di una versione che questo programma non conosce");
    if (i.impronta !== impronta(mia)) {
      throw new Error(`Questa chiave di recupero non è quella di questo backup: serve la chiave ${i.impronta}, questa è ${impronta(mia)}`);
    }
    const imp = createHash("sha256").update(riga).digest();
    const segreto = diffieHellman({ privateKey: chiavePrivata, publicKey: oggettoPubblica(Buffer.from(i.effimera, "base64")) });
    const chiave = chiaveDelFile(segreto, i, mia);
    const prefisso = Buffer.from(i.nonce, "base64");
    esce = fs.openSync(provvisorio, "w", 0o600);
    for (let n = 0; ; n++) {
      const testa = leggiEsatto(entra, 5);
      const ultimo = testa[0] === 1;
      const lungo = testa.readUInt32BE(1);
      if (lungo > BLOCCO) throw new Error("Backup manomesso o rovinato");
      const cifrato = leggiEsatto(entra, lungo);
      const d = createDecipheriv("aes-256-gcm", chiave, nonceBlocco(prefisso, n));
      d.setAAD(datoAutenticato(imp, n, ultimo));
      d.setAuthTag(leggiEsatto(entra, 16));
      let chiaro: Buffer;
      try {
        chiaro = Buffer.concat([d.update(cifrato), d.final()]);
      } catch {
        throw new Error("Backup manomesso o rovinato: un blocco non supera il controllo");
      }
      fs.writeSync(esce, chiaro);
      if (ultimo) break;
    }
    fs.fsyncSync(esce);
    fs.closeSync(esce);
    esce = null;
    fs.renameSync(provvisorio, destinazione);
    return { creato: i.creato, impronta: i.impronta };
  } catch (e) {
    if (esce !== null) fs.closeSync(esce);
    fs.rmSync(provvisorio, { force: true });
    throw e;
  } finally {
    fs.closeSync(entra);
  }
}
