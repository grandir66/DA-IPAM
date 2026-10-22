// La lettura dal lato dell'host (spec topologia §13.5.5, T2.5; livello completo, zona rossa: comandi nuovi sugli hypervisor
// dei clienti). `lldpcli` in un comando a parte, mai accodato al comando delle schede vive (I54: su un host senza lldpcli
// l'uscita 1 farebbe perdere le schede); solo LLDP diventa un vicino (I52: CDP, EDP, FDP e SONMP li rifiuterebbe il vincolo
// di protocol, e il giro intero dell'apparato fallirebbe); il membro di riserva di un bond e il suo MAC permanente.
//
// Le fixture sono le uscite vere (T2-b) di un nodo Proxmox VE 9 dell'hub con lldpd 1.0.18, rese anonime con la stessa forma:
// `lldpcli-json0.json` (quattro vicini LLDP da due switch UniFi, che NON mandano l'indirizzo di gestione e, uno dei due, nemmeno
// le capacità) e `ip-link-bond.json` (quattro schede fisiche, un bond active-backup con un membro ACTIVE e uno BACKUP, un bond
// 802.3ad con due membri ACTIVE, un bridge). Fatti misurati su quelle uscite: lo stato del membro sta in
// `linkinfo.info_slave_data.state`, il MAC permanente in `info_slave_data.perm_hwaddr` su tutti i membri, e `permaddr` in cima
// solo sui membri il cui MAC di adesso è diverso da quello permanente.
//
// Hub isolato importato per primo (il perché sta in support/hub-isolato); i tenant stanno in DA_INVENT_DATA_DIR.
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Server, utils, type ServerChannel } from "ssh2";
import type { AddressInfo } from "node:net";
import { closeHubDb } from "@/lib/db-hub";
import { deleteTenantDatabase, getTenantDb, rileggiSchemaCavi, withTenant } from "@/lib/db-tenant";
import { encrypt } from "@/lib/crypto";
import { CODICE_CONNESSIONE_CADUTA } from "@/lib/devices/ssh-transport";
import { COMANDI_HOST, apriHostSsh, fattiHost, leggiHost, parseLldpcliJson0, type ApriHost } from "@/lib/proxmox/lldp-host";
import { LIVE_INTERFACES_COMMAND, membriDeiBond } from "@/lib/proxmox/live-interfaces";
import { leggiEsiti, scriviInterruttore } from "@/lib/topology/letture/interruttori";
import { LETTURE_SPENTE_SQL } from "@/lib/topology/letture/__tests__/letture-spente";

const F = (n: string): string => fs.readFileSync(path.join(__dirname, "fixtures", n), "utf8");
const IP_LINK = (): unknown[] => JSON.parse(F("ip-link-bond.json")) as unknown[];

// ── Il lettore di json0 ──────────────────────────────────────────────────────

test("json0 vero: ogni vicino via LLDP con la scheda, il nome, la porta e il telaio", () => {
  const v = parseLldpcliJson0(F("lldpcli-json0.json"));
  assert.ok(v.length > 0);
  for (const x of v) {
    assert.equal(x.protocol, "lldp");
    assert.ok(x.localPort !== "", "la scheda locale c'è");
    assert.ok(x.remoteDevice !== "" || x.remoteMac !== undefined, "un nome o un telaio");
  }
});

test("json0 vero: i quattro vicini come li scrive il DB; gli switch che non mandano indirizzo né capacità non ne ricevono di inventati", () => {
  const v = parseLldpcliJson0(F("lldpcli-json0.json"));
  assert.deepEqual(v, [
    // La porta remota è l'id di tipo `local` («Port 1»: il nome della porta sullo switch), non la descrizione.
    { localPort: "nic1", remoteDevice: "SW-1", remotePort: "Port 1", protocol: "lldp", remoteMac: "02:00:B0:00:00:01" },
    { localPort: "nic0", remoteDevice: "SW-1", remotePort: "Port 2", protocol: "lldp", remoteMac: "02:00:B0:00:00:01" },
    { localPort: "nic2", remoteDevice: "SW-2", remotePort: "Port 19", protocol: "lldp", remoteMac: "02:00:B0:00:00:02", remoteCaps: "bridge,router" },
    { localPort: "nic3", remoteDevice: "SW-2", remotePort: "Port 20", protocol: "lldp", remoteMac: "02:00:B0:00:00:02", remoteCaps: "bridge,router" },
  ]);
  for (const x of v) assert.equal("remoteIp" in x, false, "nessun mgmt-ip nell'uscita: il campo non c'è (né vuoto né inventato)");
});

test("I52: le righe CDP, EDP, FDP e SONMP non diventano vicini", () => {
  const j = { lldp: [{ interface: [
    { name: "nic0", via: "LLDP", chassis: [{ id: [{ type: "mac", value: "02:00:b0:00:00:01" }], name: [{ value: "SW-1" }], capability: [{ type: "Bridge", enabled: true }] }], port: [{ id: [{ type: "ifname", value: "Port 3" }] }] },
    { name: "nic1", via: "CDPv2", chassis: [{ name: [{ value: "SW-2" }] }], port: [{ id: [{ type: "ifname", value: "Gi1/0/2" }] }] },
    { name: "nic2", via: "EDP", chassis: [{ name: [{ value: "SW-3" }] }], port: [{ id: [{ type: "ifname", value: "1:2" }] }] },
    { name: "nic3", via: "FDP", chassis: [{ name: [{ value: "SW-4" }] }], port: [{ id: [{ type: "ifname", value: "1/1" }] }] },
    { name: "nic4", via: "SONMP", chassis: [{ name: [{ value: "SW-5" }] }], port: [{ id: [{ type: "ifname", value: "1/2" }] }] },
  ] }] };
  assert.deepEqual(parseLldpcliJson0(JSON.stringify(j)), [
    { localPort: "nic0", remoteDevice: "SW-1", remotePort: "Port 3", protocol: "lldp", remoteMac: "02:00:B0:00:00:01", remoteCaps: "bridge" },
  ]);
});

test("json0: mgmt-ip IPv4 quando c'è; capacità spente fuori; telaio senza nome = il MAC; senza scheda o senza telaio la riga non c'è", () => {
  // Forma derivata dalla vera: lo stesso vicino con i campi che `details` aggiunge quando lo switch li manda.
  const j = { lldp: [{ interface: [
    { name: "nic0", via: "LLDP", chassis: [{ id: [{ type: "mac", value: "02:00:b0:00:00:03" }],
      "mgmt-ip": [{ value: "fe80::1" }, { value: "10.0.0.3" }],
      capability: [{ type: "Bridge", enabled: true }, { type: "Wlan", enabled: true }, { type: "Router", enabled: false }] }],
      port: [{ id: [{ type: "mac", value: "02:00:b0:00:00:13" }], descr: [{ value: "eth0" }] }] },
    { via: "LLDP", chassis: [{ name: [{ value: "SW-9" }] }], port: [{ id: [{ type: "local", value: "Port 9" }] }] },
    { name: "nic5", via: "LLDP", chassis: [{}], port: [{ id: [{ type: "local", value: "Port 5" }] }] },
  ] }] };
  assert.deepEqual(parseLldpcliJson0(JSON.stringify(j)), [
    { localPort: "nic0", remoteDevice: "02:00:B0:00:00:03", remotePort: "eth0", protocol: "lldp", remoteMac: "02:00:B0:00:00:03", remoteIp: "10.0.0.3", remoteCaps: "bridge,wlan-ap" },
  ]);
});

test("json0 senza vicini è «letto e vuoto»; un'uscita che non è JSON o non è di lldpcli è un errore col suo codice, mai «nessun vicino»", () => {
  assert.deepEqual(parseLldpcliJson0('{"lldp": [{}]}'), []);
  assert.deepEqual(parseLldpcliJson0('{"lldp": [{"interface": []}]}'), []);
  assert.throws(() => parseLldpcliJson0("lldpcli: command not found"), (e: unknown) => (e as { code?: string }).code === "JSON_ILLEGGIBILE");
  for (const t of ["{}", "[]", "null", '{"lldp": "x"}']) {
    assert.throws(() => parseLldpcliJson0(t), (e: unknown) => (e as { code?: string }).code === "USCITA_NON_CAPITA", t);
  }
});

// ── I membri dei bond ────────────────────────────────────────────────────────

test("bond: il membro attivo e quello di riserva, col MAC permanente", () => {
  const m = membriDeiBond(IP_LINK());
  assert.ok(m.some((x) => x.stato === "attivo"));
  assert.ok(m.some((x) => x.stato === "riserva"));
  assert.ok(m.every((x) => x.bond !== "" && (x.macPermanente === null || /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(x.macPermanente))));
  const f = fattiHost(IP_LINK());
  assert.ok(f.porte.some((p) => p.lag_state === "riserva" && p.lag_group !== null));
});

test("bond, uscita vera: i quattro membri dei due bond, stato e MAC permanente (non quello di adesso, che è del bond)", () => {
  assert.deepEqual(membriDeiBond(IP_LINK()), [
    { nome: "nic1", bond: "bond25", stato: "attivo", macPermanente: "02:00:B1:00:00:03" },
    { nome: "nic0", bond: "bond25", stato: "riserva", macPermanente: "02:00:B1:00:00:01" },
    { nome: "nic2", bond: "bond10", stato: "attivo", macPermanente: "02:00:B1:00:00:04" },
    { nome: "nic3", bond: "bond10", stato: "attivo", macPermanente: "02:00:B1:00:00:05" },
  ]);
});

test("bond: senza perm_hwaddr vale `permaddr` in cima; senza tutti e due il MAC è null; uno stato sconosciuto è null", () => {
  // Copie dell'uscita vera con un campo tolto o cambiato: la forma resta quella vera.
  const senzaPerm = IP_LINK().map((x) => {
    const o = structuredClone(x) as { ifname: string; permaddr?: string; linkinfo?: { info_slave_data?: Record<string, unknown> } };
    if (o.linkinfo?.info_slave_data) delete o.linkinfo.info_slave_data.perm_hwaddr;
    if (o.ifname === "nic2" && o.linkinfo?.info_slave_data) o.linkinfo.info_slave_data.state = "SCONOSCIUTO";
    return o;
  });
  assert.deepEqual(membriDeiBond(senzaPerm).map((m) => [m.nome, m.stato, m.macPermanente]), [
    ["nic1", "attivo", "02:00:B1:00:00:03"], ["nic0", "riserva", null], ["nic2", null, null], ["nic3", "attivo", "02:00:B1:00:00:05"],
  ]);
  assert.deepEqual(membriDeiBond({ non: "un elenco" }), []);
});

test("fattiHost, uscita vera: tipo, acceso, fascio e stato del membro per ogni scheda; i MAC permanenti con la loro scheda", () => {
  const f = fattiHost(IP_LINK());
  assert.deepEqual(f.porte, [
    { port_key: "n:nic1", port_name: "nic1", port_index: null, if_kind: "physical", running: 1, lag_group: "bond25", lag_state: "attivo" },
    { port_key: "n:nic0", port_name: "nic0", port_index: null, if_kind: "physical", running: 1, lag_group: "bond25", lag_state: "riserva" },
    { port_key: "n:nic2", port_name: "nic2", port_index: null, if_kind: "physical", running: 1, lag_group: "bond10", lag_state: "attivo" },
    { port_key: "n:nic3", port_name: "nic3", port_index: null, if_kind: "physical", running: 1, lag_group: "bond10", lag_state: "attivo" },
    { port_key: "n:bond25", port_name: "bond25", port_index: null, if_kind: "lag", running: 1, lag_group: "bond25", lag_state: null },
    { port_key: "n:bond10", port_name: "bond10", port_index: null, if_kind: "lag", running: 1, lag_group: "bond10", lag_state: null },
    { port_key: "n:vmbr_int", port_name: "vmbr_int", port_index: null, if_kind: "bridge", running: 1, lag_group: null, lag_state: null },
  ]);
  assert.deepEqual(f.bridge, []);
  // Il MAC del bond (uguale a quello di adesso di un membro) non è un MAC di scheda: ci sono solo i quattro permanenti, una volta.
  assert.deepEqual(f.macs, [
    { mac: "02:00:B1:00:00:03", port_key: "n:nic1" }, { mac: "02:00:B1:00:00:01", port_key: "n:nic0" },
    { mac: "02:00:B1:00:00:04", port_key: "n:nic2" }, { mac: "02:00:B1:00:00:05", port_key: "n:nic3" },
  ]);
});

test("fattiHost: un membro senza MAC permanente non prende il MAC di adesso (che è quello del bond); una scheda fuori dai bond sì", () => {
  // Copia dell'uscita vera senza i permanenti dei due membri di bond25: il MAC di adesso di nic1 (02:00:B1:00:00:01) è quello
  // del bond, cioè la scheda nic0; darlo a nic1 abbinerebbe allo switch la scheda sbagliata.
  const copia = IP_LINK().map((x) => {
    const o = structuredClone(x) as { ifname: string; master?: string; permaddr?: string; linkinfo?: Record<string, unknown> & { info_slave_data?: Record<string, unknown> } };
    if (o.ifname === "nic1" || o.ifname === "nic0") { delete o.permaddr; if (o.linkinfo?.info_slave_data) delete o.linkinfo.info_slave_data.perm_hwaddr; }
    if (o.ifname === "nic3") { delete o.master; delete o.linkinfo; } // fuori dal bond: il suo MAC è il suo (permaddr)
    return o;
  });
  const f = fattiHost(copia);
  assert.equal(f.macs.some((m) => m.port_key === "n:nic1" || m.port_key === "n:nic0"), false, "membri senza permanente: nessun MAC");
  assert.equal(f.macs.some((m) => m.mac === "02:00:B1:00:00:01"), false, "il MAC del bond non va a nessuna scheda");
  assert.deepEqual(f.macs.find((m) => m.port_key === "n:nic3"), { mac: "02:00:B1:00:00:05", port_key: "n:nic3" });
});

// ── I54: i comandi ───────────────────────────────────────────────────────────

test("I54: i comandi sono tre, separati; nessuno è accodato al comando delle schede vive", () => {
  assert.deepEqual(Object.values(COMANDI_HOST), ["command -v lldpcli", "lldpcli -f json0 show neighbors details", "ip -d -j link show"]);
  for (const c of Object.values(COMANDI_HOST)) assert.equal(/;|&&|\|\||\|/.test(c), false, c);
  assert.equal(LIVE_INTERFACES_COMMAND.includes("lldpcli"), false, "il comando delle schede vive resta quello di prima");
});

// ── leggiHost sul DB di un cliente ───────────────────────────────────────────

const T = "TESTLLDPHOST";
const db = () => getTenantDb(T);
const ORA = new Date("2026-10-15T22:00:00Z");
const TROVATO = { stdout: "/usr/sbin/lldpcli\n", code: 0 };
const ASSENTE = { stdout: "", code: 1 };
type Uscita = { stdout: string; code: number } | (() => Promise<{ stdout: string; code: number }>);

function spia(uscite: Record<string, Uscita>) {
  const chiamate: Array<{ host: string; port: number | undefined; username: string; comandi: string[] }> = [];
  const apri: ApriHost = async (opts, fn) => {
    const voce = { host: opts.host, port: opts.port, username: opts.username, comandi: [] as string[] };
    chiamate.push(voce);
    return fn(async (cmd) => {
      voce.comandi.push(cmd);
      const u = uscite[cmd];
      if (u === undefined) throw new Error(`comando inatteso: ${cmd}`);
      return typeof u === "function" ? u() : u;
    });
  };
  return { apri, chiamate };
}
const VERE: Record<string, Uscita> = {
  [COMANDI_HOST.cerca]: TROVATO,
  [COMANDI_HOST.vicini]: { stdout: F("lldpcli-json0.json"), code: 0 },
  [COMANDI_HOST.schede]: { stdout: F("ip-link-bond.json"), code: 0 },
};
const vicini = (id: number) => db().prepare(
  "SELECT local_port, remote_device_name, remote_port, protocol, remote_ip, remote_mac, remote_caps, source FROM device_neighbors WHERE device_id = ? ORDER BY local_port",
).all(id) as Array<Record<string, unknown>>;
const porte = (id: number) => db().prepare(
  "SELECT port_key, if_kind, running, lag_group, lag_state, source FROM topology_port_facts WHERE device_id = ? ORDER BY port_key",
).all(id) as Array<Record<string, unknown>>;
const macs = (id: number) => db().prepare("SELECT mac, port_key, source FROM topology_device_macs WHERE device_id = ? ORDER BY mac").all(id) as Array<Record<string, unknown>>;

beforeEach(() => {
  db().exec(`DELETE FROM topology_port_facts; DELETE FROM topology_bridge_facts; DELETE FROM topology_device_macs;
    DELETE FROM device_neighbors; DELETE FROM network_devices; DELETE FROM tenant_settings WHERE key LIKE 'topologia.lettura.%';
    ${LETTURE_SPENTE_SQL}`);
  // La credenziale SSH in un binding d'archivio (dalla 2g, T26, le colonne dell'apparato non si leggono più).
  db().exec("DELETE FROM device_credential_bindings; DELETE FROM credentials WHERE name = 'root di prova';");
  const voce = Number(db().prepare("INSERT INTO credentials (name, credential_type, encrypted_username, encrypted_password) VALUES ('root di prova', 'ssh', ?, ?)")
    .run(encrypt("root@pam"), encrypt("segreto-di-prova")).lastInsertRowid);
  const ins = db().prepare(`INSERT INTO network_devices (id, name, host, device_type, vendor, protocol, scan_target, enabled)
    VALUES (?, ?, ?, 'hypervisor', 'proxmox', 'ssh', 'proxmox', 1)`);
  const lega = db().prepare("INSERT INTO device_credential_bindings (device_id, credential_id, protocol_type, port, sort_order) VALUES (?, ?, 'ssh', 22, 0)");
  ins.run(1, "HV-1", "192.0.2.11");
  lega.run(1, voce);
  // Un cluster su un apparato solo («a,b»): il primo nodo è censito anche da solo (id 3), il secondo no.
  ins.run(2, "PVE-C", "192.0.2.21,22");
  lega.run(2, voce);
  ins.run(3, "PVE-N1", "192.0.2.21");
  lega.run(3, voce);
  withTenant(T, () => rileggiSchemaCavi());
});
after(() => { deleteTenantDatabase(T); closeHubDb(); removeTestHubDb(); });

const accendi = (): void => { withTenant(T, () => scriviInterruttore("host", true, "prova", ORA)); };

test("spenta (chiave assente): nessuna connessione, niente scritto", async () => {
  const s = spia(VERE);
  const r = await withTenant(T, () => leggiHost(1, s.apri, () => ORA));
  assert.deepEqual(r, [{ stato: "saltato", motivo: "spenta" }]);
  assert.deepEqual(s.chiamate, []);
  assert.deepEqual([vicini(1), porte(1), macs(1)], [[], [], []]);
});

test("accesa, con lldpd: tre comandi a parte su una connessione; vicini `host`/`lldp`, fatti delle schede, MAC permanenti, esito", async () => {
  accendi();
  const s = spia(VERE);
  const r = await withTenant(T, () => leggiHost(1, s.apri, () => ORA));
  assert.equal(r.length, 1);
  assert.equal(r[0].stato, "letto");
  assert.deepEqual(s.chiamate, [{ host: "192.0.2.11", port: 22, username: "root", comandi: Object.values(COMANDI_HOST) }]);
  assert.deepEqual(vicini(1), [
    { local_port: "nic0", remote_device_name: "SW-1", remote_port: "Port 2", protocol: "lldp", remote_ip: null, remote_mac: "02:00:B0:00:00:01", remote_caps: null, source: "host" },
    { local_port: "nic1", remote_device_name: "SW-1", remote_port: "Port 1", protocol: "lldp", remote_ip: null, remote_mac: "02:00:B0:00:00:01", remote_caps: null, source: "host" },
    { local_port: "nic2", remote_device_name: "SW-2", remote_port: "Port 19", protocol: "lldp", remote_ip: null, remote_mac: "02:00:B0:00:00:02", remote_caps: "bridge,router", source: "host" },
    { local_port: "nic3", remote_device_name: "SW-2", remote_port: "Port 20", protocol: "lldp", remote_ip: null, remote_mac: "02:00:B0:00:00:02", remote_caps: "bridge,router", source: "host" },
  ]);
  const p = porte(1);
  assert.equal(p.length, 7);
  assert.ok(p.every((x) => x.source === "host"));
  assert.deepEqual(p.find((x) => x.port_key === "n:nic0"), { port_key: "n:nic0", if_kind: "physical", running: 1, lag_group: "bond25", lag_state: "riserva", source: "host" });
  assert.deepEqual(macs(1).map((m) => [m.mac, m.port_key, m.source]), [
    ["02:00:B1:00:00:01", "n:nic0", "host"], ["02:00:B1:00:00:03", "n:nic1", "host"], ["02:00:B1:00:00:04", "n:nic2", "host"], ["02:00:B1:00:00:05", "n:nic3", "host"],
  ]);
  assert.deepEqual(withTenant(T, () => leggiEsiti("host"))["1"], { il: "2026-10-15 22:00:00", comandi: 3, riusciti: 3, codice: null });
});

test("I54: lldpd non installato (uscita 1) non è un errore: due comandi, le schede si scrivono, nessun vicino", async () => {
  accendi();
  const s = spia({ ...VERE, [COMANDI_HOST.cerca]: ASSENTE });
  const r = await withTenant(T, () => leggiHost(1, s.apri, () => ORA));
  assert.equal(r[0].stato, "letto");
  assert.deepEqual(s.chiamate[0].comandi, [COMANDI_HOST.cerca, COMANDI_HOST.schede]);
  assert.deepEqual(vicini(1), []);
  assert.equal(porte(1).length, 7);
  assert.deepEqual(withTenant(T, () => leggiEsiti("host"))["1"], { il: "2026-10-15 22:00:00", comandi: 2, riusciti: 2, codice: null });
});

test("lldpcli che non risponde (lldpd fermo): le schede si scrivono, i vicini no, e l'esito lo dice col codice", async () => {
  accendi();
  const s = spia({ ...VERE, [COMANDI_HOST.vicini]: { stdout: "", code: 1 } });
  const r = await withTenant(T, () => leggiHost(1, s.apri, () => ORA));
  assert.equal(r[0].stato, "letto");
  assert.deepEqual(vicini(1), []);
  assert.equal(porte(1).length, 7);
  assert.deepEqual(withTenant(T, () => leggiEsiti("host"))["1"], { il: "2026-10-15 22:00:00", comandi: 3, riusciti: 2, codice: "LLDPCLI_NON_RIUSCITO" });
});

test("lldpcli con un'uscita non leggibile: «non so», nessun vicino scritto (mai «nessun vicino»), le schede sì", async () => {
  accendi();
  const s = spia({ ...VERE, [COMANDI_HOST.vicini]: { stdout: '{"lldp": [{"interface": [', code: 0 } });
  await withTenant(T, () => leggiHost(1, s.apri, () => ORA));
  assert.deepEqual(vicini(1), []);
  assert.equal(porte(1).length, 7);
  assert.equal(withTenant(T, () => leggiEsiti("host"))["1"].codice, "JSON_ILLEGGIBILE");
});

test("schede non lette e niente vicini: la lettura non è riuscita, niente scritto (né schede vuote né MAC)", async () => {
  accendi();
  for (const [schede, codice] of [[{ stdout: "Object \"link\" is unknown", code: 0 }, "JSON_ILLEGGIBILE"], [{ stdout: "{}", code: 0 }, "USCITA_NON_CAPITA"],
    [{ stdout: "[]", code: 0 }, "USCITA_NON_CAPITA"], [{ stdout: "", code: 255 }, "USCITA_NON_ZERO"]] as const) {
    db().exec("DELETE FROM tenant_settings WHERE key = 'topologia.lettura.host.esito'");
    const s = spia({ ...VERE, [COMANDI_HOST.cerca]: ASSENTE, [COMANDI_HOST.schede]: schede });
    const r = await withTenant(T, () => leggiHost(1, s.apri, () => ORA));
    assert.equal(r[0].stato, "errore", codice);
    assert.deepEqual([porte(1), macs(1)], [[], []], codice);
    assert.deepEqual(withTenant(T, () => leggiEsiti("host"))["1"], { il: "2026-10-15 22:00:00", comandi: 0, riusciti: 0, codice }, codice);
  }
});

test("connessione caduta a metà: «non so» col codice, i comandi dopo non danno niente da scrivere", async () => {
  accendi();
  const caduta = () => Promise.reject(Object.assign(new Error("caduta"), { code: CODICE_CONNESSIONE_CADUTA }));
  const s = spia({ ...VERE, [COMANDI_HOST.vicini]: caduta, [COMANDI_HOST.schede]: caduta });
  const r = await withTenant(T, () => leggiHost(1, s.apri, () => ORA));
  assert.equal(r[0].stato, "errore");
  assert.deepEqual([vicini(1), porte(1), macs(1)], [[], [], []]);
  assert.equal(withTenant(T, () => leggiEsiti("host"))["1"].codice, CODICE_CONNESSIONE_CADUTA);
});

test("connessione che non si apre: errore col codice, niente scritto", async () => {
  accendi();
  const apri: ApriHost = async () => { throw Object.assign(new Error("Connessione SSH non riuscita"), { code: "SSH_CONNECT_TIMEOUT" }); };
  const r = await withTenant(T, () => leggiHost(1, apri, () => ORA));
  assert.equal(r[0].stato, "errore");
  assert.equal(withTenant(T, () => leggiEsiti("host"))["1"].codice, "SSH_CONNECT_TIMEOUT");
  assert.deepEqual(porte(1), []);
});

test("cadenza: una seconda lettura entro l'ora non apre connessioni", async () => {
  accendi();
  const s = spia(VERE);
  await withTenant(T, () => leggiHost(1, s.apri, () => ORA));
  const r = await withTenant(T, () => leggiHost(1, s.apri, () => new Date(ORA.getTime() + 30 * 60_000)));
  assert.deepEqual(r, [{ stato: "saltato", motivo: "cadenza" }]);
  assert.equal(s.chiamate.length, 1);
});

test("cluster su un apparato solo: il nodo censito si scrive sul suo apparato; quello non censito non si legge e si conta", async () => {
  accendi();
  const s = spia(VERE);
  const r = await withTenant(T, () => leggiHost(2, s.apri, () => ORA));
  assert.deepEqual(s.chiamate.map((c) => c.host), ["192.0.2.21"], "il nodo non censito non riceve comandi");
  assert.deepEqual(r.map((x) => x.stato), ["letto", "errore"]);
  assert.equal(r[1].stato === "errore" ? r[1].esito.codice : null, "NODO_NON_CENSITO");
  assert.equal(vicini(3).length, 4);
  assert.equal(porte(3).length, 7);
  assert.deepEqual([vicini(2), porte(2), macs(2)], [[], [], []], "sull'apparato del cluster niente: la scheda è sempre di un apparato solo");
});

test("cluster: due apparati con l'indirizzo del nodo e nessuno (o più d'uno) hypervisor: non si sceglie a caso", async () => {
  accendi();
  db().prepare("UPDATE network_devices SET device_type = 'server' WHERE id = 3").run();
  db().prepare(`INSERT INTO network_devices (id, name, host, device_type, vendor, protocol, enabled) VALUES (4, 'SRV-N1', '192.0.2.21', 'server', 'linux', 'ssh', 1)`).run();
  const s = spia(VERE);
  const r = await withTenant(T, () => leggiHost(2, s.apri, () => ORA));
  assert.deepEqual(s.chiamate, []);
  assert.deepEqual(r.map((x) => (x.stato === "errore" ? x.esito.codice : x.stato)), ["NODO_AMBIGUO", "NODO_NON_CENSITO"]);
  // Con un hypervisor fra i due, è lui.
  db().prepare("UPDATE network_devices SET device_type = 'hypervisor' WHERE id = 3").run();
  const r2 = await withTenant(T, () => leggiHost(2, s.apri, () => ORA));
  assert.deepEqual(r2.map((x) => x.stato), ["letto", "errore"]);
  assert.equal(porte(3).length, 7);
});

// ── La connessione vera (server ssh2 in memoria su 127.0.0.1, niente rete) ───

async function serverSsh(risposta: (comando: string, canale: ServerChannel) => void): Promise<{ porta: number; chiudi: () => void }> {
  // ecdsa e non ed25519: misurato il 15/10, ssh2 genera una chiave ed25519 che poi non sa leggere circa 1 volta su 200
  // («Malformed OpenSSH private key»), e la prova fallirebbe a caso; ecdsa 0 su 2000.
  const chiave = utils.generateKeyPairSync("ecdsa", { bits: 256 });
  const srv = new Server({ hostKeys: [chiave.private] }, (client) => {
    client.on("authentication", (ctx) => ctx.accept());
    client.on("ready", () => {
      client.on("session", (accetta) => {
        const s = accetta();
        s.on("exec", (acc, _rif, info) => risposta(info.command, acc()));
      });
    });
    client.on("error", () => { /* la connessione chiusa dal server stesso */ });
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
  return { porta: (srv.address() as AddressInfo).port, chiudi: () => srv.close() };
}

test("apriHostSsh: il codice d'uscita arriva com'è (1 = lldpd assente); un canale chiuso senza codice è CONNESSIONE_CADUTA", async () => {
  const visti: string[] = [];
  const srv = await serverSsh((cmd, canale) => {
    visti.push(cmd);
    if (cmd === COMANDI_HOST.cerca) { canale.exit(1); canale.end(); return; }
    if (cmd === COMANDI_HOST.schede) { canale.write("[{\"ifname\": \"nic0\""); canale.end(); return; } // tagliata, senza codice
    canale.exit(0); canale.end();
  });
  try {
    const opz = { host: "127.0.0.1", port: srv.porta, username: "u", password: "p" };
    const r = await apriHostSsh(opz, async (esegui) => esegui(COMANDI_HOST.cerca));
    assert.deepEqual(r, { stdout: "", code: 1 });
    await assert.rejects(apriHostSsh(opz, async (esegui) => esegui(COMANDI_HOST.schede)),
      (e: unknown) => (e as { code?: unknown }).code === CODICE_CONNESSIONE_CADUTA);
    assert.deepEqual(visti, [COMANDI_HOST.cerca, COMANDI_HOST.schede]);
  } finally {
    srv.chiudi();
  }
});

// Revisione del Task 7 di T2: la ricerca del nodo guardava anche gli apparati spenti.
test("cluster: un hypervisor spento sullo stesso indirizzo non rende il nodo ambiguo né riceve le righe", async () => {
  accendi();
  db().prepare(`INSERT INTO network_devices (id, name, host, device_type, vendor, protocol, enabled) VALUES (4, 'HV-SPENTO', '192.0.2.21', 'hypervisor', 'linux', 'ssh', 0)`).run();
  const s = spia(VERE);
  const r = await withTenant(T, () => leggiHost(2, s.apri, () => ORA));
  assert.deepEqual(r.map((x) => x.stato), ["letto", "errore"]);
  assert.equal(vicini(3).length, 4);
  assert.deepEqual([vicini(4), porte(4), macs(4)], [[], [], []]);
});
