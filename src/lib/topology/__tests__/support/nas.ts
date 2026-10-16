// La rete del NAS (piano 2026-10-16, unioni a mano, Task 1): un NAS con tre indirizzi su tre reti, tre MAC di OUI diversi, oggi
// tre nodi. Inventata, nella forma dei casi visti sul campo; nomi, IP e MAC non sono di nessun cliente.
import type { ModelUnioneRow } from "@/lib/topology/unioni-tipi";
import type { TopologyModelInput } from "@/lib/topology/model-types";
import { baseInput, dev, host } from "./righe";
import { riga } from "./reti-campione";

const mk = { vendor: "mikrotik", via: "ssh" } as const;

/**
 * Tre switch MikroTik, uno per rete, ognuno col NAS su ether5. Solo il primo indirizzo ha un nome (il suo hostname e quello che
 * annuncia a SW-ALFA); il secondo e il terzo non annunciano nome. Una correzione «aggiungi» fra il secondo e il terzo indirizzo e
 * una ★ dal secondo verso SW-BETA: dopo l'unione la correzione ha i capi uguali e la ★ vale per il nodo unito.
 */
export function nas(): TopologyModelInput {
  return baseInput({
    devices: [
      dev(1, { name: "SW-ALFA", host: "10.71.1.2", ...mk }),
      dev(2, { name: "SW-BETA", host: "10.71.2.2", ...mk }),
      dev(3, { name: "SW-GAMMA", host: "10.71.3.2", ...mk }),
    ],
    hosts: [
      host(11, { network_id: 1, ip: "10.71.1.20", mac: "02:00:7a:00:01:11", hostname: "QWNAS-7", classification: "nas" }),
      host(12, { network_id: 2, ip: "10.71.2.20", mac: "02:00:7b:00:02:12", classification: "nas" }),
      host(13, { network_id: 3, ip: "10.71.3.20", mac: "02:00:7c:00:03:13", classification: "nas" }),
    ],
    networks: [
      { id: 1, cidr: "10.71.1.0/24", name: "rete-1", gateway: null, location_id: null },
      { id: 2, cidr: "10.71.2.0/24", name: "rete-2", gateway: null, location_id: null },
      { id: 3, cidr: "10.71.3.0/24", name: "rete-3", gateway: null, location_id: null },
    ],
    neighbors: [
      riga({ device_id: 1, local_port: "ether5", remote_ip: "10.71.1.20", remote_device_name: "QWNAS-7", protocol: "lldp", source: "device" }),
      riga({ device_id: 2, local_port: "ether5", remote_ip: "10.71.2.20", protocol: "lldp", source: "device" }),
      riga({ device_id: 3, local_port: "ether5", remote_ip: "10.71.3.20", protocol: "lldp", source: "device" }),
    ],
    overrides: [{ id: 1, action: "add", a_node: "host:12", a_port: "", b_node: "host:13", b_port: "", medium: null }],
    primaries: [{ node_id: "host:12", other_node: "dev:2", node_port: "", other_port: "ether5" }],
  });
}

/** Il NAS promosso ad apparato dal suo primo indirizzo. */
export function nasPromosso(): TopologyModelInput {
  const t = nas();
  t.devices.push(dev(5, { name: "QWNAS-7", host: "10.71.1.20", device_type: "nas", vendor: "generico", host_id: 11 }));
  return t;
}

/** Il NAS censito due volte: dal primo indirizzo e dal secondo («apparato + apparato», Scelte 5). */
export function nasDueApparati(): TopologyModelInput {
  const t = nasPromosso();
  t.devices.push(dev(6, { name: "QWNAS-7-B", host: "10.71.2.20", device_type: "nas", vendor: "generico", host_id: 12 }));
  return t;
}

/** L'unione dei tre indirizzi del NAS, nel gruppo 1 (nessuna prova la modifica: l'indice ne fa una copia). */
export const GRUPPO_NAS: ModelUnioneRow[] = [
  { gruppo: 1, membro: "host:11" }, { gruppo: 1, membro: "host:12" }, { gruppo: 1, membro: "host:13" },
];
