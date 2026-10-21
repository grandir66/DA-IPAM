/**
 * Pezzi puri della scheda MikroTik (21/10, piano «Scheda MikroTik copiata dal Manager»): gruppo e stato delle
 * interfacce, uso in percentuale, contatori e caselle della Panoramica. Modulo puro (niente DB, niente React):
 * un dato che manca non produce una casella con un «—».
 */
import type { Casella } from "@/components/scheda/striscia-numeri";
import type { HardwareMikrotik, RisorseMikrotik } from "@/lib/devices/mikrotik-scheda";
import type { InterfacciaScheda } from "./router";

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
 * delle interfacce; le porte dei bridge e gli utenti arrivano dalle letture dei task successivi.
 */
export function contatoriMikrotik(i: {
  interfacce: InterfacciaScheda[] | null; rotte: number; porteBridge: number | null; bond: number | null; vlan: number | null; utenti: number | null;
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
    vlan: i.vlan ?? dalTipo("vlan"),
    porteBridge: i.porteBridge,
    bond: i.bond ?? dalTipo("bond"),
    rotte: i.rotte > 0 ? i.rotte : null,
    utenti: i.utenti,
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

/** Striscia della Panoramica MikroTik: al massimo sei caselle, solo quelle di cui c'è il dato (ordine della tavola). */
export function caselleMikrotik(i: {
  risorse: RisorseMikrotik | null;
  hardware: HardwareMikrotik | null;
  scansione: string | null;
  interfacce: InterfacciaScheda[] | null;
  vlan: { numero: number; bridge: number | null } | null;
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
  if (r?.uptime_s != null) {
    const giorni = Math.floor(r.uptime_s / 86400);
    const letta = i.scansione ? dataLettura(i.scansione) : null;
    const riavvio = letta ? new Date(letta.getTime() - r.uptime_s * 1000).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", timeZone: "Europe/Rome" }) : null;
    c.push({ etichetta: "Acceso da", valore: `${giorni} g`, ...(riavvio ? { sotto: `riavvio ${riavvio}` } : {}) });
  }
  if (i.interfacce && i.interfacce.length > 0) {
    const su = i.interfacce.filter((x) => statoInterfaccia(x) === "attiva").length;
    const spente = i.interfacce.filter((x) => x.disabilitata === true).length;
    c.push({ etichetta: "Interfacce su", valore: `${su} / ${i.interfacce.length}`, ...(spente > 0 ? { sotto: `${spente} disabilitat${spente === 1 ? "a" : "e"}` } : {}), tab: "interfacce" });
  }
  const nVlan = i.vlan?.numero ?? (i.interfacce ? i.interfacce.filter((x) => gruppoInterfaccia(x.tipo) === "vlan").length : null);
  if (nVlan != null && nVlan > 0) {
    c.push({ etichetta: "VLAN", valore: String(nVlan), ...(i.vlan?.bridge != null ? { sotto: `su ${i.vlan.bridge} bridge` } : {}), tab: "interfacce" });
  }
  const h = i.hardware;
  if (h?.firmware_corrente) {
    if (h.firmware_aggiornabile && h.firmware_aggiornabile !== h.firmware_corrente) {
      c.push({ etichetta: "Firmware aggiornabile", valore: h.firmware_aggiornabile, sotto: `installato ${h.firmware_corrente}`, attenzione: true });
    } else {
      c.push({ etichetta: "Firmware", valore: h.firmware_corrente });
    }
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
