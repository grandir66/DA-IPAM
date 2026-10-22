/**
 * Tipo di scheda dell'apparato (21/10): dalla classificazione canonica, non da `device_type`.
 * Incidente: 22 server dell'hub avevano device_type='switch' (workaround di schema) e la scheda
 * mostrava porte e MAC di uno switch su DA-DC01.
 *
 * Run: DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test src/lib/scheda/__tests__/tipo-scheda.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mikrotikPerTab, tipoScheda, tabDelTipo, bloccoReteGestione, TAB_COMUNI, type InputTipoScheda } from "../tipo-scheda";

const base: InputTipoScheda = { gestito: true, classification: null, device_type: null, vendor: null, scan_target: null };
const t = (o: Partial<InputTipoScheda>) => tipoScheda({ ...base, ...o });
const NO = { ruoli: [], haAd: false, haDipendenze: false, mikrotik: null };

describe("tipoScheda", () => {
  it("DA-DC01 (device_type switch, classificazione server, vendor windows) -> server_windows", () => {
    assert.equal(t({ classification: "server", device_type: "switch", vendor: "windows" }), "server_windows");
  });
  it("da-wazuh -> server_linux", () => {
    assert.equal(t({ classification: "server", device_type: "switch", vendor: "linux" }), "server_linux");
  });
  it("SNS EVA2 (server generico, vendor stormshield) -> firewall", () => {
    assert.equal(t({ classification: "server", device_type: "switch", vendor: "stormshield" }), "firewall");
  });
  it("switch ubiquiti -> switch", () => {
    assert.equal(t({ classification: "switch", device_type: "switch", vendor: "ubiquiti" }), "switch");
  });
  it("classificazione sconosciuta -> generico", () => {
    assert.equal(t({ classification: "pippo_custom", device_type: "switch", vendor: "cisco" }), "generico");
  });
  it("DA-VEEAM: classificazione «windows»/«linux» (slug non canonico) col vendor -> server; la postazione resta generico", () => {
    assert.equal(t({ classification: "windows", device_type: "switch", vendor: "windows" }), "server_windows");
    assert.equal(t({ classification: "windows", device_type: "server", vendor: "windows" }), "server_windows");
    assert.equal(t({ classification: "linux", device_type: "switch", vendor: "linux" }), "server_linux");
    assert.equal(t({ classification: "windows", device_type: "switch" }), "server_windows", "senza vendor: lo dice lo slug");
    assert.equal(t({ classification: "workstation", device_type: "switch", vendor: "windows" }), "generico");
  });
  it("host non gestito -> host", () => {
    assert.equal(t({ gestito: false, classification: "switch" }), "host");
  });
  it("router, load balancer e vpn gateway -> router; nas -> storage", () => {
    assert.equal(t({ classification: "router" }), "router");
    assert.equal(t({ classification: "load_balancer" }), "router");
    assert.equal(t({ classification: "vpn_gateway" }), "router");
    assert.equal(t({ classification: "nas" }), "storage");
  });
  it("hypervisor, e server con scan_target proxmox/vmware -> hypervisor", () => {
    assert.equal(t({ classification: "hypervisor" }), "hypervisor");
    assert.equal(t({ classification: "server", scan_target: "proxmox" }), "hypervisor");
    assert.equal(t({ classification: "server", scan_target: "vmware", vendor: "windows" }), "hypervisor");
  });
  it("server/vm: windows o linux anche da scan_target; senza indizi -> generico", () => {
    assert.equal(t({ classification: "vm", scan_target: "windows" }), "server_windows");
    assert.equal(t({ classification: "server", scan_target: "linux" }), "server_linux");
    assert.equal(t({ classification: "server" }), "generico");
  });
  it("slug vecchio server_windows passa dal canonico", () => {
    assert.equal(t({ classification: "server_windows" }), "server_windows");
  });
  it("senza classificazione si guarda device_type con i ripieghi di db-tenant", () => {
    assert.equal(t({ device_type: "router" }), "router");
    assert.equal(t({ device_type: "firewall" }), "firewall");
    assert.equal(t({ device_type: "hypervisor" }), "hypervisor");
    assert.equal(t({ device_type: "nas" }), "storage");
    assert.equal(t({ device_type: "switch", vendor: "windows" }), "server_windows");
    assert.equal(t({ device_type: "switch", vendor: "linux" }), "server_linux");
    assert.equal(t({ device_type: "switch", vendor: "qnap" }), "storage");
    assert.equal(t({ device_type: "switch", vendor: "synology" }), "storage");
    assert.equal(t({ device_type: "switch", vendor: "stormshield" }), "firewall");
    assert.equal(t({ device_type: "switch", vendor: "cisco" }), "switch");
    assert.equal(t({ classification: "unknown", device_type: "switch", vendor: "cisco" }), "switch");
    assert.equal(t({}), "generico");
  });
});

describe("tabDelTipo", () => {
  it("TAB_COMUNI", () => assert.deepEqual(TAB_COMUNI, ["sicurezza", "gestione", "storico"]));
  it("host non gestito: panoramica + sicurezza, gestione, storico (classificare e annotare dalla scheda)", () => {
    assert.deepEqual(tabDelTipo("host", NO), ["panoramica", "sicurezza", "gestione", "storico"]);
  });
  it("router e firewall MikroTik (SSH): Dispositivi dopo DHCP; VLAN e Bridge solo se c'è almeno un bridge", () => {
    const comuni = ["sicurezza", "gestione", "storico"];
    for (const x of ["router", "firewall"] as const) {
      assert.deepEqual(tabDelTipo(x, { ...NO, mikrotik: { haBridge: false } }), ["panoramica", "interfacce", "routing", "dhcp", "dispositivi", "configurazione", ...comuni], x);
      assert.deepEqual(tabDelTipo(x, { ...NO, mikrotik: { haBridge: true } }), ["panoramica", "interfacce", "vlan", "bridge", "routing", "dhcp", "dispositivi", "configurazione", ...comuni], x);
    }
  });
  it("un firewall Stormshield (mikrotik null) tiene le tab di oggi, e il bridge non cambia gli altri tipi", () => {
    assert.deepEqual(tabDelTipo("firewall", NO), ["panoramica", "interfacce", "routing", "dhcp", "configurazione", "sicurezza", "gestione", "storico"]);
    assert.deepEqual(tabDelTipo("switch", { ...NO, mikrotik: { haBridge: true } }), ["panoramica", "porte", "vlan", "vicini", "sicurezza", "gestione", "storico"]);
  });
  it("switch: panoramica, porte, vlan, vicini + comuni, senza dettagli (T3)", () => {
    assert.deepEqual(tabDelTipo("switch", NO), ["panoramica", "porte", "vlan", "vicini", "sicurezza", "gestione", "storico"]);
  });
  it("router e firewall: panoramica, interfacce, routing, dhcp, configurazione + comuni, senza dettagli (T4)", () => {
    for (const x of ["router", "firewall"] as const) {
      assert.deepEqual(tabDelTipo(x, NO), ["panoramica", "interfacce", "routing", "dhcp", "configurazione", "sicurezza", "gestione", "storico"], x);
    }
  });
  it("storage: panoramica, dischi, volumi, servizi_nas + comuni, senza dettagli (T5)", () => {
    assert.deepEqual(tabDelTipo("storage", NO), ["panoramica", "dischi", "volumi", "servizi_nas", "sicurezza", "gestione", "storico"]);
  });
  it("hypervisor: panoramica, vm, nodi, storage_px, rete_px + comuni, senza dettagli (T6)", () => {
    assert.deepEqual(tabDelTipo("hypervisor", NO), ["panoramica", "vm", "nodi", "storage_px", "rete_px", "sicurezza", "gestione", "storico"]);
  });
  it("server Windows: sistema, servizi, aggiornamenti, software, utenti + comuni, senza dettagli (T7)", () => {
    assert.deepEqual(tabDelTipo("server_windows", NO), ["panoramica", "sistema", "servizi", "aggiornamenti", "software", "utenti", "sicurezza", "gestione", "storico"]);
  });
  it("server Windows: «Active Directory» solo se DC E l'integrazione ha dati", () => {
    const base = ["panoramica", "sistema", "servizi", "aggiornamenti", "software", "utenti"];
    const comuni = ["sicurezza", "gestione", "storico"];
    assert.deepEqual(tabDelTipo("server_windows", { ruoli: ["dc", "dns"], haAd: true, haDipendenze: false, mikrotik: null }), [...base, "ad", ...comuni], "DC con dati AD");
    assert.deepEqual(tabDelTipo("server_windows", { ruoli: ["dc"], haAd: false, haDipendenze: false, mikrotik: null }), [...base, ...comuni], "DC senza dati AD");
    assert.deepEqual(tabDelTipo("server_windows", { ruoli: ["database"], haAd: true, haDipendenze: false, mikrotik: null }), [...base, ...comuni], "dati AD ma non DC");
  });
  it("server: «Dipendenze» solo se ce ne sono, dopo Utenti/AD e prima delle comuni", () => {
    assert.deepEqual(tabDelTipo("server_windows", { ruoli: ["dc"], haAd: true, haDipendenze: true, mikrotik: null }),
      ["panoramica", "sistema", "servizi", "aggiornamenti", "software", "utenti", "ad", "dipendenze", "sicurezza", "gestione", "storico"]);
    assert.deepEqual(tabDelTipo("server_linux", { ruoli: [], haAd: false, haDipendenze: true, mikrotik: null }),
      ["panoramica", "sistema", "servizi", "aggiornamenti", "utenti", "dipendenze", "sicurezza", "gestione", "storico"]);
  });
  it("server Linux: sistema, servizi, aggiornamenti (pacchetti), utenti + comuni; mai «ad» né «software»", () => {
    assert.deepEqual(tabDelTipo("server_linux", NO), ["panoramica", "sistema", "servizi", "aggiornamenti", "utenti", "sicurezza", "gestione", "storico"]);
    assert.ok(!tabDelTipo("server_linux", { ruoli: ["dc"], haAd: true, haDipendenze: false, mikrotik: null }).includes("ad"));
  });
  it("generico: ancora panoramica, dettagli + comuni", () => {
    assert.deepEqual(tabDelTipo("generico", NO), ["panoramica", "dettagli", "sicurezza", "gestione", "storico"]);
  });
});

describe("bloccoReteGestione", () => {
  it("mostra in Gestione solo ciò che le tab del tipo non mostrano già", () => {
    assert.deepEqual(bloccoReteGestione("switch"), { snmp: true, ipMappa: false }, "IP e mappa stanno in Vicini e MAC");
    assert.deepEqual(bloccoReteGestione("router"), { snmp: false, ipMappa: false }, "in Interfacce e Configurazione");
    assert.deepEqual(bloccoReteGestione("firewall"), { snmp: false, ipMappa: false });
    assert.deepEqual(bloccoReteGestione("hypervisor"), { snmp: true, ipMappa: false }, "IP e mappa stanno in Rete");
    assert.deepEqual(bloccoReteGestione("storage"), { snmp: true, ipMappa: true });
    assert.deepEqual(bloccoReteGestione("server_windows"), { snmp: false, ipMappa: true }, "SNMP sta in Sistema");
    assert.deepEqual(bloccoReteGestione("server_linux"), { snmp: false, ipMappa: true });
    assert.deepEqual(bloccoReteGestione("generico"), { snmp: false, ipMappa: false }, "stanno in Dettagli");
    assert.deepEqual(bloccoReteGestione("host"), { snmp: true, ipMappa: true });
  });
});

describe("mikrotikPerTab (caso 5 del piano)", () => {
  const base = { vendor: "mikrotik", protocol: "ssh" };
  it("VLAN e Bridge solo con la lettura della topologia accesa E almeno un bridge", () => {
    assert.deepEqual(mikrotikPerTab({ ...base, mikrotik: { bridge: 1, letto_il: "x", topologia_accesa: true } }), { haBridge: true });
    assert.deepEqual(mikrotikPerTab({ ...base, mikrotik: { bridge: 1, letto_il: "x", topologia_accesa: false } }), { haBridge: false }, "righe rimaste da prima dello spegnimento");
    assert.deepEqual(mikrotikPerTab({ ...base, mikrotik: { bridge: 0, letto_il: null, topologia_accesa: true } }), { haBridge: false });
    assert.deepEqual(mikrotikPerTab({ ...base, mikrotik: null }), { haBridge: false });
    assert.equal(mikrotikPerTab({ vendor: "mikrotik", protocol: "snmp_v2", mikrotik: null }), null);
    const tabs = tabDelTipo("router", { ruoli: [], haAd: false, haDipendenze: false, mikrotik: mikrotikPerTab({ ...base, mikrotik: { bridge: 1, letto_il: "x", topologia_accesa: false } }) });
    assert.equal(tabs.includes("vlan") || tabs.includes("bridge"), false);
  });
});
