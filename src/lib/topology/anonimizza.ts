/**
 * Dati del modello resi anonimi per le fixture (il repo è pubblico): IP, MAC e
 * nomi sostituiti in modo coerente, così contenimenti delle reti, gateway, MAC
 * condivisi e nomi uguali restano tali e il modello dà gli stessi conteggi.
 *
 * Gli pseudonimi non coincidono mai con un valore vero: i blocchi finti non
 * toccano reti o IP veri, un MAC finto non è mai un MAC vero, un nome finto non
 * è mai la chiave di un nome vero. Così «il valore vero non c'è» si verifica
 * cercandolo, senza falsi allarmi né coincidenze. Logica pura.
 */
import type { TopologyModelInput } from "@/lib/topology/model-types";
import { normalizeName } from "@/lib/topology/match";
import { identifiesByName, isVirtualMac, realOui } from "@/lib/topology/identity";
import { normalizeMacForStorage } from "@/lib/utils";
import { DEVICE_CLASSIFICATIONS } from "@/lib/device-classifications";

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const MAC = /^[0-9a-f]{2}([:-]?)[0-9a-f]{2}(\1[0-9a-f]{2}){4}$/i;
/** MAC in ogni forma comune: «aa:bb:…», «aa-bb-…», «aabb.ccdd.eeff», 12 cifre esadecimali. */
const MAC_ANY = /^([0-9a-f]{2}([:-])[0-9a-f]{2}(\2[0-9a-f]{2}){4}|[0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4}|[0-9a-f]{12})$/i;
const SIGLA: Record<string, string> = {
  router: "RTR", switch: "SW", access_point: "AP", firewall: "FW", hypervisor: "HV", nas: "NAS", server: "SRV",
};

/**
 * Nome di porta «di serie» (quello che l'apparato dà da sé): resta. Ogni altro nome
 * — «ether5-Magazzino», una descrizione LLDP — può dire chi è il cliente e diventa
 * `porta-<n>`. Il modello le porte le riporta e basta, non le confronta.
 */
export const PORTA_GENERICA = new RegExp(
  "^(" +
    [
      "(port|porta)\\s*\\d+",
      "(ether|eth|sfp-sfpplus|sfpplus|sfp28-|sfp|qsfpplus|qsfp|combo|wlan|bridge|bond|vmbr|vlan|lan|wan|mgmt|ge|xe|et|gi|te|fa|tw|hu|fo|po|" +
        "gigabitethernet|tengigabitethernet|twentyfivegige|fortygigabitethernet|hundredgige|fastethernet|ethernet|port-channel|interface|ath|wifi)" +
        "[\\s-]?\\d+([/:.]\\d+)*",
      "en[ospx]\\d+(s\\d+)?(f\\d+)?(np\\d+)?",
      "\\d+([/:.]\\d+)*",
      // T1 (spec §13.12.2): i nomi di serie che mancavano. Non dicono chi è il cliente.
      "sfp(\\+|_|28)?\\s?\\d+",                                                                   // «SFP+ 9», «SFP_ 9», «SFP 1», «SFP28 29»
      // Una porta di fabbrica con la velocità in coda come la legge il traduttore (MIKROTIK_FISICA: «-10g», «-2.5»), la corsia
      // di una QSFP, la radio coi suoi numeri («wlan60-1»), nel bridge o in un fascio: un intero o un numero col punto dopo il
      // trattino è un nome scelto e diventa uno pseudonimo (verifica del 15/10).
      "(bridge\\d*/)?(bond\\d+/)?((ether|sfp-sfpplus|sfp28-|sfp|combo|bond)\\d+(-(\\d+(\\.\\d+)?g|2\\.5))?|qsfp\\d*-?\\d+(-[1-8])?|(wlan|wifi)\\d+(-\\d+)?)(,(bridge\\d*|bond\\d+))*",
      "(wifi|ath|wlan)\\d+[a-z]+\\d*",                                                            // «wifi2ap9»
    ].join("|") +
    ")$",
  "i",
);

/**
 * I nomi di porta di fabbrica, per prodotto: l'elenco chiuso del secondo controllo delle fixture (`porteInChiaro`). Non
 * segue PORTA_GENERICA e non ha forme viste solo su un cliente: allargarlo vuol dire scrivere qui il prodotto che dà quel
 * nome da sé. La sola forma scelta da un cliente che resta è la porta di fabbrica con la velocità in coda («ether1-2.5»): il
 * traduttore la legge fisica (MIKROTIK_FISICA) e non dice chi è il cliente, perché è un numero di una norma Ethernet.
 */
const NOMI_DI_FABBRICA = new RegExp(
  "^(" +
    [
      "(port|porta)\\s*\\d+", "sfp(\\+|_|28)?\\s?\\d+",
      "(ether|sfp-sfpplus|sfp28-|sfp|combo|bond)\\d+(-(\\d+(\\.\\d+)?g|2\\.5))?", "qsfp\\w*?-?\\d+(-[1-8])?",
      "(wlan|wifi)\\d+(-\\d+)?", "(wifi|ath|wlan|ra)\\d+[a-z]+\\d*", "bridge\\d*", "vrrp\\d+", "vlan[\\s-]?\\d+",
      "(eth|sfpplus|qsfpplus|vmbr|lan|wan|mgmt|ge|xe|et|gi|te|fa|tw|hu|fo|po|gigabitethernet|tengigabitethernet|twentyfivegige|" +
        "fortygigabitethernet|hundredgige|fastethernet|ethernet|port-channel|interface|ath|\\d+gigabitethernet)[\\s-]?\\d+([/:.]\\d+)*",
      "en[ospx]\\d+(s\\d+)?(f\\d+)?(np\\d+)?", "\\d+([/:.]\\d+)*",
    ].join("|") +
    ")$",
  "i",
);

/**
 * Il secondo controllo dei nomi di porta (spec §13.12.2). Verifica del 15/10: un'alternativa di PORTA_GENERICA allargata ai
 * nomi VRRP che il cliente A dà alle sue interfacce li avrebbe pubblicati nella fixture come «di serie», e nessun controllo se
 * ne accorgeva (`contaValoriVeri` guarda IP, MAC e nomi degli oggetti). Conta i pezzi dei nomi di porta della fixture uguali a
 * un pezzo di un nome di porta vero che non sono nomi di fabbrica: lo script d'estrazione non scrive la fixture se non è 0.
 */
export function porteInChiaro(vero: TopologyModelInput, anonimo: TopologyModelInput): number {
  const pezzi = (v: string): string[] => v.split(/[,/]| - /).map((p) => p.trim()).filter((p) => p !== "");
  const veri = new Set(portsOf(vero).flatMap(pezzi));
  return new Set(portsOf(anonimo).flatMap(pezzi).filter((p) => veri.has(p) && !NOMI_DI_FABBRICA.test(p))).size;
}

const PEZZO_ANONIMO = /^((bridge|vlan|vrrp|eoip|gre|ipip|vxlan|wireguard|wg|ovpn|pppoe|pptp|l2tp|sstp|lte|loopback|veth)-)?porta-\d+$/;

/** Una porta come la scrive l'anonimizzatore: di serie, uno pseudonimo, o composta di questi pezzi (prova della forma delle fixture). */
export function portaAnonima(v: string): boolean {
  const t = v.trim();
  const ok = (p: string): boolean => PORTA_GENERICA.test(p.trim()) || PEZZO_ANONIMO.test(p.trim());
  if (t === "" || ok(t)) return true;
  const conDescrizione = /^(.+?) - (.+)$/.exec(t);
  if (conDescrizione) return PORTA_GENERICA.test(conDescrizione[1]) && ok(conDescrizione[2]);
  if (t.includes(",")) return t.split(",").every(ok);
  if (t.includes("/")) return t.split("/").every(ok);
  return false;
}

const toInt = (ip: string): number => ip.split(".").reduce((a, o) => a * 256 + Number(o), 0);
const toIp = (n: number): string => [24, 16, 8, 0].map((s) => Math.floor(n / 2 ** s) % 256).join(".");

interface Cidr {
  base: number;
  len: number;
}

function parseCidr(cidr: string): Cidr | null {
  const [ip, l] = cidr.split("/");
  const len = Number(l);
  if (!IPV4.test(ip) || !Number.isInteger(len) || len < 0 || len > 32) return null;
  const size = 2 ** (32 - len);
  return { base: Math.floor(toInt(ip) / size) * size, len };
}

const sizeOf = (c: Cidr): number => 2 ** (32 - c.len);
const contains = (o: Cidr, ip: number): boolean => ip >= o.base && ip < o.base + sizeOf(o);

/**
 * I valori chiusi che una fixture può contenere così come sono: lo schema del DB
 * (CHECK) e le classificazioni dell'app. `windows` è la classificazione di prima
 * di `server_windows`, ancora presente nei dati.
 */
export const VOCABOLARIO = {
  vendor: ["mikrotik", "ubiquiti", "hp", "cisco", "omada", "stormshield", "proxmox", "vmware", "linux", "windows", "synology", "qnap", "other"],
  device_type: ["router", "switch", "firewall", "hypervisor", "access_point", "nas", "server"],
  classification: [...DEVICE_CLASSIFICATIONS, "windows"] as string[],
  status: ["online", "offline", "unknown"],
  protocol: ["lldp", "cdp", "mndp", "unknown"],
  source: ["device", "unifi"],
  via: ["ssh", "snmp_v2", "snmp_v3", "api", "winrm"],
  piattaforma: ["MikroTik", "altro"],
  // T1 (spec §13.6.1): gli stati delle porte e dello spanning tree come li scrive la lettura. Stanno qui perché
  // PAROLE_DELL_APP li prende dal vocabolario: sull'hub «down» (137 porte) è anche una parola di un nome vero, e senza
  // questa riga l'estrazione della fixture si fermava con «nomi 137» (verifica del piano, 15/10).
  stato_porta: ["up", "down", "disabled"],
  stp: ["forwarding", "blocking", "discarding", "disabled", "learning", "listening", "broken"],
} as const;

function portsOf(input: TopologyModelInput): string[] {
  return [
    ...input.neighbors.flatMap((n) => [n.local_port, n.remote_port]), ...input.uplinkPorts.map((p) => p.port_name),
    ...input.overrides.flatMap((o) => [o.a_port, o.b_port]), ...input.macPorts.map((m) => m.port_name),
    ...input.primaries.flatMap((p) => [p.node_port, p.other_port]), ...input.portInfo.map((p) => p.port_name),
    ...(input.ports ?? []).map((p) => p.port_name),
  ].filter((p): p is string => typeof p === "string" && p.trim() !== "");
}

export function anonimizzaInput(input: TopologyModelInput): TopologyModelInput {
  // Valori veri: gli pseudonimi li evitano.
  const rawPorts = portsOf(input).map((p) => p.trim());
  const nameFields = [
    ...input.devices.map((d) => d.name),
    ...input.hosts.flatMap((h) => [h.hostname, h.custom_name]),
    ...input.neighbors.map((n) => n.remote_device_name),
    ...input.locations.map((l) => l.name),
    ...input.networks.map((n) => n.name),
  ].filter((x): x is string => typeof x === "string" && x.trim() !== "");
  const realIps = new Set<number>(
    [
      ...input.devices.map((d) => d.host), ...input.hosts.map((h) => h.ip), ...input.neighbors.map((n) => n.remote_ip),
      ...input.networks.map((n) => n.gateway), ...nameFields.map((s) => s.trim()), ...rawPorts,
    ]
      .filter((v): v is string => typeof v === "string" && IPV4.test(v))
      .map(toInt),
  );
  const realMacs = new Set<string>(
    [
      ...input.hosts.map((h) => h.mac), ...input.devices.flatMap((d) => [d.controller_mac, d.uplink_mac]),
      ...input.knownMacs.map((k) => k.mac), ...input.neighbors.map((n) => n.remote_mac), ...input.macPorts.map((m) => m.mac),
      ...nameFields.filter((s) => MAC.test(s.trim())), ...rawPorts.filter((p) => MAC_ANY.test(p)),
    ]
      .map((v) => normalizeMacForStorage(v))
      .filter((v): v is string => v !== null),
  );
  const realNameKeys = new Set(nameFields.map((s) => normalizeName(s)));
  const realPorts = new Set(rawPorts.map((p) => p.toLowerCase()));

  // Reti esterne → blocchi nuovi in 10.0.0.0/8, allineati alla loro dimensione,
  // che non toccano nessuna rete e nessun IP veri.
  const parsed = input.networks
    .map((n) => ({ n, c: parseCidr(n.cidr) }))
    .filter((x): x is { n: (typeof input.networks)[number]; c: Cidr } => x.c !== null);
  const realRanges = parsed.map((x) => x.c);
  const realIpList = [...realIps];
  const touchesReal = (from: number, size: number): boolean =>
    realRanges.some((r) => r.base < from + size && from < r.base + sizeOf(r)) ||
    realIpList.some((v) => v >= from && v < from + size);
  const outer = parsed
    .filter((x) => !parsed.some((y) => y !== x && y.c.len < x.c.len && contains(y.c, x.c.base)))
    .sort((a, b) => a.n.id - b.n.id);
  const blocks: Array<{ from: number; len: number; to: number }> = [];
  let next = toInt("10.0.0.0");
  const END = toInt("10.255.255.255");
  for (const { c } of outer) {
    if (blocks.some((b) => b.from === c.base && b.len === c.len)) continue;
    const size = sizeOf(c);
    let to = Math.ceil(next / size) * size;
    while (to + size - 1 <= END && touchesReal(to, size)) to += size;
    if (to + size - 1 > END) throw new Error("anonimizzaInput: le reti non stanno in 10.0.0.0/8");
    blocks.push({ from: c.base, len: c.len, to });
    next = to + size;
  }

  // IP fuori da ogni rete → 172.31.x.y in sequenza, mai un IP o una rete veri.
  let fuori = toInt("172.31.0.1");
  const FUORI_END = toInt("172.31.255.254");
  const nextFuori = (): string => {
    while (fuori <= FUORI_END && (realIps.has(fuori) || realRanges.some((r) => contains(r, fuori)))) fuori++;
    if (fuori > FUORI_END) throw new Error("anonimizzaInput: gli IP fuori dalle reti non stanno in 172.31.0.0/16");
    return toIp(fuori++);
  };
  const ipMap = new Map<string, string>();
  // Un «indirizzo» che non è IPv4 (IPv6, un nome DNS) non esce com'è.
  const otherAddr = new Map<string, string>();
  const ip = (v: string | null): string | null => {
    if (v === null || v.trim() === "") return v;
    const s = v.trim();
    if (!IPV4.test(s)) {
      if (s.includes(":")) {
        const k = s.toLowerCase();
        let out = otherAddr.get(k);
        if (!out) {
          out = `fd00::${(otherAddr.size + 1).toString(16)}`;
          otherAddr.set(k, out);
        }
        return out;
      }
      return pseudo(s, "host");
    }
    const hit = ipMap.get(s);
    if (hit) return hit;
    const n = toInt(s);
    const b = blocks.find((x) => contains({ base: x.from, len: x.len }, n));
    const out = b ? toIp(b.to + (n - b.from)) : nextFuori();
    ipMap.set(s, out);
    return out;
  };
  const otherCidr = new Map<string, string>();
  const cidr = (v: string): string => {
    const c = parseCidr(v);
    if (c) return `${ip(toIp(c.base))}/${c.len}`;
    const k = v.trim().toLowerCase();
    let out = otherCidr.get(k);
    if (!out) {
      out = `fd00:${(otherCidr.size + 1).toString(16)}::/64`;
      otherCidr.set(k, out);
    }
    return out;
  };

  const macMap = new Map<string, string>();
  const ouiMap = new Map<string, number>();
  const macSeqByOui = new Map<number, number>();
  const mac = (v: string | null): string | null => {
    const k = normalizeMacForStorage(v);
    if (!k) return null;
    let out = macMap.get(k);
    if (!out && isVirtualMac(k)) {
      // Un MAC virtuale (VRRP/HSRP) non identifica nessuno e il modello lo tratta a parte:
      // resta virtuale (stessa famiglia, ultimo byte finto, dall'alto), o si fonderebbero oggetti che il dato vero tiene separati.
      const famiglia = k.toLowerCase().split(":").slice(0, 5).join(":");
      let b = 0xff;
      do {
        out = `${famiglia}:${(b--).toString(16).padStart(2, "0")}`;
        if (b < 0) throw new Error("anonimizzaInput: i MAC virtuali finti sono finiti");
      } while (realMacs.has(out.toUpperCase()) || [...macMap.values()].includes(out));
      macMap.set(k, out);
    }
    if (!out) {
      // Il modello confronta i produttori (OUI): due MAC veri di OUI diversi restano di OUI diversi.
      // Un OUI vero → un indice (02:0h:ll, indice su 12 bit), poi un progressivo sui tre byte bassi.
      const oui = realOui(k) ?? "";
      let o = ouiMap.get(oui);
      if (o === undefined) {
        o = ouiMap.size;
        if (o > 0xfff) throw new Error("anonimizzaInput: i produttori (OUI) sono più di 4096");
        ouiMap.set(oui, o);
      }
      do {
        const n = (macSeqByOui.get(o) ?? 0) + 1;
        if (n > 0xffffff) throw new Error("anonimizzaInput: i MAC finti sono finiti");
        macSeqByOui.set(o, n);
        out = `02:0${(o >> 8).toString(16)}:${(o & 255).toString(16).padStart(2, "0")}:${[16, 8, 0].map((sh) => ((n >> sh) & 255).toString(16).padStart(2, "0")).join(":")}`;
      } while (realMacs.has(out.toUpperCase()));
      macMap.set(k, out);
    }
    return out;
  };

  const counters = new Map<string, number>();
  const fresh = (prefix: string): string => {
    let out: string;
    do {
      const n = (counters.get(prefix) ?? 0) + 1;
      counters.set(prefix, n);
      out = `${prefix}-${n}`;
    } while (realNameKeys.has(normalizeName(out)));
    return out;
  };
  const nameMap = new Map<string, string>();
  // Un nome che il modello non usa come identità (di fabbrica, corto, solo esadecimale) resta tale:
  // «fab<n>» è solo esadecimale, quindi non fonde niente, come l'originale.
  let fabSeq = 0;
  const freshFab = (): string => {
    let out: string;
    do out = `fab${++fabSeq}`;
    while (realNameKeys.has(out));
    return out;
  };
  function pseudo(raw: string | null, prefix: string): string | null {
    if (raw === null || raw.trim() === "") return raw;
    if (IPV4.test(raw.trim())) return ip(raw.trim());
    if (MAC.test(raw.trim())) return mac(raw.trim());
    const key = normalizeName(raw);
    // Chiave vuota (es. «.x»): il modello non la abbina a niente, e così resta.
    if (key === "") return fresh(prefix);
    let out = nameMap.get(key);
    if (!out) {
      out = identifiesByName(key) ? fresh(prefix) : freshFab();
      nameMap.set(key, out);
    }
    return out;
  }

  const portMap = new Map<string, string>();
  let portSeq = 0;
  /** Interfacce logiche: un nome scelto dal cliente che comincia così tiene il prefisso («vlan-porta-N»), il traduttore lo legge ancora logico. */
  const PREFISSO_LOGICO = /^(bridge|vlan|vrrp|eoip|gre|ipip|vxlan|wireguard|wg|ovpn|pppoe|pptp|l2tp|sstp|lte|loopback|veth)/i;
  const pezzo = (v: string): string => {
    const t = v.trim();
    if (t === "" || PORTA_GENERICA.test(t)) return v;
    if (IPV4.test(t)) return ip(t) as string;
    if (MAC_ANY.test(t)) return mac(t) as string;
    let out = portMap.get(t);
    if (!out) {
      const pre = PREFISSO_LOGICO.exec(t)?.[1]?.toLowerCase();
      do out = `${pre ? `${pre}-` : ""}porta-${++portSeq}`;
      while (realPorts.has(out));
      portMap.set(t, out);
    }
    return out;
  };
  /**
   * Un nome di porta: di serie resta; composto («‹porta›,‹fascio›,‹bridge›», «‹bridge›/‹porta›», «‹porta di serie› -
   * ‹descrizione›») si anonimizza pezzo per pezzo: la parte di serie resta e il traduttore la legge come sul dato vero;
   * lo stesso pezzo ha sempre lo stesso pseudonimo (il bridge, la descrizione di una porta nell'elenco e nell'LLDP).
   */
  const porta = (v: string): string => {
    if (!v || v.trim() === "") return v;
    const t = v.trim();
    // Prima IP e MAC: «192.0.2.1» e «00:11:22:33:44:55» passerebbero per numeri di porta di serie.
    if (IPV4.test(t)) return ip(t) as string;
    if (MAC_ANY.test(t)) return mac(t) as string;
    if (PORTA_GENERICA.test(t)) return v;
    const conDescrizione = /^(.+?) - (.+)$/.exec(t);
    if (conDescrizione && PORTA_GENERICA.test(conDescrizione[1])) return `${conDescrizione[1]} - ${pezzo(conDescrizione[2])}`;
    if (t.includes(",")) return t.split(",").map(pezzo).join(",");
    if (t.includes("/") && !/\d\/\d/.test(t)) return t.split("/").map(pezzo).join("/");
    return pezzo(t);
  };
  const piattaforma = (v: string | null | undefined): string | null => (!v || v.trim() === "" ? null : /mikrotik/i.test(v) ? "MikroTik" : "altro");

  // Un nome d'host vuoto vale come assente (il modello e la mappa vecchia li trattano uguali).
  const blankToNull = (v: string | null): string | null => (v === null || v.trim() === "" ? null : v);

  // Gli apparati per primi: un vicino col nome di un apparato ne prende la sigla.
  const devices = [...input.devices].sort((a, b) => a.id - b.id).map((d) => ({
    // Un nome vuoto non si abbina a niente: una sigla nuova, che nessuno cerca, lascia il modello com'è.
    ...d, name: d.name.trim() === "" ? fresh(SIGLA[d.device_type] ?? "DEV") : (pseudo(d.name, SIGLA[d.device_type] ?? "DEV") as string), host: ip(d.host) as string, model: null,
    controller_mac: mac(d.controller_mac), uplink_mac: mac(d.uplink_mac),
  }));
  const hosts = [...input.hosts].sort((a, b) => a.id - b.id).map((h) => ({
    ...h, ip: ip(h.ip) as string, mac: mac(h.mac), hostname: blankToNull(pseudo(h.hostname, "host")), custom_name: blankToNull(pseudo(h.custom_name, "host")),
  }));
  const neighbors = input.neighbors.map((n) => ({
    ...n, remote_device_name: pseudo(n.remote_device_name, "ext") ?? "", remote_ip: ip(n.remote_ip), remote_mac: mac(n.remote_mac),
    local_port: porta(n.local_port), remote_port: porta(n.remote_port),
    ...(n.remote_platform !== undefined ? { remote_platform: piattaforma(n.remote_platform) } : {}),
  }));
  const locations = [...input.locations].sort((a, b) => a.id - b.id).map((l) => ({
    ...l, name: fresh(l.parent_id == null ? "Sede" : "Ubicazione"),
  }));
  const networks = [...input.networks].sort((a, b) => a.id - b.id).map((n) => ({
    ...n, cidr: cidr(n.cidr), name: fresh("Rete"), gateway: ip(n.gateway),
  }));
  return {
    ...input, devices, hosts, neighbors, locations, networks,
    knownMacs: input.knownMacs.map((k) => ({ ...k, mac: mac(k.mac) as string })),
    uplinkPorts: input.uplinkPorts.map((p) => ({ ...p, port_name: porta(p.port_name) })),
    // Stesso MAC vero → stesso MAC finto degli host e dei vicini; la porta passa dal vocabolario delle porte; il timestamp resta (come nei vicini).
    macPorts: input.macPorts.map((m) => ({ ...m, mac: mac(m.mac) as string, port_name: porta(m.port_name) })),
    // Chi ha fatto una correzione è una persona: non entra (quando sì).
    overrides: input.overrides.map((o) => ({
      ...o, a_port: porta(o.a_port), b_port: porta(o.b_port), ...(o.created_by !== undefined ? { created_by: null } : {}),
    })),
    primaries: input.primaries.map((p) => ({ ...p, node_port: porta(p.node_port), other_port: porta(p.other_port) })),
    portInfo: input.portInfo.map((p) => ({ ...p, port_name: porta(p.port_name) })),
    // Le VM e gli host dei cluster portano nomi, IP e MAC veri dei clienti: nelle fixture non entrano.
    vms: [],
    scanHosts: [],
    ...(input.ports ? { ports: input.ports.map((p) => ({ ...p, port_name: porta(p.port_name) })) } : {}),
  };
}

/** Parole che l'anonimo contiene di suo (sigle, vocabolario, porte di serie): non sono dati del cliente. */
const PAROLE_DELL_APP = new Set<string>([
  ...Object.values(VOCABOLARIO).flatMap((vs) => [...vs]).flatMap((v) => v.toLowerCase().split(/[^a-z0-9]+/)),
  "rtr", "sw", "ap", "fw", "hv", "nas", "srv", "dev", "host", "ext", "sede", "ubicazione", "rete", "porta", "port", "fd00",
  "ether", "eth", "sfp", "sfpplus", "sfp28", "qsfp", "qsfpplus", "combo", "wlan", "bridge", "bond", "vmbr", "vlan", "lan", "wan",
  "mgmt", "gigabitethernet", "tengigabitethernet", "twentyfivegige", "fortygigabitethernet", "hundredgige", "fastethernet",
  "ethernet", "channel", "interface", "wifi",
  "vrrp", "eoip", "vxlan", "wireguard", "ovpn", "pppoe", "pptp", "l2tp", "sstp", "loopback", "veth", "sfp28",
]);

const tokens = (s: string): string[] => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const seq = (t: string[]): string => ` ${t.join(" ")} `;

/**
 * Quanti valori di testo di `anonimo` contengono un IP, un MAC (in ogni forma) o un
 * nome veri di `vero`. Per i nomi: la chiave, ogni etichetta fra i punti e ogni parola
 * di almeno 4 caratteri (non solo cifre, non del vocabolario dell'app), a parola
 * intera e senza distinzione di maiuscole. Lo script d'estrazione rifiuta di scrivere
 * una fixture se il conto non è zero. Logica pura.
 */
export function contaValoriVeri(vero: TopologyModelInput, anonimo: unknown): { ip: number; mac: number; nomi: number } {
  const ports = portsOf(vero).map((p) => p.trim());
  const names = [
    ...vero.devices.flatMap((d) => [d.name, d.host]), ...vero.hosts.flatMap((h) => [h.hostname, h.custom_name, h.ip]),
    ...vero.neighbors.map((n) => n.remote_device_name), ...vero.locations.map((l) => l.name), ...vero.networks.map((n) => n.name),
  ].filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim());
  const ips = new Set<string>(
    [
      ...vero.devices.map((d) => d.host), ...vero.hosts.map((h) => h.ip), ...vero.neighbors.map((n) => n.remote_ip),
      ...vero.networks.flatMap((n) => [n.gateway, n.cidr.split("/")[0]]), ...names, ...ports,
    ].filter((v): v is string => typeof v === "string" && IPV4.test(v.trim())).map((v) => v.trim()),
  );
  const macs = new Set<string>(
    [
      ...vero.hosts.map((h) => h.mac), ...vero.devices.flatMap((d) => [d.controller_mac, d.uplink_mac]),
      ...vero.knownMacs.map((k) => k.mac), ...vero.neighbors.map((n) => n.remote_mac), ...vero.macPorts.map((m) => m.mac),
      ...[...names, ...ports].filter((s) => MAC_ANY.test(s)),
    ]
      .map((v) => normalizeMacForStorage(v))
      .filter((v): v is string => v !== null)
      .map((v) => v.replace(/:/g, "").toLowerCase()),
  );
  const nomi = new Set<string>();
  for (const n of names) {
    if (IPV4.test(n) || MAC_ANY.test(n)) continue;
    const parti = [normalizeName(n), ...n.split(".")].map(tokens).filter((t) => t.join("").length >= 4);
    const parole = tokens(n).filter((t) => t.length >= 4 && !/^\d+$/.test(t)).map((t) => [t]);
    for (const t of [...parti, ...parole]) {
      if (t.length === 1 && PAROLE_DELL_APP.has(t[0])) continue;
      nomi.add(seq(t));
    }
  }

  const valori: string[] = [];
  const raccogli = (v: unknown): void => {
    if (typeof v === "string") valori.push(v);
    else if (Array.isArray(v)) v.forEach(raccogli);
    else if (v !== null && typeof v === "object") Object.values(v).forEach(raccogli);
  };
  raccogli(anonimo);

  const conto = { ip: 0, mac: 0, nomi: 0 };
  for (const v of valori) {
    if ((v.match(/(?<![\d.])\d{1,3}(?:\.\d{1,3}){3}(?![\d.])/g) ?? []).some((x) => ips.has(x))) conto.ip++;
    const compatto = v.toLowerCase().replace(/[\s:.-]/g, "");
    if ([...macs].some((m) => compatto.includes(m))) conto.mac++;
    const t = seq(tokens(v));
    if ([...nomi].some((n) => t.includes(n))) conto.nomi++;
  }
  return conto;
}

/**
 * L'ingresso che una fixture può avere: senza le VM e gli host dei cluster, che portano nomi, IP e MAC veri dei clienti
 * (`FASE_2B_SEZIONI.vms: null` nella prova della forma). Lo script d'estrazione confronta i conteggi del modello su
 * questo e sulla fixture anonima: dalla fase 2b le VM cambiano il modello, e col dato vero intero il confronto falliva.
 */
export function ingressoDellaFixture(input: TopologyModelInput): TopologyModelInput {
  return { ...input, vms: [], scanHosts: [] };
}
