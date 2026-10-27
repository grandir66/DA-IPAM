/**
 * Vault semplice, passo 1: il formato «vault Domarc v1» (spec in DA-Link,
 * `docs/superpowers/specs/2026-10-27-vault-semplice-kdbx-design.md` §2) in `src/lib/vault/kdbx.ts`.
 *
 * Valori tutti finti (il repository è pubblico). Le prove incrociate aprono gli archivi di `dati/vault_kdbx/`: uno
 * scritto da questo modulo e uno da `dalink/vault_kdbx.py` di DA-Link (gli stessi file stanno anche là).
 *
 * Run: node --import tsx --test src/lib/vault/__tests__/kdbx.test.ts
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as kdbxweb from "kdbxweb";
import { ArchivioKdbx, creaArchivioKdbx, ErroreKdbx, nuovoKeyfile } from "../kdbx";
import { scriviContenuto, type Contenuto } from "./support/kdbx-contenuto";

const DATI = join(__dirname, "dati", "vault_kdbx");
const SSH = "clienti/70000/firewall/ssh";
const VALORI: Record<string, string> = {
  username: "admin",
  password: "PW-FINTA-1",
  url: "https://192.0.2.1",
  notes: "nota àèì",
  private_key: "-----BEGIN FINTA-----\nabc\n-----END FINTA-----",
  porta: "22",
  protocollo: "ssh",
};

const ab = (b: Uint8Array): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
const modo = (p: string): number => statSync(p).mode & 0o777;

async function codice(f: () => unknown): Promise<string> {
  try {
    await f();
  } catch (e) {
    assert.ok(e instanceof ErroreKdbx, `atteso ErroreKdbx, arrivato ${String(e)}`);
    return e.codice;
  }
  assert.fail("doveva fallire");
}

/** L'archivio grezzo con kdbxweb, per guardare dentro senza passare dal modulo. */
async function grezzo(cartella: string, keyfile: Uint8Array): Promise<kdbxweb.Kdbx> {
  return kdbxweb.Kdbx.load(ab(readFileSync(join(cartella, "prova.kdbx"))), new kdbxweb.Credentials(null, ab(keyfile)));
}

let cartella: string;
let keyfile: Uint8Array;

beforeEach(async () => {
  cartella = join(mkdtempSync(join(tmpdir(), "vault-kdbx-")), "vault");
  keyfile = await creaArchivioKdbx(cartella, "prova");
});

describe("creazione", () => {
  it("crea i due file con i permessi", async () => {
    assert.equal(modo(cartella), 0o700);
    assert.deepEqual(readdirSync(cartella).sort(), ["prova.kdbx", "prova.keyx"]);
    for (const f of ["prova.kdbx", "prova.keyx"]) assert.equal(modo(join(cartella, f)), 0o600, f);
    assert.deepEqual(new Uint8Array(readFileSync(join(cartella, "prova.keyx"))), keyfile);
    assert.match(Buffer.from(keyfile).toString(), /<Version>2\.0<\/Version>/);
  });

  it("senza key file su disco", async () => {
    const c = join(mkdtempSync(join(tmpdir(), "vault-kdbx-")), "v");
    const k = await creaArchivioKdbx(c, "prova", { scriviKeyfile: false });
    assert.equal(existsSync(join(c, "prova.keyx")), false);
    const a = await ArchivioKdbx.apri(c, "prova", k);
    assert.deepEqual(a.elenca(), []);
  });

  it("non sovrascrive", async () => {
    const prima = readFileSync(join(cartella, "prova.kdbx"));
    assert.equal(await codice(() => creaArchivioKdbx(cartella, "prova")), "esiste");
    assert.deepEqual(readFileSync(join(cartella, "prova.kdbx")), prima);
  });

  it("KDBX 4, AES-256, Argon2id 64 MiB / 3 / 2 e metadati Domarc", async () => {
    const db = await grezzo(cartella, keyfile);
    assert.equal(db.header.versionMajor, 4);
    assert.equal(db.header.dataCipherUuid?.toString(), kdbxweb.Consts.CipherId.Aes);
    const kdf = db.header.kdfParameters;
    assert.equal(Buffer.from(kdf?.get("$UUID") as ArrayBuffer).toString("base64"), kdbxweb.Consts.KdfId.Argon2id);
    assert.equal(Number((kdf?.get("M") as kdbxweb.Int64).value), 64 * 1024 * 1024);
    assert.equal(Number((kdf?.get("I") as kdbxweb.Int64).value), 3);
    assert.equal(kdf?.get("P"), 2);
    const a = await ArchivioKdbx.apri(cartella, "prova", keyfile);
    assert.deepEqual(a.metadati(), { "domarc.formato": "1", "domarc.archivio": "prova" });
  });
});

describe("voci", () => {
  it("scrive, legge, elenca per prefisso", async () => {
    const a = await ArchivioKdbx.apri(cartella, "prova", keyfile, { scrittura: true });
    assert.equal(a.scrivi(SSH, VALORI), 1);
    a.scrivi("app/da-ipam/encryption_key", { password: "PW-FINTA-APP" });
    await a.salva();
    a.chiudi();
    const b = await ArchivioKdbx.apri(cartella, "prova", keyfile);
    assert.deepEqual(b.leggi(SSH), VALORI);
    assert.equal(b.versione(SSH), 1);
    assert.deepEqual(b.elenca(), ["app/da-ipam/encryption_key", SSH]);
    assert.deepEqual(b.elenca("clienti/70000"), [SSH]);
    assert.deepEqual(b.elenca("clienti/7000"), []);
    assert.deepEqual(b.elenca("app"), ["app/da-ipam/encryption_key"]);
  });

  it("gruppi annidati, campi standard e protezione dei campi in più", async () => {
    const a = await ArchivioKdbx.apri(cartella, "prova", keyfile, { scrittura: true });
    a.scrivi(SSH, { ...VALORI, segreto_nuovo: "PW-FINTA-X" });
    await a.salva();
    a.chiudi();
    const db = await grezzo(cartella, keyfile);
    const clienti = db.getDefaultGroup().groups.find((g) => g.name === "clienti");
    const fw = clienti?.groups.find((g) => g.name === "70000")?.groups.find((g) => g.name === "firewall");
    const e = fw?.entries[0];
    assert.ok(e);
    assert.equal(e.fields.get("Title"), "ssh");
    assert.equal(e.fields.get("UserName"), "admin");
    assert.ok(e.fields.get("Password") instanceof kdbxweb.ProtectedValue);
    assert.ok(e.fields.get("private_key") instanceof kdbxweb.ProtectedValue);
    assert.ok(e.fields.get("segreto_nuovo") instanceof kdbxweb.ProtectedValue);
    assert.equal(typeof e.fields.get("porta"), "string");
    assert.equal(typeof e.fields.get("protocollo"), "string");
  });

  it("storico al massimo dieci, dal più recente", async () => {
    const a = await ArchivioKdbx.apri(cartella, "prova", keyfile, { scrittura: true });
    for (let i = 1; i <= 13; i++) assert.equal(a.scrivi(SSH, { username: "admin", password: `PW-FINTA-${i}` }), i);
    await a.salva();
    a.chiudi();
    const b = await ArchivioKdbx.apri(cartella, "prova", keyfile);
    assert.equal(b.leggi(SSH).password, "PW-FINTA-13");
    assert.equal(b.versione(SSH), 13);
    const s = b.storico(SSH);
    assert.equal(s.length, 10);
    assert.deepEqual(s.map((v) => v.password), Array.from({ length: 10 }, (_, i) => `PW-FINTA-${12 - i}`));
  });

  it("i campi che non ci sono più si tolgono", async () => {
    const a = await ArchivioKdbx.apri(cartella, "prova", keyfile, { scrittura: true });
    a.scrivi(SSH, VALORI);
    a.scrivi(SSH, { password: "PW-FINTA-2" });
    assert.deepEqual(a.leggi(SSH), { password: "PW-FINTA-2" });
    assert.deepEqual(a.storico(SSH)[0], VALORI);
  });

  it("versione attesa: conflitto", async () => {
    const a = await ArchivioKdbx.apri(cartella, "prova", keyfile, { scrittura: true });
    a.scrivi(SSH, { password: "PW-FINTA-1" }, { versioneAttesa: 0 });
    assert.equal(await codice(() => a.scrivi(SSH, { password: "PW-FINTA-2" }, { versioneAttesa: 0 })), "conflitto");
    assert.equal(a.scrivi(SSH, { password: "PW-FINTA-2" }, { versioneAttesa: 1 }), 2);
    assert.equal(await codice(() => a.scrivi("app/x/y", { password: "PW-FINTA" }, { versioneAttesa: 3 })), "conflitto");
  });

  it("cancella", async () => {
    const a = await ArchivioKdbx.apri(cartella, "prova", keyfile, { scrittura: true });
    a.scrivi(SSH, VALORI);
    a.cancella(SSH);
    await a.salva();
    a.chiudi();
    const b = await ArchivioKdbx.apri(cartella, "prova", keyfile);
    assert.deepEqual(b.elenca(), []);
    assert.equal(await codice(() => b.leggi(SSH)), "non_trovato");
  });

  for (const p of ["", "/clienti/a", "clienti/a/", "clienti//a", "Clienti/a", "clienti/../a", "clienti/./a", "clienti/a b", "clienti/è", "a/".repeat(9) + "b"]) {
    it(`percorso non valido: «${p}»`, async () => {
      const a = await ArchivioKdbx.apri(cartella, "prova", keyfile, { scrittura: true });
      assert.equal(await codice(() => a.scrivi(p, { password: "PW-FINTA" })), "percorso");
    });
  }

  it("fa fede domarc.percorso: una voce spostata a mano resta al suo percorso", async () => {
    const a = await ArchivioKdbx.apri(cartella, "prova", keyfile, { scrittura: true });
    a.scrivi(SSH, VALORI);
    await a.salva();
    a.chiudi();
    const db = await grezzo(cartella, keyfile);
    const e = [...db.getDefaultGroup().allEntries()].find((x) => x.fields.get("Title") === "ssh");
    assert.ok(e);
    db.move(e, db.getDefaultGroup());
    e.fields.set("Title", "rinominata");
    writeFileSync(join(cartella, "prova.kdbx"), Buffer.from(await db.save()));
    const b = await ArchivioKdbx.apri(cartella, "prova", keyfile);
    assert.deepEqual(b.elenca(), [SSH]);
    assert.deepEqual(b.leggi(SSH), VALORI);
  });

  it("il cestino di KeePassXC non conta", async () => {
    const a = await ArchivioKdbx.apri(cartella, "prova", keyfile, { scrittura: true });
    a.scrivi(SSH, VALORI);
    await a.salva();
    a.chiudi();
    const db = await grezzo(cartella, keyfile);
    const e = [...db.getDefaultGroup().allEntries()].find((x) => x.fields.get("Title") === "ssh");
    assert.ok(e);
    db.remove(e);
    writeFileSync(join(cartella, "prova.kdbx"), Buffer.from(await db.save()));
    const b = await ArchivioKdbx.apri(cartella, "prova", keyfile);
    assert.deepEqual(b.elenca(), []);
  });

  it("carattere non XML rifiutato, senza il valore nel messaggio", async () => {
    const a = await ArchivioKdbx.apri(cartella, "prova", keyfile, { scrittura: true });
    try {
      a.scrivi(SSH, { password: "PW-FINTA-\x01-NONXML" });
      assert.fail("doveva fallire");
    } catch (e) {
      assert.ok(e instanceof ErroreKdbx);
      assert.equal(e.codice, "valore");
      assert.doesNotMatch(e.message, /PW-FINTA/);
    }
  });
});

describe("apertura e scrittura", () => {
  it("key file sbagliato", async () => {
    assert.equal(await codice(async () => ArchivioKdbx.apri(cartella, "prova", await nuovoKeyfile())), "chiave");
  });

  it("un archivio senza metadati Domarc si rifiuta", async () => {
    const c = mkdtempSync(join(tmpdir(), "vault-kdbx-"));
    const k = await nuovoKeyfile();
    const db = kdbxweb.Kdbx.create(new kdbxweb.Credentials(null, ab(k)), "altro");
    writeFileSync(join(c, "altro.kdbx"), Buffer.from(await db.save()));
    assert.equal(await codice(() => ArchivioKdbx.apri(c, "altro", k)), "formato");
  });

  it("in sola lettura non si scrive", async () => {
    const a = await ArchivioKdbx.apri(cartella, "prova", keyfile);
    assert.equal(await codice(() => a.scrivi(SSH, VALORI)), "sola_lettura");
    assert.equal(await codice(() => a.salva()), "sola_lettura");
  });

  it("un solo scrittore; un lettore entra lo stesso", async () => {
    const a = await ArchivioKdbx.apri(cartella, "prova", keyfile, { scrittura: true });
    assert.equal(await codice(() => ArchivioKdbx.apri(cartella, "prova", keyfile, { scrittura: true })), "occupato");
    const b = await ArchivioKdbx.apri(cartella, "prova", keyfile);
    assert.deepEqual(b.elenca(), []);
    a.chiudi();
    (await ArchivioKdbx.apri(cartella, "prova", keyfile, { scrittura: true })).chiudi();
  });

  it("il lucchetto di un processo morto si riprende", async () => {
    const morto = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf8" }).stdout;
    writeFileSync(join(cartella, "prova.kdbx.lock"), `${morto}\n`);
    const a = await ArchivioKdbx.apri(cartella, "prova", keyfile, { scrittura: true });
    a.scrivi(SSH, VALORI);
    await a.salva();
    a.chiudi();
  });

  it("il lucchetto di un processo vivo tiene", async () => {
    const vivo = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"]);
    try {
      writeFileSync(join(cartella, "prova.kdbx.lock"), `${vivo.pid}\n`);
      assert.equal(await codice(() => ArchivioKdbx.apri(cartella, "prova", keyfile, { scrittura: true })), "occupato");
    } finally {
      vivo.kill();
    }
  });

  it("salva tiene la copia di prima, 0600; sali e IV nuovi a ogni salvataggio", async () => {
    const a = await ArchivioKdbx.apri(cartella, "prova", keyfile, { scrittura: true });
    const semi = new Set<string>();
    // kdbxweb azzera il seme in memoria dopo l'apertura: si legge dall'intestazione del file (KDBX 4: firma e versione
    // in 12 byte, poi campi id/lunghezza/dati; 4 = seme, 7 = IV)
    const vedi = async () => {
      const b = readFileSync(join(cartella, "prova.kdbx"));
      const campi = new Map<number, string>();
      for (let i = 12; b[i] !== 0; ) {
        const lung = b.readUInt32LE(i + 1);
        campi.set(b[i], b.subarray(i + 5, i + 5 + lung).toString("hex"));
        i += 5 + lung;
      }
      semi.add(`${campi.get(4)}:${campi.get(7)}`);
    };
    await vedi();
    a.scrivi(SSH, { password: "PW-FINTA-1" });
    await a.salva();
    await vedi();
    const prima = readFileSync(join(cartella, "prova.kdbx"));
    a.scrivi(SSH, { password: "PW-FINTA-2" });
    await a.salva();
    await vedi();
    a.chiudi();
    assert.deepEqual(readFileSync(join(cartella, "prova.kdbx.prec")), prima);
    assert.equal(modo(join(cartella, "prova.kdbx.prec")), 0o600);
    assert.equal(modo(join(cartella, "prova.kdbx")), 0o600);
    assert.equal(semi.size, 3);
  });

  it("un archivio che non si rilegge uguale non si scrive", async () => {
    const a = await ArchivioKdbx.apri(cartella, "prova", keyfile, { scrittura: true });
    a.scrivi(SSH, VALORI);
    await a.salva();
    const prima = readFileSync(join(cartella, "prova.kdbx"));
    a.scrivi("app/x/y", { password: "PW-FINTA" });
    const vera = Reflect.get(ArchivioKdbx, "carica") as (d: Uint8Array, k: Uint8Array) => Promise<kdbxweb.Kdbx>;
    Reflect.set(ArchivioKdbx, "carica", async (d: Uint8Array, k: Uint8Array) => {
      const db = await vera(d, k);
      const persa = [...db.getDefaultGroup().allEntries()][0];
      if (persa) db.move(persa, null);
      return db;
    });
    try {
      assert.equal(await codice(() => a.salva()), "formato");
    } finally {
      Reflect.set(ArchivioKdbx, "carica", vera);
      a.chiudi();
    }
    assert.deepEqual(readFileSync(join(cartella, "prova.kdbx")), prima);
  });

  for (const punto of ["a_meta_scrittura", "prima_del_rename"]) {
    it(`crash a metà salvataggio (${punto}): resta il file di prima`, async () => {
      const a = await ArchivioKdbx.apri(cartella, "prova", keyfile, { scrittura: true });
      a.scrivi(SSH, { password: "PW-FINTA-VECCHIA" });
      await a.salva();
      a.chiudi();
      const r = spawnSync(process.execPath, ["--import", "tsx", join(__dirname, "support", "kdbx-crash.ts"), cartella, punto], {
        encoding: "utf8",
        cwd: process.cwd(),
      });
      assert.equal(r.status, 9, `il figlio doveva uscire con 9: ${r.status} ${r.stderr}`);
      const b = await ArchivioKdbx.apri(cartella, "prova", keyfile, { scrittura: true });
      assert.deepEqual(b.leggi(SSH), { password: "PW-FINTA-VECCHIA" });
      b.chiudi();
      assert.deepEqual(readdirSync(cartella).filter((f) => f.includes(".tmp")), []);
    });
  }

  it("nessun valore negli errori", async () => {
    const a = await ArchivioKdbx.apri(cartella, "prova", keyfile, { scrittura: true });
    a.scrivi(SSH, VALORI);
    const messaggi: string[] = [];
    for (const f of [() => a.scrivi(SSH, VALORI, { versioneAttesa: 7 }), () => a.leggi("clienti/nessuno/x")]) {
      try {
        f();
      } catch (e) {
        messaggi.push(String(e));
      }
    }
    assert.equal(messaggi.length, 2);
    for (const v of ["PW-FINTA-1", "BEGIN FINTA"]) assert.ok(!messaggi.join("\n").includes(v));
  });
});

describe("contratto incrociato (DA-Link ↔ DA-IPAM)", () => {
  const contenuto = JSON.parse(readFileSync(join(DATI, "contenuto.json"), "utf8")) as Contenuto;

  async function controlla(a: ArchivioKdbx): Promise<void> {
    assert.deepEqual(a.elenca(), Object.keys(contenuto.voci).sort());
    for (const [percorso, attesa] of Object.entries(contenuto.voci)) {
      assert.deepEqual(a.leggi(percorso), attesa.valori, percorso);
      assert.equal(a.versione(percorso), attesa.versione, percorso);
      assert.deepEqual(a.storico(percorso), attesa.storico, percorso);
    }
  }

  for (const nome of ["da-python", "da-typescript"]) {
    it(`l'archivio di prova ${nome} si legge come atteso`, async () => {
      const c = mkdtempSync(join(tmpdir(), "vault-kdbx-"));
      mkdirSync(c, { recursive: true });
      copyFileSync(join(DATI, `${nome}.kdbx`), join(c, "prova.kdbx"));
      const a = await ArchivioKdbx.apri(c, "prova", new Uint8Array(readFileSync(join(DATI, `${nome}.keyx`))));
      assert.deepEqual(a.metadati(), contenuto.metadati);
      await controlla(a);
    });
  }

  it("le scritture di contenuto.json rifatte oggi danno il contenuto atteso", async () => {
    const a = await ArchivioKdbx.apri(cartella, "prova", keyfile, { scrittura: true });
    scriviContenuto(a, contenuto);
    await a.salva();
    a.chiudi();
    await controlla(await ArchivioKdbx.apri(cartella, "prova", keyfile));
  });
});
