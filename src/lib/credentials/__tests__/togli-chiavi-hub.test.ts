/**
 * Le chiavi dell'hub rese inutili dalla tappa 2 credenziali (2g, T27):
 * `host_windows_credential_id` e `host_linux_credential_id` (D3: la 2d le ha
 * copiate nelle reti del cliente A, sull'hub con due tenant non si copiano) e
 * le `integration_unifi_*` (la 2f e `migrateLegacyUnifiConfig` le hanno
 * portate nel controller del tenant, segno `controllers_legacy_unifi`).
 *
 * Perché uno script con le sue condizioni: le due conversioni le leggono
 * ancora quando un tenant le fa per la prima volta, e lo fanno solo con UN
 * tenant attivo. Toglierle prima vuol dire perdere, senza dirlo, la chiave di
 * default o la configurazione UniFi di quel tenant. Rischi coperti:
 *   1. con un tenant attivo e la sua 2d (o la sua migrazione UniFi) non
 *      ancora fatta, le chiavi che servono restano, col perché;
 *   2. con più tenant attivi le conversioni non le leggono: si tolgono;
 *   3. a vuoto lo script stampa solo i NOMI delle chiavi, mai i valori, e non
 *      scrive; con `--applica` e la conferma («togli <n>») c'è il backup di
 *      hub.db, poi le chiavi se ne vanno; con la conferma sbagliata niente.
 *
 * Run: DA_INVENT_DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ipam.XXXXXX")" node --import tsx --test src/lib/credentials/__tests__/togli-chiavi-hub.test.ts
 */
import { TEST_DATA_DIR } from "@/lib/__tests__/support/data-dir-isolata";
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import Database from "better-sqlite3";

import { HUB_SCHEMA_SQL } from "@/lib/db-hub-schema";
import { TENANT_SCHEMA_SQL } from "@/lib/db-tenant-schema";
import { chiaviPresentiDb, pianoChiaviHub, togliChiaviHubDb, type TenantHub } from "@/lib/credentials/chiavi-hub";

void TEST_DATA_DIR;

const REPO = path.resolve(__dirname, "../../../..");
const SCRIPT = path.join(REPO, "scripts/credenziali/togli-chiavi-hub.ts");
const radice = fs.mkdtempSync(path.join(os.tmpdir(), "togli-chiavi-hub-"));
after(() => fs.rmSync(radice, { recursive: true, force: true }));

const DONE = "done:2026-10-16T08:00:00.000Z:lista=1";
const D3 = ["host_linux_credential_id", "host_windows_credential_id"];
const UNIFI = ["integration_unifi_api_token", "integration_unifi_kind", "integration_unifi_url"];
const tutte = [...D3, ...UNIFI].sort();
const unTenant = (o: Partial<TenantHub> = {}): TenantHub => ({ codice: "T2GA", attivo: true, segnoCatene: DONE, segnoUnifi: "done:3", ...o });

describe("pianoChiaviHub", () => {
  it("un tenant attivo con la 2d chiusa e la configurazione UniFi portata → si tolgono tutte", () => {
    const p = pianoChiaviHub(tutte, [unTenant()]);
    assert.deepEqual(p.daTogliere, tutte);
    assert.deepEqual(p.trattenute, []);
  });

  it("un tenant attivo con la 2d non chiusa → le due chiavi di D3 restano, col perché; le UniFi si tolgono", () => {
    for (const segnoCatene of [null, "errore:x"]) {
      const p = pianoChiaviHub(tutte, [unTenant({ segnoCatene })]);
      assert.deepEqual(p.daTogliere, UNIFI);
      assert.deepEqual(p.trattenute.map((t) => t.chiave), D3);
      assert.match(p.trattenute[0].motivo, /2d/);
    }
  });

  it("un tenant attivo senza il segno della migrazione UniFi → le UniFi restano", () => {
    const p = pianoChiaviHub(tutte, [unTenant({ segnoUnifi: null })]);
    assert.deepEqual(p.daTogliere, D3);
    assert.deepEqual(p.trattenute.map((t) => t.chiave), UNIFI);
  });

  it("il DB del tenant attivo che non c'è → restano tutte", () => {
    const p = pianoChiaviHub(tutte, [unTenant({ segnoCatene: undefined, segnoUnifi: undefined })]);
    assert.deepEqual(p.daTogliere, []);
  });

  it("due tenant attivi (l'hub) → le conversioni non le leggono: si tolgono tutte, anche senza segni (DEFAULT mai aperto)", () => {
    const p = pianoChiaviHub(tutte, [unTenant({ codice: "T2GH1" }), unTenant({ codice: "T2GH2" }), unTenant({ codice: "DEFAULT", attivo: false, segnoCatene: null, segnoUnifi: null })]);
    assert.deepEqual(p.daTogliere, tutte);
  });

  it("nessun tenant attivo → le UniFi restano (si porterebbero nel primo tenant che si apre), le D3 no (la 2d le copia solo con uno)", () => {
    const p = pianoChiaviHub(tutte, [unTenant({ attivo: false })]);
    assert.deepEqual(p.daTogliere, D3);
    assert.deepEqual(p.trattenute.map((t) => t.chiave), UNIFI);
  });
});

function hub(file: string, attivi: Array<{ codice: string; attivo: number }>): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const h = new Database(file);
  h.exec(HUB_SCHEMA_SQL);
  const s = h.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
  s.run("host_windows_credential_id", "7");
  s.run("host_linux_credential_id", "8");
  s.run("integration_unifi_url", "https://10.92.0.1");
  s.run("integration_unifi_kind", "udm");
  s.run("integration_unifi_api_token", "valore-segreto-del-token");
  s.run("server_port", "3000");
  for (const t of attivi) h.prepare("INSERT INTO tenants (codice_cliente, ragione_sociale, active) VALUES (?, ?, ?)").run(t.codice, `Cliente ${t.codice}`, t.attivo);
  h.close();
}

function tenantDb(file: string, segni: Record<string, string>): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const d = new Database(file);
  d.exec(TENANT_SCHEMA_SQL);
  for (const [k, v] of Object.entries(segni)) d.prepare("INSERT INTO tenant_settings (key, value) VALUES (?, ?)").run(k, v);
  d.close();
}

describe("chiaviPresentiDb e togliChiaviHubDb", () => {
  it("trova solo le chiavi di D3 e le integration_unifi_*, e toglie solo quelle del piano", () => {
    const f = path.join(radice, "puro", "hub.db");
    hub(f, [{ codice: "T2GA", attivo: 1 }]);
    const h = new Database(f);
    try {
      assert.deepEqual(chiaviPresentiDb(h), tutte);
      const p = pianoChiaviHub(chiaviPresentiDb(h), [unTenant({ segnoUnifi: null })]);
      assert.equal(togliChiaviHubDb(h, p), 2);
      assert.deepEqual(chiaviPresentiDb(h), UNIFI);
      assert.equal((h.prepare("SELECT value FROM settings WHERE key = 'server_port'").get() as { value: string }).value, "3000");
    } finally {
      h.close();
    }
  });
});

describe("togli-chiavi-hub.ts sulla copia", () => {
  let n = 0;
  function scena(): { servizio: string; copia: string } {
    const base = path.join(radice, `s${++n}`);
    const servizio = path.join(base, "servizio");
    const copia = path.join(base, "copia");
    fs.mkdirSync(path.join(servizio, "tenants"), { recursive: true });
    new Database(path.join(servizio, "hub.db")).close();
    hub(path.join(copia, "hub.db"), [{ codice: "T2GA", attivo: 1 }]);
    tenantDb(path.join(copia, "tenants", "T2GA.db"), { credenziali_t2_catene: DONE, controllers_legacy_unifi: "done:3" });
    return { servizio, copia };
  }
  const lancia = (s: { servizio: string; copia: string }, args: string[], input = "") => {
    const env: NodeJS.ProcessEnv = { ...process.env, DA_INVENT_DATA_DIR: s.servizio };
    delete env.DA_IPAM_HUB_DB_PATH;
    return spawnSync(process.execPath, ["--import", "tsx", SCRIPT, "--dati", s.copia, "--copia", ...args], { cwd: REPO, env, encoding: "utf8", timeout: 180_000, input });
  };
  const chiavi = (copia: string) => {
    const h = new Database(path.join(copia, "hub.db"), { readonly: true });
    try {
      return chiaviPresentiDb(h);
    } finally {
      h.close();
    }
  };

  it("a vuoto stampa solo i nomi delle chiavi, mai i valori, e non scrive", () => {
    const s = scena();
    const st = fs.statSync(path.join(s.copia, "hub.db"));
    const r = lancia(s, []);
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    for (const k of tutte) assert.match(r.stdout, new RegExp(k));
    assert.doesNotMatch(`${r.stdout}\n${r.stderr}`, /valore-segreto-del-token|10\.92\.0\.1|udm/);
    assert.match(r.stdout, /a vuoto: niente scritto/);
    assert.deepEqual(chiavi(s.copia), tutte);
    assert.equal(fs.statSync(path.join(s.copia, "hub.db")).mtimeMs, st.mtimeMs);
    assert.deepEqual(fs.readdirSync(s.copia).filter((f) => f.includes(".bak-")), []);
  });

  it("--applica con la conferma sbagliata → niente; con «togli 5» → backup di hub.db e chiavi tolte", () => {
    const s = scena();
    const r1 = lancia(s, ["--applica"], "si\n");
    assert.equal(r1.status, 1, `${r1.stdout}\n${r1.stderr}`);
    assert.deepEqual(chiavi(s.copia), tutte);
    assert.deepEqual(fs.readdirSync(s.copia).filter((f) => f.includes(".bak-")), []);

    const r2 = lancia(s, ["--applica"], "togli 5\n");
    assert.equal(r2.status, 0, `${r2.stdout}\n${r2.stderr}`);
    assert.match(r2.stdout, /scrivi «togli 5»/);
    assert.match(r2.stdout, /backup: .*hub\.db\.bak-\d{8}-\d{6}/);
    assert.deepEqual(chiavi(s.copia), []);
    const bak = fs.readdirSync(s.copia).filter((f) => f.includes(".bak-"));
    assert.equal(bak.length, 1);
    const copiaBak = new Database(path.join(s.copia, bak[0]), { readonly: true });
    try {
      assert.deepEqual(chiaviPresentiDb(copiaBak), tutte, "il backup non è quello di prima");
    } finally {
      copiaBak.close();
    }
  });
});
