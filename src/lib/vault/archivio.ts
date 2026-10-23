/**
 * L'archivio locale cifrato delle appliance (piano da-vault 2026-10-23, «DA-IPAM dei clienti», passo 10).
 *
 * Una chiave dei dati casuale di 32 byte esiste solo dentro gli slot age, mai in chiaro su disco:
 * - `slot-cliente.age`: passphrase del cliente (almeno 14 caratteri), scrypt;
 * - `slot-domarc.age`: verso la chiave pubblica Domarc (X25519, D3); acceso di serie, il cliente lo esclude per
 *   iscritto (D5: `senzaDomarc`);
 * - `slot-tpm.cred`: systemd-creds `tpm2+host`. L'unità lo carica con `LoadCredentialEncrypted=vault-key:…` e l'app
 *   legge il contenuto in chiaro da `$CREDENTIALS_DIRECTORY/vault-key`.
 *
 * Ogni slot contiene `{ formato, archivio, slot, chiave }`: l'id dell'archivio e il nome dello slot stanno DENTRO lo
 * slot, così uno slot copiato da un altro archivio (o rinominato) è rifiutato anche con la passphrase giusta. In più
 * `archivio.json` tiene una verifica HMAC della chiave: una chiave che non è quella dell'archivio non apre né riscrive.
 *
 * `archivio.json` si scrive per ultimo: c'è = l'archivio è completo. Scritture atomiche (file temporaneo, fsync,
 * rename, fsync della cartella), file 0600, cartella 0700. Nessun messaggio contiene la chiave o la passphrase.
 */
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ErroreVault } from "./tipi";

export const PASSPHRASE_MINIMA = 14;
/** Il fattore di lavoro di scrypt di age (2^18): quello dei file age normali. Le prove lo abbassano. */
export const SCRYPT_LOGN = 18;
const FORMATO = 1;

export type NomeSlot = "cliente" | "domarc" | "tpm";

const FILE_SLOT: Record<NomeSlot, string> = {
  cliente: "slot-cliente.age",
  domarc: "slot-domarc.age",
  tpm: "slot-tpm.cred",
};
const FILE_ARCHIVIO = "archivio.json";

/** D5: il cliente ha escluso lo slot Domarc per iscritto; il riferimento della sua richiesta sta nell'archivio. */
export interface DomarcEscluso {
  richiesta: string;
  il: string;
}

export interface InfoArchivio {
  formato: number;
  id: string;
  creato: string;
  /** Presente solo se l'archivio è nato senza slot Domarc, con la richiesta scritta del cliente. */
  domarcEscluso?: DomarcEscluso;
  /** Lo slot è dichiarato nell'archivio e il suo file c'è. */
  slot: Record<NomeSlot, boolean>;
}

interface ArchivioSuDisco {
  formato: number;
  id: string;
  creato: string;
  verifica: string;
  domarcEscluso?: DomarcEscluso;
  slot: Record<NomeSlot, boolean>;
}

interface ContenutoSlot {
  formato: number;
  archivio: string;
  slot: NomeSlot;
  chiave: string;
}

// ── File ────────────────────────────────────────────────────────────────────

/** Scrittura atomica 0600: file temporaneo, fsync, rename, fsync della cartella. */
export function scriviAtomico(dir: string, nome: string, dati: string | Uint8Array): void {
  const finale = join(dir, nome);
  const tmp = join(dir, `.${nome}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`);
  writeFileSync(tmp, dati, { mode: 0o600 });
  const fd = openSync(tmp, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, finale);
  sincronizzaCartella(dir);
}

function sincronizzaCartella(dir: string): void {
  try {
    const fd = openSync(dir, "r");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch {
    // Alcuni file system non permettono fsync su una cartella: il rename resta atomico.
  }
}

function leggiSuDisco(dir: string): ArchivioSuDisco {
  const p = join(dir, FILE_ARCHIVIO);
  if (!existsSync(p)) throw new ErroreVault("archivio_assente", "Archivio del vault assente: va creato prima di sbloccarlo");
  let a: unknown;
  try {
    a = JSON.parse(readFileSync(p, "utf8"));
  } catch {
    throw new ErroreVault("archivio_rotto", "archivio.json del vault non è leggibile");
  }
  const r = a as Partial<ArchivioSuDisco> | null;
  if (
    !r || typeof r !== "object" || r.formato !== FORMATO || typeof r.id !== "string" || typeof r.verifica !== "string" ||
    typeof r.creato !== "string" || !r.slot || typeof r.slot !== "object"
  ) {
    throw new ErroreVault("archivio_rotto", "archivio.json del vault non ha la forma attesa");
  }
  const s = r.slot as Partial<Record<NomeSlot, unknown>>;
  const e = (r as { domarcEscluso?: Partial<DomarcEscluso> }).domarcEscluso;
  // Il riferimento della richiesta del cliente si conserva a ogni riscrittura di archivio.json (slot TPM, slot, …).
  const domarcEscluso = e && typeof e.richiesta === "string" && typeof e.il === "string" ? { richiesta: e.richiesta, il: e.il } : undefined;
  return {
    formato: r.formato,
    id: r.id,
    creato: r.creato,
    verifica: r.verifica,
    ...(domarcEscluso ? { domarcEscluso } : {}),
    slot: { cliente: s.cliente === true, domarc: s.domarc === true, tpm: s.tpm === true },
  };
}

function scriviSuDisco(dir: string, a: ArchivioSuDisco): void {
  scriviAtomico(dir, FILE_ARCHIVIO, `${JSON.stringify(a, null, 2)}\n`);
}

// ── Chiave e contenuto degli slot ───────────────────────────────────────────

function verificaDi(chiave: Buffer, id: string): string {
  return createHmac("sha256", chiave).update(`da-vault/verifica/${id}`).digest("hex");
}

function chiaveDellArchivio(a: ArchivioSuDisco, chiave: Buffer): boolean {
  if (chiave.length !== 32) return false;
  const atteso = Buffer.from(a.verifica, "hex");
  const calcolato = Buffer.from(verificaDi(chiave, a.id), "hex");
  return atteso.length === calcolato.length && timingSafeEqual(atteso, calcolato);
}

function controllaChiave(a: ArchivioSuDisco, chiave: Buffer): void {
  if (!chiaveDellArchivio(a, chiave)) {
    throw new ErroreVault("slot_estraneo", "La chiave data non è quella di questo archivio");
  }
}

/** La chiave è quella dell'archivio della cartella (per chi la riceve già aperta, es. la ricifra). */
export function chiaveDiQuestoArchivio(dir: string, chiave: Buffer): boolean {
  return chiaveDellArchivio(leggiSuDisco(dir), chiave);
}

function contenuto(a: ArchivioSuDisco, slot: NomeSlot, chiave: Buffer): Buffer {
  const c: ContenutoSlot = { formato: FORMATO, archivio: a.id, slot, chiave: chiave.toString("base64") };
  return Buffer.from(JSON.stringify(c), "utf8");
}

/** Legge il contenuto di uno slot già decifrato e controlla che sia di QUESTO archivio e di QUESTO slot. */
function chiaveDaContenuto(a: ArchivioSuDisco, slot: NomeSlot, dati: Uint8Array): Buffer {
  let c: Partial<ContenutoSlot>;
  try {
    c = JSON.parse(Buffer.from(dati).toString("utf8")) as Partial<ContenutoSlot>;
  } catch {
    throw new ErroreVault("slot_errato", `Lo slot ${slot} non ha un contenuto leggibile`);
  }
  if (!c || c.formato !== FORMATO || typeof c.chiave !== "string") {
    throw new ErroreVault("slot_errato", `Lo slot ${slot} non ha un contenuto leggibile`);
  }
  if (c.archivio !== a.id || c.slot !== slot) {
    throw new ErroreVault("slot_estraneo", `Lo slot ${slot} è di un altro archivio o di un altro slot: non si usa`);
  }
  const chiave = Buffer.from(c.chiave, "base64");
  if (!chiaveDellArchivio(a, chiave)) {
    throw new ErroreVault("slot_estraneo", `Lo slot ${slot} non contiene la chiave di questo archivio`);
  }
  return chiave;
}

function fileSlot(dir: string, a: ArchivioSuDisco, slot: NomeSlot): string {
  const p = join(dir, FILE_SLOT[slot]);
  if (!a.slot[slot] || !existsSync(p)) {
    throw new ErroreVault("slot_assente", `Lo slot ${slot} non c'è in questo archivio`);
  }
  return p;
}

// ── Cifratura age ───────────────────────────────────────────────────────────

/**
 * `age-encryption` si carica SOLO quando serve (`await import`): è un modulo ESM puro con dipendenze (`@noble/*`) che
 * vogliono Node >= 20.19, mentre l'app dichiara `node >=20`. Questo file lo raggiungono all'avvio jobs, backup, layout
 * e catalogo delle opzioni (via `appliance.ts`): importato in modo statico, su un Node 20.x più vecchio l'app non
 * partirebbe più anche a interruttori spenti (revisione del 23/10, rilievo 6; provato da `avvio-leggero.test.ts`).
 */
async function age(): Promise<typeof import("age-encryption")> {
  return import("age-encryption");
}

async function cifraConPassphrase(dati: Uint8Array, passphrase: string, logN: number): Promise<Uint8Array> {
  const { Encrypter } = await age();
  const e = new Encrypter();
  e.setPassphrase(passphrase);
  e.setScryptWorkFactor(logN);
  return e.encrypt(dati);
}

/** Un destinatario age X25519: `age1` e 58 caratteri bech32. */
export function destinatarioValido(destinatario: string): boolean {
  return /^age1[02-9ac-hj-np-z]{58}$/.test(destinatario.trim());
}

async function cifraVersoDestinatario(dati: Uint8Array, destinatario: string): Promise<Uint8Array> {
  if (!destinatarioValido(destinatario)) {
    throw new ErroreVault("configurazione", "La chiave pubblica Domarc non è un destinatario age X25519 (age1…)");
  }
  const { Encrypter } = await age();
  const e = new Encrypter();
  try {
    e.addRecipient(destinatario.trim());
  } catch {
    throw new ErroreVault("configurazione", "La chiave pubblica Domarc non è un destinatario age valido");
  }
  return e.encrypt(dati);
}

/**
 * La regola unica per la passphrase del cliente (creazione, cambio, recupero): almeno 14 caratteri e niente spazi, tab o
 * a capo all'inizio o alla fine. Non si taglia in silenzio: `crea` la prendeva com'era e `reset-password` la tagliava, e
 * un cliente con uno spazio finale restava fuori dopo un recupero (revisione del 23/10, rilievo 10). Rifiutarla agli
 * estremi rende le due strade identiche.
 */
function controllaPassphrase(passphrase: string): void {
  if (typeof passphrase !== "string" || [...passphrase].length < PASSPHRASE_MINIMA) {
    throw new ErroreVault("configurazione", `La passphrase del cliente deve avere almeno ${PASSPHRASE_MINIMA} caratteri`);
  }
  if (passphrase !== passphrase.trim()) {
    throw new ErroreVault("configurazione", "La passphrase del cliente non deve avere spazi, tab o a capo all'inizio o alla fine (spazi dentro vanno bene)");
  }
}

// ── API ─────────────────────────────────────────────────────────────────────

export interface OpzioniCreazione {
  passphrase: string;
  /** Destinatario age (age1…) della chiave Domarc; null solo con `senzaDomarc`. */
  chiaveDomarc: string | null;
  /** D5: il cliente ha escluso per iscritto lo slot Domarc. */
  senzaDomarc?: boolean;
  /** Con `senzaDomarc` è OBBLIGATORIO: il riferimento della richiesta scritta del cliente (finisce nell'archivio). */
  richiestaCliente?: string;
  scryptLogN?: number;
}

/** Crea l'archivio: chiave nuova, slot cliente e (di serie) Domarc, poi `archivio.json`. Non sovrascrive. */
export async function creaArchivio(dir: string, op: OpzioniCreazione): Promise<{ id: string; chiave: Buffer }> {
  if (existsSync(join(dir, FILE_ARCHIVIO))) {
    throw new ErroreVault("archivio_esistente", "L'archivio del vault c'è già: non si ricrea sopra");
  }
  controllaPassphrase(op.passphrase);
  const conDomarc = !op.senzaDomarc;
  const richiesta = op.richiestaCliente?.trim();
  if (!conDomarc && !richiesta) {
    throw new ErroreVault("configurazione", "Senza slot Domarc serve il riferimento della richiesta scritta del cliente (richiesta cliente)");
  }
  if (conDomarc && !op.chiaveDomarc) {
    throw new ErroreVault(
      "configurazione",
      "Manca la chiave pubblica Domarc (DA_VAULT_CHIAVE_DOMARC): lo slot Domarc è acceso di serie; si esclude solo con la richiesta scritta del cliente",
    );
  }
  if (conDomarc && op.chiaveDomarc && !destinatarioValido(op.chiaveDomarc)) {
    throw new ErroreVault("configurazione", "La chiave pubblica Domarc non è un destinatario age X25519 (age1…)");
  }
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const chiave = randomBytes(32);
  const a: ArchivioSuDisco = {
    formato: FORMATO,
    id: randomUUID(),
    creato: new Date().toISOString(),
    verifica: "",
    ...(!conDomarc && richiesta ? { domarcEscluso: { richiesta, il: new Date().toISOString() } } : {}),
    slot: { cliente: true, domarc: conDomarc, tpm: false },
  };
  a.verifica = verificaDi(chiave, a.id);
  scriviAtomico(dir, FILE_SLOT.cliente, await cifraConPassphrase(contenuto(a, "cliente", chiave), op.passphrase, op.scryptLogN ?? SCRYPT_LOGN));
  if (conDomarc && op.chiaveDomarc) {
    scriviAtomico(dir, FILE_SLOT.domarc, await cifraVersoDestinatario(contenuto(a, "domarc", chiave), op.chiaveDomarc));
  }
  scriviSuDisco(dir, a);
  return { id: a.id, chiave };
}

export function archivioPresente(dir: string): boolean {
  return existsSync(join(dir, FILE_ARCHIVIO));
}

export function leggiArchivio(dir: string): InfoArchivio {
  const a = leggiSuDisco(dir);
  const presente = (s: NomeSlot) => a.slot[s] && existsSync(join(dir, FILE_SLOT[s]));
  return {
    formato: a.formato,
    id: a.id,
    creato: a.creato,
    ...(a.domarcEscluso ? { domarcEscluso: a.domarcEscluso } : {}),
    slot: { cliente: presente("cliente"), domarc: presente("domarc"), tpm: presente("tpm") },
  };
}

export async function apriConPassphrase(dir: string, passphrase: string): Promise<Buffer> {
  const a = leggiSuDisco(dir);
  const p = fileSlot(dir, a, "cliente");
  const { Decrypter } = await age();
  const d = new Decrypter();
  d.addPassphrase(passphrase);
  let dati: Uint8Array;
  try {
    dati = await d.decrypt(readFileSync(p));
  } catch {
    throw new ErroreVault("slot_errato", "Passphrase errata: lo slot del cliente non si apre");
  }
  return chiaveDaContenuto(a, "cliente", dati);
}

/** `identita`: la chiave privata Domarc (AGE-SECRET-KEY-1…), presa da Keeper e passata sullo stdin. */
export async function apriConDomarc(dir: string, identita: string): Promise<Buffer> {
  const a = leggiSuDisco(dir);
  const p = fileSlot(dir, a, "domarc");
  const { Decrypter } = await age();
  const d = new Decrypter();
  try {
    d.addIdentity(identita.trim());
  } catch {
    throw new ErroreVault("configurazione", "La chiave privata Domarc non è un'identità age (AGE-SECRET-KEY-1…)");
  }
  let dati: Uint8Array;
  try {
    dati = await d.decrypt(readFileSync(p));
  } catch {
    throw new ErroreVault("slot_errato", "La chiave Domarc data non apre lo slot Domarc di questo archivio");
  }
  return chiaveDaContenuto(a, "domarc", dati);
}

/** Lo slot TPM come lo vede l'app: `vault-key` nella cartella delle credenziali di systemd (già decifrato dal TPM). */
export function apriConTpm(dir: string, cartellaCredenziali: string | undefined = process.env.CREDENTIALS_DIRECTORY): Buffer {
  const a = leggiSuDisco(dir);
  if (!cartellaCredenziali) throw new ErroreVault("slot_assente", "Nessuna credenziale di systemd (CREDENTIALS_DIRECTORY): niente slot TPM");
  const p = join(cartellaCredenziali, "vault-key");
  if (!existsSync(p)) throw new ErroreVault("slot_assente", "La credenziale vault-key di systemd non c'è: niente slot TPM");
  return chiaveDaContenuto(a, "tpm", readFileSync(p));
}

/** Quello che `systemd-creds encrypt` deve cifrare per lo slot TPM (passa sullo stdin, mai su disco in chiaro). */
export function contenutoSlotTpm(dir: string, chiave: Buffer): Buffer {
  const a = leggiSuDisco(dir);
  controllaChiave(a, chiave);
  return contenuto(a, "tpm", chiave);
}

export type EseguiComando = (comando: string, argomenti: string[], stdin: Buffer) => Promise<void>;

/** Esegue un comando passando i dati sullo stdin; errore se esce diverso da 0. */
export const eseguiConStdin: EseguiComando = async (comando, argomenti, stdin) => {
  const { spawn } = await import("node:child_process");
  await new Promise<void>((risolvi, rifiuta) => {
    const p = spawn(comando, argomenti, { stdio: ["pipe", "ignore", "pipe"] });
    let errore = "";
    p.stderr.on("data", (d: Buffer) => { errore += d.toString("utf8"); });
    p.on("error", rifiuta);
    p.on("close", (codice) => (codice === 0 ? risolvi() : rifiuta(new Error(`${comando} è uscito con ${codice}: ${errore.trim().slice(0, 300)}`))));
    p.stdin.end(stdin);
  });
};

/** Scrive lo slot TPM con `systemd-creds encrypt --with-key=tpm2+host`, il contenuto sullo stdin. */
export async function scriviSlotTpm(dir: string, chiave: Buffer, esegui: EseguiComando = eseguiConStdin): Promise<void> {
  const a = leggiSuDisco(dir);
  controllaChiave(a, chiave);
  const uscita = join(dir, FILE_SLOT.tpm);
  await esegui("systemd-creds", ["encrypt", "--with-key=tpm2+host", "--name=vault-key", "-", uscita], contenuto(a, "tpm", chiave));
  if (!existsSync(uscita)) throw new ErroreVault("configurazione", "systemd-creds non ha scritto lo slot TPM");
  scriviSuDisco(dir, { ...a, slot: { ...a.slot, tpm: true } });
}

/** Riscrive lo slot del cliente con una passphrase nuova (stessa chiave dei dati). */
export async function scriviSlotCliente(dir: string, chiave: Buffer, passphrase: string, scryptLogN: number = SCRYPT_LOGN): Promise<void> {
  const a = leggiSuDisco(dir);
  controllaChiave(a, chiave);
  controllaPassphrase(passphrase);
  scriviAtomico(dir, FILE_SLOT.cliente, await cifraConPassphrase(contenuto(a, "cliente", chiave), passphrase, scryptLogN));
  if (!a.slot.cliente) scriviSuDisco(dir, { ...a, slot: { ...a.slot, cliente: true } });
}

/** Riscrive lo slot Domarc verso un destinatario (anche nuovo: cambio di generazione), stessa chiave dei dati. */
export async function scriviSlotDomarc(dir: string, chiave: Buffer, destinatario: string): Promise<void> {
  const a = leggiSuDisco(dir);
  controllaChiave(a, chiave);
  scriviAtomico(dir, FILE_SLOT.domarc, await cifraVersoDestinatario(contenuto(a, "domarc", chiave), destinatario));
  if (!a.slot.domarc) scriviSuDisco(dir, { ...a, slot: { ...a.slot, domarc: true } });
}

/** Toglie uno slot (voce e file). L'ultimo slot non si toglie: l'archivio non si aprirebbe più. */
export function togliSlot(dir: string, slot: NomeSlot): void {
  const a = leggiSuDisco(dir);
  const restano = (Object.keys(FILE_SLOT) as NomeSlot[]).filter((s) => s !== slot && a.slot[s] && existsSync(join(dir, FILE_SLOT[s])));
  if (restano.length === 0) {
    throw new ErroreVault("configurazione", `Lo slot ${slot} è l'ultimo: togliendolo l'archivio non si aprirebbe più`);
  }
  scriviSuDisco(dir, { ...a, slot: { ...a.slot, [slot]: false } });
  rmSync(join(dir, FILE_SLOT[slot]), { force: true });
  sincronizzaCartella(dir);
}
