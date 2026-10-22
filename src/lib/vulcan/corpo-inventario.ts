/**
 * A-IPAM, Task 4: la fotografia dell'inventario per DA-Vul-can
 * (`POST /api/ipam/inventario`, spec §5.4, `schema_versione: 1`). Funzione pura.
 *
 * Lista bianca: ogni oggetto si costruisce campo per campo, in ordine fisso
 * (`CAMPI_OGGETTO`); niente si copia dalla riga. L'hub valida con uno schema chiuso
 * (`strict`, copia in `__tests__/fixtures/schemi-hub.ts`): un campo in più o un testo
 * oltre i suoi limiti farebbe rifiutare l'intera fotografia (422), quindi i testi si
 * accorciano ai limiti dell'hub e un host che non può avere i campi obbligatori
 * (ip, rete, data) si salta e si conta.
 *
 * Oggetti ordinati per rete e ip, chiavi fisse: due fotografie dello stesso DB fermo
 * differiscono solo per `generato_il`.
 */
import { statoSupportoOs } from "@/lib/ad/health/obsolete-os";
import { parseDbDate } from "@/lib/db-date";
import type { DatiInventario, RigaHostInventario } from "./dati-inventario";

export const SCHEMA_VERSIONE_INVENTARIO = 1;
/** Limiti dell'hub: oltre, l'istanza non invia e lo dice. */
export const MAX_OGGETTI = 50_000;
export const MAX_RETI = 5_000;
export const MAX_BYTE_JSON = 50 * 1024 * 1024;
const MAX_PORTE = 1000;

/** La lista bianca dei campi di un oggetto, nell'ordine in cui escono. */
export const CAMPI_OGGETTO: readonly string[] = Object.freeze([
  "ip", "rete_cidr", "stato", "visto_prima", "visto_ultima", "classificazione", "os_famiglia", "os", "fuori_supporto",
  "mac", "produttore", "hostname", "tipo_apparato", "modello", "firmware", "seriale", "porte", "fonti", "in_ad",
  "agente_wazuh",
]);

const STATI = new Set(["online", "offline", "unknown"]);

/** Testo pulito e accorciato al limite dell'hub; vuoto → null. Non spezza una coppia surrogata. */
function taglia(v: unknown, max: number): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (s === "") return null;
  if (s.length <= max) return s;
  let t = s.slice(0, max);
  const ultimo = t.charCodeAt(t.length - 1);
  if (ultimo >= 0xd800 && ultimo <= 0xdbff) t = t.slice(0, -1);
  return t;
}

const primo = (...v: (string | null)[]): string | null => {
  for (const x of v) if (x != null && x.trim() !== "") return x;
  return null;
};

/** Data del DB (SQLite UTC senza fuso) in ISO; vuota o illeggibile → null, mai un testo finto (revisione 22/10). */
function dataIso(v: string | null): string | null {
  if (v == null || v.trim() === "") return null;
  const d = parseDbDate(v.trim());
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Minuscole solo ASCII, come `LOWER()` di SQLite. */
const minuscoleAscii = (s: string) => s.replace(/[A-Z]/g, (c) => c.toLowerCase());

/**
 * Stessa regola della colonna generata `hosts.os_family` (db-tenant-schema.ts):
 * `TRIM` di SQLite toglie solo gli spazi, `LOWER` solo l'ASCII. Una prova la
 * confronta con SQLite su stringhe vere.
 */
export function famigliaOs(os: string | null): string {
  if (os == null || os.replace(/^ +| +$/g, "") === "") return "Unknown";
  const l = minuscoleAscii(os);
  const ha = (...k: string[]) => k.some((x) => l.includes(x));
  if (ha("windows")) return "Windows";
  if (ha("android")) return "Android";
  if (l.startsWith("ios") || ha("ipados", "iphone", "ipad")) return "iOS";
  if (ha("macos", "mac os", "darwin", "osx")) return "Apple";
  if (ha("linux", "ubuntu", "debian", "centos", "rhel", "red hat", "fedora", "alpine", "suse", "arch", "rocky", "almalinux")) {
    return "Linux";
  }
  return "Unknown";
}

type Porta = { porta: number; protocollo: string; servizio: string | null; versione: string | null };

/** `open_ports` (JSON `[{port, protocol, service, version}]`) → porte; illeggibile → null. */
function porteDi(raw: string | null): Porta[] | null {
  if (raw == null || raw.trim() === "") return [];
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(v)) return null;
  const out: Porta[] = [];
  for (const x of v) {
    if (!x || typeof x !== "object") continue;
    const p = x as Record<string, unknown>;
    const n = typeof p.port === "number" ? p.port : typeof p.port === "string" ? Number(p.port) : NaN;
    if (!Number.isInteger(n) || n < 0 || n > 65535) continue;
    out.push({
      porta: n,
      protocollo: taglia(p.protocol, 8) ?? "",
      servizio: taglia(p.service, 80),
      versione: taglia(p.version, 120),
    });
    if (out.length >= MAX_PORTE) break;
  }
  return out;
}

/** Chiave d'ordine dell'ip: IPv4 a ottetti con zeri davanti (10.0.0.9 prima di 10.0.0.10), il resto com'è. */
function chiaveIp(ip: string): string {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  return m ? `4:${m.slice(1).map((o) => o.padStart(3, "0")).join(".")}` : `6:${ip}`;
}

const confronta = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function oggettoDi(h: RigaHostInventario, rete: string, d: DatiInventario, adesso: Date, conto: { porteIllegibili: number }) {
  const ip = taglia(h.ip, 45);
  if (ip == null || ip.length < 3) return null;
  const vistoPrima = dataIso(h.first_seen) ?? dataIso(h.created_at);
  if (vistoPrima == null) return null;
  const vistoUltima = dataIso(h.last_seen) ?? vistoPrima;

  const w = d.wazuh.get(h.id);
  const inAd = d.inAd.has(h.id);
  const os = taglia(primo(w?.os ?? null, d.osAd.get(h.id) ?? null, h.os_info), 200);
  const famigliaColonna = h.os_family && h.os_family !== "Unknown" ? h.os_family : null;

  let porte = porteDi(h.open_ports);
  if (porte == null) {
    conto.porteIllegibili++;
    porte = [];
  }
  const fonti: string[] = [];
  const sorgente = taglia(h.host_source, 40);
  if (sorgente) fonti.push(sorgente);
  if (inAd && !fonti.includes("ad")) fonti.push("ad");
  if (w && !fonti.includes("wazuh")) fonti.push("wazuh");

  const stato = h.status && STATI.has(h.status) ? h.status : "unknown";

  // Chiavi nell'ordine di CAMPI_OGGETTO.
  return {
    ip,
    rete_cidr: rete,
    stato,
    visto_prima: vistoPrima,
    visto_ultima: vistoUltima,
    classificazione: taglia(h.classification, 60) ?? "unknown",
    os_famiglia: taglia(famigliaColonna ?? famigliaOs(os), 60) ?? "Unknown",
    os,
    fuori_supporto: statoSupportoOs(os, adesso),
    mac: taglia(h.mac, 32),
    produttore: taglia(primo(h.vendor, h.device_manufacturer), 120),
    hostname: taglia(primo(h.custom_name, h.hostname, h.dns_reverse), 255),
    tipo_apparato: taglia(h.nd_device_type, 60),
    modello: taglia(primo(h.nd_model, h.model), 120),
    firmware: taglia(primo(h.nd_firmware, h.firmware), 120),
    seriale: taglia(primo(h.nd_serial_number, h.serial_number), 120),
    porte,
    fonti,
    in_ad: inAd,
    agente_wazuh: w != null,
  };
}

export function corpoInventario(
  d: DatiInventario,
  testa: { codcli: string; nodo: string; versione: string; adesso: Date },
): { json: string; oggetti: number; porteIllegibili: number; saltati: number } | { errore: string } {
  if (d.host.length > MAX_OGGETTI) {
    return { errore: `oltre 50.000 oggetti (${d.host.length}): l'hub non li accetta` };
  }
  if (d.reti.length > MAX_RETI) return { errore: `oltre 5.000 reti (${d.reti.length}): l'hub non le accetta` };

  const cidrDi = new Map<number, string>();
  const reti = [...d.reti]
    .sort((a, b) => confronta(a.cidr, b.cidr) || a.id - b.id)
    .map((r) => {
      cidrDi.set(r.id, r.cidr);
      return { cidr: taglia(r.cidr, 49) ?? "", nome: taglia(r.nome, 120) ?? "", vlan: Number.isInteger(r.vlan) ? r.vlan : null, sede: taglia(r.sede, 120) };
    });

  const conto = { porteIllegibili: 0 };
  let saltati = 0;
  const oggetti: { chiave: [string, string]; o: NonNullable<ReturnType<typeof oggettoDi>> }[] = [];
  for (const h of d.host) {
    const rete = cidrDi.get(h.network_id);
    const o = rete && rete.length >= 3 && rete.length <= 49 ? oggettoDi(h, rete, d, testa.adesso, conto) : null;
    if (!o) {
      saltati++;
      continue;
    }
    oggetti.push({ chiave: [rete as string, chiaveIp(o.ip)], o });
  }
  oggetti.sort((a, b) => confronta(a.chiave[0], b.chiave[0]) || confronta(a.chiave[1], b.chiave[1]));

  const json = JSON.stringify({
    schema_versione: SCHEMA_VERSIONE_INVENTARIO,
    codcli: taglia(testa.codcli, 20) ?? "",
    nodo: taglia(testa.nodo, 80) ?? "",
    generato_il: testa.adesso.toISOString(),
    versione_ipam: taglia(testa.versione, 40),
    reti,
    oggetti: oggetti.map((x) => x.o),
  });
  if (Buffer.byteLength(json, "utf8") > MAX_BYTE_JSON) {
    return { errore: "fotografia oltre 50 MB: l'hub non la accetta" };
  }
  return { json, oggetti: oggetti.length, porteIllegibili: conto.porteIllegibili, saltati };
}
