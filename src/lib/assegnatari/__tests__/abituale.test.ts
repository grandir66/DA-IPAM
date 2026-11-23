// Utente abituale in Apparati (Riccardo, 23/11/2026): chi vince fra scelta a mano, assegnatario dell'asset e calcolo,
// e che la scelta a mano resista al ricalcolo. Stessa forma dei dati di `abbinamenti.test.ts` (misura sull'hub .8).
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { migrateAssegnatariAd } from "@/lib/db-tenant";
import { TENANT_SCHEMA_SQL } from "@/lib/db-tenant-schema";
import { registraAccessi } from "../db";
import { ErroreScelta, impostaUtenteAbituale, utentiAbituali, utentiSceglibili } from "../abituale";
import { leggiDescrizioneAd } from "../descrizione-ad";

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
    calcolo: { nome: "Marzia Miari", account: "marzia", fonte: "accessi", accessi: 108, totale: 108, base: "tastiera", il: null, computer: null },
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

// Descrizione del computer di AD scritta dallo script di accesso (formato vero del 70791, 23/11/2026).
const gg = (giorniFa: number) => { const d = new Date(Date.now() - giorniFa * 86_400_000); return `${d.getUTCDate()}/${d.getUTCMonth() + 1}/${d.getUTCFullYear()}`; };
function conComputer(db: Database.Database, nome: string, hostId: number | null, descr: string, os = "Windows 11 Pro"): void {
  db.prepare("INSERT INTO ad_computers (integration_id, object_guid, sam_account_name, distinguished_name, operating_system, enabled, host_id, raw_data) VALUES (1, ?, ?, ?, ?, 1, ?, ?)")
    .run(`c-${nome}`, `${nome}$`, `CN=${nome}`, os, hostId, JSON.stringify({ description: descr }));
}

test("descrizione di AD: formato dello script di accesso letto, altri formati e date impossibili scartati", () => {
  assert.deepEqual(leggiDescrizioneAd("donato - 23/11/2026 - OS: Microsoft Windows 11 Pro sp 0 - IP: 192.168.4.174 - HP EliteDesk"),
    { account: "donato", giorno: "2026-11-23", ip: "192.168.4.174" });
  assert.deepEqual(leggiDescrizioneAd(["DOMARC\\Massimo - 1/9/2026 - OS: Windows 10"]), { account: "massimo", giorno: "2026-09-01", ip: null });
  assert.equal(leggiDescrizioneAd("Server di stampa piano terra"), null);
  assert.equal(leggiDescrizioneAd("donato - 31/02/2026 - OS: x"), null);
  assert.equal(leggiDescrizioneAd(null), null);
});

test("descrizione di AD: vale dove gli accessi non bastano; gli accessi vincono; vecchia, server o di servizio no", () => {
  const db = dbProva();
  db.prepare("INSERT INTO ad_users (integration_id, object_guid, sam_account_name, display_name, enabled, given_name, surname) VALUES (1, 'g-9', 'scanner', 'Scanner Sala', 1, 'Scanner', 'Sala')").run();
  const h = db.prepare("INSERT INTO hosts (id, network_id, ip, hostname, classification) VALUES (?, 1, ?, ?, ?)");
  h.run(7, "192.168.4.174", "PC-APADULA", "workstation");
  h.run(8, "192.168.4.180", "PC-VECCHIO", "workstation");
  h.run(9, "192.168.6.22", null, null);
  h.run(10, "192.168.4.181", "PC-SCANNER", "workstation");
  conComputer(db, "PC-APADULA", 7, `donato - ${gg(1)} - OS: Microsoft Windows 11 Pro sp 0 - IP: 192.168.4.174 - HP`);
  conComputer(db, "PC-POCHI", 4, `massimo - ${gg(2)} - OS: Windows 11 - IP: 192.168.4.170`);
  conComputer(db, "PC-MIARI", 1, `donato - ${gg(0)} - OS: Windows 11 - IP: 192.168.4.132`);
  conComputer(db, "PC-VECCHIO", 8, `donato - ${gg(45)} - OS: Windows 11 - IP: 192.168.4.180`);
  conComputer(db, "HP-CATS", null, `massimo - ${gg(3)} - OS: Windows 11 - IP: 192.168.6.22`);
  conComputer(db, "DA-SNS", 2, `donato - ${gg(1)} - OS: Windows Server 2019 - IP: 192.168.4.8`, "Windows Server 2019 Standard");
  conComputer(db, "PC-SCANNER", 10, `scanner - ${gg(1)} - OS: Windows 10 - IP: 192.168.4.181`);
  const m = utentiAbituali(db);
  assert.deepEqual([m.get(7)?.origine, m.get(7)?.account, m.get(7)?.calcolo?.fonte, m.get(7)?.calcolo?.computer], ["calcolato", "donato", "ad", "PC-APADULA"]);
  assert.deepEqual([m.get(4)?.account, m.get(4)?.calcolo?.fonte], ["massimo", "ad"], "pochi dati negli accessi: vale AD");
  assert.deepEqual([m.get(1)?.account, m.get(1)?.calcolo?.fonte], ["marzia", "accessi"], "gli accessi vincono sull'ultimo utente di AD");
  assert.equal(m.has(8), false, "descrizione più vecchia della finestra");
  assert.deepEqual([m.get(9)?.account, m.get(9)?.calcolo?.computer], ["massimo", "HP-CATS"], "computer non legato: host trovato con l'IP della descrizione");
  assert.equal(m.get(2), undefined, "server: niente");
  assert.equal(m.has(10), false, "account di servizio: niente");
  assert.equal(m.get(5)?.origine, "condiviso");
  impostaUtenteAbituale(db, [7], { modo: "manuale", account: "massimo" }, null);
  const v = utentiAbituali(db).get(7)!;
  assert.deepEqual([v.origine, v.account, v.diverso, v.calcolo?.account], ["manuale", "massimo", true, "donato"], "a mano vince, AD diverso segnalato");
});
