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
import { normalizeMacForStorage } from "@/lib/utils";

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const MAC = /^[0-9a-f]{2}([:-]?)[0-9a-f]{2}(\1[0-9a-f]{2}){4}$/i;
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
    ].join("|") +
    ")$",
  "i",
);

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

export function anonimizzaInput(input: TopologyModelInput): TopologyModelInput {
  // Valori veri: gli pseudonimi li evitano.
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
      ...input.networks.map((n) => n.gateway), ...nameFields.map((s) => s.trim()),
    ]
      .filter((v): v is string => typeof v === "string" && IPV4.test(v))
      .map(toInt),
  );
  const realMacs = new Set<string>(
    [
      ...input.hosts.map((h) => h.mac), ...input.devices.flatMap((d) => [d.controller_mac, d.uplink_mac]),
      ...input.knownMacs.map((k) => k.mac), ...input.neighbors.map((n) => n.remote_mac),
      ...nameFields.filter((s) => MAC.test(s.trim())),
    ]
      .map((v) => normalizeMacForStorage(v))
      .filter((v): v is string => v !== null),
  );
  const realNameKeys = new Set(nameFields.map((s) => normalizeName(s)));
  const realPorts = new Set(
    [
      ...input.neighbors.flatMap((n) => [n.local_port, n.remote_port]), ...input.uplinkPorts.map((p) => p.port_name),
      ...input.overrides.flatMap((o) => [o.a_port, o.b_port]),
    ].map((p) => (p ?? "").toLowerCase()),
  );

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
  let macSeq = 0;
  const mac = (v: string | null): string | null => {
    const k = normalizeMacForStorage(v);
    if (!k) return null;
    let out = macMap.get(k);
    if (!out) {
      do {
        macSeq++;
        if (macSeq > 0xffffff) throw new Error("anonimizzaInput: i MAC finti sono finiti");
        out = `02:00:00:${[16, 8, 0].map((s) => ((macSeq >> s) & 255).toString(16).padStart(2, "0")).join(":")}`;
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
  function pseudo(raw: string | null, prefix: string): string | null {
    if (raw === null || raw.trim() === "") return raw;
    if (IPV4.test(raw.trim())) return ip(raw.trim());
    if (MAC.test(raw.trim())) return mac(raw.trim());
    const key = normalizeName(raw);
    // Chiave vuota (es. «.x»): il modello non la abbina a niente, e così resta.
    if (key === "") return fresh(prefix);
    let out = nameMap.get(key);
    if (!out) {
      out = fresh(prefix);
      nameMap.set(key, out);
    }
    return out;
  }

  const portMap = new Map<string, string>();
  let portSeq = 0;
  const porta = (v: string): string => {
    if (!v || v.trim() === "" || PORTA_GENERICA.test(v.trim())) return v;
    let out = portMap.get(v);
    if (!out) {
      do out = `porta-${++portSeq}`;
      while (realPorts.has(out));
      portMap.set(v, out);
    }
    return out;
  };

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
    overrides: input.overrides.map((o) => ({ ...o, a_port: porta(o.a_port), b_port: porta(o.b_port) })),
  };
}
