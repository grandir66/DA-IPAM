/**
 * Reti-campione per famiglia (spec topologia §13.12.2; vincolo 9 di Riccardo, 14/10 sera: «il piano deve essere universale»).
 * Ogni famiglia è una rete inventata, scritta nella forma vera delle sue letture — le righe come le scrivono i lettori di oggi:
 * `/ip neighbor` di RouterOS (il contenitore dopo la virgola, il percorso del bridge nella porta remota, il MAC
 * dell'interfaccia che annuncia), il controller (le porte «SFP_ N» nella tabella LLDP, l'uplink, «ethN» del gateway), SNMP (i
 * nomi di porta delle altre marche), la scansione delle VM. Nomi, IP e MAC inventati; i nomi scelti dal cliente hanno il
 * disegno dei nomi veri («BR_…», «VL_…») ma nessuna regola li conosce (I58). Il cliente A e la rete dell'hub sono misure, non
 * famiglie: le loro prove stanno in `model-fixtures.test.ts`. Un caso nuovo visto sul campo diventa prima una riga di una
 * famiglia, poi codice (§13.13.3, punto 15).
 */
import type { ModelNeighborRow, ModelPortRow, TopologyModelInput } from "@/lib/topology/model-types";
import { baseInput, dev, host } from "./righe";

export const ORA = "2026-10-13 11:00:00";
export const ORA_CONTROLLER = "2026-10-13 03:00:00";

/** Una riga dei vicini con i default dei lettori di oggi (LLDP, letta dall'apparato, adesso). */
export function riga(r: Partial<ModelNeighborRow> & Pick<ModelNeighborRow, "device_id" | "local_port">): ModelNeighborRow {
  return { remote_device_name: "", remote_port: "", protocol: "lldp", remote_ip: null, remote_mac: null, timestamp: ORA, source: "device", ...r };
}

/** Le porte di un apparato come le scrive switch_ports: [indice, nome, velocità]. */
export function porte(device_id: number, elenco: Array<[number, string, string | null]>): ModelPortRow[] {
  return elenco.map(([port_index, port_name, speed]) => ({ device_id, port_index, port_name, speed, status: "up", stp_state: null }));
}

const mk = { vendor: "mikrotik", via: "ssh" } as const;

/**
 * Famiglia 1 · Solo MikroTik. Il router di testa (dev:3) ha un bridge dal nome scelto e VLAN dai nomi scelti, e annuncia da ogni
 * interfaccia; un fascio LACP di due cavi verso l'aggregazione (dev:11, un MikroTik), coi membri nel bridge, dove il CDP di uno
 * switch che sta dietro l'aggregazione arriva inoltrato; lo switch (dev:21) tiene il nome di fabbrica del bridge; un secondo
 * router (dev:1) con la porta radice verso l'aggregazione e due cavi diretti verso la testa, dal suo lato fuori dal bridge (in
 * due VRF), dove sente la testa con due MAC da due interfacce e con un nome annunciato diverso da quello dell'inventario; la
 * testa sente il secondo router anche su due VLAN dai nomi scelti, da sola su ognuna; un router virtuale (dev:51), VM
 * dell'hypervisor dev:41, con un tunnel WireGuard verso un router remoto non censito; un EoIP nel bridge; la WAN come VLAN su
 * due porte d'accesso (due modem); un NAS che solo la tabella MAC della testa vede, dietro un fascio. La testa ha l'id più alto
 * del secondo router ma fa da gateway di due reti (I63). Le forme vengono dai casi nati sulla rete dell'hub; la rete no.
 */
export function soloMikrotik(): TopologyModelInput {
  return baseInput({
    devices: [
      dev(1, { name: "RTR-FRONTIERA", device_type: "router", host: "10.1.0.2", ...mk }),
      dev(3, { name: "RTR-TESTA", device_type: "router", host: "10.1.0.1", ...mk }),
      dev(11, { name: "AGG-CRS", host: "10.1.0.11", ...mk }),
      dev(21, { name: "SW-A", host: "10.1.0.21", ...mk }),
      dev(41, { name: "pve-a", device_type: "server", vendor: "proxmox", host: "10.1.0.41", proxmox_scan: 1, port_count: 0 }),
      dev(51, { name: "RTR-VIRTUALE", device_type: "router", host: "10.1.0.51", ...mk }),
    ],
    hosts: [
      host(61, { ip: "10.1.0.61", mac: "02:00:b1:00:61:01", hostname: "NAS-1", classification: "nas" }),
      host(71, { ip: "10.66.0.2", mac: "02:00:b2:00:71:01", hostname: "MODEM-1", classification: "router" }),
      host(72, { ip: "10.66.0.3", mac: "02:00:b2:00:72:01", hostname: "MODEM-2", classification: "router" }),
      host(81, { ip: "10.1.10.1", mac: "02:00:a0:00:03:01" }), // il secondo indirizzo della testa, fuso per MAC
    ],
    knownMacs: [{ device_id: 3, mac: "02:00:a0:00:03:01" }, { device_id: 51, mac: "02:00:a0:00:51:01" }],
    networks: [
      { id: 1, cidr: "10.1.0.0/24", name: "lan", gateway: "10.1.0.1", location_id: null },
      { id: 2, cidr: "10.1.10.0/24", name: "servizi", gateway: "10.1.10.1", location_id: null },
      { id: 3, cidr: "10.66.0.0/24", name: "wan", gateway: null, location_id: null },
    ],
    ports: [
      ...porte(3, [[1, "sfp-sfpplus1", "10000 Mbps"], [3, "sfp-sfpplus3", "10000 Mbps"], [5, "sfp-sfpplus5", "1000 Mbps"], [6, "sfp-sfpplus6", "1000 Mbps"], [21, "sfp28-1", "25000 Mbps"], [22, "sfp28-2", "25000 Mbps"]]),
      ...porte(11, [[2, "sfp-sfpplus2", "10000 Mbps"], [5, "sfp-sfpplus5", "10000 Mbps"], [10, "sfp-sfpplus10", "10000 Mbps"], [21, "sfp28-1", "25000 Mbps"], [22, "sfp28-2", "25000 Mbps"]]),
      ...porte(21, [[1, "sfp-sfpplus1", "10000 Mbps"]]),
      ...porte(1, [[1, "sfp-sfpplus1", "10000 Mbps"], [2, "sfp-sfpplus2", "10000 Mbps"], [4, "sfp-sfpplus4", "10000 Mbps"]]),
      ...porte(51, [[1, "ether1", "1000 Mbps"]]),
    ],
    neighbors: [
      // la testa: il fascio verso l'aggregazione (LLDP sui due membri), e su un membro il CDP inoltrato di SW-A
      riga({ device_id: 3, local_port: "sfp28-1,bond1,BR_RP", remote_device_name: "AGG-CRS", remote_ip: "10.1.0.11", remote_mac: "02:00:a0:00:11:21", remote_port: "BR_AGG/bond1/sfp28-1", remote_platform: "MikroTik" }),
      riga({ device_id: 3, local_port: "sfp28-2,bond1,BR_RP", remote_device_name: "AGG-CRS", remote_ip: "10.1.0.11", remote_mac: "02:00:a0:00:11:22", remote_port: "BR_AGG/bond1/sfp28-2", remote_platform: "MikroTik" }),
      riga({ device_id: 3, local_port: "sfp28-1,bond1,BR_RP", remote_device_name: "SW-A", remote_ip: "10.1.0.21", remote_mac: "02:00:a0:00:21:01", remote_port: "bridge/sfp-sfpplus1", protocol: "mndp", remote_platform: "MikroTik" }),
      riga({ device_id: 3, local_port: "sfp28-2,bond1,BR_RP", remote_device_name: "SW-A", remote_ip: "10.1.0.21", remote_mac: "02:00:a0:00:21:01", remote_port: "bridge/sfp-sfpplus1", protocol: "mndp", remote_platform: "MikroTik" }),
      // la testa sente il secondo router sui due cavi diretti, e su una VLAN dal nome scelto dove è l'unico vicino (H7)
      riga({ device_id: 3, local_port: "sfp-sfpplus1,BR_RP", remote_device_name: "RTR-FRONTIERA", remote_ip: "10.1.0.2", remote_mac: "02:00:a0:00:01:02", remote_port: "sfp-sfpplus2", remote_platform: "MikroTik" }),
      riga({ device_id: 3, local_port: "sfp-sfpplus3,BR_RP", remote_device_name: "RTR-FRONTIERA", remote_ip: "10.1.0.2", remote_mac: "02:00:a0:00:01:04", remote_port: "sfp-sfpplus4", remote_platform: "MikroTik" }),
      riga({ device_id: 3, local_port: "VL_16_QWE", remote_device_name: "RTR-FRONTIERA", remote_ip: "10.1.0.2", remote_mac: "02:00:a0:00:01:16", remote_port: "VL_16_QWE", protocol: "mndp", remote_platform: "MikroTik" }),
      riga({ device_id: 3, local_port: "VL_20_ABC", remote_device_name: "RTR-FRONTIERA", remote_ip: "10.1.0.2", remote_mac: "02:00:a0:00:01:20", remote_port: "VL_20_ABC", protocol: "mndp", remote_platform: "MikroTik" }),
      // la WAN come VLAN dentro il bridge, su due porte d'accesso, un modem ciascuna (G5)
      riga({ device_id: 3, local_port: "sfp-sfpplus5,BR_RP", remote_device_name: "MODEM-1", remote_ip: "10.66.0.2", remote_mac: "02:00:b2:00:71:01", remote_port: "eth0" }),
      riga({ device_id: 3, local_port: "sfp-sfpplus6,BR_RP", remote_device_name: "MODEM-2", remote_ip: "10.66.0.3", remote_mac: "02:00:b2:00:72:01", remote_port: "eth0" }),
      riga({ device_id: 3, local_port: "VL_88_WAN", remote_device_name: "MODEM-1", remote_ip: "10.66.0.2", remote_mac: "02:00:b2:00:71:01", remote_port: "eth0", protocol: "mndp" }),
      riga({ device_id: 3, local_port: "VL_88_WAN", remote_device_name: "MODEM-2", remote_ip: "10.66.0.3", remote_mac: "02:00:b2:00:72:01", remote_port: "eth0", protocol: "mndp" }),
      // un EoIP nel bridge verso una sede non censita: un tunnel, mai un cavo (G2; il tunnel in T3)
      riga({ device_id: 3, local_port: "eoip-sede2,BR_RP", remote_device_name: "RTR-SEDE2", remote_ip: "10.9.0.1", remote_mac: "02:00:a9:00:00:01", remote_port: "eoip-sede1", protocol: "mndp", remote_platform: "MikroTik" }),
      // l'aggregazione (MikroTik letto via SSH): il fascio verso la testa, SW-A, la porta radice del secondo router, l'hypervisor
      riga({ device_id: 11, local_port: "sfp28-1,bond1,BR_AGG", remote_device_name: "RTR-TESTA", remote_ip: "10.1.0.1", remote_mac: "02:00:a0:00:03:21", remote_port: "BR_RP/bond1/sfp28-1", remote_platform: "MikroTik" }),
      riga({ device_id: 11, local_port: "sfp28-2,bond1,BR_AGG", remote_device_name: "RTR-TESTA", remote_ip: "10.1.0.1", remote_mac: "02:00:a0:00:03:22", remote_port: "BR_RP/bond1/sfp28-2", remote_platform: "MikroTik" }),
      riga({ device_id: 11, local_port: "sfp-sfpplus2,BR_AGG", remote_device_name: "SW-A", remote_ip: "10.1.0.21", remote_mac: "02:00:a0:00:21:01", remote_port: "bridge/sfp-sfpplus1", remote_platform: "MikroTik" }),
      riga({ device_id: 11, local_port: "sfp-sfpplus10,BR_AGG", remote_device_name: "RTR-FRONTIERA", remote_ip: "10.1.0.2", remote_mac: "02:00:a0:00:01:01", remote_port: "BR_FX/sfp-sfpplus1", remote_platform: "MikroTik" }),
      riga({ device_id: 11, local_port: "sfp-sfpplus5,BR_AGG", remote_device_name: "pve-a", remote_ip: "10.1.0.41", remote_mac: "02:00:c1:00:41:01", remote_port: "enp1s0f0" }),
      riga({ device_id: 21, local_port: "sfp-sfpplus1,bridge", remote_device_name: "AGG-CRS", remote_ip: "10.1.0.11", remote_mac: "02:00:a0:00:11:02", remote_port: "BR_AGG/sfp-sfpplus2", remote_platform: "MikroTik" }),
      // il secondo router: la porta radice nel suo bridge; i due cavi diretti fuori dal bridge. Sente la testa col nome che lei
      // annuncia (diverso dall'inventario) e dall'indirizzo della WAN: righe non abbinate, e sulla sfp-sfpplus4 con due MAC (I60)
      riga({ device_id: 1, local_port: "sfp-sfpplus1,BR_FX", remote_device_name: "AGG-CRS", remote_ip: "10.1.0.11", remote_mac: "02:00:a0:00:11:10", remote_port: "BR_AGG/sfp-sfpplus10", remote_platform: "MikroTik" }),
      riga({ device_id: 1, local_port: "sfp-sfpplus2", remote_device_name: "testa-ccr", remote_ip: "10.66.0.1", remote_mac: "02:00:a0:00:03:11", remote_port: "BR_RP/sfp-sfpplus1", remote_platform: "MikroTik" }),
      riga({ device_id: 1, local_port: "sfp-sfpplus4", remote_device_name: "testa-ccr", remote_ip: "10.66.0.1", remote_mac: "02:00:a0:00:03:13", remote_port: "BR_RP/sfp-sfpplus3", remote_platform: "MikroTik" }),
      riga({ device_id: 1, local_port: "sfp-sfpplus4", remote_device_name: "testa-ccr", remote_ip: "10.66.0.1", remote_mac: "02:00:a0:00:03:88", remote_port: "VL_88_WAN", remote_platform: "MikroTik" }),
      // il router virtuale: sente la testa attraverso il bridge dell'hypervisor (MNDP, unico vicino); un tunnel WireGuard verso un
      // router nel cloud non censito, in un verso solo (G14: un tunnel, mai un cavo)
      riga({ device_id: 51, local_port: "ether1", remote_device_name: "RTR-TESTA", remote_ip: "10.1.0.1", remote_mac: "02:00:a0:00:03:10", remote_port: "VL_10_LAN", protocol: "mndp", remote_platform: "MikroTik" }),
      riga({ device_id: 51, local_port: "wg-cloud", remote_device_name: "RTR-CLOUD", remote_ip: "198.51.100.1", remote_mac: null, remote_port: "wg-sede", protocol: "mndp", remote_platform: "MikroTik" }),
    ],
    // il NAS lo vede solo la tabella MAC della testa, dietro un fascio senza LLDP (in T3 il partner LACP: H18)
    macPorts: [{ device_id: 3, mac: "02:00:b1:00:61:01", port_name: "bond2", timestamp: ORA, source: "device" }],
    vms: [{ scannedDeviceId: 41, vmid: 100, name: "rtr-virtuale", node: "pve-a", status: "running", type: "qemu", macs: ["02:00:a0:00:51:01"], ips: ["10.1.0.51"], scannedAt: "2026-10-13T06:00:00.000Z" }],
    scanHosts: [{ scannedDeviceId: 41, hostname: "pve-a", ips: ["10.1.0.41"], macs: [] }],
  });
}

const uf = { vendor: "ubiquiti", via: "api" } as const;
const ctrl = (r: Partial<ModelNeighborRow> & Pick<ModelNeighborRow, "device_id" | "local_port">) => riga({ source: "unifi", timestamp: ORA_CONTROLLER, ...r });

/**
 * Famiglia 2 · Solo UniFi, col controller. Il gateway del controller (dev:1, un UDM) è l'unico router, con WAN e LAN verso lo
 * stesso switch (l'aggregazione, dev:2): il controller ne segna come uplink la WAN (SFP+ 1), e il gateway scrive le sue porte
 * come «ethN», che il suo elenco non ha. L'aggregazione ha un'etichetta scritta a mano su una porta («SFP+ 9 - srv-b», che nella
 * tabella LLDP il controller scrive «SFP_ 9 - srv-b») e un nome doppio («SFP+ 5» su due porte a 10G). Uno switch senza spanning
 * tree (dev:4, uplink `disabled` su una porta accesa), un AP cablato (dev:5) e uno in mesh (dev:6); due switch di laboratorio,
 * solo host, dietro uno switch muto sulla porta 20 dello switch da 48 (dev:3).
 */
export function soloUnifi(): TopologyModelInput {
  const mac = (id: number) => `02:00:d0:00:0${id}:00`;
  return baseInput({
    devices: [
      dev(1, { name: "UDM-GW", device_type: "router", host: "10.2.0.1", controller_mac: mac(1), uplink_mac: mac(2), uplink_remote_port: 25, uplink_seen_at: ORA_CONTROLLER, ...uf }),
      dev(2, { name: "USW-AGG", host: "10.2.0.2", controller_mac: mac(2), ...uf }),
      dev(3, { name: "USW-48", host: "10.2.0.3", controller_mac: mac(3), uplink_mac: mac(2), uplink_remote_port: 1, uplink_seen_at: ORA_CONTROLLER, ...uf }),
      dev(4, { name: "FLEX-1", host: "10.2.0.4", controller_mac: mac(4), uplink_mac: mac(3), uplink_remote_port: 7, uplink_seen_at: ORA_CONTROLLER, ...uf }),
      dev(5, { name: "AP-1", device_type: "access_point", host: "10.2.0.5", controller_mac: mac(5), uplink_mac: mac(3), uplink_remote_port: 8, uplink_seen_at: ORA_CONTROLLER, uplink_type: "wire", ...uf }),
      dev(6, { name: "AP-2", device_type: "access_point", host: "10.2.0.6", controller_mac: mac(6), uplink_mac: mac(5), uplink_seen_at: ORA_CONTROLLER, uplink_type: "wireless", ...uf }),
    ],
    hosts: [
      host(7, { ip: "10.2.0.7", mac: "02:00:e0:00:07:01", hostname: "srv-b", classification: "server" }),
      host(8, { ip: "10.2.0.8", mac: "02:00:e0:00:08:01", hostname: "srv-c", classification: "server" }),
      host(31, { ip: "10.2.9.31", mac: "02:00:e0:00:31:01", hostname: "LAB-SW-1", classification: "switch" }),
      host(32, { ip: "10.2.9.32", mac: "02:00:e0:00:32:01", hostname: "LAB-SW-2", classification: "switch" }),
    ],
    uplinkPorts: [
      { device_id: 1, port_index: 10, port_name: "SFP+ 1" }, { device_id: 3, port_index: 49, port_name: "SFP+ 1" },
      { device_id: 4, port_index: 1, port_name: "Port 1" }, { device_id: 5, port_index: 1, port_name: "Port 1" },
    ],
    ports: [
      ...porte(1, [[1, "Port 1", "1000 Mbps"], [10, "SFP+ 1", "10000 Mbps"], [11, "SFP+ 2", "10000 Mbps"]]),
      ...porte(2, [[1, "SFP+ 1", "10000 Mbps"], [2, "SFP+ 2", "10000 Mbps"], [5, "SFP+ 5", "10000 Mbps"], [6, "SFP+ 5", "10000 Mbps"], [9, "SFP+ 9 - srv-b", "10000 Mbps"], [25, "SFP28 25", "25000 Mbps"]]),
      ...porte(3, [[7, "Port 7", "1000 Mbps"], [8, "Port 8", "1000 Mbps"], [20, "Port 20", "1000 Mbps"], [49, "SFP+ 1", "10000 Mbps"], [50, "SFP+ 2", "10000 Mbps"], [51, "SFP 1", "1000 Mbps"]]),
      ...porte(4, [[1, "Port 1", "1000 Mbps"]]).map((p) => ({ ...p, stp_state: "disabled" })),
      ...porte(5, [[1, "Port 1", "1000 Mbps"]]),
    ],
    neighbors: [
      ctrl({ device_id: 3, local_port: "SFP+ 1", remote_device_name: "USW-AGG", remote_mac: mac(2), remote_port: "SFP+ 1" }),
      ctrl({ device_id: 2, local_port: "SFP+ 1", remote_device_name: "USW-48", remote_mac: mac(3), remote_port: "SFP+ 1" }),
      // WAN e LAN del gateway: l'aggregazione e lo switch da 48 lo vedono; lui scrive le sue porte come «ethN»
      ctrl({ device_id: 2, local_port: "SFP28 25", remote_device_name: "UDM-GW", remote_mac: mac(1), remote_port: "eth9" }),
      ctrl({ device_id: 2, local_port: "SFP+ 2", remote_device_name: "UDM-GW", remote_mac: mac(1), remote_port: "eth10" }),
      ctrl({ device_id: 1, local_port: "eth9", remote_device_name: "USW-AGG", remote_mac: mac(2), remote_port: "SFP28 25" }),
      ctrl({ device_id: 1, local_port: "eth10", remote_device_name: "USW-AGG", remote_mac: mac(2), remote_port: "SFP+ 2" }),
      // l'etichetta scritta a mano e il nome doppio, come li scrive il controller nella tabella LLDP
      ctrl({ device_id: 2, local_port: "SFP_ 9 - srv-b", remote_device_name: "srv-b", remote_mac: "02:00:e0:00:07:01", remote_port: "enp1s0" }),
      ctrl({ device_id: 2, local_port: "SFP_ 5", remote_device_name: "srv-c", remote_mac: "02:00:e0:00:08:01", remote_port: "eno1" }),
      ctrl({ device_id: 3, local_port: "Port 7", remote_device_name: "FLEX-1", remote_mac: mac(4), remote_port: "Port 1" }),
      ctrl({ device_id: 3, local_port: "Port 8", remote_device_name: "AP-1", remote_mac: mac(5), remote_port: "eth0" }),
      ctrl({ device_id: 4, local_port: "Port 1", remote_device_name: "USW-48", remote_mac: mac(3), remote_port: "Port 7" }),
      // due switch di laboratorio dietro uno switch muto: la porta 20 sente due apparati (un segmento)
      ctrl({ device_id: 3, local_port: "Port 20", remote_device_name: "LAB-SW-1", remote_mac: "02:00:e0:00:31:01", remote_port: "Port 1" }),
      ctrl({ device_id: 3, local_port: "Port 20", remote_device_name: "LAB-SW-2", remote_mac: "02:00:e0:00:32:01", remote_port: "Port 1" }),
    ],
  });
}

const snmp = { vendor: "cisco", via: "snmp_v2" } as const;

/**
 * Famiglia 3 · Altre marche via SNMP. Le forme delle MIB standard e della documentazione dei produttori, **non osservate su un
 * apparato** (spec §13.12.2): porta locale LLDP tradotta da `lldpLocPortTable` («Gi1/0/24»), CDP fra due Cisco, «1/1/24» di uno
 * switch HP/Aruba. In T1 queste righe passano dal traduttore generico: un router di un'altra marca non perde i cavi che ha
 * (`fisica: null` vale «non logica» per le sue regole), e un'interfaccia logica comune («Vlan100») non dà cavi. Le altre prove
 * di questa famiglia (CDP inoltrato, fasci «Po1» e «Trk1», MSTP) arrivano col modello per cavo, in T3.
 */
export function altreMarcheSnmp(): TopologyModelInput {
  return baseInput({
    devices: [
      dev(1, { name: "RTR-C", device_type: "router", host: "10.3.0.1", ...snmp }),
      dev(2, { name: "SW-C1", host: "10.3.0.2", ...snmp }),
      dev(3, { name: "SW-C2", host: "10.3.0.3", ...snmp }),
      dev(4, { name: "SW-HP1", host: "10.3.0.4", vendor: "aruba", via: "snmp_v2" }),
    ],
    ports: [
      ...porte(1, [[1, "Gi0/0/1", "1000 Mbps"], [100, "Vlan100", null]]),
      ...porte(2, [[1, "Te1/1/1", "10000 Mbps"], [24, "Gi1/0/24", "1000 Mbps"]]),
      ...porte(3, [[1, "Te1/1/1", "10000 Mbps"], [2, "Gi1/0/2", "1000 Mbps"]]),
      ...porte(4, [[24, "1/1/24", "1000 Mbps"]]),
    ],
    neighbors: [
      riga({ device_id: 1, local_port: "Gi0/0/1", remote_device_name: "SW-C1", remote_ip: "10.3.0.2", remote_port: "Gi1/0/24" }),
      riga({ device_id: 1, local_port: "Vlan100", remote_device_name: "SW-C2", remote_ip: "10.3.0.3", remote_port: "Vlan100", protocol: "cdp" }),
      riga({ device_id: 2, local_port: "Gi1/0/24", remote_device_name: "RTR-C", remote_ip: "10.3.0.1", remote_port: "Gi0/0/1" }),
      riga({ device_id: 2, local_port: "Te1/1/1", remote_device_name: "SW-C2", remote_ip: "10.3.0.3", remote_port: "Te1/1/1", protocol: "cdp" }),
      riga({ device_id: 3, local_port: "Te1/1/1", remote_device_name: "SW-C1", remote_ip: "10.3.0.2", remote_port: "Te1/1/1", protocol: "cdp" }),
      riga({ device_id: 3, local_port: "Gi1/0/2", remote_device_name: "SW-HP1", remote_ip: "10.3.0.4", remote_port: "1/1/24" }),
      riga({ device_id: 4, local_port: "1/1/24", remote_device_name: "SW-C2", remote_ip: "10.3.0.3", remote_port: "Gi1/0/2" }),
    ],
  });
}

/**
 * Famiglia 4 · Con hypervisor (inventata). Un router (dev:1), un core del controller (dev:2) e uno switch di accesso (dev:3);
 * due nodi Proxmox (dev:41, dev:42) con la gestione a 1G sull'accesso e i dati a 10G sul core: pve-1 su una porta con
 * l'etichetta scritta a mano («SFP+ 3 - pve-1», che la tabella LLDP del controller scrive «SFP_ 3 - pve-1»), pve-2 su un bond
 * attivo e di riserva di due porte del core che il controller chiama tutte e due «SFP+ 7» (un nome doppio, tutte e due a
 * 10G). Le VM si vedono su tutte e due le porte di ogni nodo; le schede di pve-1 (dati) e di pve-2 (gestione) si
 * annunciano con l'LLDP del firmware, senza nome. Su pve-1 una VM router (dev:51) e una VM firewall registrata come switch (dev:52) che legge la sua tabella MAC: ci sono le sue schede e il MAC
 * di pve-1. La lettura delle VM di pve-2 è vecchia (aprile). Un host che la classificazione dice hypervisor, senza VM né scansione, sta
 * sulla porta 3 dell'accesso.
 */
export function conHypervisor(): TopologyModelInput {
  const M = { rtr: "02:00:f4:00:01:01", core: "02:00:f4:00:02:00", acc: "02:00:f4:00:03:00", hv1: "02:00:f4:00:41:01", hv2: "02:00:f4:00:42:01",
    nic1: "02:00:f4:00:41:a1", nic2: "02:00:f4:00:42:b2", r51: "02:00:f4:00:51:01", fwLan: "02:00:f4:00:52:01", fwWan: "02:00:f4:00:52:02", app: "02:00:f4:01:03:01",
    db: "02:00:f4:02:01:01", web: "02:00:f4:02:02:01" };
  const vm = (scannedDeviceId: number, vmid: number, name: string, node: string, macs: string[], scannedAt: string) =>
    ({ scannedDeviceId, vmid, name, node, status: "running", type: "qemu", macs, ips: [], scannedAt });
  const mp = (device_id: number, mac: string, port_name: string, source = "unifi") => ({ device_id, mac, port_name, timestamp: ORA_CONTROLLER, source });
  return baseInput({
    devices: [
      dev(1, { name: "RTR-H", device_type: "router", host: "10.4.0.1", ...mk }),
      dev(2, { name: "CORE-H", host: "10.4.0.2", controller_mac: M.core, uplink_mac: M.rtr, uplink_seen_at: ORA_CONTROLLER, ...uf }),
      dev(3, { name: "ACC-H", host: "10.4.0.3", controller_mac: M.acc, uplink_mac: M.core, uplink_remote_port: 2, uplink_seen_at: ORA_CONTROLLER, ...uf }),
      dev(41, { name: "pve-1", device_type: "server", vendor: "proxmox", host: "10.4.0.41", proxmox_scan: 1, port_count: 0 }),
      dev(42, { name: "pve-2", device_type: "server", vendor: "proxmox", host: "10.4.0.42", proxmox_scan: 1, port_count: 0 }),
      dev(51, { name: "RTR-VM", device_type: "router", host: "10.4.0.51", ...mk }),
      dev(52, { name: "FW-VM", device_type: "switch", vendor: "stormshield", via: "ssh", host: "10.4.0.52", port_count: 2 }),
    ],
    // un host che la classificazione dice hypervisor, senza VM né scansione: in T1b è un attaccato (I65)
    hosts: [host(49, { ip: "10.4.0.49", mac: "02:00:f4:00:49:01", hostname: "pve-vecchio", classification: "hypervisor" })],
    knownMacs: [{ device_id: 1, mac: M.rtr }, { device_id: 51, mac: M.r51 }, { device_id: 52, mac: M.fwLan }, { device_id: 52, mac: M.fwWan }],
    networks: [{ id: 1, cidr: "10.4.0.0/24", name: "lan", gateway: "10.4.0.1", location_id: null }],
    uplinkPorts: [{ device_id: 2, port_index: 1, port_name: "SFP+ 1" }, { device_id: 3, port_index: 25, port_name: "SFP+ 1" }],
    ports: [
      ...porte(1, [[1, "sfp-sfpplus1", "10000 Mbps"]]),
      ...porte(2, [[1, "SFP+ 1", "10000 Mbps"], [2, "SFP+ 2", "10000 Mbps"], [3, "SFP+ 3 - pve-1", "10000 Mbps"], [7, "SFP+ 7", "10000 Mbps"], [8, "SFP+ 7", "10000 Mbps"]]),
      ...porte(3, [[1, "Port 1", "1000 Mbps"], [2, "Port 2", "1000 Mbps"], [3, "Port 3", "1000 Mbps"], [25, "SFP+ 1", "10000 Mbps"]]),
    ],
    neighbors: [
      riga({ device_id: 1, local_port: "sfp-sfpplus1,bridge", remote_device_name: "CORE-H", remote_mac: M.core, remote_port: "SFP+ 1" }),
      ctrl({ device_id: 2, local_port: "SFP+ 1", remote_device_name: "RTR-H", remote_mac: M.rtr, remote_port: "sfp-sfpplus1", remote_platform: "MikroTik" }),
      ctrl({ device_id: 2, local_port: "SFP+ 2", remote_device_name: "ACC-H", remote_mac: M.acc, remote_port: "SFP+ 1" }),
      ctrl({ device_id: 3, local_port: "SFP+ 1", remote_device_name: "CORE-H", remote_mac: M.core, remote_port: "SFP+ 2" }),
      // l'LLDP del firmware della scheda di pve-1: senza nome, col MAC della scheda come porta
      ctrl({ device_id: 2, local_port: "SFP_ 3 - pve-1", remote_device_name: "", remote_mac: M.nic1, remote_port: M.nic1 }),
      ctrl({ device_id: 3, local_port: "Port 2", remote_device_name: "", remote_mac: M.nic2, remote_port: M.nic2 }),
      // la VM router sente il router attraverso il bridge dell'hypervisor (MNDP)
      riga({ device_id: 51, local_port: "ether1", remote_device_name: "RTR-H", remote_ip: "10.4.0.1", remote_mac: M.rtr, remote_port: "bridge", protocol: "mndp", remote_platform: "MikroTik" }),
    ],
    macPorts: [
      // pve-1: i dati sul core, la gestione sull'accesso; le VM si vedono da tutte e due le parti
      ...[M.hv1, M.r51, M.fwLan, M.app].map((m) => mp(2, m, "SFP+ 3 - pve-1")),
      ...[M.hv1, M.r51, M.fwLan, M.app].map((m) => mp(3, m, "Port 1")),
      // pve-2: il bond sulle due «SFP+ 7» del core; la gestione sull'accesso
      ...[M.hv2, M.db, M.web].map((m) => mp(2, m, "SFP+ 7")),
      ...[M.hv2, M.db, M.web].map((m) => mp(3, m, "Port 2")),
      mp(3, "02:00:f4:00:49:01", "Port 3"),
      // la tabella MAC della VM firewall: le sue schede e pve-1 (stessa rete), mai un cavo verso il suo hypervisor
      mp(52, M.fwLan, "lan", "device"), mp(52, M.fwWan, "wan", "device"), mp(52, M.hv1, "lan", "device"),
    ],
    vms: [
      vm(41, 101, "rtr-vm", "pve-1", [M.r51], "2026-10-13T06:00:00.000Z"),
      vm(41, 102, "fw-vm", "pve-1", [M.fwLan, M.fwWan], "2026-10-13T06:00:00.000Z"),
      vm(41, 103, "srv-app", "pve-1", [M.app], "2026-10-13T06:00:00.000Z"),
      vm(42, 201, "srv-db", "pve-2", [M.db], "2026-04-27T09:00:00.000Z"),
      vm(42, 202, "srv-web", "pve-2", [M.web], "2026-04-27T09:00:00.000Z"),
    ],
    scanHosts: [
      { scannedDeviceId: 41, hostname: "pve-1", ips: ["10.4.0.41"], macs: [M.hv1, M.nic1], scannedAt: "2026-10-13T06:00:00.000Z" },
      { scannedDeviceId: 42, hostname: "pve-2", ips: ["10.4.0.42"], macs: [M.hv2, M.nic2], scannedAt: "2026-04-27T09:00:00.000Z" },
    ],
  });
}

/**
 * Famiglia 5 · Mista (inventata). Un router MikroTik coi nomi di fabbrica (dev:1: `bridge`, nessun fascio) e un secondo
 * router di riserva (dev:2) sullo stesso segmento della WAN, con un modem (host:61): le due porte della WAN sentono due
 * apparati, nessun cavo fra loro. Uno switch del controller (dev:3) e uno switch di un'altra marca letto via SNMP (dev:4),
 * con un telefono IP che si annuncia via CDP (host:81, che la classificazione automatica dice router) e un PC che solo la
 * tabella MAC vede. Un ponte radio che si annuncia (host:71 e host:72) verso il router di una sede (dev:5): oltre la radio il
 * router della sede si sente via LLDP, sulla stessa porta della radio.
 */
export function mista(): TopologyModelInput {
  const M = { r1: "02:00:f5:00:01:01", r2: "02:00:f5:00:02:01", sw: "02:00:f5:00:03:00", cisco: "02:00:f5:00:04:01", sede: "02:00:f5:00:05:01",
    modem: "02:00:f5:00:61:01", radio1: "02:00:f5:00:71:01", radio2: "02:00:f5:00:72:01", tel: "02:00:f5:00:81:01", pc: "02:00:f5:00:91:01" };
  const cisco = { vendor: "cisco", via: "snmp_v2" } as const;
  return baseInput({
    devices: [
      dev(1, { name: "RTR-M", device_type: "router", host: "10.5.0.1", ...mk }),
      dev(2, { name: "RTR-RISERVA", device_type: "router", host: "10.5.0.2", ...mk }),
      dev(3, { name: "USW-M", host: "10.5.0.3", controller_mac: M.sw, uplink_mac: M.r1, uplink_seen_at: ORA_CONTROLLER, ...uf }),
      dev(4, { name: "SW-C", host: "10.5.0.4", ...cisco }),
      dev(5, { name: "RTR-SEDE", device_type: "router", host: "10.5.9.1", ...mk }),
    ],
    hosts: [
      host(61, { ip: "192.0.2.1", mac: M.modem, hostname: "modem", classification: "router" }),
      host(71, { ip: "10.5.0.71", mac: M.radio1, hostname: null, classification: "access_point" }),
      host(72, { ip: "10.5.0.72", mac: M.radio2, hostname: null, classification: "access_point" }),
      host(81, { ip: "10.5.0.81", mac: M.tel, hostname: "SEP0A1B2C3D4E5F", classification: "router" }),
      host(91, { ip: "10.5.0.91", mac: M.pc, hostname: "PC-91", classification: "workstation" }),
    ],
    knownMacs: [{ device_id: 1, mac: M.r1 }, { device_id: 2, mac: M.r2 }, { device_id: 4, mac: M.cisco }, { device_id: 5, mac: M.sede }],
    networks: [
      { id: 1, cidr: "10.5.0.0/24", name: "lan", gateway: "10.5.0.1", location_id: null },
      { id: 2, cidr: "10.5.9.0/24", name: "sede", gateway: "10.5.9.1", location_id: null },
    ],
    uplinkPorts: [{ device_id: 3, port_index: 1, port_name: "Port 1" }],
    ports: [
      ...porte(1, [[1, "ether1", "1000 Mbps"], [2, "ether2", "1000 Mbps"], [5, "ether5", "1000 Mbps"]]),
      ...porte(2, [[1, "ether1", "1000 Mbps"], [2, "ether2", "1000 Mbps"]]),
      ...porte(3, [[1, "Port 1", "1000 Mbps"], [2, "Port 2", "1000 Mbps"], [24, "Port 24", "1000 Mbps"]]),
      ...porte(4, [[5, "Gi1/0/5", "1000 Mbps"], [10, "Gi1/0/10", "1000 Mbps"], [48, "Gi1/0/48", "1000 Mbps"]]),
      ...porte(5, [[1, "ether1", "1000 Mbps"]]),
    ],
    neighbors: [
      // il segmento della WAN: ogni router sente il modem e l'altro router sulla sua ether1
      riga({ device_id: 1, local_port: "ether1", remote_device_name: "modem", remote_mac: M.modem, remote_port: "eth0" }),
      riga({ device_id: 1, local_port: "ether1", remote_device_name: "RTR-RISERVA", remote_mac: M.r2, remote_port: "ether1", remote_platform: "MikroTik" }),
      riga({ device_id: 2, local_port: "ether1", remote_device_name: "modem", remote_mac: M.modem, remote_port: "eth0" }),
      riga({ device_id: 2, local_port: "ether1", remote_device_name: "RTR-M", remote_mac: M.r1, remote_port: "ether1", remote_platform: "MikroTik" }),
      // le LAN dei due router verso lo switch del controller (nomi di fabbrica: «ether2,bridge»)
      riga({ device_id: 1, local_port: "ether2,bridge", remote_device_name: "USW-M", remote_mac: M.sw, remote_port: "Port 1" }),
      riga({ device_id: 2, local_port: "ether2,bridge", remote_device_name: "USW-M", remote_mac: M.sw, remote_port: "Port 2" }),
      // l'annuncio del router attraversa lo switch: sulla LAN il router di riserva lo sente via MNDP, mai un cavo (G6)
      riga({ device_id: 2, local_port: "ether2,bridge", remote_device_name: "RTR-M", remote_mac: M.r1, remote_port: "bridge", protocol: "mndp", remote_platform: "MikroTik" }),
      ctrl({ device_id: 3, local_port: "Port 1", remote_device_name: "RTR-M", remote_mac: M.r1, remote_port: "ether2", remote_platform: "MikroTik" }),
      ctrl({ device_id: 3, local_port: "Port 2", remote_device_name: "RTR-RISERVA", remote_mac: M.r2, remote_port: "ether2", remote_platform: "MikroTik" }),
      // lo switch di un'altra marca: LLDP dai due capi; il telefono via CDP
      ctrl({ device_id: 3, local_port: "Port 24", remote_device_name: "SW-C", remote_mac: M.cisco, remote_port: "Gi1/0/48" }),
      riga({ device_id: 4, local_port: "Gi1/0/48", remote_device_name: "USW-M", remote_mac: M.sw, remote_port: "Port 24" }),
      riga({ device_id: 4, local_port: "Gi1/0/5", remote_device_name: "SEP0A1B2C3D4E5F", remote_mac: M.tel, remote_port: "Port 1", protocol: "cdp", remote_platform: "Cisco IP Phone 8845" }),
      // il ponte radio: il router sente la radio vicina e, attraverso le due radio, il router della sede
      riga({ device_id: 1, local_port: "ether5,bridge", remote_device_name: "", remote_mac: M.radio1, remote_port: "" }),
      riga({ device_id: 1, local_port: "ether5,bridge", remote_device_name: "RTR-SEDE", remote_mac: M.sede, remote_port: "ether1", remote_platform: "MikroTik" }),
      riga({ device_id: 5, local_port: "ether1", remote_device_name: "", remote_mac: M.radio2, remote_port: "" }),
      riga({ device_id: 5, local_port: "ether1", remote_device_name: "RTR-M", remote_mac: M.r1, remote_port: "ether5", remote_platform: "MikroTik" }),
    ],
    macPorts: [{ device_id: 4, mac: M.pc, port_name: "Gi1/0/10", timestamp: ORA, source: "device" }],
  });
}
