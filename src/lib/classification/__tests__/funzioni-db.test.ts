/**
 * Le funzioni nel database: riempimento, righe a mano che non si toccano, righe del sistema che si tolgono.
 * Run: node --import tsx --test src/lib/classification/__tests__/funzioni-db.test.ts
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { funzioniPerHost, impostaFunzioneAMano, ricalcolaFunzioni } from "../funzioni-db";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(`CREATE TABLE hosts (id INTEGER PRIMARY KEY, network_id INTEGER, ip TEXT, hostname TEXT, custom_name TEXT,
      classification TEXT, open_ports TEXT, server_roles TEXT);
    CREATE TABLE wazuh_agent (agent_id TEXT PRIMARY KEY, host_id INTEGER);
    CREATE TABLE wazuh_service (id INTEGER PRIMARY KEY, agent_id TEXT, service_id TEXT, process_pid INTEGER);
    CREATE TABLE dc_lettura (dc TEXT PRIMARY KEY);
    INSERT INTO hosts (id, network_id, ip, hostname, classification, open_ports) VALUES
      (1, 1, '10.0.0.1', 'DA-DC01.domarc.it', 'server', '[{"port":53},{"port":445}]'),
      (2, 1, '10.0.0.2', 'pc-ufficio', 'workstation', 'non è json'),
      (3, 2, '10.0.1.1', 'gw', 'router', NULL);
    INSERT INTO wazuh_agent VALUES ('001', 1), ('002', 2);
    INSERT INTO wazuh_service (agent_id, service_id, process_pid) VALUES
      ('001', 'NTDS', 700), ('001', 'DHCPServer', 0), ('002', 'Dnscache', 900), ('002', 'Spooler', 901);
    INSERT INTO dc_lettura VALUES ('DA-DC01.domarc.it');`);
});

const slug = (id: number) => (funzioniPerHost(db)[id] ?? []).map((f) => f.funzione).sort();

describe("ricalcolaFunzioni", () => {
  it("senza applica non scrive, ma dice che cosa scriverebbe", () => {
    const r = ricalcolaFunzioni(db, { applica: false });
    assert.deepEqual(r.trovate.map((t) => `${t.host_id}:${t.funzione}`).sort(), ["1:ad_ldap", "1:dns", "3:router"]);
    assert.deepEqual(funzioniPerHost(db), {});
  });
  it("scrive: il DC è AD e DNS, il servizio fermo non conta, il PC non ha funzioni, il router fa da router", () => {
    ricalcolaFunzioni(db, { applica: true });
    assert.deepEqual(slug(1), ["ad_ldap", "dns"]);
    assert.deepEqual(slug(2), []);
    assert.deepEqual(slug(3), ["router"]);
    assert.deepEqual(Object.keys(funzioniPerHost(db, 2)), ["3"]);
  });
  it("una funzione che il sistema non trova più si toglie", () => {
    ricalcolaFunzioni(db, { applica: true });
    db.exec("UPDATE hosts SET open_ports = NULL WHERE id = 1");
    const r = ricalcolaFunzioni(db, { applica: true });
    assert.equal(r.tolte, 1);
    assert.deepEqual(slug(1), ["ad_ldap"]);
  });
  it("messa a mano resta anche se il sistema non la trova; tolta a mano non torna anche se la trova", () => {
    ricalcolaFunzioni(db, { applica: true });
    db.exec(`INSERT INTO host_funzioni (host_id, funzione, origine, a_mano) VALUES (2, 'ia_locale', 'a mano', 1);
             UPDATE host_funzioni SET a_mano = -1 WHERE host_id = 3 AND funzione = 'router';`);
    ricalcolaFunzioni(db, { applica: true });
    assert.deepEqual(slug(2), ["ia_locale"]);
    assert.deepEqual(slug(3), []);
    assert.equal((db.prepare("SELECT a_mano FROM host_funzioni WHERE host_id = 3").get() as { a_mano: number }).a_mano, -1);
  });
});

describe("impostaFunzioneAMano", () => {
  it("metti: la funzione c'è anche se il sistema non la trova, e resta dopo un ricalcolo", () => {
    ricalcolaFunzioni(db, { applica: true });
    assert.equal(impostaFunzioneAMano(db, [2, 3], "ia_locale", "metti"), 2);
    ricalcolaFunzioni(db, { applica: true });
    assert.deepEqual(slug(2), ["ia_locale"]);
    assert.deepEqual(slug(3), ["ia_locale", "router"]);
    assert.equal(funzioniPerHost(db)[2][0].a_mano, true);
  });
  it("togli: la funzione sparisce e il sistema non la rimette", () => {
    ricalcolaFunzioni(db, { applica: true });
    impostaFunzioneAMano(db, [1], "dns", "togli");
    ricalcolaFunzioni(db, { applica: true });
    assert.deepEqual(slug(1), ["ad_ldap"]);
  });
  it("automatica: via la scelta della persona, il sistema rimette subito ciò che trova", () => {
    ricalcolaFunzioni(db, { applica: true });
    impostaFunzioneAMano(db, [1], "dns", "togli");
    impostaFunzioneAMano(db, [2], "ia_locale", "metti");
    impostaFunzioneAMano(db, [1], "dns", "automatica");
    impostaFunzioneAMano(db, [2], "ia_locale", "automatica");
    assert.deepEqual(slug(1), ["ad_ldap", "dns"]);
    assert.deepEqual(slug(2), []);
  });
  it("un host che non esiste non scrive niente", () => {
    assert.equal(impostaFunzioneAMano(db, [999], "dns", "metti"), 0);
  });
});
