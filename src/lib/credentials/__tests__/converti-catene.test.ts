/**
 * Catene vecchie e pin convertiti nella lista della rete (tappa 2d
 * credenziali, T16 del piano `plans/2026-10-15-tappa2-archivio-credenziali.md`).
 *
 * Perché: oggi le catene per ruolo (`network_host_credentials`) le scrive solo
 * la pagina della rete, che le rimanda senza mostrarle; il pin
 * (`host_detect_credential`) fa da corto circuito nella discovery; le due
 * chiavi «di default» dell'hub si accodano in ogni tenant. La 2d porta tutto
 * nella lista unica (`network_credentials`) e nelle righe dell'host. Rischi
 * coperti:
 *   1. la proprietà della sotto-tappa: per ssh, winrm e snmp il motore dà la
 *      stessa sequenza di voci (e di porte) prima e dopo la conversione;
 *   2. una voce in due ruoli (ssh e linux, ammesso dalla UNIQUE con `role`)
 *      accodata due volte farebbe scattare UNIQUE(network_id, credential_id):
 *      ROLLBACK, e la 2d resterebbe ferma su quel tenant;
 *   3. il pin diventa una riga validata dell'host solo se l'host non ha già la
 *      stessa voce sullo stesso protocollo, su qualunque porta;
 *   4. chiavi dell'hub (D3 = (a)): copiate solo con un tenant attivo; con due
 *      si saltano col motivo «due tenant attivi», e il segno resta `done:`;
 *   5. una riga col tipo che non vale per il ruolo si salta e il segno dice
 *      `parziale:`; conteggi che non tornano → ROLLBACK, niente scritto;
 *   6. col segno `done:` la conversione non si richiama: la voce che l'utente
 *      toglie dalla lista non torna dalla catena congelata (le tabelle vecchie
 *      restano piene fino alla 2g);
 *   7. un import riporta i segni del bundle: lì la conversione gira senza
 *      chiavi dell'hub (`globali = null`), e con la cancellazione solo se il
 *      segno del bundle non è chiuso (prove in `transfer/__tests__/roundtrip.test.ts`);
 *   8. la prova a vuoto sulla copia mostra le voci entrate e il confronto
 *      delle catene del motore.
 *
 * Run: DA_INVENT_DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ipam.XXXXXX")" node --import tsx --test src/lib/credentials/__tests__/converti-catene.test.ts
 */
import { TEST_DATA_DIR } from "@/lib/__tests__/support/data-dir-isolata";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import Database from "better-sqlite3";

import { TENANT_SCHEMA_SQL, TENANT_INDEXES_SQL } from "@/lib/db-tenant-schema";
import { closeTenantDb, deleteTenantDatabase, getTenantDb, withTenant } from "@/lib/db-tenant";
import { closeHubDb, getHubDb } from "@/lib/db-hub";
import { catenaReteDb, resolveCredentialsForDb, type CredProtocol } from "@/lib/credentials/resolve";
import { convertiCateneVecchie, descriviCatene, segnoCatene, type GlobaliHub } from "@/lib/credentials/converti-catene";
import { righeConversioni } from "@/lib/transfer/esito-import";

// ── Appoggio ────────────────────────────────────────────────────────────────

function nuovoDb(): Database.Database {
  const d = new Database(":memory:");
  d.pragma("foreign_keys = ON");
  d.exec(TENANT_SCHEMA_SQL);
  d.exec(TENANT_INDEXES_SQL);
  return d;
}

function voce(d: Database.Database, name: string, tipo: string, port: number | null = null): number {
  return Number(d.prepare("INSERT INTO credentials (name, credential_type, port) VALUES (?, ?, ?)").run(name, tipo, port).lastInsertRowid);
}

function rete(d: Database.Database, cidr: string, name: string): number {
  return Number(d.prepare("INSERT INTO networks (cidr, name) VALUES (?, ?)").run(cidr, name).lastInsertRowid);
}

function host(d: Database.Database, networkId: number, ip: string): number {
  return Number(d.prepare("INSERT INTO hosts (network_id, ip) VALUES (?, ?)").run(networkId, ip).lastInsertRowid);
}

function lista(d: Database.Database, networkId: number, ids: number[]): void {
  const ins = d.prepare("INSERT INTO network_credentials (network_id, credential_id, sort_order) VALUES (?, ?, ?)");
  ids.forEach((id, i) => ins.run(networkId, id, i));
}

function vecchia(d: Database.Database, networkId: number, role: string, id: number, sort: number): void {
  d.prepare("INSERT INTO network_host_credentials (network_id, credential_id, role, sort_order) VALUES (?, ?, ?, ?)").run(networkId, id, role, sort);
}

function pin(d: Database.Database, hostId: number, role: string, id: number, updatedAt: string): void {
  d.prepare("INSERT INTO host_detect_credential (host_id, role, credential_id, updated_at) VALUES (?, ?, ?, ?)").run(hostId, role, id, updatedAt);
}

function listaDi(d: Database.Database, networkId: number): number[] {
  return (
    d.prepare("SELECT credential_id FROM network_credentials WHERE network_id = ? ORDER BY sort_order, id").all(networkId) as Array<{ credential_id: number }>
  ).map((r) => r.credential_id);
}

function conta(d: Database.Database, tabella: string): number {
  return (d.prepare(`SELECT COUNT(*) AS n FROM ${tabella}`).get() as { n: number }).n;
}

function istantanea(d: Database.Database): string {
  return JSON.stringify({
    lista: d.prepare("SELECT * FROM network_credentials ORDER BY id").all(),
    host: d.prepare("SELECT * FROM host_credentials ORDER BY id").all(),
  });
}

const PROTOCOLLI: CredProtocol[] = ["ssh", "winrm", "snmp"];

/** Sequenza del motore per ogni rete e protocollo: «voce:porta», nell'ordine. */
function sequenze(d: Database.Database, globali: GlobaliHub | null): Record<string, { motore: string[]; catena: number[] }> {
  const out: Record<string, { motore: string[]; catena: number[] }> = {};
  const globaliHub = globali ? { windows: globali.windows, linux: globali.linux } : null;
  for (const { id } of d.prepare("SELECT id FROM networks ORDER BY id").all() as Array<{ id: number }>) {
    for (const p of PROTOCOLLI) {
      out[`${id}:${p}`] = {
        motore: resolveCredentialsForDb(d, { networkId: id }, p, { globaliHub }).map((c) => `${c.credential_id}:${c.port}`),
        catena: catenaReteDb(d, id, p, { globaliHub, registra: false }),
      };
    }
  }
  return out;
}

// ── La conversione ──────────────────────────────────────────────────────────

describe("convertiCateneVecchie", () => {
  it("lista [A,B], vecchie windows [C], ssh [B], linux [D] → lista [A,B,C,D]", () => {
    const d = nuovoDb();
    const n = rete(d, "10.1.0.0/24", "Rete uno");
    const A = voce(d, "A", "windows");
    const B = voce(d, "B", "ssh");
    const C = voce(d, "C", "windows");
    const D = voce(d, "D", "ssh");
    lista(d, n, [A, B]);
    vecchia(d, n, "windows", C, 0);
    vecchia(d, n, "ssh", B, 0);
    vecchia(d, n, "linux", D, 0);

    const e = convertiCateneVecchie(d, null, { aVuoto: false });

    assert.deepEqual(listaDi(d, n), [A, B, C, D]);
    assert.deepEqual(e.aggiunteLista, [
      { network_id: n, credential_id: C, da: "windows" },
      { network_id: n, credential_id: D, da: "linux" },
    ]);
    assert.deepEqual(e.saltate, []);
    assert.match(segnoCatene(e), /^done:\d{4}-\d{2}-\d{2}T[^:]+:\d{2}:[^:]+:lista=2,/);
    // Le tabelle vecchie restano congelate fino alla 2g.
    assert.equal(conta(d, "network_host_credentials"), 3);
  });

  it("per ssh, winrm e snmp il motore dà la stessa sequenza di voci e porte prima e dopo la conversione", () => {
    const d = nuovoDb();
    const n1 = rete(d, "10.1.0.0/24", "Rete uno");
    const n2 = rete(d, "10.2.0.0/24", "Rete due");
    const n3 = rete(d, "10.3.0.0/24", "Rete tre");
    const A = voce(d, "A", "windows");
    const B = voce(d, "B", "ssh");
    const C = voce(d, "C", "windows");
    const D = voce(d, "D", "ssh", 2222);
    const E = voce(d, "E", "snmp");
    const F = voce(d, "F", "snmp_v3", 1161);
    const G = voce(d, "G", "windows");
    const H = voce(d, "H", "ssh");
    const J = voce(d, "J (chiave Windows dell'hub)", "windows");
    const K = voce(d, "K (chiave Linux dell'hub)", "ssh");
    lista(d, n1, [A, B, H]);
    vecchia(d, n1, "windows", C, 1);
    vecchia(d, n1, "ssh", B, 0);
    vecchia(d, n1, "ssh", D, 1);
    vecchia(d, n1, "ssh", G, 2); // tipo che non vale per il ruolo: il motore lo scarta già
    vecchia(d, n1, "ssh", H, 3);
    vecchia(d, n1, "linux", D, 0);
    vecchia(d, n1, "snmp", F, 1);
    vecchia(d, n1, "snmp", E, 0);
    vecchia(d, n2, "linux", B, 0);
    lista(d, n3, [J]);
    const globali: GlobaliHub = { windows: J, linux: K, tenantAttivi: 1 };

    const prima = sequenze(d, globali);
    const e = convertiCateneVecchie(d, globali, { aVuoto: false });
    const dopo = sequenze(d, globali);

    assert.deepEqual(dopo, prima);
    assert.deepEqual(listaDi(d, n1), [A, B, H, C, D, E, F, J, K]);
    assert.deepEqual(listaDi(d, n2), [B, J, K]);
    assert.deepEqual(listaDi(d, n3), [J, K]);
    assert.deepEqual(
      e.aggiunteLista.filter((a) => a.da === "globale").map((a) => [a.network_id, a.credential_id]),
      [[n1, J], [n1, K], [n2, J], [n2, K], [n3, K]]
    );
    assert.deepEqual(e.saltate, [{ network_id: n1, credential_id: G, motivo: "tipo «windows» non vale per il ruolo ssh" }]);
    assert.match(segnoCatene(e), /^parziale:/);
    // Il motore, sulla lista sola (come dopo il T17), dà già la stessa sequenza.
    const soloLista = (p: CredProtocol, n: number) =>
      resolveCredentialsForDb(d, { networkId: n }, p, { fonti: ["network_chain"] }).map((c) => `${c.credential_id}:${c.port}`);
    for (const n of [n1, n2, n3]) for (const p of PROTOCOLLI) assert.deepEqual(soloLista(p, n), prima[`${n}:${p}`].motore, `rete ${n}, ${p}`);
  });

  it("voce B nel ruolo ssh e nel ruolo linux della stessa rete, assente dalla lista → B una volta sola", () => {
    const d = nuovoDb();
    const n = rete(d, "10.1.0.0/24", "Rete uno");
    const B = voce(d, "B", "ssh");
    vecchia(d, n, "ssh", B, 0);
    vecchia(d, n, "linux", B, 0);

    const e = convertiCateneVecchie(d, null, { aVuoto: false });

    assert.deepEqual(listaDi(d, n), [B]);
    assert.deepEqual(e.aggiunteLista, [{ network_id: n, credential_id: B, da: "ssh" }]);
  });

  it("pin con un equivalente su un'altra porta → nessuna riga; pin senza → una riga validata dal pin", () => {
    const d = nuovoDb();
    const n = rete(d, "10.1.0.0/24", "Rete uno");
    const h1 = host(d, n, "10.1.0.1");
    const h2 = host(d, n, "10.1.0.2");
    const h3 = host(d, n, "10.1.0.3");
    const C = voce(d, "C", "windows");
    const D = voce(d, "D", "ssh", 2222);
    const E = voce(d, "E", "snmp");
    d.prepare("INSERT INTO host_credentials (host_id, credential_id, protocol_type, port, validated, sort_order) VALUES (?, ?, 'winrm', 5986, 0, 0)").run(h2, C);
    d.prepare("INSERT INTO host_credentials (host_id, credential_id, protocol_type, port, validated, sort_order) VALUES (?, ?, 'snmp', 161, 1, 4)").run(h1, E);
    pin(d, h1, "ssh", D, "2026-10-01 10:00:00");
    pin(d, h2, "windows", C, "2026-10-02 10:00:00");
    pin(d, h3, "windows", D, "2026-10-03 10:00:00"); // tipo che non vale per il ruolo

    const e = convertiCateneVecchie(d, null, { aVuoto: false });

    assert.equal(e.righeHostDaPin, 1);
    assert.equal(e.pinGiaPresenti, 1);
    assert.deepEqual(e.saltate, [{ host_id: h3, credential_id: D, motivo: "tipo «ssh» non vale per il ruolo windows" }]);
    const nuova = d
      .prepare("SELECT protocol_type, port, validated, validated_at, sort_order, auto_detected FROM host_credentials WHERE host_id = ? AND credential_id = ?")
      .get(h1, D);
    assert.deepEqual(nuova, { protocol_type: "ssh", port: 2222, validated: 1, validated_at: "2026-10-01 10:00:00", sort_order: 5, auto_detected: 1 });
    assert.equal((d.prepare("SELECT COUNT(*) AS n FROM host_credentials WHERE host_id = ?").get(h2) as { n: number }).n, 1);
    assert.equal(conta(d, "host_detect_credential"), 3);
    assert.match(segnoCatene(e), /^parziale:.*host_da_pin=1,pin_presenti=1,saltate=1/);
  });

  it("chiave globale con due tenant attivi → saltata col motivo, e il segno resta done", () => {
    const d = nuovoDb();
    const n = rete(d, "10.1.0.0/24", "Rete uno");
    const J = voce(d, "J", "windows");
    const K = voce(d, "K", "ssh");

    const e = convertiCateneVecchie(d, { windows: J, linux: K, tenantAttivi: 2 }, { aVuoto: false });

    assert.deepEqual(listaDi(d, n), []);
    assert.deepEqual(e.saltate, [
      { credential_id: J, motivo: "due tenant attivi" },
      { credential_id: K, motivo: "due tenant attivi" },
    ]);
    assert.match(segnoCatene(e), /^done:.*saltate=2/);
    assert.match(descriviCatene(e), /#\d+: due tenant attivi/);
  });

  it("chiave globale con un tenant attivo: dopo le vecchie, solo se esiste e il tipo combacia", () => {
    const d = nuovoDb();
    const n = rete(d, "10.1.0.0/24", "Rete uno");
    const C = voce(d, "C", "windows");
    const K = voce(d, "K", "windows"); // chiave Linux che punta a una voce Windows

    const e = convertiCateneVecchie(d, { windows: 999, linux: K, tenantAttivi: 1 }, { aVuoto: false });

    assert.deepEqual(listaDi(d, n), []);
    assert.deepEqual(e.saltate, [
      { credential_id: 999, motivo: "la voce non esiste nel tenant" },
      { credential_id: K, motivo: "tipo «windows» non vale per il ruolo linux" },
    ]);
    assert.match(segnoCatene(e), /^parziale:/);
    void C;
  });

  it("seconda chiamata → nessun effetto", () => {
    const d = nuovoDb();
    const n = rete(d, "10.1.0.0/24", "Rete uno");
    const h = host(d, n, "10.1.0.1");
    const B = voce(d, "B", "ssh");
    const C = voce(d, "C", "windows");
    vecchia(d, n, "ssh", B, 0);
    pin(d, h, "windows", C, "2026-10-01 10:00:00");
    const globali: GlobaliHub = { windows: C, linux: null, tenantAttivi: 1 };
    const prima = convertiCateneVecchie(d, globali, { aVuoto: false });
    assert.equal(prima.aggiunteLista.length, 2);
    assert.equal(prima.righeHostDaPin, 1);
    const stato = istantanea(d);

    const seconda = convertiCateneVecchie(d, globali, { aVuoto: false });

    assert.equal(istantanea(d), stato);
    assert.deepEqual(seconda.aggiunteLista, []);
    assert.equal(seconda.righeHostDaPin, 0);
    assert.equal(seconda.pinGiaPresenti, 1);
  });

  it("a vuoto: lo stesso esito, niente scritto", () => {
    const costruisci = () => {
      const d = nuovoDb();
      const n = rete(d, "10.1.0.0/24", "Rete uno");
      const h = host(d, n, "10.1.0.1");
      const B = voce(d, "B", "ssh");
      const C = voce(d, "C", "windows");
      vecchia(d, n, "ssh", B, 0);
      vecchia(d, n, "linux", B, 1);
      pin(d, h, "ssh", B, "2026-10-01 10:00:00");
      pin(d, h, "linux", B, "2026-10-01 10:00:00");
      return { d, globali: { windows: C, linux: null, tenantAttivi: 1 } as GlobaliHub };
    };
    const vero = costruisci();
    const prova = costruisci();
    const stato = istantanea(prova.d);

    const eVero = convertiCateneVecchie(vero.d, vero.globali, { aVuoto: false });
    const eProva = convertiCateneVecchie(prova.d, prova.globali, { aVuoto: true });

    assert.deepEqual(eProva, eVero);
    assert.equal(eVero.righeHostDaPin, 1);
    assert.equal(eVero.pinGiaPresenti, 1);
    assert.equal(istantanea(prova.d), stato);
  });

  it("conteggi che non tornano → errore e niente scritto", () => {
    const d = nuovoDb();
    const n = rete(d, "10.1.0.0/24", "Rete uno");
    const B = voce(d, "B", "ssh");
    const C = voce(d, "C", "ssh");
    vecchia(d, n, "ssh", B, 0);
    vecchia(d, n, "ssh", C, 1);
    // Un trigger che toglie la riga appena entrata: la lista non cresce di quanto detto.
    d.exec(`CREATE TRIGGER trg_prova_toglie AFTER INSERT ON network_credentials WHEN NEW.credential_id = ${C}
            BEGIN DELETE FROM network_credentials WHERE id = NEW.id; END`);

    assert.throws(() => convertiCateneVecchie(d, null, { aVuoto: false }), /conteggi/);
    assert.deepEqual(listaDi(d, n), []);
  });
});

// ── All'apertura del tenant ─────────────────────────────────────────────────

function segno(d: Database.Database): string | null {
  const r = d.prepare("SELECT value FROM tenant_settings WHERE key = 'credenziali_t2_catene'").get() as { value: string } | undefined;
  return r?.value ?? null;
}

function riapri(code: string): Database.Database {
  closeTenantDb(code);
  return withTenant(code, () => getTenantDb(code));
}

describe("getTenantDb: conversione delle catene col segno credenziali_t2_catene", () => {
  const CODE = "TESTCATENE2D";
  after(() => deleteTenantDatabase(CODE));

  it("conversione fatta; l'utente toglie dalla lista la voce arrivata dalla catena vecchia; alla seconda apertura non torna", () => {
    let d = withTenant(CODE, () => getTenantDb(CODE));
    assert.match(segno(d) ?? "", /^done:/);
    // Uno stato di prima della 2d: una catena vecchia, segno assente.
    d.prepare("DELETE FROM tenant_settings WHERE key = 'credenziali_t2_catene'").run();
    const n = rete(d, "10.77.0.0/24", "Rete prova 2d");
    const B = voce(d, "Server", "ssh");
    vecchia(d, n, "ssh", B, 0);

    d = riapri(CODE);
    assert.deepEqual(listaDi(d, n), [B], "la catena vecchia non è entrata nella lista");
    assert.match(segno(d) ?? "", /^done:.*lista=1/);

    d.prepare("DELETE FROM network_credentials WHERE network_id = ?").run(n);
    d = riapri(CODE);
    assert.deepEqual(listaDi(d, n), [], "la voce tolta è tornata dalla catena congelata");
  });
});

// ── Import ──────────────────────────────────────────────────────────────────

describe("righeConversioni: il nome della conversione delle catene", () => {
  it("si legge in italiano, non la chiave", () => {
    const [r] = righeConversioni({ credenziali_t2_catene: { segno: "done:2026-10-16T10:00:00.000Z:lista=1,da_globale=0,host_da_pin=0,pin_presenti=0,saltate=0", dettaglio: "x" } });
    assert.equal(r.testo, "Elenchi vecchi delle credenziali (reti e host) convertiti: x");
  });
});

// ── prova-a-vuoto.ts: le voci entrate e le catene del motore ────────────────

const REPO = process.cwd();
const SCRIPT = path.join(REPO, "scripts", "credenziali", "prova-a-vuoto.ts");
const TPAV = "TESTPROVA2D";

describe("prova-a-vuoto.ts: la conversione delle catene sulla copia", () => {
  let radice = "";
  let servizio = "";
  let copia = "";
  before(() => {
    getHubDb();
    closeHubDb();
    radice = fs.mkdtempSync(path.join(os.tmpdir(), "prova-a-vuoto-2d-"));
    servizio = path.join(radice, "servizio");
    copia = path.join(radice, "copia");
    for (const dir of [servizio, copia]) {
      fs.mkdirSync(path.join(dir, "tenants"), { recursive: true });
      fs.copyFileSync(path.join(TEST_DATA_DIR, "hub.db"), path.join(dir, "hub.db"));
    }
    const d = new Database(path.join(copia, "tenants", `${TPAV}.db`));
    d.exec(TENANT_SCHEMA_SQL);
    d.exec(TENANT_INDEXES_SQL);
    const n = rete(d, "10.88.0.0/24", "Rete della copia");
    const B = voce(d, "Server della copia", "ssh");
    vecchia(d, n, "ssh", B, 0);
    d.close();
  });
  after(() => {
    if (radice) fs.rmSync(radice, { recursive: true, force: true });
  });

  it("stampa le righe prima e dopo, la voce entrata per nome e le catene del motore uguali", () => {
    const env: NodeJS.ProcessEnv = { ...process.env, DA_INVENT_DATA_DIR: servizio };
    delete env.DA_IPAM_HUB_DB_PATH;
    const r = spawnSync(process.execPath, ["--import", "tsx", SCRIPT, "--dati", copia], { cwd: REPO, env, encoding: "utf8", timeout: 180_000 });
    assert.equal(r.status, 0, `uscita ${r.status}\n${r.stdout}\n${r.stderr}`);
    const blocco = r.stdout.split(`== Tenant ${TPAV}`)[1] ?? "";
    assert.match(blocco, /catene \(2d\): lista delle reti 0 → 1, righe host 0 → 0, catene vecchie 1 → 1, pin 0 → 0/);
    assert.match(blocco, /rete «Rete della copia» \(#1\): «Server della copia» \(#1\)/);
    assert.match(blocco, /catene del motore \(ssh, winrm, snmp\): uguali prima e dopo/);
    assert.match(blocco, /credenziali_t2_catene: \(assente\) → done:/);
  });

  it("una catena del motore che cambia si elenca per nome ed esce con 1", () => {
    const altra = path.join(radice, "copia-diversa");
    fs.mkdirSync(path.join(altra, "tenants"), { recursive: true });
    fs.copyFileSync(path.join(TEST_DATA_DIR, "hub.db"), path.join(altra, "hub.db"));
    const d = new Database(path.join(altra, "tenants", `${TPAV}.db`));
    d.exec(TENANT_SCHEMA_SQL);
    d.exec(TENANT_INDEXES_SQL);
    const n = rete(d, "10.89.0.0/24", "Rete che cambia");
    lista(d, n, [voce(d, "Voce che sparisce", "ssh")]);
    // Simula una conversione sbagliata: quando si scrive il segno, la lista si svuota.
    d.exec(`CREATE TRIGGER trg_prova_svuota AFTER INSERT ON tenant_settings WHEN NEW.key = 'credenziali_t2_catene'
            BEGIN DELETE FROM network_credentials; END`);
    d.close();
    const env: NodeJS.ProcessEnv = { ...process.env, DA_INVENT_DATA_DIR: servizio };
    delete env.DA_IPAM_HUB_DB_PATH;
    const r = spawnSync(process.execPath, ["--import", "tsx", SCRIPT, "--dati", altra], { cwd: REPO, env, encoding: "utf8", timeout: 180_000 });
    assert.equal(r.status, 1, `uscita ${r.status}\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /voci USCITE dalla lista:\n  rete «Rete che cambia» \(#1\): «Voce che sparisce» \(#1\)/);
    assert.match(r.stdout, /catene del motore \(ssh, winrm, snmp\): DIVERSE\n  rete «Rete che cambia» \(#1\) ssh: prima «Voce che sparisce» \(#1\):22 → dopo \(vuota\)/);
    assert.match(r.stdout, /DA GUARDARE: catene del motore diverse o non misurabili/);
  });
});
