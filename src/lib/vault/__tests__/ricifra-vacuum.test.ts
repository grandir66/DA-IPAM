/**
 * Correzioni della revisione del 23/10, rilievi 2 e 3 della ricifra.
 *
 * 2. Crash FRA il COMMIT e il VACUUM: il giro dopo trovava zero valori e dichiarava `vacuum: true` senza farlo, e i
 *    valori della chiave vecchia restavano nelle pagine libere. Con `--applica` il checkpoint e il VACUUM si fanno
 *    sempre, anche quando non c'è niente da ricifrare.
 * 3. Zero database o `hub.db` assente = errore (una cartella dati sbagliata non deve finire in «0 valori, tutto bene»),
 *    e il messaggio dice quale cartella è stata guardata.
 *
 * Run: node --import tsx --test src/lib/vault/__tests__/ricifra-vacuum.test.ts
 */
import { TEST_DATA_DIR } from "@/lib/__tests__/support/data-dir-isolata";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { chiaveInstallazione } from "@/lib/crypto";
import { closeHubDb } from "@/lib/db-hub";
import { closeTenantDb } from "@/lib/db-tenant";
import { fileDaRicifrare, ricifra } from "../ricifra";
import { chiudiVault, impostaChiaveDati } from "../stato";
import { popola, SEGRETI_PROVA, valoriDellaChiave, type DatiProva } from "./support/dati-ricifra";

const T = "RICIFRAVAC";
let K: Buffer;
let dati: DatiProva;
/** I valori del database del cliente cifrati con la chiave d'installazione, come stanno nelle colonne, prima della ricifra. */
let vecchiDelCliente: string[] = [];

/** Tutti i byte di un database con il suo WAL e il suo journal. */
function byteDi(file: string): Buffer {
  return Buffer.concat([file, `${file}-wal`, `${file}-journal`].filter((f) => existsSync(f)).map((f) => readFileSync(f)));
}

before(() => {
  delete process.env.DA_VAULT_LOCALE;
  dati = popola(T);
  K = randomBytes(32);
  process.env.DA_VAULT_LOCALE = "1";
  impostaChiaveDati(K, "passphrase");
  closeTenantDb(T);
  closeHubDb();
  vecchiDelCliente = valoriDellaChiave(join(TEST_DATA_DIR, "tenants", `${T}.db`), chiaveInstallazione());
});

after(() => {
  delete process.env.DA_VAULT_LOCALE;
  chiudiVault(null);
  closeTenantDb(T);
  closeHubDb();
});

describe("rilievo 2: crash fra COMMIT e VACUUM", () => {
  it("il giro dopo fa il VACUUM anche senza valori da ricifrare: nel file non resta niente della chiave vecchia", () => {
    const fileTenant = join(TEST_DATA_DIR, "tenants", `${T}.db`);
    assert.ok(byteDi(fileTenant).includes(Buffer.from(dati.cancellato)), "la prova non vale: il valore cancellato non è nel file nemmeno prima");

    // Il figlio ricifra e si uccide con SIGKILL dopo il COMMIT del database del cliente, prima del suo VACUUM.
    const r = spawnSync(process.execPath, ["--import", "tsx", join(__dirname, "support", "ricifra-crash.ts")], {
      env: { ...process.env, DA_INVENT_DATA_DIR: TEST_DATA_DIR, DA_VAULT_LOCALE: "1", PROVA_CHIAVE_SLOT: K.toString("hex"), PROVA_CRASH_DOPO_COMMIT_DI: `${T}.db` },
      encoding: "utf8",
      cwd: process.cwd(),
    });
    assert.equal(r.signal, "SIGKILL", `il figlio doveva morire ucciso: ${r.status} ${r.stderr}`);

    // Dopo il crash: la ricifra è COMMESSA (i valori sono della chiave degli slot) ma il file non è stato ripulito.
    assert.ok(vecchiDelCliente.length >= 3, "la prova non vale: pochi valori vecchi nel database del cliente");
    const prima = byteDi(fileTenant);
    const rimasti = vecchiDelCliente.filter((v) => prima.includes(Buffer.from(v)));
    assert.ok(rimasti.length > 0, "la prova non vale: dopo il crash non resta niente della chiave vecchia da ripulire");

    // Il giro dopo: zero valori da ricifrare, ma il VACUUM si fa davvero.
    const e = ricifra({ dataDir: TEST_DATA_DIR, chiaveNuova: K, applica: true });
    const tenant = e.file.find((f) => f.file.endsWith(`${T}.db`));
    assert.equal(tenant?.valori, 0, "il giro dopo il crash non doveva trovare altro da ricifrare");
    assert.equal(tenant?.vacuum, true);
    const dopo = byteDi(fileTenant);
    for (const v of [...rimasti, dati.cancellato]) assert.ok(!dopo.includes(Buffer.from(v)), "valore della chiave vecchia rimasto nel file dopo il secondo giro");
  });

  it("a vuoto non si fa nessun VACUUM", () => {
    const e = ricifra({ dataDir: TEST_DATA_DIR, chiaveNuova: K });
    assert.ok(e.file.every((f) => f.vacuum === false));
  });
});

describe("rilievo 3: cartella dati sbagliata", () => {
  it("una cartella senza hub.db né database dei clienti: errore che dice la cartella, non «0 valori»", () => {
    const vuota = mkdtempSync(join(tmpdir(), "da-vault-dati-vuoti-"));
    for (const applica of [false, true]) {
      assert.throws(
        () => ricifra({ dataDir: vuota, chiaveNuova: K, applica }),
        (e: unknown) => e instanceof Error && e.message.includes(vuota) && /hub\.db/.test(e.message),
      );
    }
  });

  it("hub.db assente anche se ci sono database dei clienti: errore", () => {
    const dir = mkdtempSync(join(tmpdir(), "da-vault-solo-clienti-"));
    mkdirSync(join(dir, "tenants"));
    // Un file di cliente con dentro un database vero ma senza hub.db accanto.
    const sorgente = join(TEST_DATA_DIR, "tenants", `${T}.db`);
    writeCopia(sorgente, join(dir, "tenants", "X1.db"));
    assert.equal(fileDaRicifrare(dir).length, 1);
    assert.throws(() => ricifra({ dataDir: dir, chiaveNuova: K }), /hub\.db/);
  });

  it("la cartella giusta continua a funzionare", () => {
    assert.doesNotThrow(() => ricifra({ dataDir: TEST_DATA_DIR, chiaveNuova: K }));
    assert.ok(SEGRETI_PROVA.ssh);
  });
});

function writeCopia(da: string, a: string): void {
  // Copia consistente con l'API di backup di SQLite (il database sorgente è in WAL).
  const db = new Database(da, { readonly: true });
  try {
    db.exec(`VACUUM INTO '${a.replace(/'/g, "''")}'`);
  } finally {
    db.close();
  }
}
