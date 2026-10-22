/**
 * Elenco VM e striscia della scheda hypervisor (T6). Dati con la forma vera della scansione Proxmox:
 * `agent` arriva come stringa «1»/«0» (il tipo dice number), lo stato del nodo è «unknown».
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ProxmoxScanViewModel } from "@/components/scheda/dati";
import { caselleHypervisor, contaChip, filtraVm, nodoDellaScheda, numeroVm, poolStorage, vlanVm } from "../hypervisor";

type V = NonNullable<ProxmoxScanViewModel["vms"]>[number];
const vm = (o: Partial<V> & { vmid: number; name: string }): V => ({
  node: "DA-PX-01", type: "qemu", status: "running", maxcpu: 2, memory_mb: 4096, disk_gb: 10, ip_addresses: [], agent: "1" as unknown as number, ...o,
});
const VMS: V[] = [
  vm({ vmid: 401, name: "DA-DC01", ip_addresses: ["192.168.4.1"], networks_details: [{ id: "net0", vlan: "4" }] }),
  vm({ vmid: 102, name: "VEEAM-PX-03", status: "stopped", node: "DA-PX-03" }),
  vm({ vmid: 205, name: "test-ubuntu", agent: "0" as unknown as number, ip_addresses: ["192.168.20.9"], networks_details: [{ id: "net0", vlan: "20" }, { id: "net1", vlan: "20" }] }),
  vm({ vmid: 301, name: "ct-pihole", type: "lxc", agent: undefined, ip_addresses: ["192.168.4.53"] }),
];

describe("numeroVm (precedenza di ?? e > nella vecchia etichetta)", () => {
  it("usa _total_vm_rows se c'è, anche se è più grande dell'elenco troncato", () => {
    assert.equal(numeroVm({ vms: VMS, _total_vm_rows: 51 }), 51);
  });
  it("senza _total_vm_rows conta l'elenco; senza niente è 0", () => {
    assert.equal(numeroVm({ vms: VMS }), 4);
    assert.equal(numeroVm({}), 0);
    assert.equal(numeroVm(null), 0);
  });
  it("_total_vm_rows = 0 vale 0, non ricade sull'elenco", () => {
    assert.equal(numeroVm({ vms: VMS, _total_vm_rows: 0 }), 0);
  });
});

describe("contaChip e filtraVm", () => {
  it("accese = running, spente = il resto, senza agente = qemu acceso con agent diverso da 1 (anche stringa)", () => {
    assert.deepEqual(contaChip(VMS), { accese: 3, spente: 1, senza_agente: 1, tutte: 4 });
  });
  it("chip", () => {
    assert.deepEqual(filtraVm(VMS, "spente", "").map((v) => v.vmid), [102]);
    assert.deepEqual(filtraVm(VMS, "senza_agente", "").map((v) => v.vmid), [205]);
    assert.equal(filtraVm(VMS, "tutte", "").length, 4);
  });
  it("ricerca per nome, IP e VLAN, senza badare alle maiuscole, in AND col chip", () => {
    assert.deepEqual(filtraVm(VMS, "tutte", "DC01").map((v) => v.vmid), [401]);
    assert.deepEqual(filtraVm(VMS, "tutte", "192.168.4.").map((v) => v.vmid), [401, 301]);
    assert.deepEqual(filtraVm(VMS, "tutte", "vlan 20").map((v) => v.vmid), [205]);
    assert.deepEqual(filtraVm(VMS, "tutte", "20").map((v) => v.vmid), [205]);
    assert.deepEqual(filtraVm(VMS, "accese", "veeam"), []);
  });
});

describe("vlanVm", () => {
  it("VLAN distinte nell'ordine di scheda; vuote e assenti saltate", () => {
    assert.deepEqual(vlanVm(VMS[2]), ["20"]);
    assert.deepEqual(vlanVm(VMS[3]), []);
  });
});

describe("poolStorage", () => {
  const px: ProxmoxScanViewModel = {
    hosts: [
      { hostname: "DA-PX-01", status: "unknown", storage: [{ name: "NFS", type: "nfs", total_gb: 1000, used_gb: 880 }, { name: "zfs", type: "zfspool", total_gb: 1000, used_gb: 500 }] },
      { hostname: "DA-PX-02", status: "unknown", storage: [{ name: "NFS", type: "nfs", total_gb: 1000, used_gb: 880 }, { name: "zfs", type: "zfspool", total_gb: 1000, used_gb: 700 }] },
    ],
  };
  it("lo storage condiviso (nfs) è una riga «cluster», il locale una per nodo", () => {
    const p = poolStorage(px);
    assert.equal(p.filter((x) => x.nome === "NFS").length, 1);
    assert.equal(p.find((x) => x.nome === "NFS")?.nodo, "cluster");
    assert.equal(p.filter((x) => x.nome === "zfs").length, 2);
  });
  it("striscia: storage peggiore col suo nodo, attenzione da 85%", () => {
    const c = caselleHypervisor(px, { nodi: [] }).find((x) => x.etichetta === "Storage peggiore");
    assert.equal(c?.valore, "88%");
    assert.equal(c?.attenzione, true);
    assert.match(c?.sotto ?? "", /NFS/);
    assert.match(c?.sotto ?? "", /cluster/);
  });
});

describe("caselleHypervisor", () => {
  it("VM accese/totali dall'elenco completo, nodi senza stato letto non finti «online»", () => {
    const px: ProxmoxScanViewModel = { hosts: [{ hostname: "A", status: "unknown" }, { hostname: "B", status: "unknown" }], vms: VMS, _total_vm_rows: 4 };
    const c = caselleHypervisor(px, { nodi: [] });
    assert.equal(c.find((x) => x.etichetta === "VM e container")?.valore, "3 / 4");
    assert.equal(c.find((x) => x.etichetta === "Nodi")?.valore, "2");
  });
  it("RAM del cluster: somma usata su somma totale dei nodi che hanno entrambi", () => {
    const px: ProxmoxScanViewModel = { hosts: [{ hostname: "A", status: "unknown", memory_total_gb: 100, memory_used_gb: 60 }, { hostname: "B", status: "unknown", memory_total_gb: 100, memory_used_gb: 80 }, { hostname: "C", status: "unknown" }] };
    const r = caselleHypervisor(px, { nodi: [] }).find((x) => x.etichetta === "RAM cluster");
    assert.equal(r?.valore, "70%");
  });
  it("abbonamento: tutti attivi -> ✓ attivo con la scadenza più vicina; uno scaduto -> attenzione", () => {
    const attivo = (d: string) => ({ status: "active", nextduedate: d });
    const ok = caselleHypervisor({ hosts: [{ hostname: "A", status: "u", subscription: attivo("2027-05-23") }, { hostname: "B", status: "u", subscription: attivo("2027-01-10") }] }, { nodi: [] }).find((x) => x.etichetta === "Abbonamento");
    assert.match(ok?.valore ?? "", /attivo/);
    assert.match(ok?.sotto ?? "", /01\/2027/);
    const ko = caselleHypervisor({ hosts: [{ hostname: "A", status: "u", subscription: attivo("2027-05-23") }, { hostname: "B", status: "u", subscription: { status: "notfound" } }] }, { nodi: [] }).find((x) => x.etichetta === "Abbonamento");
    assert.equal(ko?.attenzione, true);
  });
  it("senza dati della scansione: nessuna casella", () => {
    assert.deepEqual(caselleHypervisor(null, { nodi: [] }), []);
  });
});

describe("nodoDellaScheda", () => {
  const nodo = { hostname: "DA-PX-03", status: "unknown", network_interfaces: [{ name: "vmbr0", ip_addresses: "192.168.40.3" }, { name: "vlan16", ip_addresses: "192.168.16.3/24, 10.0.0.3" }] };
  it("per IP di una interfaccia (anche con /prefisso o elenco)", () => {
    assert.equal(nodoDellaScheda(nodo, { ip: "192.168.16.3" }), true);
    assert.equal(nodoDellaScheda(nodo, { ip: "10.0.0.3" }), true);
  });
  it("per nome senza dominio, ignorando le maiuscole", () => {
    assert.equal(nodoDellaScheda({ hostname: "DA-PX-03", status: "u" }, { ip: "1.1.1.1", hostname: "da-px-03.domarc.it" }), true);
  });
  it("un altro nodo no", () => {
    assert.equal(nodoDellaScheda(nodo, { ip: "192.168.40.2", hostname: "DA-PX-02" }), false);
  });
});
