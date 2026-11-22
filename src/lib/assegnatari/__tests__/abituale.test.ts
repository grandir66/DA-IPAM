// Utente abituale in Apparati (Riccardo, 23/11/2026): chi vince fra scelta a mano, assegnatario dell'asset e calcolo,
// e che la scelta a mano resista al ricalcolo. Stessa forma dei dati di `abbinamenti.test.ts` (misura sull'hub .8).
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { migrateAssegnatariAd } from "@/lib/db-tenant";
import { TENANT_SCHEMA_SQL } from "@/lib/db-tenant-schema";
import { registraAccessi } from "../db";
import { ErroreScelta, impostaUtenteAbituale, utentiAbituali, utentiSceglibili } from "../abituale";

function dbProva(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(TENANT_SCHEMA_SQL);
  migrateAssegnatariAd(db);
  db.prepare("INSERT INTO ad_integrations (id, name, dc_host, domain, base_dn, encrypted_username, encrypted_password) VALUES (1, 'AD', 'dc', 'cliente.local', 'DC=x', 'x', 'x')").run();
  const u = db.prepare("INSERT INTO ad_users (integration_id, object_guid, sam_account_name, display_name, enabled, given_name, surname) VALUES (1, ?, ?, ?, ?, ?, ?)");
  u.run("g-1", "marzia", "Marzia Miari", 1, "Marzia", "Miari");
  u.run("g-2", "donato", "Donato Apadula", 1, "Donato", "Apadula");
  u.run("g-3", "massimo", "Massimo Malagola", 1, "Massimo", "Malagola");
  u.run("g-4", "s.annovi", "Simone Annovi", 1, "Simone", "Annovi");
  u.run("g-5", "uscito", "Ugo Uscito", 0, "Ugo", "Uscito");
  db.prepare("INSERT INTO networks (id, cidr, name) VALUES (1, '192.168.4.0/24', 'lan')").run();
  const h = db.prepare("INSERT INTO hosts (id, network_id, ip, hostname, classification) VALUES (?, 1, ?, ?, ?)");
  h.run(1, "192.168.4.132", "PC-MIARI", "workstation");
  h.run(2, "192.168.4.8", "da-sns", "server");
  h.run(3, "192.168.4.160", "PC-MAX", "workstation");
  h.run(4, "192.168.4.170", "PC-POCHI", "workstation");
  h.run(5, "192.168.4.171", "PC-SALA", "workstation");
  h.run(6, "192.168.4.172", "PC-MUTO", "workstation");
  // PC-MAX ha un asset NIS2 assegnato a Simone, ma lo usa Massimo.
  db.prepare("INSERT INTO asset_assignees (id, name, ad_integration_id, ad_object_guid, origine) VALUES (50, 'Simone Annovi', 1, 'g-4', 'ad')").run();
  db.prepare("INSERT INTO inventory_assets (id, hostname, host_id, categoria, asset_assignee_id) VALUES (11, 'PC-MAX', 3, 'Desktop', 50)").run();
  const oggi = new Date().toISOString().slice(0, 10);
  const a = (hostId: number, account: string, n: number, fonte: "wazuh_tastiera" | "wazuh_rete" = "wazuh_tastiera") =>
    ({ hostId, account, fonte, giorno: oggi, conteggio: n, ultimo: `${oggi} 10:00:00` });
  registraAccessi(db, [
    a(1, "marzia", 108), a(2, "donato", 9, "wazuh_rete"), a(3, "massimo", 36, "wazuh_rete"), a(4, "marzia", 2),
    a(5, "marzia", 10), a(5, "donato", 10),
  ], "somma");
  return db;
}

test("senza interventi: calcolato dove c'è una persona prevalente, asset assegnato = a mano, server e pochi dati vuoti", () => {
  const m = utentiAbituali(dbProva());
  assert.deepEqual(m.get(1), {
    origine: "calcolato", aMano: false, nome: "Marzia Miari", account: "marzia", disattivato: false, diverso: false,
    calcolo: { nome: "Marzia Miari", account: "marzia", accessi: 108, totale: 108, base: "tastiera" },
  });
  assert.equal(m.has(2), false, "un server non ha utente abituale");
  const max = m.get(3)!;
  assert.deepEqual([max.origine, max.aMano, max.nome, max.account, max.diverso, max.calcolo?.account], ["manuale", true, "Simone Annovi", "s.annovi", true, "massimo"]);
  assert.equal(m.has(4), false, "pochi dati: niente");
  assert.deepEqual([m.get(5)?.origine, m.get(5)?.aMano], ["condiviso", false]);
  assert.equal(m.has(6), false);
});

test("la scelta a mano vince sul calcolo e resiste a nuovi accessi; «auto» torna al calcolo", () => {
  const db = dbProva();
  assert.deepEqual(impostaUtenteAbituale(db, [1, 6], { modo: "manuale", account: "DONATO" }, 7), { scritti: 2, assetAllineati: 0 });
  const oggi = new Date().toISOString().slice(0, 10);
  registraAccessi(db, [{ hostId: 1, account: "marzia", fonte: "wazuh_tastiera", giorno: oggi, conteggio: 500, ultimo: null }], "somma");
  let m = utentiAbituali(db);
  assert.deepEqual([m.get(1)?.origine, m.get(1)?.nome, m.get(1)?.diverso, m.get(1)?.calcolo?.account], ["manuale", "Donato Apadula", true, "marzia"]);
  assert.deepEqual([m.get(6)?.origine, m.get(6)?.nome, m.get(6)?.diverso], ["manuale", "Donato Apadula", false], "host senza accessi: si vede lo stesso");
  impostaUtenteAbituale(db, [1], { modo: "auto" }, 7);
  m = utentiAbituali(db);
  assert.deepEqual([m.get(1)?.origine, m.get(1)?.account], ["calcolato", "marzia"]);
});

test("con un asset NIS2: l'assegnatario si allinea con il diario; «auto» lo toglie; «condiviso» segna l'asset", () => {
  const db = dbProva();
  assert.deepEqual(impostaUtenteAbituale(db, [3], { modo: "manuale", account: "massimo" }, 7), { scritti: 1, assetAllineati: 1 });
  const asset = () => db.prepare("SELECT asset_assignee_id AS a, proposta_assegnatario_off AS off FROM inventory_assets WHERE id = 11").get() as { a: number | null; off: number };
  const massimo = (db.prepare("SELECT id FROM asset_assignees WHERE ad_object_guid = 'g-3'").get() as { id: number }).id;
  assert.equal(asset().a, massimo, "assegnatario creato da AD e messo sull'asset");
  let v = utentiAbituali(db).get(3)!;
  assert.deepEqual([v.origine, v.nome, v.diverso], ["manuale", "Massimo Malagola", false]);
  impostaUtenteAbituale(db, [3], { modo: "condiviso" }, 7);
  assert.deepEqual(asset(), { a: massimo, off: 1 });
  v = utentiAbituali(db).get(3)!;
  assert.deepEqual([v.origine, v.aMano], ["condiviso", true]);
  impostaUtenteAbituale(db, [3], { modo: "auto" }, 7);
  assert.deepEqual(asset(), { a: null, off: 0 });
  v = utentiAbituali(db).get(3)!;
  assert.deepEqual([v.origine, v.account], ["calcolato", "massimo"]);
  const diario = db.prepare("SELECT field_name, old_value, new_value, user_id FROM inventory_audit_log WHERE asset_id = 11 ORDER BY id").all();
  assert.equal(diario.length, 4);
  assert.deepEqual(diario[0], { field_name: "asset_assignee_id", old_value: "50", new_value: String(massimo), user_id: 7 });
});

test("utente scelto a mano poi disattivato in AD: resta, segnato da riassegnare; account inesistente rifiutato senza scrivere", () => {
  const db = dbProva();
  impostaUtenteAbituale(db, [6], { modo: "manuale", account: "s.annovi" }, null);
  db.prepare("UPDATE ad_users SET enabled = 0 WHERE object_guid = 'g-4'").run();
  const v = utentiAbituali(db).get(6)!;
  assert.deepEqual([v.nome, v.disattivato], ["Simone Annovi", true]);
  assert.throws(() => impostaUtenteAbituale(db, [4], { modo: "manuale", account: "nessuno" }, null), ErroreScelta);
  assert.equal(utentiAbituali(db).has(4), false);
  assert.deepEqual(utentiSceglibili(db).map((u) => u.account), ["donato", "marzia", "massimo"], "solo gli abilitati, per nome");
});

test("migrazione: le colonne sugli host ci sono e un secondo giro non aggiunge niente", () => {
  const db = dbProva();
  const col = (db.prepare("PRAGMA table_info(hosts)").all() as Array<{ name: string }>).map((c) => c.name);
  for (const c of ["utente_abituale_modo", "utente_abituale_integrazione", "utente_abituale_guid"]) assert.ok(col.includes(c), c);
  assert.deepEqual(migrateAssegnatariAd(db), []);
});
