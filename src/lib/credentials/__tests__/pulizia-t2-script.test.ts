/**
 * `scripts/credenziali/pulizia-t2.ts`: la pulizia dei dati vecchi delle
 * credenziali (tappa 2g, T27), lanciata come la lancerà la sessione principale
 * sul server: qui su una copia (`--copia`), con la conferma scritta da stdin.
 *
 * Perché uno script e non getTenantDb: su un'appliance che riceve `main`
 * conversioni e pulizia girerebbero nella stessa apertura, senza prova a
 * vuoto, backup e conferma. Decisioni di Riccardo del 16/10: niente attesa di
 * D9 (al suo posto il registro dei ripieghi a zero dal rilascio della 2f), e
 * i lasciati accettati per elenco (`--lasciati-accettati`). Rischi coperti:
 *   1. un segno `parziale:` fuori dall'elenco o un `errore:` → nessun
 *      effetto, motivo stampato;
 *   2. a vuoto non scrive niente (file, contenuto, nessun `.bak`);
 *   3. con `--applica` e la conferma giusta il `.bak` c'è prima della prima
 *      scrittura (ha ancora le colonne piene), poi colonne vuote, tabelle
 *      tolte e segno; la seconda volta non ha effetti; una conferma sbagliata
 *      non tocca niente;
 *   4. un apparato con una colonna piena senza binding equivalente si elenca e
 *      il tenant non si pulisce;
 *   5. i ripieghi `cred_colonna_apparato` dal rilascio della 2f che il
 *      registro non sa attribuire ai lasciati accettati si confermano nella
 *      stessa conferma, col numero: il solo codice del tenant non basta;
 *   6. sui dati veri (`--servizio`) non parte se non sa dire che il servizio
 *      è fermo (tre esiti: fermo, attivo, non so).
 *
 * Run: DA_INVENT_DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ipam.XXXXXX")" node --import tsx --test src/lib/credentials/__tests__/pulizia-t2-script.test.ts
 */
import { TEST_DATA_DIR } from "@/lib/__tests__/support/data-dir-isolata";
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import Database from "better-sqlite3";

import { encrypt } from "@/lib/crypto";
import { HUB_SCHEMA_SQL } from "@/lib/db-hub-schema";
import { contenutoDb, creaTenantDopo2f, DATA_2F } from "./support/tenant-dopo-2f";

void TEST_DATA_DIR;

const REPO = path.resolve(__dirname, "../../../..");
const SCRIPT = path.join(REPO, "scripts/credenziali/pulizia-t2.ts");
const T = "T2GPROVA";
const radice = fs.mkdtempSync(path.join(os.tmpdir(), "pulizia-t2-script-"));
after(() => fs.rmSync(radice, { recursive: true, force: true }));

interface Scena {
  servizio: string;
  copia: string;
  registro: string;
  file: string;
  lasciato: number;
}

let n = 0;
/** Cartella del servizio (da non toccare) e copia con un tenant dopo la 2f; `prepara` cambia il DB prima di chiuderlo. */
function scena(prepara?: (d: Database.Database, lasciato: number) => void): Scena {
  const base = path.join(radice, `s${++n}`);
  const servizio = path.join(base, "servizio");
  const copia = path.join(base, "copia");
  const registro = path.join(base, "registro");
  for (const dir of [servizio, copia]) {
    fs.mkdirSync(path.join(dir, "tenants"), { recursive: true });
    const h = new Database(path.join(dir, "hub.db"));
    h.exec(HUB_SCHEMA_SQL);
    h.close();
  }
  fs.mkdirSync(registro, { recursive: true });
  const t = creaTenantDopo2f(path.join(copia, "tenants", `${T}.db`));
  prepara?.(t.d, t.lasciato);
  t.d.close();
  return { servizio, copia, registro, file: t.file, lasciato: t.lasciato };
}

function lancia(s: Scena, args: string[], input?: string) {
  const env: NodeJS.ProcessEnv = { ...process.env, DA_INVENT_DATA_DIR: s.servizio };
  delete env.DA_IPAM_HUB_DB_PATH;
  return spawnSync(process.execPath, ["--import", "tsx", SCRIPT, "--dati", s.copia, "--registro", s.registro, ...args], {
    cwd: REPO,
    env,
    encoding: "utf8",
    timeout: 180_000,
    input: input ?? "",
  });
}

const accettati = (s: Scena) => ["--lasciati-accettati", `${T}:${s.lasciato}`];
const bak = (s: Scena) => fs.readdirSync(path.dirname(s.file)).filter((f) => f.includes(".bak-"));
const leggi = <R>(file: string, f: (d: Database.Database) => R): R => {
  const d = new Database(file, { readonly: true });
  try {
    return f(d);
  } finally {
    d.close();
  }
};
const contenuto = (file: string) => leggi(file, contenutoDb);
const tabella = (d: Database.Database, nome: string) => !!d.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(nome);
const esito = (r: ReturnType<typeof lancia>) => `uscita ${r.status}\n${r.stdout}\n${r.stderr}`;

describe("pulizia-t2.ts: quando non parte", () => {
  it("senza --copia né --servizio → non parte (2): si dice se i dati sono una copia o quelli veri", () => {
    const s = scena();
    const env: NodeJS.ProcessEnv = { ...process.env, DA_INVENT_DATA_DIR: s.servizio };
    const r = spawnSync(process.execPath, ["--import", "tsx", SCRIPT, "--dati", s.copia, "--registro", s.registro], { cwd: REPO, env, encoding: "utf8", timeout: 180_000 });
    assert.equal(r.status, 2, esito(r));
    assert.match(r.stderr, /--copia/);
    assert.match(r.stderr, /--servizio/);
  });

  it("--servizio senza poter dire che il servizio è fermo (unità che non c'è, o niente systemctl) → non parte (2), niente aperto", () => {
    const s = scena();
    const prima = contenuto(s.file);
    const env: NodeJS.ProcessEnv = { ...process.env, DA_INVENT_DATA_DIR: s.copia };
    const r = spawnSync(
      process.execPath,
      ["--import", "tsx", SCRIPT, "--dati", s.copia, "--registro", s.registro, "--servizio", "da-ipam-prova-t27-che-non-esiste"],
      { cwd: REPO, env, encoding: "utf8", timeout: 180_000 },
    );
    assert.equal(r.status, 2, esito(r));
    assert.match(r.stderr, /fermo/);
    assert.equal(contenuto(s.file), prima);
  });

  it("--dati uguale alla cartella del servizio con --copia → non parte (2)", () => {
    const s = scena();
    const env: NodeJS.ProcessEnv = { ...process.env, DA_INVENT_DATA_DIR: s.copia };
    const r = spawnSync(process.execPath, ["--import", "tsx", SCRIPT, "--dati", s.copia, "--registro", s.registro, "--copia"], { cwd: REPO, env, encoding: "utf8", timeout: 180_000 });
    assert.equal(r.status, 2, esito(r));
    assert.match(r.stderr, /servizio/);
  });
});

describe("pulizia-t2.ts sulla copia", () => {
  it("segno parziale: della 2e senza elenco → BLOCCATO col motivo, nessun effetto, anche con --applica", () => {
    const s = scena();
    const prima = contenuto(s.file);
    const r = lancia(s, ["--copia", "--applica"], `${T}\n`);
    assert.equal(r.status, 1, esito(r));
    assert.match(r.stdout, /BLOCCATO/);
    assert.match(r.stdout, /parziale/);
    assert.match(r.stdout, /«Server lasciato»/);
    assert.equal(contenuto(s.file), prima);
    assert.deepEqual(bak(s), []);
  });

  it("segno errore: (tipi) → BLOCCATO col motivo, nessun effetto", () => {
    const s = scena((d) => d.prepare("UPDATE tenant_settings SET value = 'errore:UNIQUE constraint failed' WHERE key = 'credenziali_t2_tipi'").run());
    const prima = contenuto(s.file);
    const r = lancia(s, ["--copia", "--applica", ...accettati(s)], `${T}\n`);
    assert.equal(r.status, 1, esito(r));
    assert.match(r.stdout, /credenziali_t2_tipi vale «errore:UNIQUE constraint failed»: serve done:/);
    assert.equal(contenuto(s.file), prima);
    assert.deepEqual(bak(s), []);
  });

  it("a vuoto con l'elenco: il piano coi nomi, niente scritto (file, contenuto, nessun .bak)", () => {
    const s = scena();
    const prima = contenuto(s.file);
    const st = fs.statSync(s.file);
    const r = lancia(s, ["--copia", ...accettati(s)]);
    assert.equal(r.status, 0, esito(r));
    assert.match(r.stdout, /== Tenant T2GPROVA/);
    assert.match(r.stdout, new RegExp(`apparati da svuotare:\\n  «Server lasciato» \\(#${s.lasciato}\\): credential_id`));
    assert.match(r.stdout, /controller da svuotare:\n {2}«Sede» \(#\d+\)/);
    assert.match(r.stdout, /controller senza voce, restano com'erano:\n {2}«Magazzino» \(#\d+\)/);
    assert.match(r.stdout, /Active Directory da svuotare:\n {2}«Dominio» \(#\d+\)/);
    assert.match(r.stdout, /tabelle da togliere: network_host_credentials \(1 righe\), host_detect_credential \(1 righe\)/);
    assert.match(r.stdout, /a vuoto: niente scritto/);
    assert.equal(contenuto(s.file), prima);
    const dopo = fs.statSync(s.file);
    assert.equal(dopo.mtimeMs, st.mtimeMs);
    assert.equal(dopo.size, st.size);
    assert.deepEqual(bak(s), []);
    assert.doesNotMatch(`${r.stdout}\n${r.stderr}`, /pw-root|chiave-sede|pw-magazzino|pw-ldap/);
  });

  it("--applica con la conferma sbagliata → niente scritto, niente .bak", () => {
    const s = scena();
    const prima = contenuto(s.file);
    const r = lancia(s, ["--copia", "--applica", ...accettati(s)], "si\n");
    assert.equal(r.status, 1, esito(r));
    assert.match(r.stdout, /conferma non data: tenant T2GPROVA non toccato/);
    assert.equal(contenuto(s.file), prima);
    assert.deepEqual(bak(s), []);
  });

  it("--applica con la conferma giusta: .bak prima della prima scrittura, colonne vuote, tabelle tolte, segno; la seconda volta niente", () => {
    const s = scena();
    const prima = contenuto(s.file);
    const r = lancia(s, ["--copia", "--applica", ...accettati(s)], `${T}\n`);
    assert.equal(r.status, 0, esito(r));
    assert.match(r.stdout, /Per pulire il tenant T2GPROVA scrivi «T2GPROVA»/);
    assert.match(r.stdout, /backup: .*T2GPROVA\.db\.bak-\d{8}-\d{6}/);
    assert.match(r.stdout, /ora italiana/);
    const copie = bak(s);
    assert.equal(copie.length, 1);
    // Il .bak è il DB di prima: colonne piene e tabelle vecchie.
    assert.equal(contenuto(path.join(path.dirname(s.file), copie[0])), prima);
    leggi(s.file, (d) => {
      const app = d.prepare("SELECT credential_id FROM network_devices WHERE id = ?").get(s.lasciato) as { credential_id: number | null };
      assert.equal(app.credential_id, null);
      assert.equal(tabella(d, "network_host_credentials"), false);
      assert.equal(tabella(d, "host_detect_credential"), false);
      const segno = (d.prepare("SELECT value FROM tenant_settings WHERE key = 'credenziali_t2_pulizia'").get() as { value: string }).value;
      assert.match(segno, new RegExp(`^done:.*lasciati_accettati=${s.lasciato},ripieghi_confermati=0`));
    });

    const dopo = contenuto(s.file);
    const r2 = lancia(s, ["--copia", "--applica", ...accettati(s)], `${T}\n`);
    assert.equal(r2.status, 0, esito(r2));
    assert.match(r2.stdout, /già pulito/);
    assert.equal(contenuto(s.file), dopo);
    assert.equal(bak(s).length, 1, "la seconda volta ha fatto un altro backup");
  });

  it("un apparato con una colonna piena senza binding equivalente → elencato, BLOCCATO, il tenant non si pulisce", () => {
    const s = scena((d, lasciato) => {
      d.prepare("UPDATE network_devices SET username = 'root', encrypted_password = ? WHERE id = ?").run(encrypt("altra-password"), lasciato);
    });
    const prima = contenuto(s.file);
    const r = lancia(s, ["--copia", "--applica", ...accettati(s)], `${T}\n`);
    assert.equal(r.status, 1, esito(r));
    assert.match(r.stdout, new RegExp(`apparati che bloccano:\\n  «Server lasciato» \\(#${s.lasciato}\\): .*senza un binding equivalente`));
    assert.match(r.stdout, /BLOCCATO/);
    assert.equal(contenuto(s.file), prima);
    assert.deepEqual(bak(s), []);
    assert.doesNotMatch(r.stdout, /altra-password/);
  });

  it("ripieghi cred_colonna_apparato dopo la 2f con l'elenco → da confermare: il solo codice non basta, codice e numero sì", () => {
    const s = scena();
    fs.writeFileSync(
      path.join(s.registro, "ripieghi-2026-10-16.jsonl"),
      `${JSON.stringify({ ts: "2026-10-16T09:00:00.000Z", caso: "cred_colonna_apparato", tenant: T, firma: "acquisisci @ src/x.ts:1:1", tipo: "conteggio", ora: "2026-10-16T09", n: 10 })}\n` +
        `${JSON.stringify({ ts: "2026-10-16T07:00:00.000Z", caso: "cred_binding_inline", tenant: T, firma: "prima della 2f @ src/y.ts:1:1", tipo: "stack" })}\n`,
    );
    const prima = contenuto(s.file);
    const r = lancia(s, ["--copia", "--applica", ...accettati(s)], `${T}\n`);
    assert.equal(r.status, 1, esito(r));
    assert.match(r.stdout, /ripieghi da confermare \(10\):\n {2}- ripiego cred_colonna_apparato da acquisisci @ src\/x\.ts:1:1: almeno 10/);
    assert.match(r.stdout, /scrivi «T2GPROVA 10»/);
    assert.match(r.stdout, /conferma non data/);
    assert.equal(contenuto(s.file), prima);

    const r2 = lancia(s, ["--copia", "--applica", ...accettati(s)], `${T} 10\n`);
    assert.equal(r2.status, 0, esito(r2));
    leggi(s.file, (d) => {
      const segno = (d.prepare("SELECT value FROM tenant_settings WHERE key = 'credenziali_t2_pulizia'").get() as { value: string }).value;
      assert.match(segno, /ripieghi_confermati=10/);
    });
  });

  it("--tenant che nella copia non c'è → non parte (2)", () => {
    const s = scena();
    const r = lancia(s, ["--copia", "--tenant", "T2GNONCE"]);
    assert.equal(r.status, 2, esito(r));
    assert.match(r.stderr, /T2GNONCE/);
  });

  it("il segno della 2f di oggi non blocca (D9 rivista: niente attesa)", () => {
    const oggi = new Date().toISOString();
    const s = scena((d) => d.prepare("UPDATE tenant_settings SET value = ? WHERE key = 'credenziali_t2_integrazioni'").run(`done:${oggi}:controller=1`));
    const r = lancia(s, ["--copia", ...accettati(s)]);
    assert.equal(r.status, 0, esito(r));
    assert.match(r.stdout, /a vuoto: niente scritto/);
    assert.notEqual(oggi, DATA_2F);
  });
});
