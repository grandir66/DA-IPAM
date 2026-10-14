// Uscita del comando delle schede vive di un nodo Proxmox INVENTATO, con la
// forma vera di iproute2 (`ip -j link show`, senza -d: linkinfo solo dove serve
// a provarne la lettura) e del ciclo sulle velocità di /sys/class/net.
// MAC 02:00:00:…, nessun dato di clienti.

/** `ip -j link show` di un nodo inventato: eno1/eno2 nel bond0, bond0 nel vmbr0, VLAN 40, una tap di VM. */
export const IP_LINK = [
  { ifindex: 1, ifname: "lo", flags: ["LOOPBACK", "UP", "LOWER_UP"], mtu: 65536, qdisc: "noqueue", operstate: "UNKNOWN", linkmode: "DEFAULT", group: "default", txqlen: 1000, link_type: "loopback", address: "00:00:00:00:00:00", broadcast: "00:00:00:00:00:00" },
  { ifindex: 2, ifname: "eno1", flags: ["BROADCAST", "MULTICAST", "SLAVE", "UP", "LOWER_UP"], mtu: 1500, qdisc: "mq", master: "bond0", operstate: "UP", linkmode: "DEFAULT", group: "default", txqlen: 1000, link_type: "ether", address: "02:00:00:00:10:01", broadcast: "ff:ff:ff:ff:ff:ff", permaddr: "02:00:00:00:10:01" },
  { ifindex: 3, ifname: "eno2", flags: ["NO-CARRIER", "BROADCAST", "MULTICAST", "SLAVE", "UP"], mtu: 1500, qdisc: "mq", master: "bond0", operstate: "DOWN", linkmode: "DEFAULT", group: "default", txqlen: 1000, link_type: "ether", address: "02:00:00:00:10:01", broadcast: "ff:ff:ff:ff:ff:ff", permaddr: "02:00:00:00:10:02" },
  { ifindex: 4, ifname: "bond0", flags: ["BROADCAST", "MULTICAST", "MASTER", "UP", "LOWER_UP"], mtu: 1500, qdisc: "noqueue", master: "vmbr0", operstate: "UP", linkmode: "DEFAULT", group: "default", txqlen: 1000, link_type: "ether", address: "02:00:00:00:10:01", broadcast: "ff:ff:ff:ff:ff:ff", linkinfo: { info_kind: "bond", info_data: { mode: "active-backup" } } },
  { ifindex: 5, ifname: "vmbr0", flags: ["BROADCAST", "MULTICAST", "UP", "LOWER_UP"], mtu: 1500, qdisc: "noqueue", operstate: "UP", linkmode: "DEFAULT", group: "default", txqlen: 1000, link_type: "ether", address: "02:00:00:00:10:01", broadcast: "ff:ff:ff:ff:ff:ff" },
  { ifindex: 6, link: "vmbr0", ifname: "vmbr0.40", flags: ["BROADCAST", "MULTICAST", "UP", "LOWER_UP"], mtu: 1500, qdisc: "noqueue", operstate: "UP", linkmode: "DEFAULT", group: "default", txqlen: 1000, link_type: "ether", address: "02:00:00:00:10:01", broadcast: "ff:ff:ff:ff:ff:ff" },
  { ifindex: 7, ifname: "tap100i0", flags: ["BROADCAST", "MULTICAST", "PROMISC", "UP", "LOWER_UP"], mtu: 1500, qdisc: "pfifo_fast", master: "vmbr0", operstate: "UNKNOWN", linkmode: "DEFAULT", group: "default", txqlen: 1000, link_type: "ether", address: "02:00:00:00:20:01", broadcast: "ff:ff:ff:ff:ff:ff" },
  { ifindex: 8, ifname: "fwbr101i0", flags: ["BROADCAST", "MULTICAST", "UP", "LOWER_UP"], mtu: 1500, qdisc: "noqueue", operstate: "UP", linkmode: "DEFAULT", group: "default", txqlen: 1000, link_type: "ether", address: "02:00:00:00:20:02", broadcast: "ff:ff:ff:ff:ff:ff" },
  { ifindex: 9, ifname: "veth102i0", flags: ["BROADCAST", "MULTICAST", "UP", "LOWER_UP"], mtu: 1500, qdisc: "noqueue", master: "fwbr102i0", operstate: "UP", linkmode: "DEFAULT", group: "default", txqlen: 1000, link_type: "ether", address: "02:00:00:00:20:03", broadcast: "ff:ff:ff:ff:ff:ff" },
  { ifindex: 10, ifname: "fwpr101p0", flags: ["BROADCAST", "MULTICAST", "UP", "LOWER_UP"], mtu: 1500, qdisc: "noqueue", master: "vmbr0", operstate: "UP", linkmode: "DEFAULT", group: "default", txqlen: 1000, link_type: "ether", address: "02:00:00:00:20:04", broadcast: "ff:ff:ff:ff:ff:ff" },
  { ifindex: 11, ifname: "fwln101i0", flags: ["BROADCAST", "MULTICAST", "UP", "LOWER_UP"], mtu: 1500, qdisc: "noqueue", master: "fwbr101i0", operstate: "UP", linkmode: "DEFAULT", group: "default", txqlen: 1000, link_type: "ether", address: "02:00:00:00:20:05", broadcast: "ff:ff:ff:ff:ff:ff" },
];

/** La parte delle velocità come la stampa il ciclo `for f in /sys/class/net/*\/speed`. */
export const SPEED_LINES = [
  "/sys/class/net/bond0/speed 1000",
  "/sys/class/net/eno1/speed 1000",
  "/sys/class/net/eno2/speed -1",
  "/sys/class/net/fwbr101i0/speed ",
  "/sys/class/net/lo/speed ",
  "/sys/class/net/tap100i0/speed 10",
  "/sys/class/net/vmbr0/speed ",
  "/sys/class/net/vmbr0.40/speed ",
].join("\n");
