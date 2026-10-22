// Il corpo per apparato del giro ARP estratto in `leggiApparatoArp` (piano 2026-10-22 scansione automatica, Task 4): il
// job `apparati_scelti` lo chiama per «Porte e MAC» con `vlan: "no"` (la VLAN la fa lui, solo se scelta); il giro ARP lo
// chiama dentro il lucchetto per apparato e passa oltre un apparato già in lettura («Interroga» o il job). Che il giro
// faccia esattamente quello di prima lo dicono le prove di sempre (`arp-*`, `mac-porta-sicura`), non toccate.
// Log: le cinque righe che scrivevano il nome dell'apparato (`[ARP Poll] Errore su`, `getPortSchema fallito per`,
// `[DHCP Leases]`, `[Neighbors]`, `[Routing]`) ora hanno l'id e il codice, e il messaggio senza IP né nome.
//
// Hub isolato importato per primo (il perché sta in support/hub-isolato).
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb } from "@/lib/db-hub";
import { deleteTenantDatabase, getTenantDb, rileggiSchemaCavi, rileggiSchemaSwitchVlan, withTenant } from "@/lib/db-tenant";
import { leggiApparatoArp, runArpPoll, type ContestoArp } from "@/lib/cron/jobs";
import { conLucchettoApparato } from "@/lib/devices/lucchetto-apparato";
import { tipoLetturaApparato } from "@/lib/devices/lettura-info";
import type { RouterClient } from "@/lib/devices/router-client";
import type { SwitchClient } from "@/lib/devices/switch-client";
import type { LettoreSnmp, VoceSnmp } from "@/lib/devices/snmp-walk";
import { scriviInterruttore } from "@/lib/topology/letture/interruttori";
import type { NetworkDevice } from "@/types";

const T = "TESTLETTURAAPPARATO";
const db = () => getTenantDb(T);

beforeEach(() => {
  db().exec(`DELETE FROM mac_port_entries; DELETE FROM switch_ports; DELETE FROM arp_entries; DELETE FROM switch_vlan_lettura;
    DELETE FROM network_devices; DELETE FROM networks; DELETE FROM tenant_settings WHERE key LIKE 'topologia.lettura.%';`);
  db().exec("INSERT INTO networks (id, cidr, name) VALUES (1, '192.0.2.0/24', 'LAN prova')");
  const ins = db().prepare("INSERT INTO network_devices (id, name, host, device_type, vendor, protocol, enabled, use_for_arp_poll, community_string) "
    + "VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)");
  ins.run(1, "RTR-SEGRETO", "192.0.2.1", "router", "cisco", "snmp_v2", 1, "public");
  ins.run(5, "SW-SEGRETO-5", "192.0.2.5", "switch", "cisco", "snmp_v2", 0, "public");
  ins.run(6, "SW-SEGRETO-6", "192.0.2.6", "switch", "cisco", "snmp_v2", 0, "public");
  withTenant(T, () => { rileggiSchemaCavi(); rileggiSchemaSwitchVlan(); });
});
after(() => { deleteTenantDatabase(T); closeHubDb(); removeTestHubDb(); });

const apparato = (id: number) => db().prepare("SELECT * FROM network_devices WHERE id = ?").get(id) as NetworkDevice;
const contesto = (): ContestoArp => ({ networks: [], enrichSet: null, porteNonLette: [], esitiLetture: [] });

/** La spia delle walk SNMP: quali apparati le chiedono (nessuna risposta utile). */
function spiaWalk() {
  const apparati: number[] = [];
  const crea = async (device: { id: number }): Promise<LettoreSnmp> => {
    apparati.push(device.id);
    const walk = async (): Promise<VoceSnmp[]> => [];
    return Object.assign(walk, { get: async (): Promise<VoceSnmp[]> => [] });
  };
  return { crea, apparati };
}

function clientSwitch(chiamate: string[]) {
  return async (device: NetworkDevice): Promise<SwitchClient> => ({
    async getMacTable() {
      chiamate.push(`${device.id}:getMacTable`);
      return [{ mac: "02:00:00:00:00:05", port_name: "ge-1 ", vlan: 10, port_status: "up" as const, speed: "1G" }];
    },
    async getPortSchema() { chiamate.push(`${device.id}:getPortSchema`); return []; },
    async testConnection() { return true; },
  });
}
const routerFinto = async (): Promise<RouterClient> => ({ async getArpTable() { return []; }, async testConnection() { return true; } });

test("leggiApparatoArp(switch, { vlan: \"no\" }) con switch_vlan acceso: nessuna walk Q-BRIDGE, tabella MAC scritta", async () => {
  withTenant(T, () => scriviInterruttore("switch_vlan", true, "admin"));
  const walk = spiaWalk();
  const chiamate: string[] = [];
  const ctx = contesto();
  await withTenant(T, () => leggiApparatoArp(apparato(5), ctx, { creaClientSwitch: clientSwitch(chiamate), creaWalkSnmp: walk.crea, vlan: "no" }));
  assert.deepEqual(walk.apparati, [], "VLAN non scelta: nessuna sessione SNMP");
  assert.deepEqual(chiamate, ["5:getMacTable", "5:getPortSchema"]);
  const mac = db().prepare("SELECT device_id, mac, port_name FROM mac_port_entries").all();
  assert.deepEqual(mac, [{ device_id: 5, mac: "02:00:00:00:00:05", port_name: "ge-1" }]);
  assert.deepEqual(ctx.esitiLetture, [], "nessuna lettura VLAN nel resoconto");

  // Lo stesso apparato «come il giro» (predefinito): la VLAN si legge, come prima.
  await withTenant(T, () => leggiApparatoArp(apparato(5), contesto(), { creaClientSwitch: clientSwitch([]), creaWalkSnmp: walk.crea }));
  assert.deepEqual(walk.apparati, [5]);
});

test("runArpPoll: un apparato già nel lucchetto non si legge (zero chiamate al client), gli altri sì", async () => {
  const chiamate: string[] = [];
  let libera!: () => void;
  const tenuto = withTenant(T, () => conLucchettoApparato(5, () => new Promise<void>((r) => { libera = r; })));
  const info: string[] = [];
  const prima = console.info;
  console.info = (...a: unknown[]) => { info.push(a.map(String).join(" ")); };
  try {
    await withTenant(T, () => runArpPoll(null, { skipDhcpLeases: true, creaClientRouter: routerFinto, creaClientSwitch: clientSwitch(chiamate) }));
  } finally {
    console.info = prima;
  }
  assert.deepEqual(chiamate, ["6:getMacTable", "6:getPortSchema"], "lo switch 5 è saltato, il 6 letto");
  assert.ok(info.some((r) => r.includes("apparato #5") && r.includes("lettura già in corso")), info.join("\n"));
  libera();
  await tenuto;
});

test("log senza IP né nome: le cinque righe del giro hanno l'id e il codice", async () => {
  const righe: string[] = [];
  const [err, warn, inf] = [console.error, console.warn, console.info];
  const cattura = (...a: unknown[]) => { righe.push(a.map((x) => (x instanceof Error ? `${x.message} ${x.stack ?? ""}` : String(x))).join(" ")); };
  console.error = cattura; console.warn = cattura; console.info = cattura;
  const guasto = (cosa: string) => async (): Promise<never> => { throw new Error(`${cosa}: timeout 192.0.2.5 su RTR-SEGRETO`); };
  // Un router che risponde all'ARP e fallisce tutto il resto (lease, schema porte, vicini, routing), poi uno che non risponde.
  const routerGuasto = async (): Promise<RouterClient> => ({
    async getArpTable() { return []; },
    async testConnection() { return true; },
    getDhcpLeases: guasto("dhcp"),
    getPortSchema: guasto("schema"),
    getNeighbors: guasto("vicini"),
    getRoutingTable: guasto("routing"),
  });
  try {
    await withTenant(T, () => runArpPoll(null, { creaClientRouter: routerGuasto, creaClientSwitch: clientSwitch([]) }));
    await withTenant(T, () => runArpPoll(null, {
      creaClientRouter: async () => { throw new Error("timeout 192.0.2.5 RTR-SEGRETO"); },
      creaClientSwitch: clientSwitch([]),
    }));
  } finally {
    console.error = err; console.warn = warn; console.info = inf;
  }
  const tutto = righe.join("\n");
  for (const p of ["[DHCP Leases]", "getPortSchema", "[Neighbors]", "[Routing]", "[ARP Poll] apparato #1: errore"]) {
    assert.ok(tutto.includes(p), `manca la riga ${p}:\n${tutto}`);
  }
  assert.ok(tutto.includes("apparato #1"), tutto);
  assert.ok(!tutto.includes("192.0.2.5"), `IP nel log:\n${tutto}`);
  assert.ok(!tutto.includes("SEGRETO"), `nome nel log:\n${tutto}`);
  assert.ok(tutto.includes("timeout"), "il codice dell'errore resta");
});

test("tipoLetturaApparato: il ramo di «Interroga», scelta unica con il job", () => {
  const tipo = (d: Partial<NetworkDevice>) => withTenant(T, () => tipoLetturaApparato({ ...apparato(5), ...d } as NetworkDevice));
  assert.deepEqual(tipo({ device_type: "hypervisor", scan_target: "proxmox" }), { tipo: "proxmox", etichetta: "Proxmox VE" });
  assert.deepEqual(tipo({ protocol: "winrm", vendor: "windows" }), { tipo: "windows", etichetta: "WinRM" });
  assert.deepEqual(tipo({ vendor: "synology", protocol: "ssh" }), { tipo: "ssh", etichetta: "Storage" });
  assert.deepEqual(tipo({ vendor: "linux", protocol: "ssh" }), { tipo: "ssh", etichetta: "Linux/SSH" });
  // Un router con ARP e community SNMP va in arp_poll, non nell'info SNMP (la tabella ARP la legge solo quel ramo).
  assert.deepEqual(withTenant(T, () => tipoLetturaApparato({ ...apparato(1), classification: "firewall" } as NetworkDevice)), { tipo: "arp_poll", etichetta: "Router" });
  assert.deepEqual(tipo({ device_type: "access_point", classification: "access_point" }), { tipo: "snmp", etichetta: "SNMP" });
  assert.deepEqual(tipo({}), { tipo: "switch", etichetta: "Switch" });
});
