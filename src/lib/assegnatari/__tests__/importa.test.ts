// «Importa da AD» e proposta sulla scheda dell'asset (piano 2026-10-23-assegnatari-da-ad, passo 5). Il DB è lo schema
// vero del tenant più la migrazione; gli utenti di AD hanno i campi come li scrive la sync (last_logon_at ISO con «Z»).
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { migrateAssegnatariAd } from "@/lib/db-tenant";
import { TENANT_SCHEMA_SQL } from "@/lib/db-tenant-schema";
import { elencoAssegnatari, registraAccessi } from "../db";
import { anteprimaImport, importaDaAd } from "../importa";
import { ErroreProposta, accettaProposta, propostaPerAsset, segnaCondiviso } from "../asset";

const OGGI = new Date("2026-10-23T10:00:00Z");
const ieri = "2026-10-22T16:00:00.000Z";

function dbProva(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(TENANT_SCHEMA_SQL);
  migrateAssegnatariAd(db);
  db.prepare("INSERT INTO ad_integrations (id, name, dc_host, domain, base_dn, encrypted_username, encrypted_password) VALUES (1, 'AD', 'dc', 'cliente.local', 'DC=cliente,DC=local', 'x', 'x')").run();
  const u = db.prepare(
    `INSERT INTO ad_users (integration_id, object_guid, sam_account_name, display_name, email, department, title, ou, enabled, last_logon_at, given_name, surname, raw_data)
     VALUES (1, ?, ?, ?, ?, ?, ?, 'Utenti/Sede', ?, ?, ?, ?, ?)`,
  );
  const gruppi = (g: string[]) => JSON.stringify({ memberOf: g });
  u.run("0000aaaa-0001", "s.colombo", "Sara Colombo", "s.colombo@cliente.it", "Acquisti", "Buyer", 1, ieri, "Sara", "Colombo", gruppi([]));
  u.run("0000aaaa-0002", "a.bianchi", "Anna Bianchi", "a.bianchi@cliente.it", "Amministrazione", "Contabile", 1, ieri, "Anna", "Bianchi", gruppi([]));
  u.run("0000aaaa-0003", "elena", "Elena", null, null, null, 1, "2026-10-11T09:00:00.000Z", "Elena", null, gruppi([]));
  u.run("0000aaaa-0004", "m.rossi2", "Marco Rossi", "marco.rossi@cliente.it", "Commerciale", "Agente", 1, ieri, "Marco", "Rossi", gruppi([]));
  u.run("0000aaaa-0005", "svc_backup", "Backup", null, null, null, 1, ieri, null, null, gruppi([]));
  u.run("0000aaaa-0006", "l.verdi", "Luca Verdi", "l.verdi@cliente.it", "Commerciale", "Agente", 0, "2026-09-01T09:00:00.000Z", "Luca", "Verdi", gruppi([]));
  u.run("0000aaaa-0007", "it.boss", "Capo IT", "it@cliente.it", "IT", "Resp", 1, ieri, "Capo", "IT", gruppi(["CN=Domain Admins,CN=Users,DC=cliente,DC=local"]));
  u.run("0000aaaa-0008", "f.russo", "Francesca Russo", "f.russo@cliente.it", "Qualità", "Resp", 1, "2025-01-01T09:00:00.000Z", "Francesca", "Russo", gruppi([]));
  // Già presenti: Anna inserita a mano con la stessa mail, un omonimo di Marco con un'altra mail.
  db.prepare("INSERT INTO asset_assignees (id, name, email) VALUES (1, 'Anna Bianchi', 'A.Bianchi@cliente.it')").run();
  db.prepare("INSERT INTO asset_assignees (id, name, email) VALUES (2, 'Marco Rossi', 'm.rossi@cliente.it')").run();
  return db;
}

const filtri = { soloAbilitati: true, conNomeCognome: true, giorniAccesso: 90 as number | null, ou: null };

test("anteprima: nuovi, da aggiornare, da controllare; esclusi col motivo; spunta di serie su nuovi e da aggiornare", () => {
  const db = dbProva();
  const a = anteprimaImport(db, filtri, 1, 50, OGGI);
  const esiti = Object.fromEntries(a.righe.map((r) => [r.account, `${r.esito}: ${r.dettaglio}`]));
  assert.deepEqual(esiti, {
    "s.colombo": "nuovo: Nuovo",
    "a.bianchi": "aggiorna: Già presente (stessa mail): si collega ad AD",
    elena: "controlla: Manca cognome e mail",
    "m.rossi2": "controlla: Omonimo di un assegnatario",
  });
  assert.deepEqual(a.contatori, { nuovo: 1, aggiorna: 1, controlla: 2, invariato: 0, esclusi: 4 });
  assert.deepEqual(a.esclusi.map((e) => [e.motivo, e.esempi]).sort(), [
    ["amministrativo", ["it.boss"]], ["disattivato", ["l.verdi"]], ["inattivo", ["f.russo"]], ["servizio", ["svc_backup"]],
  ]);
  assert.deepEqual(a.selezionatiDiSerie.sort(), ["1:0000aaaa-0001", "1:0000aaaa-0002"]);
  assert.deepEqual(a.ou, ["Utenti/Sede"]);
  // «sempre» e senza filtro sugli abilitati: Francesca entra, Luca anche.
  const tutti = anteprimaImport(db, { ...filtri, giorniAccesso: null, soloAbilitati: false }, 1, 50, OGGI);
  assert.ok(tutti.righe.some((r) => r.account === "f.russo"));
  assert.ok(tutti.righe.some((r) => r.account === "l.verdi"));
  // Paginazione: la seconda pagina da 2.
  assert.equal(anteprimaImport(db, filtri, 2, 2, OGGI).righe.length, 2);
});

test("importazione: crea, collega per mail, non tocca gli asset; la seconda volta aggiorna e basta", () => {
  const db = dbProva();
  db.prepare("INSERT INTO inventory_assets (id, hostname, asset_assignee_id) VALUES (5, 'PC-AMM-01', 1)").run();
  const r = importaDaAd(db, ["1:0000aaaa-0001", "1:0000aaaa-0002", "1:0000aaaa-0001", "1:ffffffff-9999"]);
  assert.deepEqual(r, { creati: 1, aggiornati: 1, saltati: 1 });
  assert.deepEqual(
    db.prepare("SELECT id, name, nome, cognome, email, reparto, ruolo, origine, ad_object_guid, ad_abilitato FROM asset_assignees WHERE origine = 'ad' ORDER BY id").all(),
    [
      { id: 1, name: "Anna Bianchi", nome: "Anna", cognome: "Bianchi", email: "a.bianchi@cliente.it", reparto: "Amministrazione", ruolo: "Contabile", origine: "ad", ad_object_guid: "0000aaaa-0002", ad_abilitato: 1 },
      { id: 3, name: "Sara Colombo", nome: "Sara", cognome: "Colombo", email: "s.colombo@cliente.it", reparto: "Acquisti", ruolo: "Buyer", origine: "ad", ad_object_guid: "0000aaaa-0001", ad_abilitato: 1 },
    ],
  );
  assert.equal((db.prepare("SELECT asset_assignee_id AS a FROM inventory_assets WHERE id = 5").get() as { a: number }).a, 1, "l'asset resta com'era");
  assert.deepEqual(importaDaAd(db, ["1:0000aaaa-0001"]), { creati: 0, aggiornati: 1, saltati: 0 });
  const dopo = anteprimaImport(db, filtri, 1, 50, OGGI);
  assert.equal(dopo.righe.find((x) => x.account === "s.colombo")?.esito, "invariato");
});

test("elenco: origine, numero di asset e avviso degli usciti da AD con asset", () => {
  const db = dbProva();
  importaDaAd(db, ["1:0000aaaa-0006"]);
  const luca = (db.prepare("SELECT id FROM asset_assignees WHERE ad_object_guid = '0000aaaa-0006'").get() as { id: number }).id;
  db.prepare("INSERT INTO inventory_assets (hostname, asset_assignee_id) VALUES ('NB-COM-07', ?), ('NB-COM-08', ?)").run(luca, luca);
  const e = elencoAssegnatari(db, { origine: null, cerca: null, soloUsciti: false, pagina: 1, perPagina: 50 });
  assert.deepEqual(e.usciti, { assegnatari: 1, asset: 2 });
  assert.equal(e.righe[0].name, "Luca Verdi", "gli usciti con asset in cima");
  assert.equal(e.righe[0].asset, 2);
  assert.match(String(e.righe[0].ad_disattivato_il), /^\d{4}-\d{2}-\d{2} /);
  assert.equal(elencoAssegnatari(db, { origine: "manuale", cerca: null, soloUsciti: false, pagina: 1, perPagina: 50 }).totale, 2);
  assert.equal(elencoAssegnatari(db, { origine: null, cerca: null, soloUsciti: true, pagina: 1, perPagina: 50 }).totale, 1);
});

function conAsset(db: Database.Database, categoria = "Desktop"): void {
  db.prepare("INSERT INTO networks (id, cidr, name) VALUES (1, '10.10.20.0/24', 'uffici')").run();
  db.prepare("INSERT INTO hosts (id, network_id, ip, hostname) VALUES (1, 1, '10.10.20.43', 'PC-ACQ-03')").run();
  db.prepare("INSERT INTO inventory_assets (id, hostname, host_id, categoria) VALUES (7, 'PC-ACQ-03', 1, ?)").run(categoria);
  const oggi = new Date().toISOString().slice(0, 10);
  registraAccessi(db, [
    { hostId: 1, account: "s.colombo", fonte: "wazuh_tastiera", giorno: oggi, conteggio: 14, ultimo: `${oggi} 17:52:00` },
    { hostId: 1, account: "s.colombo", fonte: "winrm", giorno: oggi, conteggio: 1, ultimo: `${oggi} 08:00:00` },
    { hostId: 1, account: "a.bianchi", fonte: "wazuh_tastiera", giorno: oggi, conteggio: 2, ultimo: `${oggi} 09:14:00` },
    { hostId: 1, account: "it.boss", fonte: "wazuh_tastiera", giorno: oggi, conteggio: 5, ultimo: `${oggi} 11:02:00` },
  ], "somma");
}

test("proposta sull'asset: la lettura non scrive; Accetta crea l'assegnatario e assegna, col diario", () => {
  const db = dbProva();
  conAsset(db);
  const p = propostaPerAsset(db, 7)!;
  assert.equal(p.esito, "proposta");
  assert.deepEqual([p.prevalente?.account, p.prevalente?.nome, p.prevalente?.accessi, p.prevalente?.totale], ["s.colombo", "Sara Colombo", 15, 17]);
  assert.equal(p.prevalente?.assegnatarioId, null, "Sara non è ancora un assegnatario");
  assert.deepEqual(p.righe.map((r) => [r.account, r.nelCalcolo, r.motivo]), [["s.colombo", true, null], ["a.bianchi", true, null], ["it.boss", false, "amministrativo"]]);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM asset_assignees").get() as { n: number }).n, 2, "nessuna scrittura in lettura");

  assert.throws(() => accettaProposta(db, 7, "a.bianchi", 1), (e: unknown) => e instanceof ErroreProposta && e.status === 409);
  const r = accettaProposta(db, 7, "S.Colombo", 1);
  assert.equal(r.nome, "Sara Colombo");
  assert.equal((db.prepare("SELECT asset_assignee_id AS a FROM inventory_assets WHERE id = 7").get() as { a: number }).a, r.assegnatarioId);
  assert.deepEqual(db.prepare("SELECT user_id, field_name, old_value, new_value FROM inventory_audit_log WHERE asset_id = 7").all(), [
    { user_id: 1, field_name: "asset_assignee_id", old_value: null, new_value: String(r.assegnatarioId) },
  ]);
  const dopo = propostaPerAsset(db, 7)!;
  assert.equal(dopo.assegnato?.nome, "Sara Colombo");
  assert.equal(dopo.prevalente?.assegnatarioId, r.assegnatarioId);
});

test("PC condiviso: niente proposta finché non si toglie; server esclusi; asset assente null", () => {
  const db = dbProva();
  conAsset(db);
  segnaCondiviso(db, 7, true, 1);
  const p = propostaPerAsset(db, 7)!;
  assert.deepEqual([p.esito, p.perche, p.propostaOff], ["esclusa", "segnato_condiviso", true]);
  segnaCondiviso(db, 7, false, 1);
  assert.equal(propostaPerAsset(db, 7)!.esito, "proposta");
  db.prepare("UPDATE inventory_assets SET categoria = 'Server' WHERE id = 7").run();
  assert.equal(propostaPerAsset(db, 7)!.perche, "categoria");
  assert.equal(propostaPerAsset(db, 999), null);
  assert.throws(() => segnaCondiviso(db, 999, true, 1), (e: unknown) => e instanceof ErroreProposta && e.status === 404);
});

test("l'host dell'asset arriva anche dall'apparato collegato (32 asset su 34 sull'hub .8 avevano solo network_device_id)", () => {
  const db = dbProva();
  conAsset(db);
  db.exec("ALTER TABLE network_devices ADD COLUMN host_id INTEGER REFERENCES hosts(id) ON DELETE SET NULL");
  db.prepare("INSERT INTO network_devices (id, name, host, device_type, vendor, protocol, enabled, host_id) VALUES (3, 'PC', '10.10.20.43', 'server', 'windows', 'winrm', 1, 1)").run();
  db.prepare("INSERT INTO inventory_assets (id, hostname, network_device_id, categoria) VALUES (8, 'PC-ACQ-03', 3, 'Desktop')").run();
  const p = propostaPerAsset(db, 8)!;
  assert.equal(p.hostId, 1);
  assert.equal(p.esito, "proposta");
});
