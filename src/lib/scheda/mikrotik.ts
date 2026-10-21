/**
 * Pezzi puri della scheda MikroTik (21/10, piano «Scheda MikroTik copiata dal Manager»): gruppo e stato delle
 * interfacce, uso in percentuale, contatori e caselle della Panoramica, matrice porte × VLAN. Modulo puro (niente DB, niente React):
 * un dato che manca non produce una casella con un «—».
 */
import type { Casella } from "@/components/scheda/striscia-numeri";
import type { Fonte } from "@/components/scheda/riga-fonti";
import type {
  HardwareMikrotik, RigaBondMk, RigaBridgeMk, RigaDnsMk, RigaPortaBridgeMk, RigaPortaSchedaMk, RigaVlanBridgeMk, RigaVlanMk, RisorseMikrotik,
} from "@/lib/devices/mikrotik-scheda";
import { SOGLIA_POOL, type InterfacciaScheda, type UsoPool } from "./router";

export type GruppoInterfaccia = "ethernet" | "vlan" | "bond" | "bridge" | "vpn_tunnel" | "altro";

const TUNNEL = new Set([
  "wg", "wireguard", "ovpn-in", "ovpn-out", "ovpn-client", "ovpn-server", "l2tp-in", "l2tp-out", "l2tp-client",
  "sstp-in", "sstp-out", "sstp-client", "pptp-in", "pptp-out", "pptp-client", "eoip", "eoipv6", "eoip-tunnel",
  "gre", "gre6", "gre-tunnel", "ipip", "ipipv6", "ipip-tunnel", "vxlan",
]);

/** Regola della tavola «Interfacce». Il Manager metteva `wg` in «Altro»: qui è un tunnel. Tipo ignoto = altro. */
export function gruppoInterfaccia(tipo: string | null): GruppoInterfaccia {
  const t = (tipo ?? "").trim().toLowerCase();
  if (t === "ether" || t === "ethernet") return "ethernet";
  if (t === "vlan") return "vlan";
  if (t === "bond" || t === "bonding") return "bond";
  if (t === "bridge") return "bridge";
  return TUNNEL.has(t) ? "vpn_tunnel" : "altro";
}

const TITOLI_GRUPPO: { gruppo: GruppoInterfaccia; titolo: string }[] = [
  { gruppo: "ethernet", titolo: "Ethernet" }, { gruppo: "vlan", titolo: "VLAN" }, { gruppo: "bond", titolo: "Bond" },
  { gruppo: "bridge", titolo: "Bridge" }, { gruppo: "vpn_tunnel", titolo: "VPN e tunnel" }, { gruppo: "altro", titolo: "Altro" },
];

/**
 * Interfacce della tab, un gruppo per tipo nell'ordine della tavola; i gruppi vuoti non ci sono. `tipi` = i tipi RouterOS
 * presenti nel gruppo (minuscolo, in ordine alfabetico, per la testata); dentro il gruppo resta l'ordine di lettura.
 */
export function raggruppaInterfacce(l: InterfacciaScheda[]): { gruppo: GruppoInterfaccia; titolo: string; tipi: string; righe: InterfacciaScheda[] }[] {
  return TITOLI_GRUPPO
    .map(({ gruppo, titolo }) => {
      const righe = l.filter((i) => gruppoInterfaccia(i.tipo) === gruppo);
      const tipi = [...new Set(righe.map((i) => (i.tipo ?? "").trim().toLowerCase()).filter(Boolean))].sort().join(", ");
      return { gruppo, titolo, tipi, righe };
    })
    .filter((g) => g.righe.length > 0);
}

/** `disabilitata` (segno X) vince su tutto: un'interfaccia spenta da configurazione non è «giù» per un guasto. */
export function statoInterfaccia(i: { stato: "up" | "down" | "unknown"; disabilitata: boolean | null }): "attiva" | "inattiva" | "disabilitata" {
  if (i.disabilitata === true) return "disabilitata";
  return i.stato === "up" ? "attiva" : "inattiva";
}

/** Percentuale USATA 0-100 da totale e libero; null se manca un dato o il totale è 0. Libero > totale = 0, mai negativo. */
export function usoPercento(totale: number | null, libero: number | null): number | null {
  if (totale == null || libero == null || !(totale > 0) || libero < 0) return null;
  return Math.max(0, Math.min(100, Math.round(((totale - libero) / totale) * 100)));
}

export interface ContatoriMikrotik {
  indirizzi: number | null; vlan: number | null; porteBridge: number | null; bond: number | null; rotte: number | null; utenti: number | null;
}

/**
 * I sei contatori del riquadro: ognuno c'è solo se il dato c'è. VLAN e bond, se nessun altro li dà, si contano dal tipo
 * delle interfacce; le VLAN lette dal router vincono sul tipo; gli utenti solo per l'admin (Task 11).
 */
export function contatoriMikrotik(i: {
  interfacce: InterfacciaScheda[] | null; rotte: number; porteBridge: number | null; bond: number | null;
  /** Interfacce VLAN lette da `/interface vlan` (Task 10): se ci sono vincono sul conto dal tipo. null = mai lette. */
  vlanLette: RigaVlanMk[] | null;
  /** Utenti del router: il numero c'è solo se chi guarda è admin (`admin` false → null comunque). */
  utenti: number | null; admin: boolean;
}): ContatoriMikrotik {
  const l = i.interfacce;
  // Il tipo delle righe lette prima del Task 3 è null: «0 VLAN» sarebbe un dato inventato, e zero non si mostra.
  const dalTipo = (g: GruppoInterfaccia): number | null => {
    if (!l || !l.some((x) => x.tipo)) return null;
    const n = l.filter((x) => gruppoInterfaccia(x.tipo) === g).length;
    return n > 0 ? n : null;
  };
  return {
    indirizzi: l ? l.reduce((n, x) => n + x.indirizzi.length, 0) : null,
    vlan: i.vlanLette ? (i.vlanLette.length > 0 ? i.vlanLette.length : null) : dalTipo("vlan"),
    porteBridge: i.porteBridge,
    bond: i.bond ?? dalTipo("bond"),
    rotte: i.rotte > 0 ? i.rotte : null,
    utenti: i.admin && i.utenti != null && i.utenti > 0 ? i.utenti : null,
  };
}

/** Interfacce raggruppate per tipo (testo com'è sul router, minuscolo; ignoto = «altro»), dal più numeroso. */
export function perTipo(interfacce: InterfacciaScheda[]): { tipo: string; numero: number }[] {
  const m = new Map<string, number>();
  for (const i of interfacce) {
    const t = (i.tipo ?? "").trim().toLowerCase() || "altro";
    m.set(t, (m.get(t) ?? 0) + 1);
  }
  return [...m].map(([tipo, numero]) => ({ tipo, numero })).sort((a, b) => b.numero - a.numero);
}

// ── Formati ─────────────────────────────────────────────────────────────

/** «806 MiB», «1 GiB», «47 KiB»; il numero in ottetti di 1024. */
export function quantitaBinaria(byte: number): string {
  const unita = ["B", "KiB", "MiB", "GiB", "TiB"];
  let v = byte;
  let k = 0;
  while (v >= 1024 && k < unita.length - 1) { v /= 1024; k++; }
  const n = v >= 100 || Number.isInteger(v) ? Math.round(v) : Math.round(v * 10) / 10;
  return `${String(n).replace(".", ",")} ${unita[k]}`;
}

/** Data di una lettura salvata (UTC, con o senza «T»/«Z»). */
function dataLettura(s: string): Date | null {
  const d = new Date(/Z$|[+-]\d{2}:?\d{2}$/.test(s) ? s : s.replace(" ", "T") + "Z");
  return Number.isNaN(d.getTime()) ? null : d;
}

const SOGLIA_CPU = 85;

/** «41 g» e «riavvio 12/09» (data in ora italiana, dalla data della lettura); null senza uptime. Usato dalla striscia e dal riquadro Risorse. */
export function accesoDaMk(r: RisorseMikrotik | null, scansione: string | null): { valore: string; sotto?: string } | null {
  if (r?.uptime_s == null) return null;
  const giorni = Math.floor(r.uptime_s / 86400);
  const letta = scansione ? dataLettura(scansione) : null;
  const riavvio = letta ? new Date(letta.getTime() - r.uptime_s * 1000).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", timeZone: "Europe/Rome" }) : null;
  return { valore: `${giorni} g`, ...(riavvio ? { sotto: `riavvio ${riavvio}` } : {}) };
}

/** Striscia della Panoramica MikroTik: al massimo sei caselle, solo quelle di cui c'è il dato (ordine della tavola). */
export function caselleMikrotik(i: {
  risorse: RisorseMikrotik | null;
  hardware: HardwareMikrotik | null;
  scansione: string | null;
  interfacce: InterfacciaScheda[] | null;
  vlan: { numero: number; bridge: number | null } | null;
  /** Interfacce VLAN lette da `/interface vlan`: se ci sono, il numero è il loro (vince sul conto dal tipo). */
  vlanLette?: RigaVlanMk[] | null;
  /**
   * Uso dei pool DHCP dall'ultima lettura già in cache (la tab DHCP); null = mai letto, e la Panoramica non apre SSH
   * per questo. Conta solo il più pieno, e solo da `SOGLIA_POOL`.
   */
  pool?: UsoPool[] | null;
}): Casella[] {
  const c: Casella[] = [];
  const r = i.risorse;
  if (r?.cpu_carico != null) {
    const sotto = r.cpu_core != null ? `${r.cpu_core} core${r.cpu_mhz != null ? ` · ${r.cpu_mhz} MHz` : ""}` : undefined;
    c.push({ etichetta: "CPU", valore: `${r.cpu_carico}%`, ...(sotto ? { sotto } : {}), ...(r.cpu_carico >= SOGLIA_CPU ? { attenzione: true } : {}) });
  }
  const mem = r ? usoPercento(r.memoria_totale_b, r.memoria_libera_b) : null;
  if (r && mem != null && r.memoria_totale_b != null && r.memoria_libera_b != null) {
    c.push({ etichetta: "Memoria usata", valore: `${mem}%`, sotto: `${quantitaBinaria(r.memoria_libera_b)} liberi su ${quantitaBinaria(r.memoria_totale_b)}`, ...(mem >= SOGLIA_CPU ? { attenzione: true } : {}) });
  }
  // «Acceso da» cede il posto solo quando firmware aggiornabile e pool pieno si presentano insieme (sei caselle al massimo).
  const h = i.hardware;
  const aggiornabile = !!h?.firmware_corrente && !!h.firmware_aggiornabile && h.firmware_aggiornabile !== h.firmware_corrente;
  const piena = i.pool?.filter((p) => p.percento >= SOGLIA_POOL).sort((a, b) => b.percento - a.percento)[0] ?? null;
  const acceso = accesoDaMk(r, i.scansione);
  if (acceso && !(aggiornabile && piena)) c.push({ etichetta: "Acceso da", valore: acceso.valore, ...(acceso.sotto ? { sotto: acceso.sotto } : {}) });
  if (i.interfacce && i.interfacce.length > 0) {
    const su = i.interfacce.filter((x) => statoInterfaccia(x) === "attiva").length;
    const spente = i.interfacce.filter((x) => x.disabilitata === true).length;
    c.push({ etichetta: "Interfacce su", valore: `${su} / ${i.interfacce.length}`, ...(spente > 0 ? { sotto: `${spente} disabilitat${spente === 1 ? "a" : "e"}` } : {}), tab: "interfacce" });
  }
  const nVlan = i.vlanLette ? i.vlanLette.length : i.vlan?.numero ?? (i.interfacce ? i.interfacce.filter((x) => gruppoInterfaccia(x.tipo) === "vlan").length : null);
  if (nVlan != null && nVlan > 0) {
    // Con almeno un bridge c'è la tab VLAN (Task 9) e la casella apre quella; senza, le VLAN stanno nelle Interfacce.
    c.push({ etichetta: "VLAN", valore: String(nVlan), ...(i.vlan?.bridge != null ? { sotto: `su ${i.vlan.bridge} bridge` } : {}), tab: (i.vlan?.bridge ?? 0) > 0 ? "vlan" : "interfacce" });
  }
  // Firmware: la casella c'è solo quando un aggiornamento esiste; la versione installata sta nel riquadro Hardware.
  if (aggiornabile && h?.firmware_aggiornabile) {
    c.push({ etichetta: "Firmware aggiornabile", valore: h.firmware_aggiornabile, sotto: `installato ${h.firmware_corrente}`, attenzione: true });
  }
  if (piena) {
    c.push({ etichetta: "Pool DHCP più pieno", valore: `${piena.percento}%`, sotto: `${piena.usati} / ${piena.totale} · ${piena.server}`, attenzione: true, tab: "dhcp" });
  }
  return c.slice(0, 6);
}

// ── Configurazione: export ripulito come nel Manager (21/10) ─────────────────────────────────────────────────────
// Le sezioni «/system script» e «/system scheduler» dell'export contengono lo script di backup col suo accesso SFTP:
// non si mostrano né si scaricano. Il resto del testo resta byte per byte com'è, salvo le continuazioni di riga «\».

const SEZIONI_DA_TOGLIERE = new Set(["/system script", "/system scheduler"]);

export function ripulisciExport(testo: string): { testo: string; tolte: string[]; righe: number } {
  if (testo === "") return { testo: "", tolte: [], righe: 0 };
  const righe = testo.split(/(?<=\n)/); // ogni riga col suo terminatore, così \r\n e \n restano come sono
  const tolte: string[] = [];
  const tenute: string[] = [];
  let inSezioneTolta = false;
  for (const riga of righe) {
    const nuda = riga.replace(/\r?\n$/, "");
    if (nuda.startsWith("/")) {
      const nome = nuda.trim();
      // un'intestazione chiude la continuazione: una «\» rimasta sull'ultima riga tenuta (la sezione che seguiva è
      // stata tolta, o l'export era troncato) si toglie, il terminatore di riga resta
      const prec = tenute.length - 1;
      if (prec >= 0) tenute[prec] = tenute[prec].replace(/[ \t]*\\(\r?\n)$/, "$1");
      inSezioneTolta = SEZIONI_DA_TOGLIERE.has(nome);
      if (inSezioneTolta && !tolte.includes(nome)) tolte.push(nome);
    }
    if (inSezioneTolta) continue;
    // continuazione: la riga precedente finiva con «\» → si unisce togliendo «\» e il rientro di questa
    const ultima = tenute.length - 1;
    if (ultima >= 0 && /\\\r?\n$/.test(tenute[ultima]) && !nuda.startsWith("/")) {
      tenute[ultima] = tenute[ultima].replace(/\\\r?\n$/, "") + riga.replace(/^[ \t]+/, "");
    } else {
      tenute.push(riga);
    }
  }
  const out = tenute.join("");
  return { testo: out, tolte, righe: out === "" ? 0 : out.replace(/\r?\n$/, "").split("\n").length };
}

/** «<identity>_<AAAA-MM-GG>_<HHMM>.rsc» in ora italiana; l'identity senza caratteri che un file non regge. */
export function nomeFileExport(identity: string | null | undefined, quando: Date): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(quando).map((x) => [x.type, x.value]),
  );
  const base = (identity ?? "").trim().replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "mikrotik";
  return `${base}_${p.year}-${p.month}-${p.day}_${p.hour}${p.minute}.rsc`;
}

// ── Tabella ARP: stato della voce ────────────────────────────────────────────────────────────────────────────────

export interface StatoArpVista { segno: string; parola: string; forte: boolean }

/** Stato ARP di RouterOS → segno + parola (✓ forte per le voci buone, ● attenzione, ✕ fallita); null se non letto. */
export function statoArp(stato: string | null | undefined): StatoArpVista | null {
  switch ((stato ?? "").trim().toLowerCase()) {
    case "reachable": return { segno: "✓", parola: "raggiungibile", forte: true };
    case "permanent": return { segno: "✓", parola: "permanente", forte: true };
    case "stale": return { segno: "●", parola: "non recente", forte: false };
    case "delay": return { segno: "●", parola: "in attesa", forte: false };
    case "probe": return { segno: "●", parola: "in verifica", forte: false };
    case "incomplete": return { segno: "●", parola: "incompleta", forte: false };
    case "failed": return { segno: "✕", parola: "fallita", forte: false };
    case "": return null;
    default: return { segno: "●", parola: (stato ?? "").trim().toLowerCase(), forte: false };
  }
}

// ── Bridge e VLAN (Task 9): risposta della rotta, vlan-ids, matrice porte × VLAN ────────────────────────────────


/** GET /api/devices/[id]/mikrotik-scheda. `vlanBridge`, `vlan`, `dns`: null finché la lettura del Task 10 non li scrive. */
export interface RispostaSchedaMikrotik {
  bridge: RigaBridgeMk[];
  porte: RigaPortaSchedaMk[];
  bond: RigaBondMk[];
  /** seen_at della fotografia (UTC, come nel DB); null = mai letta o schema sotto il livello 2. */
  letto_il: string | null;
  vlanBridge: RigaVlanBridgeMk[] | null;
  vlan: RigaVlanMk[] | null;
  dns: RigaDnsMk | null;
  letture: { topologia: { acceso: boolean; il: string | null }; scheda: LetturaSchedaMk };
}

/**
 * Stato della lettura «VLAN, DNS e utenti»: `il` = ultimo tentativo, `codice` = suo errore; `vlan_il` e `dns_il` = età dei
 * dati di ogni sezione (UTC). Gli utenti hanno la loro (`letto_il` della rotta solo admin).
 */
export interface LetturaSchedaMk { acceso: boolean; il: string | null; codice: string | null; vlan_il: string | null; dns_il: string | null }

/** «22/10, 08:00» in ora italiana da un'ora del DB (UTC). */
function oraItaliana(s: string): string {
  const d = dataLettura(s);
  return d ? d.toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Rome" }) : s;
}

/**
 * Voce della riga delle fonti per una sezione della lettura «VLAN, DNS e utenti» (revisione dei Task 10 e 11): l'ora è quella
 * dei DATI di quella sezione (`datiIl`), mai quella di un tentativo fallito; un tentativo andato male dice il suo codice, una
 * lettura spenta con dati vecchi lo dice.
 */
export function fonteLetturaScheda(nome: string, s: LetturaSchedaMk, datiIl: string | null): Fonte {
  const prova = s.il && s.codice ? `ultima prova ${oraItaliana(s.il)}: ${s.codice}` : null;
  if (datiIl) {
    const coda = !s.acceso ? " · lettura spenta" : prova ? ` · ${prova}` : "";
    return { nome, esito: "ok", quando: oraItaliana(datiIl) + coda };
  }
  if (!s.acceso) return { nome, esito: "assente", nota: "lettura spenta" };
  if (prova) return { nome, esito: "assente", nota: prova };
  return s.il ? { nome, esito: "ok", quando: oraItaliana(s.il) } : { nome, esito: "assente", nota: "mai letta" };
}

/** Interfaccia VLAN → id, madre e tipo della madre (dalle interfacce lette); null senza lettura o VLAN non trovata. */
export function vlanConMadre(nome: string, vlan: RigaVlanMk[] | null, interfacce: InterfacciaScheda[]): { id: number | null; madre: string | null; tipoMadre: string | null } | null {
  const v = vlan?.find((x) => x.name === nome);
  if (!v) return null;
  const tipo = v.interface ? interfacce.find((i) => i.ifname === v.interface)?.tipo?.trim().toLowerCase() : null;
  return { id: v.vlan_id, madre: v.interface, tipoMadre: tipo || null };
}

const MESI = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * `last-logged-in` di `/user print` → «21/10 22:46». È l'orologio del router (ora locale del router, per i nostri in Italia),
 * non UTC: si mostra com'è, senza conversioni. Due forme (7.x «2026-10-21 22:46:44», 6.x «oct/21/2026 22:46:44»); altro com'è.
 */
export function accessoMk(s: string | null): string {
  const t = (s ?? "").trim();
  if (t === "") return "mai";
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (iso) return `${iso[3]}/${iso[2]} ${iso[4]}:${iso[5]}`;
  const v6 = t.match(/^([a-z]{3})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})/i);
  const mese = v6 ? MESI.indexOf(v6[1].toLowerCase()) : -1;
  if (v6 && mese >= 0) return `${v6[2]}/${String(mese + 1).padStart(2, "0")} ${v6[4]}:${v6[5]}`;
  return t;
}

/** Cache del DNS «usata / totale», con lo spazio prima dell'unità («48 KiB / 2048 KiB»); null se mancano tutte e due. */
export function cacheDnsMk(usata: string | null, totale: string | null): string | null {
  if (!usata && !totale) return null;
  const f = (x: string | null) => (x ? x.trim().replace(/^(\d+(?:[.,]\d+)?)\s*([A-Za-z]+)$/, "$1 $2") : "—");
  return `${f(usata)} / ${f(totale)}`;
}

/** Stato di una porta nella tab Bridge, dai segni della riga (censimento §1.9): X → disabilitata, I → inattiva, altrimenti attiva. */
export function statoPortaBridge(p: { disabled: boolean; inactive: boolean }): "attiva" | "inattiva" | "disabilitata" {
  return p.disabled ? "disabilitata" : p.inactive ? "inattiva" : "attiva";
}

/** «802.3ad · ether7, ether8 · layer-2-and-3»: modo, slave e hash di un bond, quelli che ci sono. */
export function descriviBond(b: RigaBondMk): string {
  return [b.mode, b.slaves.length > 0 ? b.slaves.join(", ") : null, b.transmit_hash_policy].filter(Boolean).join(" · ");
}

const VLAN_MIN = 1;
const VLAN_MAX = 4094;

/**
 * `vlan-ids` di `/interface bridge vlan` → colonne: «10,20» due colonne, «100-110» undici. Un intervallo più largo di `max`
 * resta UNA colonna con l'etichetta dell'intervallo (id null): 4093 colonne non si leggono (caso 4 del piano). Un pezzo
 * illeggibile o fuori 1-4094 non diventa una colonna.
 */
export function espandiVlanIds(s: string, max = 64): { id: number | null; etichetta: string }[] {
  const out: { id: number | null; etichetta: string }[] = [];
  const valido = (n: number) => Number.isInteger(n) && n >= VLAN_MIN && n <= VLAN_MAX;
  for (const pezzo of s.split(",").map((x) => x.trim()).filter(Boolean)) {
    const intervallo = pezzo.match(/^(\d+)\s*-\s*(\d+)$/);
    if (intervallo) {
      const a = Number(intervallo[1]), b = Number(intervallo[2]);
      if (!valido(a) || !valido(b) || b < a) continue;
      if (b - a + 1 > max) out.push({ id: null, etichetta: `${a}-${b}` });
      else for (let n = a; n <= b; n++) out.push({ id: n, etichetta: String(n) });
    } else if (/^\d+$/.test(pezzo) && valido(Number(pezzo))) {
      out.push({ id: Number(pezzo), etichetta: pezzo });
    }
  }
  return out;
}

export type CellaVlan = "U" | "T" | null;
/** id null = intervallo non espanso («100-200»). */
export interface ColonnaVlan { id: number | null; etichetta: string; nome: string | null }
export type StatoPortaMk = "attiva" | "inattiva" | "disabilitata";
export interface MatriceVlan {
  bridge: string;
  /** Ordinate per id; gli intervalli non espansi in fondo. */
  colonne: ColonnaVlan[];
  righe: { porta: string; stato: StatoPortaMk; pvid: number | null; bond: RigaBondMk | null; celle: CellaVlan[] }[];
  /** false = senza `/interface bridge vlan` (solo PVID): le T non si possono sapere. */
  completa: boolean;
}

/**
 * Matrice porte × VLAN di un bridge, con la regola del Manager (censimento §1.8) per ogni cella (porta, VLAN):
 * 1) la porta è negli untagged della riga `bridge vlan` (unione di `untagged` e `current_untagged`) → U;
 * 2) è nei tagged (unione di `tagged` e `current_tagged`) → T; 3) il suo PVID è quella VLAN → U implicito; 4) vuota.
 * Colonne: le VLAN delle righe `bridge vlan` del bridge (non disabilitate) più i PVID delle porte e del bridge, così ogni
 * porta mostra almeno la sua U. Senza righe `bridge vlan` (`vlanBridge` null) restano solo i PVID e la regola 3.
 * Lo stato della porta lo dà chi chiama (dalle interfacce lette; una porta che non risulta conta come attiva).
 */
export function matriceVlan(i: {
  bridge: RigaBridgeMk; porte: RigaPortaBridgeMk[]; bond: RigaBondMk[]; vlanBridge: RigaVlanBridgeMk[] | null; vlan: RigaVlanMk[] | null;
  statoPorta: (nome: string) => StatoPortaMk;
}): MatriceVlan {
  const br = i.bridge.name;
  const porte = i.porte.filter((p) => p.bridge === br);
  const righeVb = (i.vlanBridge ?? []).filter((v) => v.bridge === br && !v.disabled);
  // Per ogni colonna (chiave = etichetta) gli insiemi delle porte untagged e tagged, uniti su tutte le righe che la coprono.
  const membri = new Map<string, { id: number | null; u: Set<string>; t: Set<string> }>();
  const colonna = (id: number | null, etichetta: string) => {
    let m = membri.get(etichetta);
    if (!m) membri.set(etichetta, (m = { id, u: new Set(), t: new Set() }));
    return m;
  };
  for (const v of righeVb) {
    for (const c of espandiVlanIds(v.vlan_ids)) {
      const m = colonna(c.id, c.etichetta);
      for (const p of [...v.untagged, ...v.current_untagged]) m.u.add(p);
      for (const p of [...v.tagged, ...v.current_tagged]) m.t.add(p);
    }
  }
  for (const pvid of [i.bridge.pvid, ...porte.map((p) => p.pvid)]) if (pvid != null) colonna(pvid, String(pvid));
  // Un intervallo rimasto una colonna sola («2-4094») vale anche per le colonne numeriche che contiene: chi è tagged su
  // 2-4094 è tagged anche sulla 100 del PVID di un'altra porta (revisione del Task 9).
  for (const largo of [...membri.entries()].filter(([, m]) => m.id === null)) {
    const [a, b] = largo[0].split("-").map(Number);
    for (const m of membri.values()) {
      if (m.id === null || m.id < a || m.id > b) continue;
      for (const p of largo[1].u) m.u.add(p);
      for (const p of largo[1].t) m.t.add(p);
    }
  }

  const nomeDi = (id: number | null): string | null =>
    id == null ? null : (i.vlan ?? []).find((v) => v.vlan_id === id && v.interface === br)?.name ?? null;
  const ordinate = [...membri.entries()].sort(([ea, a], [eb, b]) =>
    a.id != null && b.id != null ? a.id - b.id : a.id != null ? -1 : b.id != null ? 1 : ea.localeCompare(eb));
  const colonne: ColonnaVlan[] = ordinate.map(([etichetta, m]) => ({ id: m.id, etichetta, nome: nomeDi(m.id) }));
  const bondPer = new Map(i.bond.map((b) => [b.name, b]));

  return {
    bridge: br,
    colonne,
    righe: porte.map((p) => ({
      porta: p.interface,
      stato: i.statoPorta(p.interface),
      pvid: p.pvid,
      bond: bondPer.get(p.interface) ?? null,
      celle: ordinate.map(([, m]): CellaVlan =>
        m.u.has(p.interface) ? "U" : m.t.has(p.interface) ? "T" : m.id != null && p.pvid === m.id ? "U" : null),
    })),
    completa: i.vlanBridge !== null,
  };
}
