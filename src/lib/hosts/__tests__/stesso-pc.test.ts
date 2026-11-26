// Lo stesso PC su più righe d'host (Riccardo, 23/11/2026: «se lo stesso pc cambia ip dovrebbe riaggiornare i dati
// mantenendo lo storico, ma senza avere una moltiplicazione di oggetti»). Casi misurati sul 70791 lo stesso giorno:
// NB-AGUZZOLI su 3 righe (riga mostrata 3.108 offline, utente e AD sulle altre), PC-LasagniF su 2 righe della stessa
// rete mai riunite, SURFACE-ALAIN con Wi-Fi, cavo e dock (3 MAC veri), NB-MAX unito a quattro «Mac» da un seriale.
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { migrateAssegnatariAd, recomputeMultihomedLinks } from "@/lib/db-tenant";
import { TENANT_SCHEMA_SQL } from "@/lib/db-tenant-schema";
import { leggiClusterDiscovery } from "@/lib/devices/cluster-discovery";
import { confrontaPrincipale, serialeConNomiMisti } from "../ancore-gruppo";
import { indirizziPassati } from "../pulizia-candidati";
import { calcolaVoci } from "@/lib/assegnatari/abbinamenti";
import { impostaUtenteAbituale, utentiAbituali } from "@/lib/assegnatari/abituale";
import { registraAccessi } from "@/lib/assegnatari/db";

const oggi = new Date().toISOString().slice(0, 10);
const fa = (g: number) => new Date(Date.now() - g * 86_400_000).toISOString().replace("T", " ").slice(0, 19);
const dataAd = (g: number) => { const d = new Date(Date.now() - g * 86_400_000); return `${d.getUTCDate()}/${d.getUTCMonth() + 1}/${d.getUTCFullYear()}`; };

function dbProva(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(TENANT_SCHEMA_SQL);
  migrateAssegnatariAd(db);
  // La aggiunge un ALTER all'apertura del tenant: la vuole la lettura dei gruppi di Apparati.
  db.exec("ALTER TABLE network_devices ADD COLUMN host_id INTEGER REFERENCES hosts(id) ON DELETE SET NULL");
  db.prepare("INSERT INTO ad_integrations (id, name, dc_host, domain, base_dn, encrypted_username, encrypted_password) VALUES (1, 'AD', 'dc', 'cliente.local', 'DC=x', 'x', 'x')").run();
  db.prepare("INSERT INTO ad_users (integration_id, object_guid, sam_account_name, display_name, enabled, given_name, surname) VALUES (1, 'g-1', 'l.aguzzoli', 'Luca Aguzzoli', 1, 'Luca', 'Aguzzoli')").run();
  db.prepare("INSERT INTO ad_users (integration_id, object_guid, sam_account_name, display_name, enabled, given_name, surname) VALUES (1, 'g-2', 'francesca', 'Francesca Lasagni', 1, 'Francesca', 'Lasagni')").run();
  const n = db.prepare("INSERT INTO networks (id, cidr, name) VALUES (?, ?, ?)");
  n.run(4, "192.168.5.0/24", "lan"); n.run(9, "192.168.3.0/24", "wifi"); n.run(1, "192.168.4.0/24", "server");
  const h = db.prepare("INSERT INTO hosts (id, network_id, ip, mac, hostname, classification, status, last_seen, serial_number) VALUES (?, ?, ?, ?, ?, 'workstation', ?, ?, ?)");
  h.run(552, 4, "192.168.5.150", "E8:EA:6A:8C:68:3C", "NB-AGUZZOLI", "online", fa(0), null);
  h.run(592, 9, "192.168.3.108", "C0:A8:10:26:85:81", "NB-AGUZZOLI", "offline", fa(0), null);
  h.run(549, 4, "192.168.5.123", "C0:A8:10:26:85:81", "NB-AGUZZOLI", "offline", fa(4), null);
  h.run(555, 4, "192.168.5.156", "54:B2:03:8D:5D:0B", "PC-LasagniF", "offline", fa(0), null);
  h.run(554, 4, "192.168.5.154", "54:B2:03:8D:5D:0C", "PC-LasagniF", "offline", fa(5), null);
  h.run(281, 4, "192.168.5.178", "B8:31:B5:36:DD:CD", "SURFACE-ALAIN", "online", fa(0), null);
  h.run(601, 9, "192.168.3.122", "E4:0D:36:18:CE:4B", "SURFACE-ALAIN", "online", fa(0), null);
  h.run(276, 4, "192.168.5.164", "CC:12:28:55:A0:9E", "SURFACE-ALAIN", "offline", fa(3), null);
  h.run(279, 4, "192.168.5.162", "E4:0D:36:18:CE:4B", "SURFACE-ALAIN", "offline", fa(4), null);
  h.run(585, 9, "192.168.3.106", "D0:65:78:D4:21:E6", "NB-MAX", "online", fa(0), "C02XYZ123ABC");
  h.run(637, 1, "192.168.4.177", "B6:51:CD:52:C6:4C", "Mac", "online", fa(0), "C02XYZ123ABC");
  h.run(372, 4, "192.168.5.193", "2E:37:B4:98:4D:69", "Mac", "offline", fa(4), "C02XYZ123ABC");
  h.run(700, 4, "192.168.5.20", "00:11:22:33:44:55", "stampante-1", "online", fa(0), null);
  h.run(701, 4, "192.168.5.21", "00:11:22:33:44:66", "stampante-1", "online", fa(0), null);
  const c = db.prepare("INSERT INTO ad_computers (integration_id, object_guid, sam_account_name, distinguished_name, operating_system, enabled, host_id, raw_data) VALUES (1, ?, ?, ?, 'Windows 11 Pro', 1, ?, ?)");
  c.run("c-1", "NB-AGUZZOLI$", "CN=NB-AGUZZOLI", 549, JSON.stringify({ description: `l.aguzzoli - ${dataAd(1)} - OS: Windows 11 - IP: 192.168.5.150` }));
  c.run("c-2", "PC-LASAGNIF$", "CN=PC-LASAGNIF", 554, JSON.stringify({ description: `francesca - ${dataAd(0)} - OS: Windows 11` }));
  c.run("c-3", "SURFACE-ALAIN$", "CN=SURFACE-ALAIN", 276, null);
  c.run("c-4", "NB-MAX$", "CN=NB-MAX", null, null);
  recomputeMultihomedLinks(db);
  return db;
}

const gruppoDi = (db: Database.Database, id: number) => (db.prepare("SELECT group_id FROM multihomed_links WHERE host_id = ?").get(id) as { group_id: string } | undefined)?.group_id ?? null;
const primarioDi = (db: Database.Database, id: number) => (db.prepare("SELECT host_id FROM multihomed_links WHERE group_id = ? AND is_primary = 1").get(gruppoDi(db, id)) as { host_id: number } | undefined)?.host_id ?? null;

test("regole pure: seriale con nomi misti; principale = gestito, poi viva e recente, poi IP", () => {
  assert.equal(serialeConNomiMisti(["NB-MAX", "Mac", "Mac.local"]), true);
  assert.equal(serialeConNomiMisti(["RB4011", "rb4011.lan", null]), false);
  assert.equal(serialeConNomiMisti(["Mac", "iPhone"]), false);
  const ip = (s: string) => Number(s.split(".").join(""));
  const m = (p: Partial<{ has_device: number; ip: string; status: string; last_seen: string }>) => ({ has_device: 0, ip: "10.0.0.9", status: "offline", last_seen: "2026-11-01 10:00:00", ...p });
  assert.ok(confrontaPrincipale(m({ has_device: 1 }), m({ status: "online" }), ip) < 0, "il gestito vince sulla viva");
  assert.ok(confrontaPrincipale(m({ status: "online", ip: "10.0.0.9" }), m({ ip: "10.0.0.1" }), ip) < 0, "la viva vince sull'IP basso");
  assert.ok(confrontaPrincipale(m({ last_seen: "2026-11-23 09:00:00" }), m({ last_seen: "2026-11-19 09:00:00", ip: "10.0.0.1" }), ip) < 0);
  assert.ok(confrontaPrincipale(m({ last_seen: "2026-11-23 18:00:00", ip: "10.0.0.2" }), m({ last_seen: "2026-11-23 08:00:00", ip: "10.0.0.1" }), ip) > 0, "stesso giorno: IP basso, niente scambi");
});

test("gruppi: PC di AD riuniti anche nella stessa rete e con tre MAC; principale la riga viva; seriale misto e omonimi senza AD no", () => {
  const db = dbProva();
  assert.ok(gruppoDi(db, 552) && gruppoDi(db, 552) === gruppoDi(db, 592) && gruppoDi(db, 552) === gruppoDi(db, 549));
  assert.equal(primarioDi(db, 552), 552, "NB-AGUZZOLI: la riga viva 5.150, non 3.108 (IP più basso, offline)");
  assert.ok(gruppoDi(db, 555) && gruppoDi(db, 555) === gruppoDi(db, 554), "PC-LasagniF: stessa rete, prima mai riunite");
  assert.equal(primarioDi(db, 555), 555, "la riga vista per ultima");
  assert.ok([281, 601, 276, 279].every((id) => gruppoDi(db, id) === gruppoDi(db, 281)), "SURFACE-ALAIN: tre MAC veri, un PC solo");
  assert.notEqual(gruppoDi(db, 585), gruppoDi(db, 637) ?? "nessuno", "NB-MAX non sta con i «Mac»");
  assert.equal(gruppoDi(db, 700), null, "due stampanti omonime nella stessa rete, senza AD: come prima, niente gruppo");
  const cl = leggiClusterDiscovery(db);
  assert.equal(cl.get(549)?.principale_host_id, 552);
  // Vivo su due reti lo stesso giorno (Wi-Fi 3.122, cavo 5.178): l'IP più basso, per non saltare a ogni scansione.
  assert.equal(cl.get(279)?.principale_host_id, 601, "Apparati accorpa anche con tre MAC veri, su una riga viva");
  assert.equal(cl.get(276)?.principale_host_id, 601);
  assert.equal(cl.get(554)?.principale_host_id, 555);
});

test("dati che seguono il PC: una voce sola, accessi sommati, AD di una riga vecchia, scelta a mano su tutte le righe", () => {
  const db = dbProva();
  registraAccessi(db, [{ hostId: 592, account: "l.aguzzoli", fonte: "wazuh_rete", giorno: oggi, conteggio: 3, ultimo: null }], "somma");
  const voci = calcolaVoci(db).voci;
  const agu = voci.filter((v) => v.pc === "NB-AGUZZOLI");
  assert.equal(agu.length, 1, "una voce per NB-AGUZZOLI, non tre");
  assert.deepEqual([agu[0].hostId, agu[0].persona?.account, agu[0].fonte], [552, "l.aguzzoli", "ad"], "AD della riga 5.123, sulla riga viva");
  const las = voci.filter((v) => v.pc === "PC-LasagniF");
  assert.deepEqual(las.map((v) => [v.hostId, v.persona?.account]), [[555, "francesca"]]);
  let m = utentiAbituali(db);
  assert.deepEqual([549, 552, 592].map((id) => m.get(id)?.account), ["l.aguzzoli", "l.aguzzoli", "l.aguzzoli"]);
  impostaUtenteAbituale(db, [549], { modo: "manuale", account: "francesca" }, null);
  const scritte = db.prepare("SELECT COUNT(*) AS n FROM hosts WHERE utente_abituale_modo = 'manuale' AND id IN (549, 552, 592)").get() as { n: number };
  assert.equal(scritte.n, 3, "la scelta va su tutte le righe del PC");
  m = utentiAbituali(db);
  assert.deepEqual([m.get(552)?.origine, m.get(552)?.account, m.get(552)?.diverso], ["manuale", "francesca", true]);
});

test("archivio: la riga passata di un PC di AD torna archiviabile; MAC vero senza AD resta protetto", () => {
  const r = (id: number, last: string, tipo: string | null, mac = "54:B2:03:8D:5D:0C") =>
    ({ id, mac, hostname: "PC-LasagniF", gruppo: "g", tipo_gruppo: tipo, last_seen: last, escluso: "gruppo multihomed", recuperato: 0, sessioni: 0 });
  assert.deepEqual([...indirizziPassati([r(1, "2026-11-23", "ad_dns"), r(2, "2026-10-01", "ad_dns")])], [2]);
  assert.deepEqual([...indirizziPassati([r(1, "2026-11-23", "hostname"), r(2, "2026-10-01", "hostname")])], []);
});

test("nome dell'apparato: la riga viva senza nome prende quello delle altre righe (telecamere dalla VLAN 15 alla 70)", async () => {
  const { nomeDelGruppo } = await import("@/lib/devices/cluster-discovery");
  const m = (host_id: number, nome: string | null) => ({ host_id, ip: `10.0.0.${host_id}`, network_id: 1, network_name: "x", status: "online", ha_apparato: false, nome });
  assert.equal(nomeDelGruppo([m(1, null), m(2, "CAM-INGRESSO")], 1), "CAM-INGRESSO");
  assert.equal(nomeDelGruppo([m(1, "192.168.70.189"), m(2, "CAM-INGRESSO")], 1), "CAM-INGRESSO", "un indirizzo non è un nome");
  assert.equal(nomeDelGruppo([m(1, "NB-AGUZZOLI"), m(2, "altro")], 1), "NB-AGUZZOLI", "il nome della principale vince");
  assert.equal(nomeDelGruppo([m(1, null), m(2, null)], 1), null);
});

test("PC di AD con più apparati gestiti (uno per IP, apparati automatici): accorpato, principale la riga viva", () => {
  const db = dbProva();
  const nd = db.prepare("INSERT INTO network_devices (name, host, device_type, vendor, protocol, enabled, host_id) VALUES (?, ?, 'switch', 'windows', 'winrm', 1, ?)");
  nd.run("NB-AGUZZOLI", "192.168.3.108", 592);
  nd.run("SURFACE-ALAIN.domarc.it", "192.168.5.164", 276);
  nd.run("SURFACE-ALAIN", "192.168.5.178", 281);
  recomputeMultihomedLinks(db);
  const cl = leggiClusterDiscovery(db);
  assert.equal(cl.get(592)?.principale_host_id, 552, "l'apparato su 3.108 offline non vince sulla riga viva 5.150");
  assert.equal(cl.get(276)?.principale_host_id, 601, "due apparati nello stesso PC: non è ambiguo, vince una riga viva");
  assert.equal(cl.get(601)?.principale, true);
});

test("PC di AD salvato come gruppo per seriale, con due apparati: Apparati lo riconosce dal nome e accorpa", () => {
  const db = dbProva();
  db.prepare("UPDATE hosts SET serial_number = 'PF3ABCDE' WHERE id IN (554, 555)").run();
  const nd = db.prepare("INSERT INTO network_devices (name, host, device_type, vendor, protocol, enabled, host_id) VALUES (?, ?, 'switch', 'windows', 'winrm', 1, ?)");
  nd.run("PC-LasagniF.domarc.it", "192.168.5.154", 554);
  nd.run("PC-LasagniF", "192.168.5.156", 555);
  recomputeMultihomedLinks(db);
  assert.equal((db.prepare("SELECT match_type FROM multihomed_links WHERE host_id = 555").get() as { match_type: string }).match_type, "serial_number");
  const cl = leggiClusterDiscovery(db);
  assert.equal(cl.get(554)?.principale_host_id, 555, "la riga vista per ultima, non ambiguo");
});
