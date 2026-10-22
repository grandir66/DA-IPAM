/**
 * Collector `proxmox-ve` esteso verso la parità con la scansione Proxmox di oggi (giro 5): guest con stato, risorse, dischi e
 * reti, storage, nodi. Forme da `pvesh` e dai file di configurazione di Proxmox; dati inventati.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { FIXTURE } from "./contratto-fixture";
import { collectDevice } from "../index";
import { descrittore } from "../catalogo";
import { parseConfigurazioniGuest, parseRisorseCluster } from "../proxmox-parsers";
import type { AcquisitionTransports } from "../schema";
import { assertCommands } from "../transports";
import { cmdAbbonamentoNodo, cmdAgentVm, cmdReportNodo, cmdStatoNodo, parseIpAgent, parseReportNodo, parseStatoNodo } from "../proxmox-parsers";

test("proxmox-ve: guest, storage e nodi dalla fixture; nessun segreto del JSON di pvesh", async () => {
    const { snapshot: s } = await FIXTURE["proxmox-ve"].normale();
    const g = s.guests!.data;
    assert.deepEqual(g.map(x => [x.id, x.power_state, x.platform, x.node, x.vmid, x.cpu_count, x.memory_bytes, x.disk_bytes]), [
        ["qemu/100", "running", "qemu", "pve-lab", 100, 4, "8589934592", "34359738368"],
        ["qemu/101", "off", "qemu", "pve-lab", 101, 2, "2147483648", "10737418240"],
        ["lxc/200", "running", "lxc", "pve-lab", 200, 1, "536870912", "8589934592"],
    ]);
    assert.deepEqual(g[0].disks, [{ id: "scsi0", storage: "local-lvm", size: "32G" }], "il CD-ROM non è un disco; sotto [prima] c'è la configurazione vecchia");
    assert.deepEqual(g[0].networks, [{ id: "net0", model: "virtio", mac: "02:00:00:00:90:10", bridge: "vmbr0", vlan: "20", ip: null }]);
    assert.deepEqual([g[0].bios, g[0].machine, g[0].agent], ["ovmf", "q35", "1"]);
    assert.deepEqual(g[2].disks, [{ id: "rootfs", storage: "local-lvm", size: "8G" }]);
    assert.deepEqual(g[2].networks, [{ id: "net0", model: null, mac: "02:00:00:00:90:20", bridge: "vmbr0", vlan: "30", ip: "192.0.2.200/24" }]);
    assert.deepEqual(s.storage_pools!.data[0], { name: "local-lvm", node: "pve-lab", type: "lvmthin", status: "available", total_bytes: "100000000000", used_bytes: "25000000000", available_bytes: "75000000000", content: ["rootdir", "images"], shared: false });
    assert.deepEqual(s.cluster_nodes!.data[0], { name: "pve-lab", status: "online", uptime_seconds: 86400, cpu_count: 8, cpu_fraction: 0.05, memory_total_bytes: "34359738368", memory_used_bytes: "8589934592" });
    assert.ok(!JSON.stringify(s).includes("non-esportare"));
    assert.equal(s.guests!.status, "ok");
    // l'agent non ha risposto sulla fixture di base: nessun IP, dichiarato «parziale», non più «non raccolto»
    assert.ok(s.guests!.warnings.includes("GUEST_IP_ADDRESSES_PARTIAL") && !s.guests!.warnings.includes("GUEST_IP_ADDRESSES_NOT_COLLECTED"));
    assert.equal(s.guests!.data[0].ip_addresses, undefined);
});

test("proxmox-ve: configurazioni non leggibili (utente senza permesso) → guest senza dischi e reti, sezione parziale e dichiarata", async () => {
    const { PROXMOX_USCITE } = await import("./contratto-fixture");
    const t: AcquisitionTransports = {
        get: async () => { throw Error("x"); }, walk: async () => { throw Error("x"); },
        shell: async c => Object.fromEntries(c.map(x => [x, x.startsWith("grep -H")
            ? { status: "error" as const, data: "", warnings: ["SSH_PERMISSION_DENIED"] }
            : { status: "ok" as const, data: PROXMOX_USCITE[x] ?? "", warnings: [] }])),
    };
    const s = await collectDevice(FIXTURE["proxmox-ve"].richiesta, t);
    assert.equal(s.guests!.data.length, 3, "i guest letti dal cluster restano");
    assert.deepEqual(s.guests!.data[0].disks, []);
    assert.equal(s.guests!.status, "partial");
    assert.ok(s.guests!.warnings.includes("QEMU_CONFIG_NOT_READ") && s.guests!.warnings.includes("LXC_CONFIG_NOT_READ"));
});

test("proxmox-ve: cluster/resources illeggibile → sezioni vuote e parziali, mai un elenco vuoto «ok»", () => {
    assert.equal(parseRisorseCluster("non è json"), null);
    assert.equal(parseRisorseCluster('{"data":[]}'), null);
    assert.deepEqual(parseConfigurazioniGuest("niente di riconoscibile", false).size, 0);
});

test("proxmox-ve: l'allowlist ha i due grep in sola lettura e le sezioni nuove sono dichiarate", () => {
    const d = descrittore("proxmox-ve");
    assert.ok(d.comandi?.includes('grep -H "" /etc/pve/nodes/*/qemu-server/*.conf') && d.comandi.includes('grep -H "" /etc/pve/nodes/*/lxc/*.conf'));
    for (const sez of ["guests", "storage_pools", "cluster_nodes"]) assert.ok(d.sezioni.includes(sez), sez);
});

const STATO = JSON.stringify({ cpuinfo: { model: "CPU Lab 3.0GHz", mhz: "3000.000", sockets: 2, cores: 16, cpus: 32 }, "current-kernel": { release: "6.8.12-4-pve", sysname: "Linux" }, rootfs: { total: 100000000000, used: 25000000000 }, ticket: "non-esportare" });
const ABBONAMENTO = JSON.stringify({ status: "active", level: "c", key: "non-esportare-chiave", productname: "Lab" });
const REPORT = "==== general system info ====\nSystem Information\n\tManufacturer: Lab Corp\n\tProduct Name: LabServer 1\n\tSerial Number: LAB0001\n";
const AGENT = JSON.stringify({ result: [{ name: "lo", "ip-addresses": [{ "ip-address": "127.0.0.1" }] }, { name: "eth0", "ip-addresses": [{ "ip-address": "192.0.2.101" }, { "ip-address": "fe80::1" }, { "ip-address": "192.0.2.101" }] }] });

test("proxmox-ve: dati hardware del nodo e IP delle VM dall'agent (forme del collaudo, dati inventati)", async () => {
    const { PROXMOX_USCITE } = await import("./contratto-fixture");
    const extra: Record<string, string> = {
        [cmdStatoNodo("pve-lab")]: STATO, [cmdAbbonamentoNodo("pve-lab")]: ABBONAMENTO, [cmdReportNodo("pve-lab")]: REPORT, [cmdAgentVm("pve-lab", 100)]: AGENT,
    };
    const chiesti: string[] = [];
    const t: AcquisitionTransports = {
        get: async () => { throw Error("x"); }, walk: async () => { throw Error("x"); },
        shell: async c => { chiesti.push(...c); return Object.fromEntries(c.map(x => [x, { status: "ok" as const, data: extra[x] ?? PROXMOX_USCITE[x] ?? "", warnings: [] }])); },
    };
    const s = await collectDevice(FIXTURE["proxmox-ve"].richiesta, t);
    const n = s.cluster_nodes!.data[0];
    assert.deepEqual([n.cpu_model, n.cpu_mhz, n.cpu_sockets, n.cpu_cores, n.kernel_version, n.rootfs_total_bytes, n.rootfs_used_bytes],
        ["CPU Lab 3.0GHz", 3000, 2, 16, "6.8.12-4-pve", "100000000000", "25000000000"]);
    assert.deepEqual([n.hardware_serial, n.hardware_manufacturer, n.hardware_model, n.subscription_status, n.subscription_level], ["LAB0001", "Lab Corp", "LabServer 1", "active", "c"]);
    assert.deepEqual(s.guests!.data[0].ip_addresses, ["192.0.2.101"], "niente loopback né link-local, senza doppioni");
    assert.equal(s.guests!.data[1].ip_addresses, undefined, "VM spenta: l'agent non si interroga");
    assert.ok(!chiesti.some(c => c.startsWith("pvesh") && (c.includes("/qemu/101/") || c.includes("/lxc/"))), "solo VM QEMU accese");
    assert.ok(!JSON.stringify(s).includes("non-esportare"), "né la chiave dell'abbonamento né il ticket");
    assert.ok(!s.guests!.warnings.includes("GUEST_IP_ADDRESSES_NOT_COLLECTED"));
});

test("proxmox-ve: le letture per nodo/VM mancate sono dichiarate, i dati già letti restano", async () => {
    const { PROXMOX_USCITE } = await import("./contratto-fixture");
    const t: AcquisitionTransports = {
        get: async () => { throw Error("x"); }, walk: async () => { throw Error("x"); },
        shell: async c => Object.fromEntries(c.map(x => [x, x.startsWith("pvesh get /nodes/")
            ? { status: "error" as const, data: "", warnings: ["SSH_PERMISSION_DENIED"] } : { status: "ok" as const, data: PROXMOX_USCITE[x] ?? "", warnings: [] }])),
    };
    const s = await collectDevice(FIXTURE["proxmox-ve"].richiesta, t);
    assert.equal(s.cluster_nodes!.data[0].name, "pve-lab");
    assert.equal(s.cluster_nodes!.data[0].cpu_model, undefined);
    for (const w of ["NODE_STATUS_NOT_READ", "NODE_SUBSCRIPTION_NOT_READ", "NODE_REPORT_NOT_READ"]) assert.ok(s.cluster_nodes!.warnings.includes(w), w);
    assert.equal(s.cluster_nodes!.status, "partial");
    assert.equal(s.guests!.data.length, 3);
});

test("proxmox-ve: allowlist per nodo/VM – solo le tre forme di lettura, nome e id validati", () => {
    assertCommands([cmdStatoNodo("pve-lab"), cmdAbbonamentoNodo("pve-lab"), cmdReportNodo("pve-lab"), cmdAgentVm("pve-lab", 100), "pveversion"], "proxmox-ve");
    for (const c of [
        "pvesh get /nodes/pve-lab/status --output-format json; reboot", "pvesh get /nodes/pve lab/status --output-format json",
        "pvesh get /nodes/$(id)/status --output-format json", "pvesh create /nodes/pve-lab/qemu/100/status/stop",
        "pvesh get /nodes/pve-lab/qemu/100/config --output-format json", "pvesh get /nodes/pve-lab/qemu/1a/agent/network-get-interfaces --output-format json",
        "pvesh get /nodes/pve-lab/qemu/100/agent/exec --output-format json", "pvesh get /nodes/../status --output-format json",
    ]) assert.throws(() => assertCommands([c], "proxmox-ve"), /COMMAND_NOT_ALLOWED/, c);
    // le altre famiglie non ereditano le forme
    assert.throws(() => assertCommands([cmdStatoNodo("pve-lab")], "linux"), /COMMAND_NOT_ALLOWED/);
});

test("proxmox-ve: parser puri – forma sconosciuta = null, mai un oggetto di null", () => {
    assert.equal(parseStatoNodo("non json"), null);
    assert.equal(parseStatoNodo("[]"), null);
    assert.equal(parseReportNodo("niente di utile"), null);
    assert.equal(parseIpAgent("{}"), null);
    assert.deepEqual(parseIpAgent("[]"), []);
});

test("proxmox-ve: proiezione verso l'inventario – nodi e VM come la scansione, campi assenti = restano quelli di prima", async () => {
    const { proiettaProxmox } = await import("../proiezioni/proxmox");
    const { snapshot } = await FIXTURE["proxmox-ve"].normale();
    assert.equal(proiettaProxmox({ ...snapshot, collector: "linux" } as never, null), null, "solo il collector Proxmox");
    assert.equal(proiettaProxmox({ ...snapshot, cluster_nodes: { ...snapshot.cluster_nodes!, status: "error" } }, "{}"), null, "nodi non letti: l'inventario non cambia");
    const prima = JSON.stringify({
        scanned_at: "2026-01-01T00:00:00.000Z", avvisi: ["x"],
        hosts: [{ hostname: "pve-lab", hardware_serial: "LAB0001", cpu_model: "CPU Lab", network_interfaces: [{ name: "vmbr0" }], subscription: null }],
        vms: [{ node: "pve-lab", vmid: 100, ip_addresses: ["192.0.2.101"], name: "vecchio" }],
    });
    const r = proiettaProxmox({ ...snapshot, identity: { ...snapshot.identity, data: { ...snapshot.identity.data!, hostname: "pve-lab" } } }, prima)!;
    assert.equal(r.scanned_at, snapshot.collected_at);
    const h = r.hosts[0];
    assert.deepEqual([h.hostname, h.status, h.cpu_total_cores, h.memory_total_gb, h.proxmox_version], ["pve-lab", "online", 8, 32, "8.2.4"]);
    assert.deepEqual([h.hardware_serial, h.cpu_model, h.network_interfaces.length], ["LAB0001", "CPU Lab", 1], "serial, CPU e schede restano quelli di prima");
    assert.deepEqual(h.storage.map(x => [x.name, x.total_gb, x.used_gb, x.available_gb, x.content]), [["local-lvm", 93.13, 23.28, 69.85, "rootdir,images"]]);
    assert.deepEqual(r.vms.map(v => [v.vmid, v.type, v.status]), [[100, "qemu", "running"], [101, "qemu", "stopped"], [200, "lxc", "running"]]);
    const v = r.vms[0];
    assert.deepEqual([v.name, v.maxcpu, v.memory_mb, v.disk_gb, v.bios, v.machine, v.agent], ["guest-lab", 4, 8192, 32, "ovmf", "q35", "1"]);
    assert.deepEqual(v.ip_addresses, ["192.0.2.101"], "IP non letti adesso: restano quelli della scansione di prima");
    assert.deepEqual(v.disks_details, [{ id: "scsi0", storage: "local-lvm", size: "32G" }]);
    assert.deepEqual(v.networks_details, [{ id: "net0", model: "virtio", mac: "02:00:00:00:90:10", bridge: "vmbr0", vlan: "20" }]);
    assert.deepEqual(r.avvisi, ["x"]);
    // guest non letti: restano le VM di prima, non una mappa vuota
    const senza = proiettaProxmox({ ...snapshot, guests: { ...snapshot.guests!, status: "error", data: [] } }, prima)!;
    assert.deepEqual(senza.vms.map(x => x.vmid), [100]);
    // prima volta, senza risultato precedente: nessun dato inventato
    const nuovo = proiettaProxmox(snapshot, null)!;
    assert.deepEqual([nuovo.hosts[0].hardware_serial, nuovo.hosts[0].cpu_model, nuovo.hosts[0].subscription], [null, null, null]);
    assert.deepEqual(nuovo.vms[0].ip_addresses, []);
});

const DMI: Record<string, string> = {
    "dmidecode -s system-manufacturer": "Lab Corp\n", "dmidecode -s system-product-name": "LabServer 1\n", "dmidecode -s system-serial-number": "LAB0001\n",
};
const trasportoConRisposte = async (extra: Record<string, string>, ricette: (c: string) => string | undefined = () => undefined): Promise<{ s: Awaited<ReturnType<typeof collectDevice>>; chiesti: string[] }> => {
    const { PROXMOX_USCITE } = await import("./contratto-fixture");
    const chiesti: string[] = [];
    const t: AcquisitionTransports = {
        get: async () => { throw Error("x"); }, walk: async () => { throw Error("x"); },
        shell: async c => { chiesti.push(...c); return Object.fromEntries(c.map(x => [x, { status: "ok" as const, data: extra[x] ?? ricette(x) ?? PROXMOX_USCITE[x] ?? "", warnings: [] }])); },
    };
    return { s: await collectDevice(FIXTURE["proxmox-ve"].richiesta, t), chiesti };
};

test("proxmox-ve: il rapporto del nodo non dà l'hardware → modello, seriale e produttore dal DMI del nodo a cui si è connessi", async () => {
    const { s, chiesti } = await trasportoConRisposte({ ...DMI, [cmdStatoNodo("pve-lab")]: STATO, [cmdAbbonamentoNodo("pve-lab")]: ABBONAMENTO, [cmdReportNodo("pve-lab")]: "==== solo versioni ====\npve-manager: 8.2.4\n" });
    const n = s.cluster_nodes!.data[0];
    assert.deepEqual([n.hardware_serial, n.hardware_manufacturer, n.hardware_model], ["LAB0001", "Lab Corp", "LabServer 1"]);
    for (const c of Object.keys(DMI)) assert.ok(chiesti.includes(c), c);
    assert.ok(!s.cluster_nodes!.warnings.includes("NODE_REPORT_NOT_READ"), "l'hardware c'è: niente avviso");
});

test("proxmox-ve: valori segnaposto del DMI non sono un modello né un seriale", async () => {
    const { s } = await trasportoConRisposte({
        "dmidecode -s system-manufacturer": "To Be Filled By O.E.M.\n", "dmidecode -s system-product-name": "Not Specified\n", "dmidecode -s system-serial-number": "Default string\n",
        [cmdReportNodo("pve-lab")]: "niente",
    });
    const n = s.cluster_nodes!.data[0];
    assert.deepEqual([n.hardware_serial, n.hardware_manufacturer, n.hardware_model], [undefined, undefined, undefined]);
    assert.ok(s.cluster_nodes!.warnings.includes("NODE_REPORT_NOT_READ"), "l'hardware non c'è: lo dice");
});

test("proxmox-ve: il DMI si legge solo per il nodo locale, mai per gli altri del cluster", async () => {
    const cluster = JSON.stringify([
        { id: "node/pve-lab", type: "node", node: "pve-lab", status: "online", maxcpu: 8 }, { id: "node/pve-due", type: "node", node: "pve-due", status: "online", maxcpu: 8 },
    ]);
    const stato = JSON.stringify([{ type: "node", name: "pve-lab", local: 0 }, { type: "node", name: "pve-due", local: 1 }]);
    const { s, chiesti } = await trasportoConRisposte({ ...DMI, "pvesh get /cluster/resources --output-format json": cluster, "pvesh get /cluster/status --output-format json": stato });
    assert.equal(chiesti.filter(c => c.startsWith("dmidecode")).length, 3, "una sola serie di tre letture");
    const per = (nome: string) => s.cluster_nodes!.data.find(n => n.name === nome)!;
    assert.equal(per("pve-due").hardware_serial, "LAB0001");
    assert.equal(per("pve-lab").hardware_serial, undefined, "l'altro nodo non eredita il seriale del locale");
});

test("proxmox-ve: rapporto del nodo avvolto in una stringa JSON (pvesh con --output-format json) si legge lo stesso", () => {
    const avvolto = JSON.stringify("==== dmi ====\n\tManufacturer: Lab Corp\n\tSerial Number: LAB0001\n");
    assert.deepEqual(parseReportNodo(avvolto), { hardware_serial: "LAB0001", hardware_model: null, hardware_manufacturer: "Lab Corp" });
});

test("proxmox-ve: allowlist – le tre letture del DMI sì, ogni altra forma di dmidecode no", () => {
    assertCommands(Object.keys(DMI), "proxmox-ve");
    for (const c of ["dmidecode", "dmidecode -t 1", "dmidecode -s system-serial-number; id", "dmidecode -s bios-version", "dmidecode -s system-uuid"])
        assert.throws(() => assertCommands([c], "proxmox-ve"), /COMMAND_NOT_ALLOWED/, c);
    assert.throws(() => assertCommands(Object.keys(DMI), "linux"), /COMMAND_NOT_ALLOWED/);
});

test("proxmox-ve: VM accesa senza agent attivo è normale (nessun avviso), con agent attivo che tace si dichiara", async () => {
    const conf = (agent: string) => (c: string) => c === 'grep -H "" /etc/pve/nodes/*/qemu-server/*.conf'
        ? ["/etc/pve/nodes/pve-lab/qemu-server/100.conf:" + (agent ? "agent: " + agent : "name: x"), "/etc/pve/nodes/pve-lab/qemu-server/100.conf:net0: virtio=02:00:00:00:90:10,bridge=vmbr0", ""].join("\n") : undefined;
    const senza = await trasportoConRisposte({}, conf(""));
    assert.equal(senza.s.guests!.data[0].agent, "0");
    assert.ok(!senza.s.guests!.warnings.includes("GUEST_IP_ADDRESSES_PARTIAL"), "agent non attivo: non è una lettura mancata");
    const con = await trasportoConRisposte({}, conf("1"));
    assert.ok(con.s.guests!.warnings.includes("GUEST_IP_ADDRESSES_PARTIAL"));
});
