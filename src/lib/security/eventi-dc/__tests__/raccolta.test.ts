/**
 * Un giro di lettura dei DC su un cliente vero (DB isolato) con WinRM finto: quali DC, che cosa si
 * chiede, coda della pagina, cursore, errori e scelta «auto/sempre/mai».
 *
 * Run: node --import tsx --test src/lib/security/eventi-dc/__tests__/raccolta.test.ts
 */
import { TEST_DATA_DIR } from "@/lib/__tests__/support/data-dir-isolata";
import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { encrypt } from "@/lib/crypto";
import { deleteTenantDatabase, getTenantDb, withTenant } from "@/lib/db-tenant";
import { ensureWazuhAlertSchema } from "@/lib/integrations/wazuh-alerts-db";
import { dcDaLeggere, giroEventiDc, scriviModoEventiDc, type EseguiWinrm } from "../raccolta";
import { ensureEventiDcSchema, letturaDc } from "../db";

void TEST_DATA_DIR;
const T = "TESTEVENTIDC";
const dbt = () => getTenantDb(T);

function prepara(): void {
  const db = dbt();
  ensureEventiDcSchema(db);
  ensureWazuhAlertSchema(db);
  for (const t of ["dc_evento", "dc_lettura", "wazuh_alert_event", "ad_computers", "ad_integrations", "credentials"]) db.exec(`DELETE FROM ${t}`);
  db.prepare("DELETE FROM tenant_settings WHERE key LIKE 'eventi_dc.%'").run();
  const cred = Number(
    db.prepare("INSERT INTO credentials (name, credential_type, encrypted_username, encrypted_password) VALUES ('DC WinRM', 'windows', ?, ?)")
      .run(encrypt("CLIENTE\\svc-eventi"), encrypt("pw")).lastInsertRowid,
  );
  const integ = Number(
    db.prepare(
      `INSERT INTO ad_integrations (name, dc_host, domain, base_dn, encrypted_username, encrypted_password, enabled, winrm_credential_id)
       VALUES ('Dominio', '10.0.0.10', 'cliente.local', 'DC=cliente,DC=local', '', '', 1, ?)`,
    ).run(cred).lastInsertRowid,
  );
  const pc = db.prepare(
    "INSERT INTO ad_computers (integration_id, object_guid, sam_account_name, dns_host_name, distinguished_name, enabled) VALUES (?, ?, ?, ?, ?, 1)",
  );
  pc.run(integ, "g1", "DC01$", "dc01.cliente.local", "CN=DC01,OU=Domain Controllers,DC=cliente,DC=local");
  pc.run(integ, "g2", "DC02$", null, "CN=DC02,OU=Domain Controllers,DC=cliente,DC=local");
  pc.run(integ, "g3", "PC-07$", "pc-07.cliente.local", "CN=PC-07,OU=Computer,DC=cliente,DC=local");
}

const risposta = (eventi: unknown[], nuovo = 5000, vecchio = 1) => JSON.stringify({ nuovo, vecchio, errore: null, eventi });
const fallito = (r: number, utente: string, t = "2026-10-29T08:00:00Z") => ({ r, t, id: 4625, d: { TargetUserName: utente, IpAddress: "10.0.0.7", SubStatus: "0xC000006A" } });

describe("giro di lettura dei DC", () => {
  beforeEach(prepara);
  after(() => deleteTenantDatabase(T));

  it("legge i DC dell'OU Domain Controllers per nome, non i PC né l'IP dell'integrazione", () => {
    assert.deepEqual(
      dcDaLeggere(dbt()).map((d) => [d.dc, d.realm]),
      [["DC02", "cliente.local"], ["dc01.cliente.local", "cliente.local"]],
    );
  });

  it("senza DC sincronizzati legge il DC dell'integrazione", () => {
    dbt().exec("DELETE FROM ad_computers");
    assert.deepEqual(dcDaLeggere(dbt()).map((d) => d.dc), ["10.0.0.10"]);
  });

  it("eventi in archivio e in coda, un evento aperto per DC e tipo; il giro dopo riparte dal cursore", async () => {
    const chiamate: Array<{ host: string; user: string; realm?: string; script: string }> = [];
    const esegui: EseguiWinrm = async (host, _p, user, _pw, script, _ps, realm) => {
      chiamate.push({ host, user, realm, script });
      return host === "dc01.cliente.local" ? risposta([fallito(10, "mrossi"), fallito(11, "lbianchi")]) : risposta([]);
    };
    const e = await withTenant(T, () => giroEventiDc(dbt(), { esegui, wazuh: false }));
    assert.equal(e.saltato, null);
    assert.equal(e.aperti, 1, "due fallimenti sullo stesso DC: un evento aperto con due occorrenze");
    assert.equal(chiamate.length, 2);
    assert.equal(chiamate[0]!.user, "CLIENTE\\svc-eventi");
    assert.equal(chiamate[0]!.realm, "cliente.local");
    assert.match(chiamate[0]!.script, /timediff/, "prima lettura: ultime 24 ore");
    const coda = dbt().prepare("SELECT agent_name, rule_id, occurrence_count, target_user FROM wazuh_alert_event").all();
    assert.deepEqual(coda, [{ agent_name: "dc01.cliente.local", rule_id: "dc-4625", occurrence_count: 2, target_user: "lbianchi" }]);
    assert.equal(letturaDc(dbt(), "dc01.cliente.local")?.ultimoRecord, 11);
    assert.equal(letturaDc(dbt(), "DC02")?.ultimoRecord, 5000, "nessun evento: avanti al più nuovo");

    chiamate.length = 0;
    await withTenant(T, () => giroEventiDc(dbt(), { esegui: async (h, ...r) => (await esegui(h, ...r), risposta([fallito(11, "lbianchi")])), wazuh: false }));
    assert.match(chiamate.find((c) => c.host === "dc01.cliente.local")!.script, /EventRecordID>11/);
    const n = dbt().prepare("SELECT occurrence_count FROM wazuh_alert_event WHERE agent_name = 'dc01.cliente.local'").get() as { occurrence_count: number };
    assert.equal(n.occurrence_count, 2, "un record riletto non conta due volte");
  });

  it("i login vanno nell'archivio del dominio ma non nella coda degli allarmi", async () => {
    const login = { r: 20, t: "2026-10-29T08:00:00Z", id: 4768, d: { TargetUserName: "mrossi", IpAddress: "::ffff:10.0.0.7", Status: "0x0" } };
    const esegui: EseguiWinrm = async (host) => (host === "dc01.cliente.local" ? risposta([login]) : risposta([]));
    const e = await withTenant(T, () => giroEventiDc(dbt(), { esegui, wazuh: false }));
    assert.equal(e.aperti, 0);
    assert.equal((dbt().prepare("SELECT COUNT(*) AS n FROM wazuh_alert_event").get() as { n: number }).n, 0);
    assert.deepEqual(dbt().prepare("SELECT categoria, account, ip FROM dc_evento").all(), [{ categoria: "accesso", account: "mrossi", ip: "10.0.0.7" }]);
  });

  it("un DC che non risponde non ferma gli altri e tiene il suo cursore", async () => {
    dbt().prepare("INSERT INTO dc_lettura (dc, ultimo_record, esito) VALUES ('DC02', 77, 'ok')").run();
    const esegui: EseguiWinrm = async (host) => {
      if (host === "DC02") throw new Error("Porte WinRM 5985/5986 chiuse");
      return risposta([fallito(5, "mrossi")]);
    };
    const e = await withTenant(T, () => giroEventiDc(dbt(), { esegui, wazuh: false }));
    assert.deepEqual(e.dc.map((d) => [d.dc, d.ok]), [["DC02", false], ["dc01.cliente.local", true]]);
    const l = letturaDc(dbt(), "DC02")!;
    assert.equal(l.esito, "errore");
    assert.equal(l.ultimoRecord, 77);
    assert.match(l.errore ?? "", /chiuse/);
  });

  it("registro girato prima della lettura: gli eventi persi si contano", async () => {
    dbt().prepare("INSERT INTO dc_lettura (dc, ultimo_record, esito) VALUES ('dc01.cliente.local', 100, 'ok')").run();
    const esegui: EseguiWinrm = async (host) => (host === "dc01.cliente.local" ? risposta([fallito(400, "x")], 900, 300) : risposta([]));
    await withTenant(T, () => giroEventiDc(dbt(), { esegui, wazuh: false }));
    assert.equal(letturaDc(dbt(), "dc01.cliente.local")?.persi, 199);
  });

  it("il DC rifiuta il registro (manca Event Log Readers): errore dichiarato", async () => {
    const esegui: EseguiWinrm = async () => JSON.stringify({ nuovo: null, vecchio: null, errore: "Attempted to perform an unauthorized operation.", eventi: [] });
    const e = await withTenant(T, () => giroEventiDc(dbt(), { esegui, wazuh: false }));
    assert.ok(e.dc.every((d) => !d.ok && /registro Sicurezza/.test(d.errore ?? "")));
  });

  it("auto con Wazuh: non legge; sempre: legge; mai: non legge", async () => {
    let chiamate = 0;
    const esegui: EseguiWinrm = async () => (chiamate++, risposta([]));
    assert.equal((await withTenant(T, () => giroEventiDc(dbt(), { esegui, wazuh: true }))).saltato, "Wazuh legge già gli allarmi");
    scriviModoEventiDc(dbt(), "sempre");
    assert.equal((await withTenant(T, () => giroEventiDc(dbt(), { esegui, wazuh: true }))).saltato, null);
    scriviModoEventiDc(dbt(), "mai");
    assert.equal((await withTenant(T, () => giroEventiDc(dbt(), { esegui, wazuh: false }))).saltato, "spento per questo cliente");
    assert.equal(chiamate, 2);
  });
});
