/**
 * Guardia degli script che lavorano sulle copie dei dati (tappa 2, T1).
 *
 * Perché: gli script della tappa 2 (fotografia, prova a vuoto, misure) girano
 * sul server con l'ambiente del servizio caricato, che contiene
 * DA_INVENT_DATA_DIR verso i dati veri (appliance-systemd-install.sh:69-70).
 * db-tenant e db-hub fissano i percorsi quando si caricano (db-tenant.ts:104,
 * db-hub.ts:14-17): un percorso sbagliato aprirebbe — e migrerebbe — i DB veri
 * dei clienti. `controllaCopia` dice perché NON partire; vuoto = si parte.
 * `copia-dati.ts` fa la copia con l'API di backup di SQLite (mai `cp` di un DB
 * in WAL) e non scrive mai dentro o sopra la cartella da cui copia.
 *
 * Run: DA_INVENT_DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ipam.XXXXXX")" node --import tsx --test src/lib/credentials/__tests__/guardia-copia.test.ts
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import Database from "better-sqlite3";

import { controllaCopia } from "@/lib/credentials/guardia-copia";

const REPO = process.cwd();

let radice = "";
let copia = "";
let servizio = "";

/** Una cartella dati finta: hub.db e tenants/, come la crea l'app. */
function cartellaDati(dir: string): void {
  fs.mkdirSync(path.join(dir, "tenants"), { recursive: true });
  fs.writeFileSync(path.join(dir, "hub.db"), "");
}

before(() => {
  radice = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "guardia-copia-")));
  copia = path.join(radice, "copia");
  servizio = path.join(radice, "servizio");
  cartellaDati(copia);
  cartellaDati(servizio);
});

after(() => {
  if (radice) fs.rmSync(radice, { recursive: true, force: true });
});

describe("controllaCopia", () => {
  const giusti = () => ({
    dati: copia,
    hubDb: path.join(copia, "hub.db"),
    cartellaTenant: path.join(copia, "tenants"),
    datiServizio: servizio,
  });

  it("tutto dentro --dati e il servizio altrove → si parte", () => {
    assert.deepEqual(controllaCopia(giusti()), []);
  });

  it("hub.db fuori da --dati → errore", () => {
    const e = controllaCopia({ ...giusti(), hubDb: path.join(servizio, "hub.db") });
    assert.equal(e.length, 1);
    assert.match(e[0], /hub\.db/);
  });

  it("cartella dei tenant fuori da --dati → errore", () => {
    const e = controllaCopia({ ...giusti(), cartellaTenant: path.join(servizio, "tenants") });
    assert.equal(e.length, 1);
    assert.match(e[0], /tenant/);
  });

  it("--dati uguale alla cartella del servizio, anche passando da un collegamento → errore", () => {
    assert.ok(controllaCopia({ dati: servizio, hubDb: path.join(servizio, "hub.db"), cartellaTenant: path.join(servizio, "tenants"), datiServizio: servizio })
      .some((x) => /servizio/.test(x)));
    const link = path.join(radice, "collegamento");
    fs.symlinkSync(servizio, link);
    assert.ok(controllaCopia({ dati: link, hubDb: path.join(link, "hub.db"), cartellaTenant: path.join(link, "tenants"), datiServizio: servizio })
      .some((x) => /servizio/.test(x)));
  });

  it("--dati che contiene la cartella del servizio → errore", () => {
    const e = controllaCopia({ dati: radice, hubDb: path.join(copia, "hub.db"), cartellaTenant: path.join(copia, "tenants"), datiServizio: servizio });
    assert.ok(e.some((x) => /contiene/.test(x)), e.join("\n"));
  });

  it("--dati senza hub.db o inesistente → errore: non è una copia dei dati", () => {
    const vuota = path.join(radice, "vuota");
    fs.mkdirSync(path.join(vuota, "tenants"), { recursive: true });
    assert.ok(controllaCopia({ dati: vuota, hubDb: path.join(vuota, "hub.db"), cartellaTenant: path.join(vuota, "tenants"), datiServizio: servizio })
      .some((x) => /hub\.db/.test(x)));
    const assente = path.join(radice, "assente");
    assert.ok(controllaCopia({ dati: assente, hubDb: path.join(assente, "hub.db"), cartellaTenant: path.join(assente, "tenants"), datiServizio: servizio })
      .some((x) => /non esiste/.test(x)));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// copia-dati.ts: copia online con l'API di backup
// ─────────────────────────────────────────────────────────────────────────────

function lanciaCopia(args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", path.join(REPO, "scripts", "credenziali", "copia-dati.ts"), ...args], {
    cwd: REPO,
    encoding: "utf8",
    timeout: 120_000,
  });
}

describe("copia-dati.ts", () => {
  let sorgente = "";
  let viva: Database.Database | null = null;

  before(() => {
    sorgente = path.join(radice, "dati-vivi");
    fs.mkdirSync(path.join(sorgente, "tenants"), { recursive: true });
    for (const f of ["hub.db", path.join("tenants", "A1.db")]) {
      const d = new Database(path.join(sorgente, f));
      d.pragma("journal_mode = WAL");
      d.exec("CREATE TABLE t (x INTEGER)");
      const ins = d.prepare("INSERT INTO t (x) VALUES (?)");
      for (let i = 0; i < 50; i++) ins.run(i);
      d.close();
    }
    // Una connessione aperta con righe ancora nel WAL: la copia le deve vedere.
    viva = new Database(path.join(sorgente, "tenants", "A1.db"));
    viva.pragma("wal_autocheckpoint = 0");
    viva.prepare("INSERT INTO t (x) VALUES (999)").run();
  });

  after(() => viva?.close());

  it("copia hub.db e i DB dei tenant, righe del WAL comprese, in una cartella 0700", () => {
    const dest = path.join(radice, "copia-nuova");
    const r = lanciaCopia(["--da", sorgente, "--a", dest]);
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    assert.equal(fs.statSync(dest).mode & 0o777, 0o700);
    const conta = (f: string) => {
      const d = new Database(f, { readonly: true });
      try {
        return (d.prepare("SELECT COUNT(*) AS n FROM t").get() as { n: number }).n;
      } finally {
        d.close();
      }
    };
    assert.equal(conta(path.join(dest, "hub.db")), 50);
    assert.equal(conta(path.join(dest, "tenants", "A1.db")), 51);
  });

  it("--a dentro --da, uguale, o già piena → esce con 2 senza copiare", () => {
    const dentro = path.join(sorgente, "copia");
    assert.equal(lanciaCopia(["--da", sorgente, "--a", dentro]).status, 2);
    assert.equal(fs.existsSync(dentro), false);
    assert.equal(lanciaCopia(["--da", sorgente, "--a", sorgente]).status, 2);
    const piena = path.join(radice, "piena");
    fs.mkdirSync(piena);
    fs.writeFileSync(path.join(piena, "x"), "x");
    assert.equal(lanciaCopia(["--da", sorgente, "--a", piena]).status, 2);
  });
});
