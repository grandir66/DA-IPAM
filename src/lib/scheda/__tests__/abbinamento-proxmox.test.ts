/**
 * Abbinamento VM Proxmox <-> host di IPAM (scheda hypervisor, T6). Logica pura con le ricerche iniettate:
 * nessun DB. Dati con la forma vera della scansione (nodo «DA-PX-01», VM con docker 172.17.0.1 in comune).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ModelScanHostRow, ModelVmRow } from "../../topology/model-types";
import { abbinaNodi, abbinaVm, ipsDistintivi, vmDelHost, type HostNoto, type Ricerche } from "../abbinamento-proxmox";

const vm = (o: Partial<ModelVmRow> & { vmid: number; node: string; ips: string[] }): ModelVmRow => ({
  scannedDeviceId: 2, name: `vm${o.vmid}`, status: "running", type: "qemu", macs: [], scannedAt: null, ...o,
});
const nodo = (hostname: string, ips: string[], scannedDeviceId = 2): ModelScanHostRow => ({ scannedDeviceId, hostname, ips, macs: [] });
const host = (id: number, ip: string, hostname: string | null = null, status: string | null = "online"): HostNoto => ({ id, ip, hostname, status });

const HOSTS: HostNoto[] = [host(17, "192.168.4.1", "DA-DC01.domarc.it"), host(51, "192.168.40.3", "DA-PX-03.domarc.it"), host(52, "192.168.40.2", "DA-PX-02"), host(99, "172.17.0.1", "un-docker-qualunque")];
const R: Ricerche = {
  perIp: (ip) => HOSTS.find((h) => h.ip === ip),
  perNome: (n) => HOSTS.find((h) => h.hostname?.toLowerCase() === n.toLowerCase() || h.hostname?.toLowerCase().startsWith(n.toLowerCase() + ".")),
};

describe("ipsDistintivi", () => {
  it("un IP che sta in più VM (docker 172.17.0.1) non identifica nessuna", () => {
    const d = ipsDistintivi([vm({ vmid: 1, node: "A", ips: ["192.168.4.1", "172.17.0.1"] }), vm({ vmid: 2, node: "A", ips: ["172.17.0.1"] })]);
    assert.deepEqual([...d], ["192.168.4.1"]);
  });
});

describe("abbinaVm", () => {
  it("abbina per IP distintivo e salta il docker condiviso anche se esiste un host con quell'IP", () => {
    const r = abbinaVm([vm({ vmid: 401, node: "DA-PX-01", ips: ["172.17.0.1", "192.168.4.1"] }), vm({ vmid: 9, node: "DA-PX-02", ips: ["172.17.0.1"] })], R);
    assert.deepEqual(r, [{ vmid: 401, node: "DA-PX-01", host_id: 17, hostname: "DA-DC01.domarc.it" }]);
  });
  it("VM senza IP o con IP sconosciuti: nessun abbinamento", () => {
    assert.deepEqual(abbinaVm([vm({ vmid: 1, node: "A", ips: [] }), vm({ vmid: 2, node: "A", ips: ["10.9.9.9"] })], R), []);
  });
});

describe("abbinaNodi", () => {
  it("prima per IP delle interfacce, poi per nome; lo stato viene dall'host di IPAM", () => {
    const r = abbinaNodi([nodo("DA-PX-03", ["192.168.40.3"]), nodo("DA-PX-02", []), nodo("DA-PX-09", [])], R);
    assert.deepEqual(r, [
      { nodo: "DA-PX-03", host_id: 51, stato: "online" },
      { nodo: "DA-PX-02", host_id: 52, stato: "online" },
      { nodo: "DA-PX-09", host_id: null, stato: null },
    ]);
  });
});

describe("vmDelHost", () => {
  const scan = (id: number) => ({
    deviceId: id,
    vms: [vm({ vmid: 401, node: "DA-PX-03", ips: ["192.168.4.1"], scannedDeviceId: id }), vm({ vmid: 5, node: "DA-PX-03", ips: ["172.17.0.1"], scannedDeviceId: id }), vm({ vmid: 6, node: "DA-PX-02", ips: ["172.17.0.1"], scannedDeviceId: id })],
    hosts: [nodo("DA-PX-03", ["192.168.40.3"], id)],
  });
  it("la stessa VM vista da cinque scansioni del cluster conta una volta e dà il nodo con la sua scheda", () => {
    const r = vmDelHost("192.168.4.1", [scan(2), scan(3), scan(4), scan(5), scan(6)], R);
    assert.deepEqual(r, { vmid: 401, nodo: "DA-PX-03", nodoHostId: 51, deviceId: 2 });
  });
  it("un IP che sta in due VM diverse non è un'identità: null", () => {
    assert.equal(vmDelHost("172.17.0.1", [scan(2)], R), null);
  });
  it("host che non è VM: null", () => {
    assert.equal(vmDelHost("192.168.40.3", [scan(2)], R), null);
  });
  it("nodo non censito in IPAM: il nome c'è, il link no", () => {
    const s = scan(2);
    s.hosts = [nodo("DA-PX-03", ["10.0.0.3"])];
    const senza: Ricerche = { perIp: (ip) => (ip === "10.0.0.3" ? undefined : R.perIp(ip)), perNome: () => undefined };
    assert.deepEqual(vmDelHost("192.168.4.1", [s], senza), { vmid: 401, nodo: "DA-PX-03", nodoHostId: null, deviceId: 2 });
  });
});
