/**
 * La copia cifrata dell'archivio degli utenti (ADR 0043, decisioni del 26/11/2026: copia automatica verso una chiave
 * pubblica di recupero, la privata la tiene solo il cliente; più «Scarica una copia» a mano).
 *
 * - **Chiave di recupero**: una coppia age X25519. La pubblica sta accanto all'archivio (`recupero.pub`); la privata
 *   si mostra UNA volta, quando nasce, e non sta mai sul disco. Sulla macchina non c'è niente che apra le copie.
 * - **Copia automatica**: a ogni salvataggio e a ogni apertura, un file `utenti-<quando>.copia.age` nella cartella
 *   delle copie, cifrato verso la pubblica. Dentro c'è tutto ciò che serve a ripartire su un'altra macchina:
 *   l'archivio, le serrature, e la chiave dell'archivio. Con la sola chiave privata di recupero si riapre tutto:
 *   per questo va tenuta fuori dalla macchina.
 * - **Scarica una copia**: un file `.kdbx` standard, cifrato con una frase scelta in quel momento, che KeePassXC apre.
 *
 * `age-encryption` si carica solo quando serve (`await import`), come in `vault/archivio.ts`.
 */
import fs from "node:fs";
import * as kdbxweb from "kdbxweb";
import { resolveDataDir } from "../data-dir";
import { elencaCartella, unisci } from "../percorsi";
import { collegaArgon2 } from "../vault/keepass";
import { cartellaArchivio, scriviRegistroArchivio } from "./deposito";

const NOME = "utenti";
export const COPIE_TENUTE = 30;
export const FRASE_MINIMA = 14;

async function age(): Promise<typeof import("age-encryption")> {
  return import("age-encryption");
}

/** Dove stanno le copie: fuori dalla cartella dell'archivio; `DA_ARCHIVIO_COPIE_DIR` le porta su un altro disco o in rete. */
export function cartellaCopie(): string {
  return process.env.DA_ARCHIVIO_COPIE_DIR?.trim() || unisci(resolveDataDir(), "archivio-utenti-copie");
}
const filePubblica = (): string => unisci(cartellaArchivio(), "recupero.pub");

export async function nuovaChiaveRecupero(): Promise<{ privata: string; pubblica: string }> {
  const { generateIdentity, identityToRecipient } = await age();
  const privata = await generateIdentity();
  return { privata, pubblica: await identityToRecipient(privata) };
}

export function scriviChiavePubblicaRecupero(pubblica: string): void {
  if (!/^age1[02-9ac-hj-np-z]{58}$/.test(pubblica)) throw new Error("Chiave pubblica di recupero non valida");
  fs.mkdirSync(cartellaArchivio(), { recursive: true, mode: 0o700 });
  const tmp = `${filePubblica()}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${pubblica}\n`, { mode: 0o600 });
  fs.renameSync(tmp, filePubblica());
}

export function chiavePubblicaRecupero(): string | null {
  try {
    const p = fs.readFileSync(filePubblica(), "utf8").trim();
    return /^age1[02-9ac-hj-np-z]{58}$/.test(p) ? p : null;
  } catch {
    return null;
  }
}

interface Involto {
  formato: 1;
  il: string;
  /** I file dell'archivio, in base64: `utenti.kdbx`, `serrature.json`, `amministratore.json`. */
  file: Record<string, string>;
  /** La chiave dell'archivio (il key file), in base64: con questa e l'archivio si riapre tutto. */
  chiave: string;
}
const FILE_COPIATI = [`${NOME}.kdbx`, "serrature.json", "amministratore.json"] as const;

function nomiCopie(): string[] {
  try {
    return elencaCartella(cartellaCopie()).filter((f) => /^utenti-\d{8}-\d{6}\.copia\.age$/.test(f)).sort();
  } catch {
    return [];
  }
}

/**
 * Fa una copia adesso. Senza chiave pubblica di recupero non fa niente e dà `null` (lo dice lo stato). Non lancia:
 * una copia che non riesce non deve far fallire il salvataggio che l'ha chiesta, ma finisce nel journal.
 */
export async function faiCopia(chiave: Uint8Array, op: { adesso?: Date; chi?: { id: number; nome: string }; indirizzo?: string | null } = {}): Promise<string | null> {
  const pubblica = chiavePubblicaRecupero();
  if (!pubblica) return null;
  const adesso = op.adesso ?? new Date();
  try {
    const file: Record<string, string> = {};
    for (const f of FILE_COPIATI) {
      const p = unisci(cartellaArchivio(), f);
      if (fs.existsSync(p)) file[f] = fs.readFileSync(p).toString("base64");
    }
    if (!file[`${NOME}.kdbx`]) return null;
    const involto: Involto = { formato: 1, il: adesso.toISOString(), file, chiave: Buffer.from(chiave).toString("base64") };
    const { Encrypter } = await age();
    const e = new Encrypter();
    e.addRecipient(pubblica);
    const cifrato = await e.encrypt(new TextEncoder().encode(JSON.stringify(involto)));
    fs.mkdirSync(cartellaCopie(), { recursive: true, mode: 0o700 });
    const nome = `utenti-${adesso.toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-")}.copia.age`;
    const tmp = unisci(cartellaCopie(), `.${nome}.tmp-${process.pid}`);
    fs.writeFileSync(tmp, cifrato, { mode: 0o600 });
    fs.renameSync(tmp, unisci(cartellaCopie(), nome));
    const tutte = nomiCopie();
    for (const vecchia of tutte.slice(0, Math.max(0, tutte.length - COPIE_TENUTE))) fs.rmSync(unisci(cartellaCopie(), vecchia), { force: true });
    if (op.chi) scriviRegistroArchivio({ azione: "copia_fatta", utente: op.chi.nome, utenteId: op.chi.id, da: op.indirizzo ?? null, dettaglio: nome }, adesso);
    return nome;
  } catch (e) {
    console.error("[archivio] copia cifrata non riuscita:", e instanceof Error ? e.name : "errore");
    return null;
  }
}

export interface StatoCopie {
  /** C'è una chiave pubblica di recupero: senza, le copie automatiche non si fanno. */
  chiave: boolean;
  quante: number;
  /** Quando è stata fatta l'ultima (dal nome del file), ISO; `null` = mai. */
  ultima: string | null;
}

export function statoCopie(): StatoCopie {
  const tutte = nomiCopie();
  const m = tutte.length ? /^utenti-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/.exec(tutte[tutte.length - 1]) : null;
  return { chiave: chiavePubblicaRecupero() !== null, quante: tutte.length, ultima: m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z` : null };
}

/** Apre una copia con la chiave privata di recupero. Lancia se la chiave non è quella o il file non è una copia. */
export async function apriCopia(cifrato: Uint8Array, privata: string): Promise<Involto> {
  const { Decrypter } = await age();
  const d = new Decrypter();
  let testo: string;
  try {
    d.addIdentity(privata.trim());
    testo = new TextDecoder().decode(await d.decrypt(cifrato));
  } catch {
    throw new Error("La chiave di recupero non apre questa copia");
  }
  const involto = JSON.parse(testo) as Involto;
  if (involto.formato !== 1 || !involto.file?.[`${NOME}.kdbx`] || !involto.chiave) throw new Error("Il file non è una copia dell'archivio");
  return involto;
}

/**
 * Ripristina una copia in una cartella dati: rimette archivio e serrature com'erano. Non sovrascrive mai un archivio
 * che c'è già. Prima di scrivere prova che la chiave dentro la copia apra davvero l'archivio dentro la copia.
 */
export async function ripristinaCopia(cifrato: Uint8Array, privata: string, destinazione: string = cartellaArchivio()): Promise<{ il: string; file: string[] }> {
  const involto = await apriCopia(cifrato, privata);
  if (fs.existsSync(unisci(destinazione, `${NOME}.kdbx`))) throw new Error("Qui c'è già un archivio: non lo sovrascrivo");
  collegaArgon2();
  const chiave = Buffer.from(involto.chiave, "base64");
  const dati = Buffer.from(involto.file[`${NOME}.kdbx`], "base64");
  await kdbxweb.Kdbx.load(dati.buffer.slice(dati.byteOffset, dati.byteOffset + dati.byteLength) as ArrayBuffer, new kdbxweb.Credentials(null, chiave.buffer.slice(chiave.byteOffset, chiave.byteOffset + chiave.byteLength) as ArrayBuffer));
  fs.mkdirSync(destinazione, { recursive: true, mode: 0o700 });
  const scritti: string[] = [];
  for (const f of FILE_COPIATI) {
    if (!involto.file[f]) continue;
    fs.writeFileSync(unisci(destinazione, f), Buffer.from(involto.file[f], "base64"), { mode: 0o600 });
    scritti.push(f);
  }
  chiave.fill(0);
  return { il: involto.il, file: scritti };
}

/** Perché una frase per la copia a mano non va bene; `null` = va bene. */
export function difettoFrase(frase: string): string | null {
  if (frase.length < FRASE_MINIMA) return `La frase deve avere almeno ${FRASE_MINIMA} caratteri`;
  if (frase !== frase.trim()) return "La frase non può cominciare o finire con uno spazio";
  if (new Set(frase).size < 6) return "La frase è troppo ripetitiva";
  return null;
}

/**
 * «Scarica una copia»: lo stesso archivio, ma cifrato con una frase al posto della chiave interna. È un file KDBX 4
 * standard: lo apre KeePassXC con la sola frase, senza DA-IPAM.
 */
export async function copiaConFrase(chiave: Uint8Array, frase: string): Promise<Uint8Array> {
  const difetto = difettoFrase(frase);
  if (difetto) throw new Error(difetto);
  collegaArgon2();
  const dati = fs.readFileSync(unisci(cartellaArchivio(), `${NOME}.kdbx`));
  const k = Buffer.from(chiave);
  const db = await kdbxweb.Kdbx.load(dati.buffer.slice(dati.byteOffset, dati.byteOffset + dati.byteLength) as ArrayBuffer, new kdbxweb.Credentials(null, k.buffer.slice(k.byteOffset, k.byteOffset + k.byteLength) as ArrayBuffer));
  await db.credentials.setKeyFile(null);
  await db.credentials.setPassword(kdbxweb.ProtectedValue.fromString(frase));
  return new Uint8Array(await db.save());
}
