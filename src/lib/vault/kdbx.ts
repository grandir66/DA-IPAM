/**
 * Vault semplice, passo 1: il formato «vault Domarc v1» (spec in DA-Link,
 * `docs/superpowers/specs/2026-10-27-vault-semplice-kdbx-design.md` §2). Un archivio KDBX 4 aperto dal solo key file.
 *
 * Un archivio è una cartella (0700) con `<nome>.kdbx` e `<nome>.keyx` (key file XML 2.0; può mancare su disco se lo
 * dà systemd). Con i due file KeePassXC apre tutto. Lo stesso contratto lo
 * implementa `dalink/vault_kdbx.py` in DA-Link: le prove incrociate di `__tests__/kdbx.test.ts` aprono un archivio
 * scritto da ciascuno dei due.
 *
 * - Percorso = gruppi annidati (`clienti/70791/firewall/ssh` è la voce `ssh` nel gruppo `firewall`…), segmenti
 *   `[a-z0-9._-]`. Il percorso sta anche nel dato `domarc.percorso` della voce, e fa fede quello.
 * - Campi: `username`, `password`, `url`, `notes` sono quelli standard di KeePass; gli altri sono campi in più,
 *   protetti di serie tranne `protocollo`, `porta`, `scadenza`, `da-ref`. Un valore vuoto non si scrive.
 * - Storico di KeePass, al massimo 10 versioni; la versione corrente sta in `domarc.versione`.
 * - Uno scrittore per archivio (`<nome>.kdbx.lock` con il pid, lo stesso lucchetto del lato Python); a ogni
 *   salvataggio kdbxweb rifà sali e IV, Argon2id 64 MiB / 3 / 2, scrittura atomica e la copia di prima in
 *   `<nome>.kdbx.prec`.
 *
 * Mai un valore nei messaggi d'errore; il modulo non scrive log.
 */
import fs from "node:fs";
import { dirname } from "node:path";
import { unisci } from "@/lib/percorsi";
import * as kdbxweb from "kdbxweb";
import { argon2d, argon2id } from "hash-wasm";

export const FORMATO = "1";
export const STORICO_MASSIMO = 10;
const PROFONDITA_MASSIMA = 8;
const LUNGHEZZA_MASSIMA = 200;
const ARGON2 = { memoriaByte: 64 * 1024 * 1024, iterazioni: 3, parallelismo: 2 } as const;

const STANDARD: Readonly<Record<string, string>> = { username: "UserName", password: "Password", url: "URL", notes: "Notes" };
const CAMPI_KEEPASS = new Set(["Title", ...Object.values(STANDARD)]);
const IN_CHIARO = new Set(["protocollo", "porta", "scadenza", "da-ref"]);
const DATO_PERCORSO = "domarc.percorso";
const DATO_VERSIONE = "domarc.versione";

const SEGMENTO = /^[a-z0-9._-]+$/;
const CAMPO = /^[a-z0-9._-]{1,64}$/;
const NOME = /^[a-z0-9][a-z0-9_-]{0,63}$/;
// Caratteri che XML 1.0 non può contenere (il database è XML)
const NON_XML = /[^\t\n\r -퟿-�\u{10000}-\u{10ffff}]/u;

export type CodiceErroreKdbx =
  | "esiste"
  | "percorso"
  | "campo"
  | "valore"
  | "non_trovato"
  | "conflitto"
  | "chiave"
  | "formato"
  | "occupato"
  | "sola_lettura";

export class ErroreKdbx extends Error {
  constructor(
    readonly codice: CodiceErroreKdbx,
    messaggio: string,
  ) {
    super(messaggio);
    this.name = "ErroreKdbx";
  }
}

export type ValoriVoce = Record<string, string>;

// ── Argon2 e chiavi ──────────────────────────────────────────────────────────

let argon2Collegato = false;

/** kdbxweb non ha un Argon2 suo: si collega hash-wasm (una volta per processo). */
function collegaArgon2(): void {
  if (argon2Collegato) return;
  kdbxweb.CryptoEngine.setArgon2Impl(async (password, salt, memory, iterations, length, parallelism, type, version) => {
    if (version !== 0x13) throw new Error("Argon2: solo la versione 1.3");
    const f = type === kdbxweb.CryptoEngine.Argon2TypeArgon2id ? argon2id : argon2d;
    const out = await f({
      password: new Uint8Array(password),
      salt: new Uint8Array(salt),
      memorySize: memory,
      iterations,
      hashLength: length,
      parallelism,
      outputType: "binary",
    });
    return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
  });
  argon2Collegato = true;
}

const ab = (b: Uint8Array): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

/** Key file KeePass 2.x in formato XML 2.0 (quello di KeePassXC): 32 byte casuali e il controllo. */
export async function nuovoKeyfile(): Promise<Uint8Array> {
  return kdbxweb.Credentials.createRandomKeyFile(2);
}

// ── Disco ────────────────────────────────────────────────────────────────────

function fsyncCartella(cartella: string): void {
  const fd = fs.openSync(cartella, "r");
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

/** File temporaneo 0600 nella stessa cartella, fsync, rename, fsync della cartella. */
function scriviAtomico(destinazione: string, dati: Uint8Array): void {
  const tmp = `${destinazione}.tmp${process.pid}`;
  try {
    const fd = fs.openSync(tmp, "w", 0o600);
    try {
      fs.writeSync(fd, dati);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, destinazione);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
  fsyncCartella(dirname(destinazione));
}

function vivo(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** `<nome>.kdbx.lock` creato in esclusiva col pid; quello di un processo morto si riprende. */
function prendiLucchetto(lucchetto: string): void {
  for (let i = 0; i < 2; i++) {
    let fd: number;
    try {
      fd = fs.openSync(lucchetto, "wx", 0o600);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      let pid = 0;
      try {
        pid = Number.parseInt(fs.readFileSync(lucchetto, "utf8").trim(), 10) || 0;
      } catch {
        pid = 0;
      }
      if (pid > 0 && vivo(pid)) throw new ErroreKdbx("occupato", `L'archivio è già aperto in scrittura (processo ${pid})`);
      fs.rmSync(lucchetto, { force: true });
      continue;
    }
    try {
      fs.writeSync(fd, `${process.pid}\n`);
    } finally {
      fs.closeSync(fd);
    }
    return;
  }
  throw new ErroreKdbx("occupato", "Il lucchetto dell'archivio non si prende");
}

// ── Controlli ────────────────────────────────────────────────────────────────

function controllaPercorso(percorso: string): string[] {
  const segmenti = percorso.split("/");
  if (
    !percorso ||
    percorso.length > LUNGHEZZA_MASSIMA ||
    segmenti.length > PROFONDITA_MASSIMA ||
    segmenti.some((s) => !SEGMENTO.test(s) || s === "." || s === "..")
  ) {
    throw new ErroreKdbx("percorso", `Percorso non valido: segmenti [a-z0-9._-] separati da «/», al massimo ${PROFONDITA_MASSIMA} livelli`);
  }
  return segmenti;
}

function controllaValori(valori: ValoriVoce): ValoriVoce {
  const puliti: ValoriVoce = {};
  for (const [campo, valore] of Object.entries(valori)) {
    if (!CAMPO.test(campo) || campo === "otp") throw new ErroreKdbx("campo", "Nome di campo non valido: [a-z0-9._-], al massimo 64");
    if (typeof valore !== "string") throw new ErroreKdbx("valore", `Il campo «${campo}» non è testo`);
    if (NON_XML.test(valore)) throw new ErroreKdbx("valore", `Il campo «${campo}» ha caratteri che KeePass non può contenere`);
    if (valore !== "") puliti[campo] = valore;
  }
  return puliti;
}

function nomeFile(cartella: string, nome: string): string {
  if (!NOME.test(nome)) throw new ErroreKdbx("formato", "Nome dell'archivio non valido: [a-z0-9_-]");
  return unisci(cartella, `${nome}.kdbx`);
}

// ── Voci ─────────────────────────────────────────────────────────────────────

function testo(v: kdbxweb.KdbxEntryField | undefined): string {
  if (v === undefined) return "";
  return v instanceof kdbxweb.ProtectedValue ? v.getText() : v;
}

function valori(voce: kdbxweb.KdbxEntry): ValoriVoce {
  const fuori: ValoriVoce = {};
  for (const [campo, chiave] of Object.entries(STANDARD)) {
    const v = testo(voce.fields.get(chiave));
    if (v) fuori[campo] = v;
  }
  for (const [campo, v] of voce.fields) {
    if (CAMPI_KEEPASS.has(campo) || !CAMPO.test(campo)) continue;
    const t = testo(v);
    if (t) fuori[campo] = t;
  }
  return Object.fromEntries(Object.entries(fuori).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

function dato(voce: kdbxweb.KdbxEntry, chiave: string): string | undefined {
  return voce.customData?.get(chiave)?.value;
}

function impostaDato(voce: kdbxweb.KdbxEntry, chiave: string, valore: string): void {
  if (!voce.customData) voce.customData = new Map();
  voce.customData.set(chiave, { value: valore });
}

// ── Archivio ─────────────────────────────────────────────────────────────────

export class ArchivioKdbx {
  private chiuso = false;

  private constructor(
    readonly cartella: string,
    readonly nome: string,
    private readonly keyfile: Uint8Array,
    private readonly db: kdbxweb.Kdbx,
    private readonly scrittura: boolean,
  ) {}

  private static async carica(dati: Uint8Array, keyfile: Uint8Array): Promise<kdbxweb.Kdbx> {
    collegaArgon2();
    try {
      return await kdbxweb.Kdbx.load(ab(dati), new kdbxweb.Credentials(null, ab(keyfile)));
    } catch (e) {
      if (e instanceof kdbxweb.KdbxError && e.code === kdbxweb.Consts.ErrorCodes.InvalidKey) {
        throw new ErroreKdbx("chiave", "Il key file non apre questo archivio");
      }
      throw new ErroreKdbx("formato", `L'archivio non si legge (${e instanceof kdbxweb.KdbxError ? e.code : "errore"})`);
    }
  }

  /** Apre l'archivio: in sola lettura di serie; `scrittura` prende il lucchetto. */
  static async apri(cartella: string, nome: string, keyfile: Uint8Array, op: { scrittura?: boolean } = {}): Promise<ArchivioKdbx> {
    const kdbx = nomeFile(cartella, nome);
    const scrittura = op.scrittura === true;
    if (scrittura) {
      prendiLucchetto(`${kdbx}.lock`);
      for (const f of fs.readdirSync(cartella)) {
        if (f.startsWith(`${nome}.kdbx.tmp`) || f.startsWith(`${nome}.kdbx.prec.tmp`)) fs.rmSync(unisci(cartella, f), { force: true });
      }
    }
    try {
      let dati: Uint8Array;
      try {
        dati = new Uint8Array(fs.readFileSync(kdbx));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") throw new ErroreKdbx("non_trovato", `L'archivio «${nome}» non c'è`);
        throw e;
      }
      const db = await ArchivioKdbx.carica(dati, keyfile);
      if (db.meta.customData.get("domarc.formato")?.value !== FORMATO) {
        throw new ErroreKdbx("formato", "Non è un archivio Domarc (manca domarc.formato = 1)");
      }
      const a = new ArchivioKdbx(cartella, nome, keyfile, db, scrittura);
      a.indice(); // doppioni e voci illeggibili si vedono all'apertura
      return a;
    } catch (e) {
      if (scrittura) fs.rmSync(`${kdbx}.lock`, { force: true });
      throw e;
    }
  }

  chiudi(): void {
    if (this.chiuso) return;
    this.chiuso = true;
    if (this.scrittura) fs.rmSync(`${nomeFile(this.cartella, this.nome)}.lock`, { force: true });
  }

  // ── Lettura

  private nelCestino(voce: kdbxweb.KdbxEntry): boolean {
    const cestino = this.db.meta.recycleBinUuid;
    if (!cestino || cestino.empty) return false;
    for (let g = voce.parentGroup; g; g = g.parentGroup) {
      if (g.uuid.equals(cestino)) return true;
    }
    return false;
  }

  private indice(): Map<string, kdbxweb.KdbxEntry> {
    const indice = new Map<string, kdbxweb.KdbxEntry>();
    for (const voce of this.db.getDefaultGroup().allEntries()) {
      if (this.nelCestino(voce)) continue;
      const percorso = dato(voce, DATO_PERCORSO);
      if (percorso === undefined) continue;
      if (indice.has(percorso)) throw new ErroreKdbx("formato", `Due voci con lo stesso percorso «${percorso}»`);
      indice.set(percorso, voce);
    }
    return indice;
  }

  private voce(percorso: string): kdbxweb.KdbxEntry {
    controllaPercorso(percorso);
    const v = this.indice().get(percorso);
    if (!v) throw new ErroreKdbx("non_trovato", `Nessuna voce «${percorso}»`);
    return v;
  }

  metadati(): Record<string, string> {
    const fuori: Record<string, string> = {};
    for (const [k, v] of this.db.meta.customData) if (k.startsWith("domarc.")) fuori[k] = v.value ?? "";
    return fuori;
  }

  elenca(prefisso = ""): string[] {
    if (prefisso) controllaPercorso(prefisso);
    return [...this.indice().keys()].filter((p) => !prefisso || p === prefisso || p.startsWith(`${prefisso}/`)).sort();
  }

  leggi(percorso: string): ValoriVoce {
    return valori(this.voce(percorso));
  }

  versione(percorso: string): number {
    const n = Number.parseInt(dato(this.voce(percorso), DATO_VERSIONE) ?? "1", 10);
    return Number.isFinite(n) ? n : 1;
  }

  /** Le versioni di prima, dalla più recente. */
  storico(percorso: string): ValoriVoce[] {
    return [...this.voce(percorso).history].reverse().map(valori);
  }

  // ── Scrittura

  private scrivibile(): void {
    if (this.chiuso) throw new ErroreKdbx("sola_lettura", "L'archivio è chiuso");
    if (!this.scrittura) throw new ErroreKdbx("sola_lettura", "Archivio aperto in sola lettura");
  }

  private gruppo(segmenti: string[]): kdbxweb.KdbxGroup {
    let g = this.db.getDefaultGroup();
    for (const s of segmenti) g = g.groups.find((x) => x.name === s) ?? this.db.createGroup(g, s);
    return g;
  }

  private controllaVersione(percorso: string, attuale: number, attesa: number | undefined): void {
    if (attesa !== undefined && attesa !== attuale) {
      throw new ErroreKdbx("conflitto", `La voce «${percorso}» è alla versione ${attuale}, non alla ${attesa}`);
    }
  }

  /**
   * Scrive la voce (tutti i campi: quelli che mancano si tolgono) e ne dà la versione nuova. La versione di prima
   * resta nello storico. `versioneAttesa` (0 = voce nuova) evita di sovrascrivere il cambio di un altro.
   */
  scrivi(percorso: string, nuovi: ValoriVoce, op: { versioneAttesa?: number } = {}): number {
    this.scrivibile();
    const segmenti = controllaPercorso(percorso);
    const puliti = controllaValori(nuovi);
    let voce = this.indice().get(percorso);
    const attuale = voce ? this.versione(percorso) : 0;
    this.controllaVersione(percorso, attuale, op.versioneAttesa);
    if (!voce) {
      voce = this.db.createEntry(this.gruppo(segmenti.slice(0, -1)));
      voce.fields.set("Title", segmenti[segmenti.length - 1]);
      impostaDato(voce, DATO_PERCORSO, percorso);
    } else {
      voce.pushHistory();
      const troppe = voce.history.length - STORICO_MASSIMO;
      if (troppe > 0) voce.removeHistory(0, troppe);
      for (const campo of [...voce.fields.keys()]) if (!CAMPI_KEEPASS.has(campo)) voce.fields.delete(campo);
    }
    for (const [campo, chiave] of Object.entries(STANDARD)) {
      const v = puliti[campo] ?? "";
      voce.fields.set(chiave, campo === "password" ? kdbxweb.ProtectedValue.fromString(v) : v);
    }
    for (const [campo, v] of Object.entries(puliti)) {
      if (campo in STANDARD) continue;
      voce.fields.set(campo, IN_CHIARO.has(campo) ? v : kdbxweb.ProtectedValue.fromString(v));
    }
    impostaDato(voce, DATO_VERSIONE, String(attuale + 1));
    voce.times.update();
    return attuale + 1;
  }

  cancella(percorso: string, op: { versioneAttesa?: number } = {}): void {
    this.scrivibile();
    const voce = this.voce(percorso);
    this.controllaVersione(percorso, this.versione(percorso), op.versioneAttesa);
    this.db.move(voce, null);
  }

  /**
   * Scrittura atomica; il file di prima resta in `<nome>.kdbx.prec`. Prima di toccare il disco il file nuovo si riapre
   * col key file: uno che non si riapre non si scrive.
   */
  async salva(): Promise<void> {
    this.scrivibile();
    const dati = new Uint8Array(await this.db.save());
    const controllo = await ArchivioKdbx.carica(dati, this.keyfile);
    if ([...controllo.getDefaultGroup().allEntries()].length !== [...this.db.getDefaultGroup().allEntries()].length) {
      throw new ErroreKdbx("formato", "L'archivio appena scritto non si rilegge uguale");
    }
    const kdbx = nomeFile(this.cartella, this.nome);
    if (fs.existsSync(kdbx)) scriviAtomico(`${kdbx}.prec`, new Uint8Array(fs.readFileSync(kdbx)));
    scriviAtomico(kdbx, dati);
  }
}

// ── Creazione ────────────────────────────────────────────────────────────────

/** Crea l'archivio vuoto e ne dà il key file; `<nome>.keyx` va su disco solo con `scriviKeyfile` (di serie sì). Non sovrascrive. */
export async function creaArchivioKdbx(cartella: string, nome: string, op: { scriviKeyfile?: boolean } = {}): Promise<Uint8Array> {
  const kdbx = nomeFile(cartella, nome);
  if (fs.existsSync(kdbx)) throw new ErroreKdbx("esiste", `L'archivio «${nome}» c'è già: non si sovrascrive`);
  const keyfile = await nuovoKeyfile();
  fs.mkdirSync(cartella, { recursive: true, mode: 0o700 });
  fs.chmodSync(cartella, 0o700);
  prendiLucchetto(`${kdbx}.lock`);
  try {
    if (fs.existsSync(kdbx)) throw new ErroreKdbx("esiste", `L'archivio «${nome}» c'è già: non si sovrascrive`);
    collegaArgon2();
    const db = kdbxweb.Kdbx.create(new kdbxweb.Credentials(null, ab(keyfile)), nome);
    db.setVersion(4);
    db.setKdf(kdbxweb.Consts.KdfId.Argon2id);
    const kdf = db.header.kdfParameters;
    if (!kdf) throw new ErroreKdbx("formato", "Parametri di Argon2 non impostati");
    kdf.set("M", kdbxweb.VarDictionary.ValueType.UInt64, kdbxweb.Int64.from(ARGON2.memoriaByte));
    kdf.set("I", kdbxweb.VarDictionary.ValueType.UInt64, kdbxweb.Int64.from(ARGON2.iterazioni));
    kdf.set("P", kdbxweb.VarDictionary.ValueType.UInt32, ARGON2.parallelismo);
    db.meta.historyMaxItems = STORICO_MASSIMO;
    db.meta.customData.set("domarc.formato", { value: FORMATO });
    db.meta.customData.set("domarc.archivio", { value: nome });
    if (op.scriviKeyfile !== false) scriviAtomico(unisci(cartella, `${nome}.keyx`), keyfile);
    scriviAtomico(kdbx, new Uint8Array(await db.save()));
  } finally {
    fs.rmSync(`${kdbx}.lock`, { force: true });
  }
  return keyfile;
}
