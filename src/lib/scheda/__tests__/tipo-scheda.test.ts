/**
 * Tipo di scheda dell'apparato (21/10): dalla classificazione canonica, non da `device_type`.
 * Incidente: 22 server dell'hub avevano device_type='switch' (workaround di schema) e la scheda
 * mostrava porte e MAC di uno switch su DA-DC01.
 *
 * Run: DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test src/lib/scheda/__tests__/tipo-scheda.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { tipoScheda, tabDelTipo, TAB_COMUNI, type InputTipoScheda } from "../tipo-scheda";

const base: InputTipoScheda = { gestito: true, classification: null, device_type: null, vendor: null, scan_target: null };
const t = (o: Partial<InputTipoScheda>) => tipoScheda({ ...base, ...o });
const NO = { ruoli: [], haAd: false, haDipendenze: false };

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
  it("host: solo panoramica, sicurezza, storico", () => {
    assert.deepEqual(tabDelTipo("host", NO), ["panoramica", "sicurezza", "storico"]);
  });
  it("gli altri tipi: panoramica, dettagli + comuni", () => {
    for (const x of ["switch", "router", "firewall", "storage", "hypervisor", "server_windows", "server_linux", "generico"] as const) {
      assert.deepEqual(tabDelTipo(x, NO), ["panoramica", "dettagli", "sicurezza", "gestione", "storico"], x);
    }
  });
});
