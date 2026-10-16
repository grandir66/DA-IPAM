// Le reti-campione delle famiglie 1 e 2 con i fatti che T2 legge nella forma dei lettori (stessi di cavi-ombra.test.ts e
// cavi-mappa.test.ts, che un .test.ts non esporta): per le prove di tappa di T3 (Task 12).
import fs from "node:fs";
import path from "node:path";
import type { IngressoCavi } from "@/lib/topology/cavi/prove";
import type { ModelVmRow, TopologyModelInput } from "@/lib/topology/model-types";
import { dev } from "./righe";
import { letturaA, letturaB, letturaC, letturaD } from "./quattro-letture";
import { altreMarcheSnmp, conHypervisor, mista, porte, riga, soloMikrotik, soloUnifi } from "./reti-campione";
import { fb, fp, ingresso } from "./cavi";

export const devFatto = (id: number, k: string, n: string, over: Parameters<typeof fp>[3] = {}) => fp(id, k, n, { source: "device", in_bridge: 1, ...over });
export const macs = (device_id: number, l: string[]) => l.map((mac) => ({ device_id, mac, source: "device" }));
export const ingMikrotik = (t1: TopologyModelInput = soloMikrotik()): IngressoCavi => ingresso(t1, {
  fattiBridge: [
    fb(3, { bridge_name: "BR_RP", bridge_id: "0.02:00:a0:00:03:00", root_id: "0.02:00:a0:00:03:00" }),
    fb(11, { bridge_name: "BR_AGG", bridge_id: "32768.02:00:a0:00:11:00", root_id: "0.02:00:a0:00:03:00", root_port: "bond1" }),
    fb(1, { bridge_name: "BR_FX", bridge_id: "32768.02:00:a0:00:01:00", root_id: "0.02:00:a0:00:03:00", root_port: "sfp-sfpplus1" }),
  ],
  fattiPorta: [
    devFatto(3, "n:sfp28-1", "sfp28-1", { lag_group: "bond1", lag_partner: "02:00:A0:00:11:00" }), devFatto(3, "n:sfp28-2", "sfp28-2", { lag_group: "bond1", lag_partner: "02:00:A0:00:11:00" }),
    devFatto(3, "n:bond1", "bond1", { if_kind: "lag", lag_group: "bond1", stp_role: "designated", stp_state: "forwarding", edge: 0, bpdu_rx: 10 }),
    devFatto(3, "n:sfp-sfpplus1", "sfp-sfpplus1", { stp_role: "designated", stp_state: "forwarding", edge: 1, bpdu_rx: 0 }),
    devFatto(3, "n:sfp-sfpplus3", "sfp-sfpplus3", { stp_role: "designated", stp_state: "forwarding", edge: 1, bpdu_rx: 0 }),
    devFatto(11, "n:sfp28-1", "sfp28-1", { lag_group: "bond1", lag_partner: "02:00:A0:00:03:00" }), devFatto(11, "n:sfp28-2", "sfp28-2", { lag_group: "bond1", lag_partner: "02:00:A0:00:03:00" }),
    devFatto(11, "n:bond1", "bond1", { if_kind: "lag", lag_group: "bond1", stp_role: "root", stp_state: "forwarding", sending_rstp: 1, designated_bridge: "0.02:00:a0:00:03:00" }),
    devFatto(1, "n:sfp-sfpplus1", "sfp-sfpplus1", { stp_role: "root", stp_state: "forwarding", sending_rstp: 1, designated_bridge: "32768.02:00:a0:00:11:00" }),
    devFatto(1, "n:sfp-sfpplus2", "sfp-sfpplus2", { in_bridge: 0 }), devFatto(1, "n:sfp-sfpplus4", "sfp-sfpplus4", { in_bridge: 0 }),
  ],
  macApparati: [
    ...macs(3, ["02:00:A0:00:03:00", "02:00:A0:00:03:01", "02:00:A0:00:03:10", "02:00:A0:00:03:11", "02:00:A0:00:03:13", "02:00:A0:00:03:21", "02:00:A0:00:03:22", "02:00:A0:00:03:88"]),
    ...macs(11, ["02:00:A0:00:11:00", "02:00:A0:00:11:02", "02:00:A0:00:11:10", "02:00:A0:00:11:21", "02:00:A0:00:11:22"]),
    ...macs(1, ["02:00:A0:00:01:01", "02:00:A0:00:01:02", "02:00:A0:00:01:04", "02:00:A0:00:01:16", "02:00:A0:00:01:20"]),
  ],
});
export const ingUnifi = (): IngressoCavi => ingresso(soloUnifi(), {
  uplink: [{ device_id: 1, uplink_local_port_idx: 10, uplink_source: "lldp_uplink" }, { device_id: 4, uplink_local_port_idx: 1, uplink_source: "lldp_uplink" }],
  fattiPorta: [fp(4, "i:1", "Port 1", { stp_state: "disabled" })],
});


// ── L'elenco di tutte le reti di prova: le cinque famiglie, la rete in quattro letture, le due fixture anonime ──────────────

/** L'ingresso di una fixture anonima delle reti vere (le tabelle che la fixture non ha sono vuote). */
export const caricaFixture = (nome: string): TopologyModelInput => ({ macPorts: [], primaries: [], portInfo: [], vms: [], scanHosts: [],
  ...JSON.parse(fs.readFileSync(path.join(__dirname, "..", "fixtures", nome), "utf8")) } as TopologyModelInput);

/** Ogni rete di prova con l'ingresso del modello di oggi (senza i fatti di T2). */
export const RETI_T1: ReadonlyArray<readonly [string, () => TopologyModelInput]> = [
  ["famiglia 1 · solo MikroTik", soloMikrotik], ["famiglia 2 · solo UniFi", soloUnifi], ["famiglia 3 · altre marche via SNMP", altreMarcheSnmp],
  ["famiglia 4 · con hypervisor", conHypervisor], ["famiglia 5 · mista", mista],
  ["la rete in quattro letture, A", () => letturaA().t1], ["la rete in quattro letture, B", () => letturaB().t1],
  ["la rete in quattro letture, C", () => letturaC().t1], ["la rete in quattro letture, D", () => letturaD().t1],
  ["fixture della rete B", () => caricaFixture("topologia-domarc.json")], ["fixture del cliente A", () => caricaFixture("topologia-cliente-a.json")],
];

/** Ogni rete di prova con l'ingresso del modello per cavo (coi fatti di T2 dove le abbiamo: famiglie 1 e 2, le quattro letture). */
export const RETI_CAVI: ReadonlyArray<readonly [string, () => IngressoCavi]> = [
  ["famiglia 1 · solo MikroTik", () => ingMikrotik()], ["famiglia 2 · solo UniFi", ingUnifi], ["famiglia 3 · altre marche via SNMP", () => ingresso(altreMarcheSnmp())],
  ["famiglia 4 · con hypervisor", () => ingresso(conHypervisor())], ["famiglia 4 · con gli accessi che vedono solo le VM", () => ingresso(conHypervisorEAltri())],
  ["famiglia 5 · mista", () => ingresso(mista())],
  ["la rete in quattro letture, A", letturaA], ["la rete in quattro letture, B", letturaB], ["la rete in quattro letture, C", letturaC], ["la rete in quattro letture, D", letturaD],
  ["fixture della rete B", () => ingresso(caricaFixture("topologia-domarc.json"))], ["fixture del cliente A", () => ingresso(caricaFixture("topologia-cliente-a.json"))],
];

const vmRow = (scannedDeviceId: number, vmid: number, name: string, node: string, macs: string[]): ModelVmRow =>
  ({ scannedDeviceId, vmid, name, node, status: "running", type: "qemu", macs, ips: [], scannedAt: "2026-10-13T06:00:00.000Z" });

/**
 * La famiglia 4 con due accessi in più dove si vedono solo le VM (S11, I56; i tre cavi inventati verso l'hypervisor 2 dell'hub sono
 * questa forma): su ACC-H2 la porta 5 vede solo una VM di pve-1 (un collegamento «solo dalle VM» che non è il principale di pve-1) e
 * pve-3, con una VM sola su ACC-H, tiene il suo principale.
 */
export function conHypervisorEAltri(): TopologyModelInput {
  const t1 = conHypervisor();
  t1.devices.push(dev(4, { name: "ACC-H2", host: "10.4.0.4", vendor: "ubiquiti", via: "api" }),
    dev(43, { name: "pve-3", device_type: "server", vendor: "proxmox", host: "10.4.0.43", proxmox_scan: 1, port_count: 0 }));
  t1.ports = [...(t1.ports ?? []), ...porte(4, [[5, "Port 5", "1000 Mbps"], [25, "SFP+ 1", "10000 Mbps"]]), ...porte(3, [[4, "Port 4", "1000 Mbps"]]), ...porte(2, [[4, "SFP+ 4", "10000 Mbps"]])];
  t1.knownMacs.push({ device_id: 4, mac: "02:00:f4:00:04:00" });
  t1.neighbors.push(
    riga({ device_id: 2, local_port: "SFP+ 4", remote_device_name: "ACC-H2", remote_mac: "02:00:f4:00:04:00", remote_port: "SFP+ 1", source: "unifi", timestamp: "2026-10-13 03:00:00" }),
    riga({ device_id: 4, local_port: "SFP+ 1", remote_device_name: "CORE-H", remote_mac: "02:00:f4:00:02:00", remote_port: "SFP+ 4", source: "unifi", timestamp: "2026-10-13 03:00:00" }),
  );
  t1.macPorts.push({ device_id: 4, mac: "02:00:f4:01:04:01", port_name: "Port 5", timestamp: "2026-10-13 03:00:00", source: "unifi" },
    { device_id: 3, mac: "02:00:f4:03:01:01", port_name: "Port 4", timestamp: "2026-10-13 03:00:00", source: "unifi" });
  t1.vms.push(vmRow(41, 104, "srv-x", "pve-1", ["02:00:f4:01:04:01"]), vmRow(43, 301, "srv-solo", "pve-3", ["02:00:f4:03:01:01"]));
  t1.scanHosts.push({ scannedDeviceId: 43, hostname: "pve-3", ips: ["10.4.0.43"], macs: ["02:00:f4:00:43:01"], scannedAt: "2026-10-13T06:00:00.000Z" });
  return t1;
}
