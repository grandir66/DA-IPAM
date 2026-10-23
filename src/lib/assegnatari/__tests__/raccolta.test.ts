// Raccolta degli accessi ai PC (piano 2026-10-23-assegnatari-da-ad, passo 3) e allineamento dopo la sync AD (passo 2).
// La risposta finta dell'indexer ha la forma VERA di OpenSearch: `aggregations.per_host.buckets[].utenti.buckets[]` con
// `ultimo.value` in millisecondi, come nella misura del 23/10 sull'hub .8.
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { migrateAssegnatariAd } from "@/lib/db-tenant";
import { TENANT_SCHEMA_SQL } from "@/lib/db-tenant-schema";
import { accessiHost, allineaAssegnatariDaAd, pcDegliAccount, personeAd, registraAccessi, CHIAVE_CURSORE_WAZUH } from "../db";
import { finestre, leggiRispostaAccessi, queryAccessi, raccogliAccessi, righeWinrm, type IndexerAccessi } from "../raccolta";

function dbProva(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(TENANT_SCHEMA_SQL);
  migrateAssegnatariAd(db);
  // Come all'apertura vera del tenant (ALTER di getTenantDb).
  db.exec("ALTER TABLE network_devices ADD COLUMN host_id INTEGER REFERENCES hosts(id) ON DELETE SET NULL");
  db.prepare("INSERT INTO networks (id, cidr, name) VALUES (1, '10.10.20.0/24', 'uffici')").run();
  const h = db.prepare("INSERT INTO hosts (id, network_id, ip, hostname) VALUES (?, 1, ?, ?)");
  h.run(1, "10.10.20.43", "pc-acq-03.cliente.local");
  h.run(2, "10.10.20.50", null);
  h.run(3, "10.10.20.60", "srv-dc01");
  db.prepare("INSERT INTO wazuh_agent (agent_id, host_id, name) VALUES ('001', 1, 'PC-ACQ-03')").run();
  db.prepare("INSERT INTO ad_integrations (id, name, dc_host, domain, base_dn, encrypted_username, encrypted_password) VALUES (1, 'AD', 'dc', 'cliente.local', 'DC=cliente,DC=local', 'x', 'x')").run();
  db.prepare("INSERT INTO ad_computers (integration_id, object_guid, sam_account_name, distinguished_name, host_id) VALUES (1, 'c-50', 'PC-PROD-11$', 'CN=PC-PROD-11', 2)").run();
  return db;
}

const ms = (s: string) => Date.parse(s);
const bucketUtente = (key: string, n: number, quando: string) => ({ key, doc_count: n, ultimo: { value: ms(quando), value_as_string: quando } });
function risposta(perHost: Array<Record<string, unknown>>) {
  return {
    took: 12, timed_out: false, _shards: { total: 1, successful: 1, skipped: 0, failed: 0 },
    hits: { total: { value: 0, relation: "eq" }, max_score: null, hits: [] },
    aggregations: { per_host: { doc_count_error_upper_bound: 0, sum_other_doc_count: 0, buckets: perHost } },
  };
}

test("la query: tipi di accesso giusti, finestra semiaperta, niente account di macchina", () => {
  const q = queryAccessi("tastiera", new Date("2026-10-22T00:00:00Z"), new Date("2026-10-22T10:00:00Z")) as {
    query: { bool: { filter: Array<Record<string, unknown>>; must_not: Array<Record<string, unknown>> } }; aggs: { per_host: { terms: { field: string } } };
  };
  assert.deepEqual(q.query.bool.filter[2], { terms: { "data.win.eventdata.logonType": ["2", "10", "11"] } });
  assert.deepEqual(q.query.bool.filter[0], { range: { "@timestamp": { gte: "2026-10-22T00:00:00.000Z", lt: "2026-10-22T10:00:00.000Z" } } });
  assert.ok(JSON.stringify(q.query.bool.must_not).includes("*$"));
  assert.equal(q.aggs.per_host.terms.field, "agent.name");
  const r = queryAccessi("rete", new Date(0), new Date(1)) as { aggs: { per_host: { terms: { field: string }; aggs: Record<string, unknown> } } };
  assert.equal(r.aggs.per_host.terms.field, "data.win.eventdata.workstationName");
  assert.ok(r.aggs.per_host.aggs.ip);
});

test("finestre spezzate alla mezzanotte UTC", () => {
  const f = finestre(new Date("2026-10-21T22:30:00Z"), new Date("2026-10-23T01:00:00Z"));
  assert.deepEqual(f.map((x) => [x.giorno, x.da.toISOString(), x.a.toISOString()]), [
    ["2026-10-21", "2026-10-21T22:30:00.000Z", "2026-10-22T00:00:00.000Z"],
    ["2026-10-22", "2026-10-22T00:00:00.000Z", "2026-10-23T00:00:00.000Z"],
    ["2026-10-23", "2026-10-23T00:00:00.000Z", "2026-10-23T01:00:00.000Z"],
  ]);
  assert.deepEqual(finestre(new Date(5), new Date(5)), []);
});

test("lettura dei bucket: ora nel formato del DB, IP della postazione, bucket senza chiave saltati", () => {
  const b = leggiRispostaAccessi(risposta([
    { key: "PC-PROD-11", doc_count: 9, utenti: { buckets: [bucketUtente("CLIENTE\\D.Ferrari", 9, "2026-10-22T08:01:02.000Z")] }, ip: { buckets: [{ key: "10.10.20.50", doc_count: 9 }] } },
    { key: "", doc_count: 1, utenti: { buckets: [] } },
  ]));
  assert.deepEqual(b, [{ chiave: "PC-PROD-11", ip: "10.10.20.50", utenti: [{ account: "CLIENTE\\D.Ferrari", conteggio: 9, ultimo: "2026-10-22 08:01:02" }] }]);
  assert.deepEqual(leggiRispostaAccessi({ hits: { hits: [] } }), []);
});

test("giro completo: tastiera per agente, rete per nome AD o IP; cursore salvato; il secondo giro non conta due volte", async () => {
  const db = dbProva();
  const chiamate: string[] = [];
  const indexer: IndexerAccessi = {
    async aggregaAlert(body) {
      const campo = (body as { aggs: { per_host: { terms: { field: string } } } }).aggs.per_host.terms.field;
      chiamate.push(campo);
      if (campo === "agent.name") {
        return risposta([{ key: "PC-ACQ-03", doc_count: 17, utenti: { buckets: [
          bucketUtente("s.colombo", 14, "2026-10-22T17:52:00Z"), bucketUtente("CLIENTE\\S.Colombo", 1, "2026-10-22T09:00:00Z"),
          bucketUtente("DWM-3", 2, "2026-10-22T09:00:00Z"),
        ] } }]);
      }
      return risposta([
        { key: "PC-PROD-11", doc_count: 6, utenti: { buckets: [bucketUtente("d.ferrari", 6, "2026-10-22T08:00:00Z")] }, ip: { buckets: [{ key: "10.10.20.99", doc_count: 6 }] } },
        { key: "SCONOSCIUTO", doc_count: 3, utenti: { buckets: [bucketUtente("x.y", 3, "2026-10-22T08:00:00Z")] }, ip: { buckets: [{ key: "10.10.20.43", doc_count: 3 }] } },
        { key: "FANTASMA", doc_count: 3, utenti: { buckets: [bucketUtente("x.y", 3, "2026-10-22T08:00:00Z")] }, ip: { buckets: [{ key: "192.0.2.1", doc_count: 3 }] } },
      ]);
    },
  };
  const ora = new Date("2026-10-22T20:02:00Z");
  db.prepare("INSERT INTO tenant_settings (key, value) VALUES (?, ?)").run(CHIAVE_CURSORE_WAZUH, "2026-10-22T18:00:00.000Z");
  const e = await raccogliAccessi(db, indexer, { giorni: 30, ora });
  assert.deepEqual(chiamate, ["agent.name", "data.win.eventdata.workstationName"], "una finestra: dalle 18:00 alle 20:00");
  assert.equal(e.finestre, 1);
  assert.equal(e.senzaHost, 1, "FANTASMA non ha host");
  assert.equal(e.cursore, "2026-10-22T20:00:00.000Z");
  const righe = db.prepare("SELECT host_id, account, fonte, giorno, conteggio, ultimo FROM host_accessi_utente ORDER BY host_id, account").all();
  assert.deepEqual(righe, [
    { host_id: 1, account: "s.colombo", fonte: "wazuh_tastiera", giorno: "2026-10-22", conteggio: 15, ultimo: "2026-10-22 17:52:00" },
    { host_id: 1, account: "x.y", fonte: "wazuh_rete", giorno: "2026-10-22", conteggio: 3, ultimo: "2026-10-22 08:00:00" },
    { host_id: 2, account: "d.ferrari", fonte: "wazuh_rete", giorno: "2026-10-22", conteggio: 6, ultimo: "2026-10-22 08:00:00" },
  ]);
  // Secondo giro un minuto dopo: la finestra [20:00, 20:01) è vuota di nuovi dati nel finto, ma il finto risponde uguale:
  // si somma solo quello che la query restituisce per la finestra nuova. Con un indexer vuoto nulla cambia.
  const vuoto: IndexerAccessi = { aggregaAlert: async () => risposta([]) };
  await raccogliAccessi(db, vuoto, { giorni: 30, ora: new Date("2026-10-22T20:03:00Z") });
  assert.equal((db.prepare("SELECT SUM(conteggio) AS n FROM host_accessi_utente").get() as { n: number }).n, 24);
  assert.equal((db.prepare("SELECT value FROM tenant_settings WHERE key = ?").get(CHIAVE_CURSORE_WAZUH) as { value: string }).value, "2026-10-22T20:01:00.000Z");
});

test("un errore dell'indexer a metà: le finestre già lette restano, il cursore si ferma lì", async () => {
  const db = dbProva();
  let n = 0;
  const indexer: IndexerAccessi = {
    async aggregaAlert() {
      n++;
      if (n > 2) throw new Error("OpenSearch POST → HTTP 503");
      return risposta([{ key: "PC-ACQ-03", doc_count: 5, utenti: { buckets: [bucketUtente("s.colombo", 5, "2026-10-21T10:00:00Z")] } }]);
    },
  };
  await assert.rejects(raccogliAccessi(db, indexer, { giorni: 2, ora: new Date("2026-10-22T12:02:00Z") }), /503/);
  assert.equal((db.prepare("SELECT value FROM tenant_settings WHERE key = ?").get(CHIAVE_CURSORE_WAZUH) as { value: string }).value, "2026-10-21T00:00:00.000Z");
  // La prima finestra completa: 5 alla tastiera (per agente) + 5 di rete (il finto risponde uguale, la postazione si
  // risolve per nome sullo stesso host). La seconda finestra si è rotta alla prima query e non ha scritto niente.
  assert.deepEqual(db.prepare("SELECT fonte, conteggio FROM host_accessi_utente ORDER BY fonte").all(), [
    { fonte: "wazuh_rete", conteggio: 5 }, { fonte: "wazuh_tastiera", conteggio: 5 },
  ]);
});

test("WinRM: utente collegato e sessioni, una presenza al giorno; account di macchina fuori", () => {
  const db = dbProva();
  db.prepare(
    "INSERT INTO network_devices (id, name, host, device_type, vendor, protocol, enabled, host_id, last_info_update, last_device_info_json) VALUES (5, 'PC', '10.10.20.43', 'server', 'windows', 'winrm', 1, NULL, datetime('now'), ?)",
  ).run(JSON.stringify({ last_logged_on_user: "CLIENTE\\s.colombo", logged_on_users: [{ username: "m.rossi", session_type: "RDP" }, { username: "PC$" }] }));
  const r = righeWinrm(db, 30);
  assert.deepEqual(r.map((x) => [x.hostId, x.account, x.fonte]).sort(), [[1, "m.rossi", "winrm"], [1, "s.colombo", "winrm"]]);
  registraAccessi(db, r, "presenza");
  registraAccessi(db, r, "presenza");
  assert.deepEqual(accessiHost(db, 1, 30).map((a) => [a.account, a.conteggio]).sort(), [["m.rossi", 1], ["s.colombo", 1]]);
  assert.deepEqual([...pcDegliAccount(db, ["s.colombo"], 30).entries()], [["s.colombo", ["pc-acq-03"]]], "il nome breve del PC");
});

test("persone di AD e allineamento degli assegnatari legati: dati da AD, disattivato con la data della prima volta", () => {
  const db = dbProva();
  const u = db.prepare(
    `INSERT INTO ad_users (integration_id, object_guid, sam_account_name, display_name, email, department, title, enabled, given_name, surname, raw_data)
     VALUES (1, ?, ?, ?, ?, 'Acquisti', 'Buyer', ?, ?, ?, ?)`,
  );
  u.run("g-1", "S.Colombo", "Sara Colombo", "s.colombo@cliente.it", 1, "Sara", "Colombo", JSON.stringify({ memberOf: ["CN=Acquisti,DC=x"] }));
  u.run("g-2", "admin.it", "Admin IT", null, 1, "Admin", "IT", JSON.stringify({ memberOf: ["CN=Domain Admins,CN=Users,DC=x"] }));
  const p = personeAd(db, ["s.colombo", "admin.it", "nessuno"]);
  assert.equal(p.get("s.colombo")?.cognome, "Colombo");
  assert.equal(p.get("s.colombo")?.amministrativo, false);
  assert.equal(p.get("admin.it")?.amministrativo, true);
  assert.equal(p.has("nessuno"), false);

  db.prepare("INSERT INTO asset_assignees (id, name, ad_integration_id, ad_object_guid, origine) VALUES (9, 'vecchio', 1, 'g-1', 'ad')").run();
  db.prepare("INSERT INTO asset_assignees (id, name, email) VALUES (10, 'A mano', 'a@b.it')").run();
  assert.equal(allineaAssegnatariDaAd(db, 1), 1);
  assert.deepEqual(db.prepare("SELECT name, nome, cognome, email, reparto, ruolo, ad_abilitato, ad_disattivato_il FROM asset_assignees WHERE id = 9").get(), {
    name: "Sara Colombo", nome: "Sara", cognome: "Colombo", email: "s.colombo@cliente.it", reparto: "Acquisti", ruolo: "Buyer", ad_abilitato: 1, ad_disattivato_il: null,
  });
  db.prepare("UPDATE ad_users SET enabled = 0 WHERE object_guid = 'g-1'").run();
  allineaAssegnatariDaAd(db, 1);
  const prima = (db.prepare("SELECT ad_disattivato_il AS d FROM asset_assignees WHERE id = 9").get() as { d: string }).d;
  assert.match(prima, /^\d{4}-\d{2}-\d{2} /);
  db.prepare("UPDATE asset_assignees SET ad_disattivato_il = '2026-10-02 08:00:00' WHERE id = 9").run();
  allineaAssegnatariDaAd(db, 1);
  assert.equal((db.prepare("SELECT ad_disattivato_il AS d FROM asset_assignees WHERE id = 9").get() as { d: string }).d, "2026-10-02 08:00:00", "la prima data resta");
  assert.equal((db.prepare("SELECT name FROM asset_assignees WHERE id = 10").get() as { name: string }).name, "A mano", "quelli a mano non si toccano");
});

test("due giri insieme sulla stessa finestra: il secondo non somma di nuovo", async () => {
  const db = dbProva();
  db.prepare("INSERT INTO tenant_settings (key, value) VALUES (?, ?)").run(CHIAVE_CURSORE_WAZUH, "2026-10-22T18:00:00.000Z");
  const risp = risposta([{ key: "PC-ACQ-03", doc_count: 4, utenti: { buckets: [bucketUtente("s.colombo", 4, "2026-10-22T19:00:00Z")] } }]);
  // Il primo giro, mentre aspetta l'indexer, lascia passare il secondo che scrive la stessa finestra per intero.
  let secondo: Promise<unknown> | null = null;
  const lento: IndexerAccessi = {
    async aggregaAlert() {
      if (!secondo) secondo = raccogliAccessi(db, { aggregaAlert: async () => risp }, { giorni: 30, ora: new Date("2026-10-22T20:02:00Z") });
      await secondo;
      return risp;
    },
  };
  await raccogliAccessi(db, lento, { giorni: 30, ora: new Date("2026-10-22T20:02:00Z") });
  assert.equal((db.prepare("SELECT SUM(conteggio) AS n FROM host_accessi_utente WHERE fonte = 'wazuh_tastiera'").get() as { n: number }).n, 4);
});
