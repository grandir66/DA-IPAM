// La rete-campione in quattro letture (spec topologia §13.12.2, G16, I38; Task 12 del piano di T3): UNA topologia inventata, scritta
// nella forma di quattro modi di leggerla, e `uguale` che dice a parole in che cosa due letture differiscono.
//
//  - A: MikroTik letti via SSH (`/ip neighbor`, i fatti di T2: bridge, fascio, tunnel) per il router di testa, il router di
//       riserva e il router della sede 2; controller (righe `unifi`, uplink per indice, `stp_state`, `lag_idx`) per i due core e
//       i tre switch di accesso. È il riferimento.
//  - B: tutta la rete letta via SNMP da apparati Cisco in Rapid-PVST: porta locale LLDP tradotta («Gi1/0/24»), BRIDGE-MIB della
//       VLAN 1 (porta radice per nome), il fascio «Po1» (`ifType` 161, gruppo «if:<indice>»), le porte fuori dal bridge perché la
//       BRIDGE-MIB non le elenca. Tutta la rete tranne l'EoIP (nessun tunnel nella MIB) e gli annunci di segmento (MNDP).
//  - C: tutta la rete letta via SNMP da apparati HP/Aruba in MSTP: il ruolo nell'albero comune e un'istanza, il fascio «Trk1»,
//       `lldpRemPortId` numerico («24», non «1/1/24»), nessuna porta designata nei fatti. Come B.
//  - D: l'hypervisor letto dal suo lato (`lldpcli -f json0 show neighbors details`, fonte `host`) con il bond `active-backup`
//       (`lag_state`): le righe di A senza quelle che gli switch scrivono sull'hypervisor, più le righe e i fatti dell'host.
//
// ATTENZIONE: B e C non sono letture vere. Le forme sono dedotte dalle MIB standard, scritte da chi ha scritto anche i lettori
// e il modello: provano la COERENZA fra le forme (lo stesso modello dà gli stessi collegamenti comunque si legga la rete), non
// l'indipendenza dal prodotto. Quella si prova solo con una lettura SNMP vera (spec §13.5.4), e oggi SNMP è spento.
//
// La topologia (nomi, MAC e VLAN inventati, nessun dato vero):
//   RT-TESTA (R, router di testa, radice dell'albero comune) — fascio bond1 (2 × 25G) con CORE-1; ether2 fuori dal bridge verso
//   ACC-1 porta 47 (2,5G, instradato); ether3 verso la radio vicina; ether8 fuori dal bridge sul segmento della WAN; un EoIP verso
//   RT-SEDE2 (solo A). CORE-1 (porta radice: il fascio verso R): porte 9, 11, 12 verso ACC-1, ACC-2, ACC-3 (10G). CORE-2: porta 11
//   verso ACC-3 porta 49 (la sua porta radice); porte 9 e 12 verso ACC-1 e ACC-2 porta 50, bloccate dal suo lato (anomalia «core che
//   esce da uno switch di accesso»). ACC-2 porta 16 verso RT-RISERVA porta 2. RT-RISERVA porta 1 sul segmento della WAN con RT-TESTA
//   e un modem non gestito. RADIO-V ≋ RADIO-L (salto radio); RADIO-L verso RT-SEDE2. HV-1 (hypervisor): ens1 verso CORE-1 porta 20
//   (attiva), ens2 verso ACC-3 porta 20 (riserva del bond).
import type { FattoBridge, FattoPorta, IngressoCavi, ViciniCaviRow } from "@/lib/topology/cavi/prove";
import { modelloMappaDaIngresso } from "@/lib/topology/cavi/mappa";
import type { Collegamento } from "@/lib/topology/cavi/collegamenti";
import type { TopologyModelInput } from "@/lib/topology/model-types";
import { fb, fp, ingresso, ORA_T2, vic } from "./cavi";
import { porte } from "./reti-campione";
import { baseInput, dev } from "./righe";

export type Lettura = "A" | "B" | "C" | "D";
type Gruppo = "mk" | "ctrl" | "altro";

/** Gli id degli apparati, uguali in tutte le letture. */
export const ID = { R: 1, RR: 2, R2S: 3, V: 5, L: 6, C1: 11, C2: 12, A1: 21, A2: 22, A3: 23, H: 31 } as const;
export const N = Object.fromEntries(Object.entries(ID).map(([k, v]) => [k, `dev:${v}`])) as { [K in keyof typeof ID]: string };

interface Disp {
  id: number; nome: string; tipo: "router" | "switch" | "server"; ip: string; mac: string; gruppo: Gruppo;
  /** indice → velocità (Mbps). */
  porte: Record<number, number>;
  /** Legge i vicini propri (l'hypervisor solo in D, le radio mai). */
  legge: boolean;
  bridge?: string;
}

const mac = (n: number, p = 0): string => `02:00:a1:00:${n.toString(16).padStart(2, "0")}:${p.toString(16).padStart(2, "0")}`;

const DISP: Disp[] = [
  { id: ID.R, nome: "RT-TESTA", tipo: "router", ip: "10.20.0.1", mac: mac(1), gruppo: "mk", legge: true, bridge: "BR_RP",
    porte: { 1: 25000, 2: 25000, 3: 2500, 4: 1000, 5: 1000, 6: 1000 } },
  { id: ID.RR, nome: "RT-RISERVA", tipo: "router", ip: "10.20.0.2", mac: mac(2), gruppo: "mk", legge: true, bridge: "BR_RS", porte: { 1: 1000, 2: 1000 } },
  { id: ID.R2S, nome: "RT-SEDE2", tipo: "router", ip: "10.20.9.1", mac: mac(3), gruppo: "mk", legge: true, bridge: "BR_S2", porte: { 3: 1000, 6: 1000 } },
  { id: ID.V, nome: "RADIO-V", tipo: "server", ip: "10.20.0.5", mac: mac(5), gruppo: "altro", legge: false, porte: {} },
  { id: ID.L, nome: "RADIO-L", tipo: "server", ip: "10.20.0.6", mac: mac(6), gruppo: "altro", legge: false, porte: {} },
  { id: ID.C1, nome: "CORE-1", tipo: "switch", ip: "10.20.0.11", mac: mac(11), gruppo: "ctrl", legge: true,
    porte: { 1: 25000, 2: 25000, 9: 10000, 11: 10000, 12: 10000, 20: 10000 } },
  { id: ID.C2, nome: "CORE-2", tipo: "switch", ip: "10.20.0.12", mac: mac(12), gruppo: "ctrl", legge: true, porte: { 9: 10000, 11: 10000, 12: 10000 } },
  { id: ID.A1, nome: "ACC-1", tipo: "switch", ip: "10.20.0.21", mac: mac(21), gruppo: "ctrl", legge: true, porte: { 47: 2500, 49: 10000, 50: 10000 } },
  { id: ID.A2, nome: "ACC-2", tipo: "switch", ip: "10.20.0.22", mac: mac(22), gruppo: "ctrl", legge: true, porte: { 16: 1000, 49: 10000, 50: 10000 } },
  { id: ID.A3, nome: "ACC-3", tipo: "switch", ip: "10.20.0.23", mac: mac(23), gruppo: "ctrl", legge: true, porte: { 20: 1000, 49: 10000, 50: 10000 } },
  { id: ID.H, nome: "HV-1", tipo: "server", ip: "10.20.0.31", mac: mac(31), gruppo: "altro", legge: false, porte: {} },
];
const disp = (id: number): Disp => DISP.find((d) => d.id === id)!;

/** Un cavo vero: due capi, `[apparato, indice di porta]`. */
type Capo = readonly [number, number];
const CAVI: ReadonlyArray<readonly [Capo, Capo]> = [
  [[ID.R, 1], [ID.C1, 1]], [[ID.R, 2], [ID.C1, 2]],               // il fascio
  [[ID.R, 3], [ID.A1, 47]],                                       // instradato, 2,5G
  [[ID.R, 4], [ID.V, 0]],                                         // verso la radio vicina
  [[ID.L, 0], [ID.R2S, 3]],                                       // dalla radio lontana al router della sede 2
  [[ID.C1, 9], [ID.A1, 49]], [[ID.C1, 11], [ID.A2, 49]], [[ID.C1, 12], [ID.A3, 50]],
  [[ID.C2, 11], [ID.A3, 49]], [[ID.C2, 9], [ID.A1, 50]], [[ID.C2, 12], [ID.A2, 50]],
  [[ID.A2, 16], [ID.RR, 2]],
  [[ID.C1, 20], [ID.H, 1]], [[ID.A3, 20], [ID.H, 2]],              // l'hypervisor: attivo e di riserva
];
const WAN = { R: 5, RR: 1 } as const;
const MODEM = { nome: "MODEM-X", mac: "02:00:b2:00:77:01" };

/** I due membri del fascio, per indice di porta. */
const FASCIO = { R: [1, 2], C1: [1, 2] } as const;
/** Le porte fuori dal bridge: dove il cavo è instradato. */
const FUORI_BRIDGE: ReadonlyArray<Capo> = [[ID.R, 3], [ID.R, WAN.R], [ID.RR, WAN.RR]];
/** Le porte bloccate (il lato di CORE-2). */
const BLOCCATE: ReadonlyArray<Capo> = [[ID.C2, 9], [ID.C2, 12], [ID.R, 6]];   // e l'EoIP: bloccato nell'albero comune
/** Il nome della porta radice di ogni bridge che ne ha una (per indice); R è la radice. */
const RADICE: Record<number, number | "radice"> = { [ID.R]: "radice", [ID.RR]: 2, [ID.R2S]: 3, [ID.C2]: 11, [ID.A1]: 49, [ID.A2]: 49, [ID.A3]: 50 };

// ── I nomi delle porte, per lettura ────────────────────────────────────────────────────────────────────────────────────────

const NOMI_MK: Record<number, Record<number, string>> = {
  [ID.R]: { 1: "sfp28-1", 2: "sfp28-2", 3: "ether2", 4: "ether3", 5: "ether8", 6: "eoip-sede2" },
  [ID.RR]: { 1: "ether1", 2: "ether2" },
  [ID.R2S]: { 3: "ether3", 6: "eoip-sede1" },
};
function nomeA(id: number, i: number): string {
  const mk = NOMI_MK[id]?.[i];
  if (mk) return mk;
  return i === 1 || i === 2 ? `SFP28 ${i}` : i === 47 || i === 16 || (i === 20 && id === ID.A3) ? `Port ${i}` : i === 49 ? "SFP+ 1" : i === 50 ? "SFP+ 2" : `SFP+ ${i}`;
}
const nomeB = (i: number): string => (i === 101 ? "Po1" : i <= 48 ? `Gi1/0/${i}` : `Te1/1/${i - 48}`);
const nomeC = (i: number): string => (i === 101 ? "Trk1" : `1/1/${i}`);
function nomePorta(l: Lettura, id: number, i: number): string {
  const d = disp(id);
  if (l === "B") return d.gruppo === "altro" ? `eth${i}` : nomeB(i);
  if (l === "C") return d.gruppo === "altro" ? `eth${i}` : nomeC(i);
  return nomeA(id, i);
}

// ── Le righe dei vicini ────────────────────────────────────────────────────────────────────────────────────────────────────

const fonteDelGruppo = (l: Lettura, g: Gruppo): string => (l === "B" || l === "C" ? "snmp" : g === "mk" ? "device" : g === "ctrl" ? "unifi" : "host");

/** La riga che `x` scrive sul vicino `y` (un cavo, visto da x). */
function riga(l: Lettura, x: Capo, y: Capo): ViciniCaviRow {
  const dx = disp(x[0]), dy = disp(y[0]);
  const snmp = l === "B" || l === "C";
  const mkX = !snmp && dx.gruppo === "mk", mkY = !snmp && dy.gruppo === "mk";
  const nx = nomePorta(l, x[0], x[1]);
  // l'hypervisor annuncia le sue schede «ensN»; le radio una porta di bridge («etherN», col contenitore se le legge un MikroTik)
  const radio = dy.id === ID.V || dy.id === ID.L;
  const ny = dy.id === ID.H ? `ens${y[1]}` : radio ? `${snmp ? "" : "bridge/"}ether${dy.id === ID.V ? 1 : 2}` : nomePorta(l, y[0], y[1]);
  const membro = (d: Disp, i: number): boolean => (d.id === ID.R && (FASCIO.R as readonly number[]).includes(i));
  const inBridge = !FUORI_BRIDGE.some((c) => c[0] === x[0] && c[1] === x[1]);
  // locale: il contenitore dopo la virgola per un MikroTik; il nome com'è per le altre fonti (il controller scrive «SFP_ N»)
  const locale = mkX ? [nx, membro(dx, x[1]) ? "bond1" : null, inBridge ? dx.bridge : null].filter((s): s is string => !!s).join(",")
    : dx.gruppo === "ctrl" && !snmp ? nx.replace(/^SFP\+(?= )/, "SFP_") : nx;
  const remoto = mkY && dy.bridge ? `${dy.bridge}/${membro(dy, y[1]) ? "bond1/" : ""}${ny}` : l === "C" && dy.gruppo !== "altro" ? String(y[1]) : ny;
  return vic({
    device_id: x[0], local_port: locale, local_port_index: dx.gruppo === "altro" ? null : x[1],
    remote_device_name: dy.nome, remote_port: remoto, remote_mac: mkY ? mac(dy.id, y[1]) : dy.mac, remote_ip: dy.ip,
    remote_platform: mkY || (radio && !snmp) ? "MikroTik" : null, source: fonteDelGruppo(l, dx.gruppo),
    remote_caps: dy.id === ID.V || dy.id === ID.L ? "bridge" : null,
  });
}

/** I cavi che un apparato che legge i vicini scrive, uno per capo che legge. */
function righeDeiCavi(l: Lettura): ViciniCaviRow[] {
  const out: ViciniCaviRow[] = [];
  for (const [x, y] of CAVI) {
    for (const [p, q] of [[x, y], [y, x]] as const) {
      const d = disp(p[0]);
      if (!d.legge) continue;
      // l'hypervisor: gli switch lo sentono in A, B e C; in D lo sente solo lui (più sotto)
      if (l === "D" && q[0] === ID.H) continue;
      // il cavo verso la radio vicina lo scrive `righeRadio`, insieme alla radio lontana che il router sente sulla stessa porta
      if (q[0] === ID.V) continue;
      out.push(riga(l, p, q));
    }
  }
  return out;
}

/** La radio lontana: il router di testa la sente sulla stessa porta della vicina, da un'interfaccia senza fili. */
function righeRadio(l: Lettura): ViciniCaviRow[] {
  const snmp = l === "B" || l === "C";
  const R = disp(ID.R), V = disp(ID.V), L = disp(ID.L);
  const porta = nomePorta(l, ID.R, 4);
  const local = snmp || R.gruppo !== "mk" ? porta : `${porta},${R.bridge}`;
  return [
    vic({ device_id: ID.R, local_port: local, local_port_index: snmp ? 4 : null, remote_device_name: V.nome, remote_ip: V.ip, remote_mac: V.mac,
      remote_port: snmp ? "ether1" : "bridge/ether1", remote_caps: "bridge", remote_platform: snmp ? null : "MikroTik", source: fonteDelGruppo(l, "mk") }),
    vic({ device_id: ID.R, local_port: local, local_port_index: snmp ? 4 : null, remote_device_name: L.nome, remote_ip: L.ip, remote_mac: L.mac,
      remote_port: snmp ? "wlan60-1" : "bridge/bond1/wlan60-1", remote_caps: "bridge", remote_platform: snmp ? null : "MikroTik", source: fonteDelGruppo(l, "mk") }),
  ];
}

/** Il segmento della WAN: ogni router sente l'altro e il modem non gestito sulla sua porta. */
function righeWan(l: Lettura): ViciniCaviRow[] {
  const snmp = l === "B" || l === "C";
  const una = (x: number, i: number, y: number, j: number): ViciniCaviRow[] => {
    const dx = disp(x), dy = disp(y);
    const mkY = !snmp && dy.gruppo === "mk";
    return [
      vic({ device_id: x, local_port: snmp ? nomePorta(l, x, i) : nomePorta(l, x, i), local_port_index: snmp ? i : null, remote_device_name: dy.nome, remote_ip: dy.ip,
        remote_mac: mkY ? mac(y, j) : dy.mac, remote_port: mkY ? `${dy.bridge}/${nomePorta(l, y, j)}` : nomePorta(l, y, j), remote_platform: mkY ? "MikroTik" : null,
        source: fonteDelGruppo(l, dx.gruppo) }),
      vic({ device_id: x, local_port: nomePorta(l, x, i), local_port_index: snmp ? i : null, remote_device_name: MODEM.nome, remote_mac: MODEM.mac, remote_port: "eth0",
        source: fonteDelGruppo(l, dx.gruppo) }),
    ];
  };
  return [...una(ID.R, WAN.R, ID.RR, WAN.RR), ...una(ID.RR, WAN.RR, ID.R, WAN.R)];
}

/** L'EoIP: un annuncio di segmento (MNDP) che il router sente nel bridge; solo A lo legge, B e C non hanno tunnel nella MIB. */
function righeEoip(l: Lettura): ViciniCaviRow[] {
  if (l !== "A" && l !== "D") return [];
  return [
    vic({ device_id: ID.R, local_port: "eoip-sede2,BR_RP", local_port_index: null, remote_device_name: "RT-SEDE2", remote_ip: "10.20.9.1", remote_mac: mac(3, 6),
      remote_port: "eoip-sede1", protocol: "mndp", remote_platform: "MikroTik", source: "device" }),
  ];
}

/** D: l'hypervisor scrive i suoi vicini con `lldpcli -f json0 show neighbors details`: la porta dello switch come l'ha annunciata. */
function righeHost(): ViciniCaviRow[] {
  return [
    vic({ device_id: ID.H, local_port: "ens1", remote_device_name: "CORE-1", remote_mac: disp(ID.C1).mac, remote_ip: disp(ID.C1).ip, remote_port: "SFP+ 20", source: "host" }),
    vic({ device_id: ID.H, local_port: "ens2", remote_device_name: "ACC-3", remote_mac: disp(ID.A3).mac, remote_ip: disp(ID.A3).ip, remote_port: "Port 20", source: "host" }),
  ];
}

// ── I fatti di porta e di bridge ──────────────────────────────────────────────────────────────────────────────────────────

function fattiPorta(l: Lettura): FattoPorta[] {
  const out: FattoPorta[] = [];
  const snmp = l === "B" || l === "C";
  const chiave = (d: Disp, i: number): string => (d.gruppo === "mk" && !snmp ? `n:${nomePorta(l, d.id, i)}` : `i:${i}`);
  const gruppoDi = (d: Disp): string => (snmp ? "snmp" : d.gruppo === "mk" ? "device" : "controller");
  for (const d of DISP) {
    if (d.gruppo === "altro") continue;
    for (const k of Object.keys(d.porte).map(Number)) {
      const nome = nomePorta(l, d.id, k);
      const fuori = FUORI_BRIDGE.some((c) => c[0] === d.id && c[1] === k);
      const bloccata = BLOCCATE.some((c) => c[0] === d.id && c[1] === k);
      const eoip = nome.startsWith("eoip-");
      if (snmp && k === 6 && (d.id === ID.R || d.id === ID.R2S)) continue;   // l'EoIP: nessun tunnel nella MIB
      const nelFascio = (d.id === ID.R || d.id === ID.C1) && (FASCIO.R as readonly number[]).includes(k);
      const lag = nelFascio ? (snmp ? "if:101" : d.id === ID.R ? "bond1" : "lag:1") : null;
      const partner = !snmp && d.id === ID.R && nelFascio ? disp(ID.C1).mac.toUpperCase() : null;
      out.push(fp(d.id, chiave(d, k), nome, {
        source: gruppoDi(d), ...(eoip ? { if_kind: "tunnel", running: 1 } : {}),
        in_bridge: d.gruppo === "ctrl" && !snmp ? null : fuori ? 0 : 1,
        ...(lag ? { lag_group: lag } : {}), ...(partner ? { lag_partner: partner } : {}),
        stp_state: bloccata ? "discarding" : fuori ? null : "forwarding",
        stp_role: bloccata ? "alternate" : null,
      }));
    }
    // L'interfaccia del fascio: sua è la porta radice di CORE-1, e il suo stato è quello del fascio.
    if (d.id === ID.R || d.id === ID.C1) {
      const bond = snmp ? 101 : 0;
      if (snmp) out.push(fp(d.id, `i:${bond}`, nomePorta(l, d.id, bond), { source: "snmp", if_kind: "lag", in_bridge: 1, stp_state: "forwarding" }));
      else if (d.id === ID.R) out.push(fp(d.id, "n:bond1", "bond1", { source: "device", if_kind: "lag", lag_group: "bond1", stp_role: "designated", stp_state: "forwarding", edge: 0, bpdu_rx: 10 }));
    }
  }
  if (l === "D") {
    out.push(
      fp(ID.H, "n:ens1", "ens1", { source: "host", lag_group: "bond0", lag_state: "attivo" }),
      fp(ID.H, "n:ens2", "ens2", { source: "host", lag_group: "bond0", lag_state: "riserva" }),
      fp(ID.H, "n:bond0", "bond0", { source: "host", if_kind: "lag" }),
    );
  }
  return out;
}

function fattiBridge(l: Lettura): FattoBridge[] {
  const snmp = l === "B" || l === "C";
  const out: FattoBridge[] = [];
  const idBridge = (id: number, prio: number): string => `${prio}.${mac(id).toUpperCase()}`;
  const radice = `0.${mac(ID.R)}`;
  for (const d of DISP) {
    // il controller non dà il bridge: lo danno gli apparati e SNMP
    if (d.gruppo === "altro" || (d.gruppo === "ctrl" && !snmp)) continue;
    const r = RADICE[d.id];
    const nome = nomePorta(l, d.id, r === undefined || r === "radice" ? 0 : r);
    out.push(fb(d.id, {
      source: snmp ? "snmp" : "device", bridge_name: snmp ? "" : d.bridge ?? "", bridge_id: d.id === ID.R ? radice : idBridge(d.id, 32768), root_id: radice,
      protocol: l === "B" ? "rstp" : l === "C" ? "mstp" : "rstp",
      // il fascio è la porta radice di CORE-1 (un fascio ha il nome del fascio, comunque lo dica il lettore)
      root_port: d.id === ID.R ? null : d.id === ID.C1 ? (snmp ? nomePorta(l, d.id, 101) : null) : nome,
      ...(l === "C" ? { region_name: "REGIONE-X", region_revision: 1, config_digest: "02:00:00:00:00:D1" } : {}),
    }));
  }
  return out;
}

// ── L'ingresso, per lettura ───────────────────────────────────────────────────────────────────────────────────────────────

function t1Di(l: Lettura): TopologyModelInput {
  const snmp = l === "B" || l === "C";
  const marca = l === "B" ? "cisco" : "hp";   // il valore della colonna per un HP/Aruba
  const devices = DISP.map((d) => {
    const base = { name: d.nome, host: d.ip, device_type: d.tipo, port_count: Object.keys(d.porte).length };
    if (d.id === ID.H) return dev(d.id, { ...base, vendor: "proxmox", proxmox_scan: 1, port_count: 0 });
    if (d.gruppo === "altro") return dev(d.id, { ...base, vendor: "mikrotik", port_count: 0 });
    if (snmp) return dev(d.id, { ...base, vendor: marca, via: "snmp_v2" });
    if (d.gruppo === "mk") return dev(d.id, { ...base, vendor: "mikrotik", via: "ssh" });
    return dev(d.id, { ...base, vendor: "ubiquiti", via: "api", controller_mac: d.mac });
  });
  // L'uplink del controller: ogni apparato del controller dice da quale porta esce e verso chi (per indice).
  const UPLINK: Record<number, { verso: number; locale: number; remota: number }> = {
    [ID.C1]: { verso: ID.R, locale: 1, remota: 1 }, [ID.C2]: { verso: ID.A3, locale: 11, remota: 49 },
    [ID.A1]: { verso: ID.C1, locale: 49, remota: 9 }, [ID.A2]: { verso: ID.C1, locale: 49, remota: 11 }, [ID.A3]: { verso: ID.C1, locale: 50, remota: 12 },
  };
  const conUplink = snmp ? devices : devices.map((d) => {
    const u = UPLINK[d.id];
    return u ? { ...d, uplink_mac: disp(u.verso).mac, uplink_remote_port: u.remota, uplink_seen_at: ORA_T2 } : d;
  });
  return baseInput({
    devices: conUplink,
    networks: [{ id: 1, cidr: "10.20.0.0/24", name: "lan", gateway: disp(ID.R).ip, location_id: null }],
    knownMacs: DISP.map((d) => ({ device_id: d.id, mac: d.mac })),
    uplinkPorts: snmp ? [] : Object.entries(UPLINK).map(([id, u]) => ({ device_id: Number(id), port_index: u.locale, port_name: nomeA(Number(id), u.locale) })),
    ports: DISP.filter((d) => d.gruppo !== "altro").flatMap((d) => porte(d.id,
      Object.entries(d.porte).filter(([k]) => !(snmp && k === "6" && (d.id === ID.R || d.id === ID.R2S)))
        .map(([k, v]) => [Number(k), nomePorta(l, d.id, Number(k)), `${v} Mbps`] as [number, string, string]))),
  });
}

function ingressoDi(l: Lettura): IngressoCavi {
  const snmp = l === "B" || l === "C";
  const macApparati = DISP.flatMap((d) => [
    { device_id: d.id, mac: d.mac, source: "device" },
    ...(d.gruppo === "mk" ? Object.keys(d.porte).map((k) => ({ device_id: d.id, mac: mac(d.id, Number(k)), source: "device" })) : []),
  ]);
  return ingresso(t1Di(l), {
    vicini: [...righeDeiCavi(l), ...righeRadio(l), ...righeWan(l), ...righeEoip(l), ...(l === "D" ? righeHost() : [])],
    fattiPorta: fattiPorta(l), fattiBridge: fattiBridge(l), macApparati,
    uplink: snmp ? [] : [ID.C1, ID.C2, ID.A1, ID.A2, ID.A3].map((id) => ({ device_id: id, uplink_local_port_idx: null, uplink_source: "lldp_uplink" })),
  });
}

/** Il riferimento: MikroTik via SSH e il controller. */
export const letturaA = (): IngressoCavi => ingressoDi("A");
/** Cisco in Rapid-PVST via SNMP (forma dedotta dalla MIB). */
export const letturaB = (): IngressoCavi => ingressoDi("B");
/** HP/Aruba in MSTP via SNMP (forma dedotta dalla MIB). */
export const letturaC = (): IngressoCavi => ingressoDi("C");
/** L'hypervisor letto dal suo lato, con il bond `active-backup`. */
export const letturaD = (): IngressoCavi => ingressoDi("D");

// ── Il confronto ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Un collegamento in una riga: genere, i due capi (apparato e chiave di porta, ordinati), stato, fiducia. */
export function descrivi(c: Collegamento): string {
  const capi = [`${c.a.nodo}:${c.a.chiave ?? "?"}`, `${c.b.nodo}:${c.b.chiave ?? "?"}`].sort();
  return `${c.genere} ${capi.join(" ↔ ")} · ${c.stato} · ${c.fiducia}`;
}

/**
 * Le differenze in parole fra due letture della stessa rete; vuoto = uguali: stessi collegamenti coi due capi per chiave di porta
 * e genere, stesso stato e stessa fiducia, stesso padre per ogni nodo. `parte` toglie dal confronto i collegamenti che una lettura
 * non può avere (un tunnel, un annuncio di segmento); `senza` toglie i nodi che non si confrontano (padri e collegamenti).
 */
export function uguale(x: IngressoCavi, y: IngressoCavi, parte: (c: Collegamento) => boolean = () => true, senza: ReadonlySet<string> = new Set()): string[] {
  const m = (i: IngressoCavi) => modelloMappaDaIngresso(i, { testaScelta: null }).m;
  const mx = m(x), my = m(y);
  const dentro = (c: Collegamento): boolean => parte(c) && ![c.a.nodo, c.b.nodo].some((n) => senza.has(n));
  const righe = (mm: ReturnType<typeof m>): string[] => mm.collegamenti.filter(dentro).map(descrivi).sort();
  const diff: string[] = [];
  const rx = righe(mx), ry = righe(my);
  for (const r of rx) if (!ry.includes(r)) diff.push(`solo nella prima lettura: ${r}`);
  for (const r of ry) if (!rx.includes(r)) diff.push(`solo nella seconda lettura: ${r}`);
  const nodi = new Set([...Object.keys(mx.albero.padri), ...Object.keys(my.albero.padri)]);
  for (const n of [...nodi].sort()) {
    if (senza.has(n)) continue;
    const px = mx.albero.padri[n], py = my.albero.padri[n];
    if (px !== py) diff.push(`padre di ${n}: ${px ?? "nessuno"} nella prima, ${py ?? "nessuno"} nella seconda`);
  }
  const sx = mx.segmenti.map((s) => s.id).sort().join(","), sy = my.segmenti.map((s) => s.id).sort().join(",");
  if (sx !== sy) diff.push(`segmenti: ${sx || "nessuno"} contro ${sy || "nessuno"}`);
  return diff;
}
