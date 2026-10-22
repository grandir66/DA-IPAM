/**
 * A-IPAM, Task 4: i campi «Mai nell'inventario» (spec §5.4) non escono, nemmeno per
 * sbaglio. DB temporaneo con lo schema vero, ogni campo vietato riempito con
 * `SENTINELLA-<campo>`: la fotografia costruita da `leggiDatiInventario` +
 * `corpoInventario` non deve contenerne nessuno, a nessuna profondità.
 * In più la prova statica sul testo SQL di `dati-inventario.ts`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { TENANT_SCHEMA_SQL } from "@/lib/db-tenant-schema";
import { leggiDatiInventario } from "../dati-inventario";
import { CAMPI_OGGETTO, corpoInventario } from "../corpo-inventario";
import { SchemaInventarioHub } from "./fixtures/schemi-hub";

const TESTA = { codcli: "70791", nodo: "nodo-1", versione: "0.9.868", adesso: new Date("2026-10-22T09:00:00.000Z") };

function dbSentinella(): Database.Database {
  const db = new Database(":memory:");
  db.exec(TENANT_SCHEMA_SQL);
  const s = (c: string) => `SENTINELLA-${c}`;
  db.prepare("INSERT INTO locations (id, name, address) VALUES (1, 'Sede A', ?)").run(s("address"));
  db.prepare(
    `INSERT INTO networks (id, cidr, name, description, gateway, vlan_id, location, snmp_community, dns_server, location_id)
     VALUES (1, '10.0.0.0/24', 'LAN', ?, '10.0.0.254', 10, ?, 'SENTINELLA-community', ?, 1)`,
  ).run(s("description"), s("location"), s("dns_server"));
  db.prepare(
    `INSERT INTO hosts (id, network_id, ip, mac, vendor, hostname, dns_forward, dns_reverse, custom_name, classification,
       server_roles, inventory_code, notes, status, open_ports, os_info, model, serial_number, firmware, device_manufacturer,
       detection_json, snmp_data, classification_reason, classification_json, monitor_ports, hostname_source, conflict_flags,
       first_seen, last_seen, host_source)
     VALUES (1, 1, '10.0.0.5', 'aa:bb:cc:dd:ee:ff', 'Dell', 'srv-01', ?, NULL, NULL, 'server',
       ?, ?, ?, 'online', ?, 'Windows Server 2012 R2', 'R740', 'SN1', '2.1', 'Dell',
       ?, ?, ?, ?, ?, ?, ?, '2026-04-27 12:49:22', '2026-10-22 08:15:37', 'scan')`,
  ).run(
    s("dns_forward"), s("server_roles"), s("inventory_code"), s("notes"),
    JSON.stringify([{ port: 445, protocol: "tcp", service: "microsoft-ds", version: null }]),
    s("detection_json"), s("snmp_data"), s("classification_reason"), s("classification_json"), s("monitor_ports"),
    s("hostname_source"), s("conflict_flags"),
  );
  db.prepare("INSERT INTO hosts (id, network_id, ip, status, first_seen, last_seen) VALUES (2, 1, '10.0.0.6', 'offline', '2026-05-01 10:00:00', '2026-05-02 10:00:00')").run();
  db.prepare(
    `INSERT INTO credentials (id, name, credential_type, encrypted_username, encrypted_password, encrypted_private_key)
     VALUES (1, ?, 'ssh', ?, ?, ?)`,
  ).run(s("cred-name"), s("username"), s("password"), s("private_key"));
  db.prepare("INSERT INTO host_credentials (host_id, credential_id, protocol_type, port) VALUES (1, 1, 'ssh', 22)").run();
  db.prepare("INSERT INTO asset_assignees (id, name, email, phone, note) VALUES (1, ?, ?, ?, ?)").run(s("assegnatario"), s("email"), s("phone"), s("note"));
  db.prepare("INSERT INTO licenses (id, name, serial, note) VALUES (1, ?, ?, ?)").run(s("licenza"), s("serial"), s("note-lic"));
  db.prepare(
    `INSERT INTO ad_integrations (id, name, dc_host, domain, base_dn, encrypted_username, encrypted_password)
     VALUES (1, ?, ?, 'esempio.local', ?, ?, ?)`,
  ).run(s("ad-name"), s("dc_host"), s("base_dn"), s("ad-user"), s("ad-pass"));
  db.prepare("INSERT INTO ad_users (integration_id, object_guid, sam_account_name, display_name, email) VALUES (1, 'g-u', ?, ?, ?)").run(s("sam"), s("display_name"), s("email-user"));
  db.prepare(
    `INSERT INTO ad_computers (integration_id, object_guid, sam_account_name, dns_host_name, distinguished_name,
       operating_system, operating_system_version, enabled, host_id, ou, raw_data)
     VALUES (1, 'g-c', ?, ?, ?, 'Windows Server 2012 R2 Standard', '6.3 (9600)', 1, 1, ?, ?)`,
  ).run(s("sam-c"), s("dns_host_name"), s("dn-computer"), s("ou"), s("raw_data"));
  db.prepare(
    `INSERT INTO ad_computers (integration_id, object_guid, sam_account_name, distinguished_name, operating_system, enabled, host_id)
     VALUES (1, 'g-off', 'off', 'CN=off', 'Windows XP', 0, 2)`,
  ).run();
  db.prepare(
    `INSERT INTO wazuh_agent (agent_id, host_id, name, ip, mac, hostname, os_platform, os_name, os_version, agent_version, manager_host)
     VALUES ('001', 1, ?, '10.0.0.5', 'aa:bb:cc:dd:ee:ff', ?, 'windows', 'Microsoft Windows Server 2012 R2 Standard', '6.3.9600', ?, ?)`,
  ).run(s("wazuh-name"), s("wazuh-hostname"), s("agent_version"), s("manager_host"));
  db.prepare(
    `INSERT INTO network_devices (name, host, device_type, vendor, protocol, username, encrypted_password, community_string,
       api_token, api_url, sysname, sysdescr, model, firmware, serial_number, last_device_info_json)
     VALUES (?, '10.0.0.5', 'server', 'windows', 'winrm', ?, ?, ?, ?, ?, ?, ?, 'R740xd', '2.2', 'SN-ND', ?)`,
  ).run(s("nd-name"), s("nd-username"), s("nd-password"), s("community_string"), s("api_token"), s("api_url"),
    s("sysname"), s("sysdescr"), s("device_info"));
  // Un apparato senza host: non va nella fotografia v1, si conta.
  db.prepare("INSERT INTO network_devices (name, host, device_type, vendor, protocol, community_string) VALUES (?, '10.9.9.9', 'switch', 'hp', 'snmp_v2', ?)")
    .run(s("nd2-name"), s("nd2-community"));
  return db;
}

function chiaviA(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) v.forEach((x) => chiaviA(x, out));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { out.add(k); chiaviA(x, out); }
  return out;
}

test("nessun campo vietato nella fotografia, a nessuna profondità", () => {
  const db = dbSentinella();
  const d = leggiDatiInventario(db);
  const r = corpoInventario(d, TESTA);
  assert.ok(!("errore" in r), "errore" in r ? r.errore : "");
  if ("errore" in r) return;
  assert.equal(r.oggetti, 2);
  assert.ok(!r.json.includes("SENTINELLA"), `sentinella nel corpo: ${r.json.match(/SENTINELLA-[\w-]+/g)?.join(", ")}`);
  // anche i dati letti (non solo il corpo) non portano i campi vietati
  assert.ok(!JSON.stringify({ ...d, inAd: [...d.inAd], wazuh: [...d.wazuh], osAd: [...d.osAd] }).includes("SENTINELLA"));

  const j = JSON.parse(r.json) as { oggetti: Record<string, unknown>[]; reti: Record<string, unknown>[] };
  for (const o of j.oggetti) for (const k of Object.keys(o)) assert.ok(CAMPI_OGGETTO.includes(k), `chiave fuori lista bianca: ${k}`);
  for (const o of j.oggetti) for (const p of (o.porte as Record<string, unknown>[])) {
    assert.deepEqual(Object.keys(p), ["porta", "protocollo", "servizio", "versione"]);
  }
  for (const rete of j.reti) assert.deepEqual(Object.keys(rete), ["cidr", "nome", "vlan", "sede"]);
  const vietate = ["notes", "note", "snmp_data", "detection_json", "community", "community_string", "snmp_community", "password",
    "username", "api_token", "token", "credenziali", "credentials", "utenti", "users", "licenze", "licenses", "assegnatari",
    "assignees", "address", "raw_data", "classification_json", "inventory_code", "conflict_flags"];
  const tutte = chiaviA(j);
  for (const k of vietate) assert.ok(!tutte.has(k), `chiave vietata nel corpo: ${k}`);

  const v = SchemaInventarioHub.safeParse(j);
  assert.ok(v.success, v.success ? "" : JSON.stringify(v.error.issues.slice(0, 3)));
  db.close();
});

test("dati letti: AD solo abilitati, os da Wazuh e AD, apparato unito per ip, apparati senza host contati", () => {
  const db = dbSentinella();
  const d = leggiDatiInventario(db);
  assert.deepEqual([...d.inAd], [1]);
  assert.equal(d.osAd.get(1), "Windows Server 2012 R2 Standard 6.3 (9600)");
  assert.equal(d.osAd.has(2), false);
  assert.equal(d.wazuh.get(1)?.os, "Microsoft Windows Server 2012 R2 Standard 6.3.9600");
  assert.equal(d.apparatiSenzaHost, 1);
  const h1 = d.host.find((h) => h.id === 1);
  assert.equal(h1?.nd_device_type, "server");
  assert.equal(h1?.nd_model, "R740xd");
  assert.deepEqual(d.reti, [{ id: 1, cidr: "10.0.0.0/24", nome: "LAN", vlan: 10, sede: "Sede A" }]);
  const r = corpoInventario(d, TESTA);
  if ("errore" in r) throw new Error(r.errore);
  const o = (JSON.parse(r.json) as { oggetti: Record<string, unknown>[] }).oggetti;
  assert.equal(o[0].fuori_supporto, true);
  assert.equal(o[0].in_ad, true);
  assert.equal(o[0].agente_wazuh, true);
  assert.equal(o[1].in_ad, false, "un computer AD disabilitato non conta");
  db.close();
});

test("statica: il testo SQL di dati-inventario.ts non ha SELECT * né colonne vietate", () => {
  const sorgente = fs.readFileSync(path.join(__dirname, "..", "dati-inventario.ts"), "utf8");
  // Solo il codice: i commenti possono spiegare cosa NON si legge.
  const codice = sorgente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  assert.ok(!/select\s+(\w+\.)?\*/i.test(codice), "SELECT * nel codice");
  for (const c of ["notes", "snmp_data", "detection_json", "community", "password", "username", "api_token", "token",
    "credential", "classification_json", "inventory_code", "conflict_flags", "raw_data", "address", "ad_users",
    "asset_assignees", "licenses", "sysdescr", "last_device_info_json"]) {
    assert.ok(!new RegExp(`\\b${c}`, "i").test(codice), `«${c}» nel codice di dati-inventario.ts`);
  }
});
