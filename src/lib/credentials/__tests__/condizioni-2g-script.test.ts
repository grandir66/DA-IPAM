/**
 * `scripts/credenziali/condizioni-2g.ts`: le condizioni per partire con la 2g,
 * misurate sulla COPIA dei dati (tappa 2g credenziali, T26), in sola lettura.
 *
 * Perché uno script: le condizioni (segni chiusi, apparati lasciati dalla 2e
 * ricalcolati adesso con la conversione a vuoto, righe di controller e AD
 * lasciate dalla 2f, registro dei ripieghi dal rilascio della 2f) si leggono
 * sul server, e la regola dei lasciati accettati da Riccardo il 16/10 vuole un
 * elenco passato a mano per tenant, mai dedotto. Rischi coperti:
 *   1. un `parziale:` della 2e senza elenco blocca, e il messaggio dice per
 *      nome quali apparati restano senza credenziale;
 *   2. con l'elenco giusto (`--lasciati-accettati <tenant>:<id>`) passa, con
 *      la nota dell'effetto accettato; con un elenco per un tenant che non c'è
 *      non parte (un errore di battitura non diventa un «tutto in regola»);
 *   3. un ripiego vecchio nel registro dopo la data del segno della 2f blocca;
 *   4. il contenuto della copia non cambia (le conversioni a vuoto si
 *      annullano: SQLite può solo lasciare il suo -wal/-journal accanto) e la
 *      cartella del servizio non si tocca, nemmeno nei file; `--dati` uguale
 *      al servizio esce con 2 senza aprire niente.
 *
 * Run: DA_INVENT_DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ipam.XXXXXX")" node --import tsx --test src/lib/credentials/__tests__/condizioni-2g-script.test.ts
 */
import { TEST_DATA_DIR } from "@/lib/__tests__/support/data-dir-isolata";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import Database from "better-sqlite3";

import { encrypt } from "@/lib/crypto";
import { TENANT_SCHEMA_SQL, TENANT_INDEXES_SQL } from "@/lib/db-tenant-schema";
import { HUB_SCHEMA_SQL } from "@/lib/db-hub-schema";

void TEST_DATA_DIR;

const REPO = path.resolve(__dirname, "../../../..");
const SCRIPT = path.join(REPO, "scripts/credenziali/condizioni-2g.ts");
const T = "T2GPROVA";
const DATA_2F = "2026-10-16T08:00:00.000Z";

let radice = "";
let servizio = "";
let copia = "";
let registro = "";
let lasciato = 0;

function stato(dir: string): string {
  const out: string[] = [];
  const giro = (d: string): void => {
    for (const f of fs.readdirSync(d).sort()) {
      const p = path.join(d, f);
      const st = fs.statSync(p);
      if (st.isDirectory()) giro(p);
      else out.push(`${path.relative(dir, p)}:${st.size}:${st.mtimeMs}:${fs.readFileSync(p).toString("base64").slice(0, 200)}`);
    }
  };
  giro(dir);
  return out.join("\n");
}

/** Il contenuto del DB tenant della copia, tabella per tabella. */
function contenuto(): string {
  const d = new Database(path.join(copia, "tenants", `${T}.db`), { readonly: true });
  try {
    const tabelle = (d.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{ name: string }>).map((r) => r.name);
    return JSON.stringify(tabelle.map((t) => [t, d.prepare(`SELECT * FROM "${t}"`).all()]));
  } finally {
    d.close();
  }
}

function lancia(args: string[], cartellaServizio: string) {
  const env: NodeJS.ProcessEnv = { ...process.env, DA_INVENT_DATA_DIR: cartellaServizio };
  delete env.DA_IPAM_HUB_DB_PATH;
  return spawnSync(process.execPath, ["--import", "tsx", SCRIPT, ...args], { cwd: REPO, env, encoding: "utf8", timeout: 180_000 });
}

describe("condizioni-2g.ts sulla copia", () => {
  before(() => {
    radice = fs.mkdtempSync(path.join(os.tmpdir(), "condizioni-2g-"));
    servizio = path.join(radice, "servizio");
    copia = path.join(radice, "copia");
    registro = path.join(radice, "registro");
    for (const dir of [servizio, copia]) {
      fs.mkdirSync(path.join(dir, "tenants"), { recursive: true });
      const h = new Database(path.join(dir, "hub.db"));
      h.exec(HUB_SCHEMA_SQL);
      h.close();
    }
    fs.mkdirSync(registro, { recursive: true });
    const d = new Database(path.join(copia, "tenants", `${T}.db`));
    d.exec(TENANT_SCHEMA_SQL);
    d.exec(TENANT_INDEXES_SQL);
    const segno = d.prepare("INSERT INTO tenant_settings (key, value) VALUES (?, ?)");
    segno.run("credenziali_t2_tipi", `done:${DATA_2F}:x=0`);
    segno.run("credenziali_t2_catene", `done:${DATA_2F}:x=0`);
    segno.run("credenziali_t2_apparati", `parziale:${DATA_2F}:lasciati=1`);
    segno.run("credenziali_t2_integrazioni", `done:${DATA_2F}:x=0`);
    // Il caso dell'hub accettato da Riccardo: voce nella colonna e binding fallito verso la stessa voce.
    const voce = Number(
      d.prepare("INSERT INTO credentials (name, credential_type, encrypted_username, encrypted_password) VALUES ('Server lasciato · SSH', 'ssh', ?, ?)")
        .run(encrypt("root"), encrypt("pw-root")).lastInsertRowid,
    );
    lasciato = Number(
      d.prepare("INSERT INTO network_devices (name, host, device_type, vendor, protocol, port, credential_id) VALUES ('Server lasciato', '10.91.0.2', 'server', 'linux', 'ssh', 22, ?)")
        .run(voce).lastInsertRowid,
    );
    d.prepare("INSERT INTO device_credential_bindings (device_id, credential_id, protocol_type, port, sort_order, test_status) VALUES (?, ?, 'ssh', 22, 0, 'failed')")
      .run(lasciato, voce);
    d.close();
    // Un ripiego della forma vecchia di PRIMA del rilascio della 2f: non conta.
    fs.writeFileSync(
      path.join(registro, "ripieghi-2026-10-16.jsonl"),
      `${JSON.stringify({ ts: "2026-10-16T07:00:00.000Z", caso: "cred_colonna_apparato", tenant: T, firma: "vecchia @ src/x.ts:1:1", tipo: "conteggio", ora: "2026-10-16T07", n: 1 })}\n`,
    );
  });

  after(() => {
    if (radice) fs.rmSync(radice, { recursive: true, force: true });
  });

  it("parziale: della 2e senza elenco → blocco, coi lasciati per nome; copia e servizio intatti", () => {
    const primaCopia = contenuto();
    const primaServizio = stato(servizio);
    const r = lancia(["--dati", copia, "--registro", registro], servizio);
    assert.equal(r.status, 1, `uscita ${r.status}\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /== Tenant T2GPROVA/);
    assert.match(r.stdout, new RegExp(`«Server lasciato» \\(#${lasciato}\\): la scelta SSH cambierebbe`));
    assert.match(r.stdout, /BLOCCATO/);
    assert.match(r.stdout, /--lasciati-accettati T2GPROVA:/);
    assert.equal(contenuto(), primaCopia, "il contenuto della copia è cambiato");
    assert.equal(stato(servizio), primaServizio, "il servizio è stato toccato");
    assert.doesNotMatch(`${r.stdout}\n${r.stderr}`, /pw-root/);
  });

  it("con l'elenco esatto per il tenant → in regola, con la nota dell'effetto accettato", () => {
    const r = lancia(["--dati", copia, "--registro", registro, "--lasciati-accettati", `${T}:${lasciato}`], servizio);
    assert.equal(r.status, 0, `uscita ${r.status}\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /senza credenziale valida finché una Prova non riesce/);
    assert.match(r.stdout, /condizioni della 2g: in regola/);
  });

  it("un elenco per un tenant che non c'è nella copia → non parte (2)", () => {
    const r = lancia(["--dati", copia, "--registro", registro, "--lasciati-accettati", `T2GNONCE:${lasciato}`], servizio);
    assert.equal(r.status, 2, `uscita ${r.status}\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /T2GNONCE/);
  });

  it("un ripiego vecchio dopo il rilascio della 2f → blocco, anche con l'elenco", () => {
    const f = path.join(registro, "ripieghi-2026-10-16.jsonl");
    const prima = fs.readFileSync(f, "utf8");
    fs.appendFileSync(f, `${JSON.stringify({ ts: "2026-10-16T09:00:00.000Z", caso: "cred_riga_integrazione", tenant: T, firma: "nuova @ src/y.ts:2:2", tipo: "stack" })}\n`);
    try {
      const r = lancia(["--dati", copia, "--registro", registro, "--lasciati-accettati", `${T}:${lasciato}`], servizio);
      assert.equal(r.status, 1, `uscita ${r.status}\n${r.stdout}\n${r.stderr}`);
      assert.match(r.stdout, /cred_riga_integrazione da nuova @ src\/y\.ts:2:2/);
    } finally {
      fs.writeFileSync(f, prima);
    }
  });

  it("cred_colonna_apparato dopo la 2f con l'elenco → DA CONFERMARE col conteggio (uscita 3), mai «in regola»", () => {
    const f = path.join(registro, "ripieghi-2026-10-16.jsonl");
    const prima = fs.readFileSync(f, "utf8");
    fs.appendFileSync(
      f,
      `${JSON.stringify({ ts: "2026-10-16T09:00:00.000Z", caso: "cred_colonna_apparato", tenant: T, firma: "lasciato @ src/w.ts:4:4", tipo: "conteggio", ora: "2026-10-16T09", n: 10 })}\n`,
    );
    try {
      const r = lancia(["--dati", copia, "--registro", registro, "--lasciati-accettati", `${T}:${lasciato}`], servizio);
      assert.equal(r.status, 3, `uscita ${r.status}\n${r.stdout}\n${r.stderr}`);
      assert.match(r.stdout, /DA CONFERMARE/);
      assert.match(r.stdout, /cred_colonna_apparato da lasciato @ src\/w\.ts:4:4: almeno 10/);
      assert.doesNotMatch(r.stdout, /condizioni della 2g: in regola/);
    } finally {
      fs.writeFileSync(f, prima);
    }
  });

  it("--dal non c'è più: un ripiego dopo la 2f non si nasconde spostando la finestra → non parte (2), mai «in regola»", () => {
    // Revisione della 2g (16/10): `--dal` sostituiva la data del segno della 2f
    // anche con una data più tarda. La finestra è quella del piano, la data del
    // segno; un'opzione che lo script non conosce non si ignora.
    const f = path.join(registro, "ripieghi-2026-10-16.jsonl");
    const prima = fs.readFileSync(f, "utf8");
    fs.appendFileSync(
      f,
      `${JSON.stringify({ ts: "2026-10-16T10:00:00.000Z", caso: "cred_catena_vecchia", tenant: T, firma: "vera @ src/z.ts:3:3", tipo: "conteggio", ora: "2026-10-16T10", n: 100 })}\n`,
    );
    try {
      const r = lancia(["--dati", copia, "--registro", registro, "--lasciati-accettati", `${T}:${lasciato}`, "--dal", "2026-10-16T11:00:00.000Z"], servizio);
      assert.equal(r.status, 2, `uscita ${r.status}\n${r.stdout}\n${r.stderr}`);
      assert.match(r.stderr, /--dal/);
      assert.doesNotMatch(r.stdout, /condizioni della 2g: in regola/);
    } finally {
      fs.writeFileSync(f, prima);
    }
  });

  it("--dati uguale alla cartella del servizio → esce con 2 senza aprire niente", () => {
    const primaServizio = stato(servizio);
    const r = lancia(["--dati", servizio, "--registro", registro], servizio);
    assert.equal(r.status, 2, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /servizio/);
    assert.equal(stato(servizio), primaServizio);
  });

  it("senza --registro → non parte (2): un registro mancante non è «nessun ripiego»", () => {
    const r = lancia(["--dati", copia], servizio);
    assert.equal(r.status, 2, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /--registro/);
  });
});
