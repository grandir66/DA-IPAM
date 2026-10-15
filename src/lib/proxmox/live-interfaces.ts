/**
 * Schede vive di un hypervisor Proxmox (spec 2026-10-12-topology-map-design §11.5,
 * piano fase 2b Task 4). La scansione via API legge la CONFIGURAZIONE delle schede:
 * niente MAC sulle schede fisiche, stato sempre «down». Qui si legge com'è la
 * macchina adesso, con UN comando SSH in sola lettura, e lo si unisce per nome
 * alle schede della scansione: MAC, stato, velocità, membri del bond. Con i MAC
 * veri la mappa trova da sola le schede sugli switch (tabella MAC per porta).
 *
 * Logica pura: niente rete, niente DB. La chiamata SSH sta in `proxmox-ssh.ts`
 * (`readLiveInterfaces`), l'unione col risultato in `run-proxmox-device-scan.ts`.
 */
import { normalizeMacForStorage } from "@/lib/utils";
import type { ProxmoxHostInfo, ProxmoxNetworkInterface } from "./proxmox-client";

export type LiveInterfaceKind = "eth" | "bond" | "bridge" | "vlan" | "other";

export type LiveInterface = {
  name: string;
  mac: string | null;
  state: "up" | "down" | "unknown";
  speedMbps: number | null;
  master: string | null;
  kind: LiveInterfaceKind;
};

/**
 * Il comando (piano fase 2b, con `-d` deciso all'unione): elenco delle schede in
 * JSON, una riga «---», poi «<percorso> <velocità>» per ogni scheda. Solo letture
 * (`ip link show`, `cat` di /sys): niente che cambi la macchina. `-d` (dettagli)
 * serve perché solo così `ip -j` stampa `linkinfo.info_kind` (bond, bridge, vlan…):
 * senza, il tipo verrebbe solo dal nome.
 */
export const LIVE_INTERFACES_COMMAND =
  'ip -d -j link show; echo ---; for f in /sys/class/net/*/speed; do echo "$f $(cat $f 2>/dev/null)"; done';

/** Schede virtuali delle VM e del firewall di Proxmox: non sono cavi, si scartano. */
const VIRTUALI = /^(tap|fwbr|veth|fwpr|fwln)/;

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/**
 * Il tipo della scheda: da `linkinfo.info_kind` quando c'è. Con `-d` (l'uscita ha i
 * campi di dettaglio, `promiscuity` su ogni scheda) una scheda Ethernet SENZA
 * `info_kind` è fisica, qualunque nome abbia (es. `nic0`): le schede virtuali
 * dichiarano tutte il loro tipo. Senza dettagli si ripiega sul nome.
 */
function kindOf(name: string, info: Record<string, unknown> | null, detailed: boolean, ether: boolean): LiveInterfaceKind {
  const infoKind = info?.info_kind;
  if (typeof infoKind === "string") {
    if (infoKind === "bond" || infoKind === "bridge" || infoKind === "vlan") return infoKind;
    return "other";
  }
  if (detailed && ether) return "eth";
  if (name.includes(".")) return "vlan";
  if (/^bond/.test(name)) return "bond";
  if (/^(vmbr|br)/.test(name)) return "bridge";
  if (/^(en|eth|em|p\d)/.test(name)) return "eth";
  return "other";
}

function stateOf(operstate: unknown): LiveInterface["state"] {
  if (operstate === "UP") return "up";
  if (operstate === "DOWN" || operstate === "LOWERLAYERDOWN" || operstate === "NOTPRESENT") return "down";
  return "unknown";
}

/**
 * L'uscita di `ip -d -j link show` più le velocità (da `parseSpeedLines`) in schede.
 * Il MAC è quello della scheda (`permaddr`, per i membri di un bond che prendono
 * il MAC del bond), altrimenti `address`; solo per le schede Ethernet. Velocità
 * ≤ 0 o ignota = null. Loopback e schede virtuali (tap, fwbr, veth, fwpr, fwln)
 * non ci sono. Un'uscita che non è un elenco dà un elenco vuoto.
 */
export function parseLiveInterfaces(ipLinkJson: unknown, speeds: Record<string, number | null>): LiveInterface[] {
  if (!Array.isArray(ipLinkJson)) return [];
  const out: LiveInterface[] = [];
  for (const item of ipLinkJson) {
    const o = asRecord(item);
    const name = typeof o?.ifname === "string" ? o.ifname.trim() : "";
    if (!o || !name) continue;
    if (o.link_type === "loopback" || name === "lo" || VIRTUALI.test(name)) continue;
    const ether = o.link_type === undefined || o.link_type === "ether";
    const hw = typeof o.permaddr === "string" ? o.permaddr : typeof o.address === "string" ? o.address : null;
    const speed = speeds[name];
    out.push({
      name,
      mac: ether ? normalizeMacForStorage(hw) : null,
      state: stateOf(o.operstate),
      speedMbps: typeof speed === "number" && Number.isFinite(speed) && speed > 0 ? speed : null,
      master: typeof o.master === "string" && o.master ? o.master : null,
      kind: kindOf(name, asRecord(o.linkinfo), "promiscuity" in o, o.link_type === "ether"),
    });
  }
  return out;
}

/** Le righe «/sys/class/net/<scheda>/speed <n>» in Mbit/s per scheda; -1, vuoto o testo = null. */
export function parseSpeedLines(text: string): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\/sys\/class\/net\/([^/\s]+)\/speed(?:\s+(.*))?$/.exec(line.trim());
    if (!m) continue;
    const n = Number((m[2] ?? "").trim());
    out[m[1]] = (m[2] ?? "").trim() !== "" && Number.isInteger(n) && n > 0 ? n : null;
  }
  return out;
}

/**
 * L'uscita intera del comando: JSON di `ip`, riga «---», velocità. Un JSON che
 * non si legge è un errore (il comando non c'è o ha risposto altro): meglio
 * dirlo che restituire «nessuna scheda».
 */
export function parseLiveOutput(stdout: string): LiveInterface[] {
  const lines = stdout.split(/\r?\n/);
  const sep = lines.findIndex((l) => l.trim() === "---");
  const jsonText = (sep >= 0 ? lines.slice(0, sep) : lines).join("\n").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error("Risposta di «ip -j link» non leggibile: il comando manca o ha risposto altro");
  }
  if (!Array.isArray(parsed)) throw new Error("Risposta di «ip -j link» non leggibile: non è un elenco di schede");
  return parseLiveInterfaces(parsed, parseSpeedLines(sep >= 0 ? lines.slice(sep + 1).join("\n") : ""));
}

/**
 * Le schede vive sull'host della scansione, per nome: quelle che ci sono già
 * prendono MAC, stato, velocità (testo, come la scrive l'API) e `master`; quelle
 * che la configurazione non elenca si aggiungono col tipo letto. La presenza di
 * `master` (anche null) segna una scheda letta viva. `live_read_at` = `readAt`.
 */
export function mergeLiveIntoHost(host: ProxmoxHostInfo, live: LiveInterface[], readAt: string): ProxmoxHostInfo {
  const byName = new Map(live.map((l) => [l.name, l]));
  const used = new Set<string>();
  const vivi = (l: LiveInterface): Pick<ProxmoxNetworkInterface, "mac_address" | "state" | "speed_mbps" | "master"> => ({
    mac_address: l.mac,
    state: l.state,
    speed_mbps: l.speedMbps === null ? null : String(l.speedMbps),
    master: l.master,
  });
  const interfaces: ProxmoxNetworkInterface[] = host.network_interfaces.map((i) => {
    const l = byName.get(i.name);
    if (!l) return i;
    used.add(i.name);
    return { ...i, ...vivi(l) };
  });
  for (const l of live) {
    if (used.has(l.name)) continue;
    interfaces.push({ name: l.name, type: l.kind, ip_addresses: null, bridge: null, vlan_id: null, ...vivi(l) });
  }
  return { ...host, network_interfaces: interfaces, live_read_at: readAt };
}

/**
 * Le schede vive di una scansione precedente di `host` (quelle con `master`),
 * per rimetterle quando la lettura di adesso non è riuscita. Null se quella
 * scansione non aveva schede vive.
 */
export function previousLive(host: ProxmoxHostInfo | undefined): { live: LiveInterface[]; readAt: string } | null {
  if (!host?.live_read_at || !Array.isArray(host.network_interfaces)) return null;
  const kinds: ReadonlySet<string> = new Set(["eth", "bond", "bridge", "vlan", "other"]);
  const live: LiveInterface[] = [];
  for (const i of host.network_interfaces) {
    if (!i || !("master" in i)) continue;
    const speed = i.speed_mbps === null || i.speed_mbps === undefined ? NaN : Number(i.speed_mbps);
    live.push({
      name: i.name,
      mac: i.mac_address ?? null,
      state: i.state === "up" || i.state === "down" ? i.state : "unknown",
      speedMbps: Number.isFinite(speed) && speed > 0 ? speed : null,
      master: i.master ?? null,
      kind: (kinds.has(i.type) ? i.type : "other") as LiveInterfaceKind,
    });
  }
  return { live, readAt: host.live_read_at };
}

function ipsOf(host: ProxmoxHostInfo): string[] {
  const out: string[] = [];
  for (const i of host.network_interfaces ?? []) {
    if (typeof i?.ip_addresses !== "string") continue;
    for (const part of i.ip_addresses.split(/[\s,]+/)) {
      const ip = part.split("/")[0]?.trim();
      if (ip) out.push(ip);
    }
  }
  return out;
}

/**
 * Su quale host del cluster è andato il comando: quello che nella configurazione
 * delle schede ha l'IP del bersaglio; se la scansione ha un host solo, quello;
 * altrimenti l'host che aveva quell'IP nella scansione `previous` (stesso nome).
 * -1 = non si sa: meglio nessuna scheda viva che quelle di un altro nodo.
 */
export function hostIndexForTarget(hosts: ProxmoxHostInfo[], ip: string, previous: ProxmoxHostInfo[] = []): number {
  const idx = hosts.findIndex((h) => ipsOf(h).includes(ip));
  if (idx >= 0) return idx;
  if (hosts.length === 1) return 0;
  const prev = previous.find((h) => ipsOf(h).includes(ip));
  return prev ? hosts.findIndex((h) => h.hostname === prev.hostname) : -1;
}

/** Un membro di un bond (spec topologia §13.5.5, «Riserva del bond»): stato letto e MAC permanente, con cui il firmware si annuncia agli switch. */
export interface MembroBond { nome: string; bond: string; stato: "attivo" | "riserva" | null; macPermanente: string | null }

/**
 * I membri dei bond da `ip -d -j link show` (T2.5): `master` è il bond, `linkinfo.info_slave_kind` è `bond`,
 * `linkinfo.info_slave_data.state` vale `ACTIVE` o `BACKUP` (altro = null, non letto). Il MAC permanente sta in
 * `info_slave_data.perm_hwaddr`; `permaddr` in cima alla scheda vale solo se quello manca. Misurato sull'uscita vera T2-b
 * (nodo Proxmox VE 9 dell'hub): `perm_hwaddr` c'è su ogni membro, `permaddr` solo sui membri il cui MAC di adesso
 * è diverso dal permanente. Il MAC di adesso (`address`) di un membro è quello del bond: qui non si usa mai.
 */
export function membriDeiBond(ipLinkJson: unknown): MembroBond[] {
  if (!Array.isArray(ipLinkJson)) return [];
  const out: MembroBond[] = [];
  for (const item of ipLinkJson) {
    const o = asRecord(item);
    const info = asRecord(o?.linkinfo);
    const nome = typeof o?.ifname === "string" ? o.ifname.trim() : "";
    if (!o || !info || nome === "" || typeof o.master !== "string" || o.master === "" || info.info_slave_kind !== "bond") continue;
    const dati = asRecord(info.info_slave_data);
    const stato = dati?.state === "ACTIVE" ? "attivo" : dati?.state === "BACKUP" ? "riserva" : null;
    const perm = typeof dati?.perm_hwaddr === "string" ? dati.perm_hwaddr : typeof o.permaddr === "string" ? o.permaddr : null;
    out.push({ nome, bond: o.master, stato, macPermanente: normalizeMacForStorage(perm) });
  }
  return out;
}
