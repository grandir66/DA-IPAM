/**
 * La scheda dell'oggetto con i dati di LibreNMS (piano 2026-10-22 LibreNMS, task 7; tavola S6 approvata): stato dei
 * sensori, gruppi per classe, porte con la fonte per riga, vicini con le due fonti, voce di LibreNMS nella riga «Dati da:».
 * Modulo puro (niente React, niente DB): le ore del DB sono UTC senza fuso.
 */
import type { DatiLibrenmsHost, StatoAggiuntaLibrenms } from "@/lib/integrations/librenms-fonte";
import { parseDbDate } from "@/lib/db-date";
import { etichettaVelocita } from "./porte-da-guardare";

/** La risposta di GET /api/hosts/[id]/librenms/dati più l'interruttore della lettura (spento = la scheda è come prima). */
/** `aggiunta`: lo stato dell'aggiunta automatica (null senza schema di LibreNMS; assente nelle risposte di prima della v0.9.884). */
export type DatiLibrenmsScheda = DatiLibrenmsHost & { acceso: boolean; aggiunta?: StatoAggiuntaLibrenms | null };
type Abbinato = Extract<DatiLibrenmsScheda, { abbinato: true }>;

/** I dati di LibreNMS da mostrare, o null: lettura spenta, oggetto non abbinato, apparato senza fotografia. */
export function datiAttivi(d: DatiLibrenmsScheda | null | undefined): Abbinato | null {
  return d && d.acceso && d.abbinato ? d : null;
}

/** Un dato del nostro giro più vecchio di così cede il posto a LibreNMS (spec §5). */
export const ORE_DATO_FRESCO = 1;
/** Una lettura di LibreNMS più vecchia di così si avvisa (lettura spenta o LibreNMS giù). */
export const ORE_LETTURA_VECCHIA = 1;

const ore = (da: string | null | undefined, adesso: Date): number | null => {
  if (!da) return null;
  const t = parseDbDate(da).getTime();
  return Number.isNaN(t) ? null : (adesso.getTime() - t) / 3_600_000;
};

// ── Sensori ──────────────────────────────────────────────────────────────────

export type StatoSensore = "ok" | "vicino" | "oltre" | "nd";
export const SOGLIA_VICINO = 0.1;

/**
 * Dentro i limiti = ok, oltre = oltre, entro il 10% dal limite = vicino, nessun limite = nd. Il 10% si misura sull'ampiezza
 * fra i due limiti se ci sono entrambi (12,1 V fra 11,4 e 12,6 è nei limiti), altrimenti sul limite stesso. LibreNMS
 * dichiara anche limiti di avviso (`sensor_limit_warn`) ma la lettura non li porta: qui vale sempre il 10%.
 */
export function statoSensore(valore: number | null, basso: number | null, alto: number | null): StatoSensore {
  if (valore === null || (basso === null && alto === null)) return "nd";
  if ((alto !== null && valore > alto) || (basso !== null && valore < basso)) return "oltre";
  const margine = basso !== null && alto !== null ? (alto - basso) * SOGLIA_VICINO : Math.abs(alto ?? basso ?? 0) * SOGLIA_VICINO;
  if ((alto !== null && valore > alto - margine) || (basso !== null && valore < basso + margine)) return "vicino";
  return "ok";
}

export interface GruppoSensori { id: string; titolo: string; unita: string; righe: DatiSensore[] }
type DatiSensore = Abbinato["sensori"][number];

const GRUPPI: ReadonlyArray<{ id: string; titolo: string; unita: string; classi: readonly string[] }> = [
  { id: "temperatura", titolo: "Temperatura", unita: "°C", classi: ["temperature"] },
  { id: "ventole", titolo: "Ventole", unita: "giri/min", classi: ["fanspeed"] },
  { id: "alimentazione", titolo: "Alimentazione", unita: "tensioni, correnti, potenza", classi: ["voltage", "current", "power", "apower", "frequency"] },
  { id: "ottiche", titolo: "Ottiche", unita: "dBm", classi: ["dbm"] },
  { id: "stati", titolo: "Stati", unita: "come li dichiara l'apparato", classi: ["state"] },
  { id: "ups", titolo: "UPS", unita: "carica, autonomia, carico", classi: ["charge", "runtime", "load"] },
];
const ALTRI = { id: "altri", titolo: "Altri sensori", unita: "" } as const;

/** Unità mostrata accanto al valore, per classe (LibreNMS non la manda nella lista). */
const UNITA_CLASSE: Readonly<Record<string, string>> = {
  temperature: "°C", fanspeed: "giri/min", voltage: "V", current: "A", power: "W", apower: "VA", frequency: "Hz", dbm: "dBm", charge: "%", runtime: "min", load: "%",
};

export function unitaSensore(classe: string): string {
  return UNITA_CLASSE[classe] ?? "";
}

/** I sensori in gruppi, nell'ordine della tavola; un gruppo senza sensori non c'è. */
export function gruppiSensori(sensori: DatiSensore[]): GruppoSensori[] {
  const noti = new Set(GRUPPI.flatMap((g) => g.classi));
  const out: GruppoSensori[] = GRUPPI.map((g) => ({ id: g.id, titolo: g.titolo, unita: g.unita, righe: sensori.filter((s) => g.classi.includes(s.classe)) }));
  out.push({ ...ALTRI, righe: sensori.filter((s) => !noti.has(s.classe)) });
  return out.filter((g) => g.righe.length > 0);
}

/** La lettura dei sensori è vecchia (oltre un'ora): la scheda avvisa che i dati possono essere vecchi. */
export function letturaVecchia(letto_il: string | null | undefined, adesso: Date = new Date()): boolean {
  const o = ore(letto_il, adesso);
  return o !== null && o > ORE_LETTURA_VECCHIA;
}

// ── Porte ────────────────────────────────────────────────────────────────────

export type StatoPortaVista = "up" | "down" | "disabled" | null;

export interface PortaNostra {
  id: number; port_name: string; status: StatoPortaVista; speed: string | null; vlan: number | null; timestamp: string | null;
}
export interface PortaVista {
  chiave: string;
  nome: string;
  stato: StatoPortaVista;
  velocita: string | null;
  vlan: number | null;
  alias: string | null;
  fonte: "ipam" | "librenms";
  ora: string | null;
  /** Id della nostra porta, se c'è: MAC e vicini restano i nostri. */
  portaId: number | null;
}

const chiaveNome = (n: string | null | undefined): string => (n ?? "").trim().toLowerCase();

function statoLibrenms(oper: string | null, admin: string | null): StatoPortaVista {
  if (admin === "down") return "disabled";
  if (oper === "up") return "up";
  if (oper === null) return null;
  return "down";
}

function velocitaLibrenms(bps: number | null): string | null {
  return bps && bps > 0 ? etichettaVelocita(String(Math.round(bps / 1_000_000))) : null;
}

/**
 * Le porte con la fonte di ogni riga (spec §5): per porta, il nostro dato se ha meno di un'ora, altrimenti quello di
 * LibreNMS; le porte che solo LibreNMS conosce entrano con la sua fonte. L'alias viene sempre da LibreNMS (noi non lo
 * leggiamo). Senza dati di LibreNMS restano le nostre, tutte con la fonte DA-IPAM.
 */
export function unisciPorte(nostre: PortaNostra[], l: Abbinato | null, adesso: Date = new Date()): PortaVista[] {
  const perNome = new Map((l?.porte ?? []).map((p) => [chiaveNome(p.if_name), p]));
  const viste = new Set<string>();
  const out: PortaVista[] = [];
  for (const n of nostre) {
    const k = chiaveNome(n.port_name);
    viste.add(k);
    const lp = perNome.get(k);
    const o = ore(n.timestamp, adesso);
    const nostroFresco = o !== null && o < ORE_DATO_FRESCO;
    if (lp && !nostroFresco) {
      out.push({ chiave: `l${lp.port_id}`, nome: n.port_name, stato: statoLibrenms(lp.oper_status, lp.admin_status), velocita: velocitaLibrenms(lp.speed) ?? n.speed, vlan: n.vlan ?? lp.vlan, alias: lp.if_alias || null, fonte: "librenms", ora: lp.letto_il, portaId: n.id });
    } else {
      out.push({ chiave: `n${n.id}`, nome: n.port_name, stato: n.status, velocita: n.speed, vlan: n.vlan, alias: lp?.if_alias || null, fonte: "ipam", ora: n.timestamp, portaId: n.id });
    }
  }
  for (const lp of l?.porte ?? []) {
    const k = chiaveNome(lp.if_name);
    if (!k || viste.has(k)) continue;
    out.push({ chiave: `l${lp.port_id}`, nome: lp.if_name ?? "?", stato: statoLibrenms(lp.oper_status, lp.admin_status), velocita: velocitaLibrenms(lp.speed), vlan: lp.vlan, alias: lp.if_alias || null, fonte: "librenms", ora: lp.letto_il, portaId: null });
  }
  return out;
}

/** La colonna «Alias» c'è solo se almeno una porta ce l'ha (Registro, L2). */
export const haAlias = (porte: PortaVista[]): boolean => porte.some((p) => !!p.alias);

/** Le porte che si leggono da LibreNMS perché il nostro giro è vecchio: serve l'avviso sopra la tabella. */
export function nostroGiroVecchio(porte: PortaVista[], nostre: PortaNostra[], adesso: Date = new Date()): string | null {
  if (nostre.length === 0) return null;
  const ultimo = nostre.map((p) => p.timestamp).filter((t): t is string => !!t).sort().at(-1) ?? null;
  const o = ore(ultimo, adesso);
  return o !== null && o >= ORE_DATO_FRESCO && porte.some((p) => p.fonte === "librenms" && p.portaId !== null) ? ultimo : null;
}

// ── Vicini ───────────────────────────────────────────────────────────────────

export interface ViciniNostro { portaLocale: string; nome: string; portaRemota: string | null; protocollo: string; ip: string | null; mac: string | null; piattaforma: string | null; chiave: string }
export type FonteVicino = "ipam" | "librenms" | "entrambe";
export interface ViciniVista {
  chiave: string;
  portaLocale: string;
  nome: string;
  portaRemota: string | null;
  protocollo: string;
  ip: string | null;
  mac: string | null;
  piattaforma: string | null;
  fonte: FonteVicino;
  /** Ora della lettura di LibreNMS, se la fonte è sua. */
  ora: string | null;
  /** Stessa porta locale con un vicino diverso nell'altra fonte. */
  disaccordo: boolean;
}

const chiaveVicino = (porta: string, nome: string, remota: string | null): string => `${chiaveNome(porta)}|${chiaveNome(nome)}|${chiaveNome(remota)}`;

/**
 * I vicini delle due fonti. Righe uguali (porta locale, nome remoto, porta remota) una volta sola con «entrambe»; sulla
 * stessa porta locale con vicini diversi le righe di entrambe le fonti restano e si segnano `disaccordo` (si vede, non si sceglie).
 */
export function unisciVicini(nostri: ViciniNostro[], l: Abbinato | null): ViciniVista[] {
  const lv = (l?.vicini ?? [])
    .filter((v) => (v.remote_hostname ?? "").trim() !== "")
    .map((v) => ({ portaLocale: v.local_port_name ?? "—", nome: (v.remote_hostname ?? "").trim(), portaRemota: v.remote_port || null, protocollo: (v.protocol ?? "").toLowerCase(), piattaforma: v.remote_platform || null, ora: v.letto_il }));
  const chiaviL = new Map(lv.map((v) => [chiaveVicino(v.portaLocale, v.nome, v.portaRemota), v]));
  const chiaviN = new Set(nostri.map((v) => chiaveVicino(v.portaLocale, v.nome, v.portaRemota)));
  const out: ViciniVista[] = [];
  for (const n of nostri) {
    const k = chiaveVicino(n.portaLocale, n.nome, n.portaRemota);
    const altro = chiaviL.get(k);
    out.push({ ...n, chiave: `n|${n.chiave}`, fonte: altro ? "entrambe" : "ipam", ora: altro?.ora ?? null, disaccordo: false });
  }
  for (const v of lv) {
    if (chiaviN.has(chiaveVicino(v.portaLocale, v.nome, v.portaRemota))) continue;
    out.push({ ...v, chiave: `l|${chiaveVicino(v.portaLocale, v.nome, v.portaRemota)}`, ip: null, mac: null, fonte: "librenms", disaccordo: false });
  }
  // Disaccordo: la stessa porta locale ha vicini nelle due fonti e nessuna riga è «entrambe».
  const perPorta = new Map<string, ViciniVista[]>();
  for (const v of out) {
    const k = chiaveNome(v.portaLocale);
    perPorta.set(k, [...(perPorta.get(k) ?? []), v]);
  }
  const conDisaccordo = new Set<string>();
  for (const [k, righe] of perPorta) {
    const soloNostre = righe.some((r) => r.fonte === "ipam");
    const soloLoro = righe.some((r) => r.fonte === "librenms");
    if (soloNostre && soloLoro && !righe.some((r) => r.fonte === "entrambe")) conDisaccordo.add(k);
  }
  const ordinati = [...out].sort((a, b) => {
    const pa = chiaveNome(a.portaLocale), pb = chiaveNome(b.portaLocale);
    return pa === pb ? 0 : pa.localeCompare(pb, "it", { numeric: true });
  });
  return ordinati.map((v) => (conDisaccordo.has(chiaveNome(v.portaLocale)) ? { ...v, disaccordo: true } : v));
}

// ── Riga «Dati da:» ──────────────────────────────────────────────────────────

export interface VoceFonte { nome: string; esito: "ok" | "assente" | "non_abbinato"; quando?: string; nota?: string }

/**
 * La voce di LibreNMS della riga «Dati da:» (spec §6, L4). Con la lettura spenta o l'oggetto non abbinato alla lettura
 * resta la voce di prima (`vecchia`); la lettura spenta si dice solo se l'oggetto è già in LibreNMS.
 */
export function voceLibrenms(dati: DatiLibrenmsScheda | null | undefined, vecchia: VoceFonte | null, ora: (iso: string) => string): VoceFonte | null {
  if (!dati) return vecchia;
  if (!dati.acceso) return vecchia && vecchia.esito === "ok" ? { nome: "LibreNMS", esito: "assente", nota: "lettura spenta" } : vecchia;
  // Non in LibreNMS: la voce c'è su ogni tipo di scheda (tavola L4), anche dove la Panoramica non ne aveva una (hypervisor).
  if (!dati.abbinato) return vecchia ?? { nome: "LibreNMS", esito: "non_abbinato" };
  if (dati.apparato === null) {
    const ultima = dati.porte[0]?.letto_il ?? dati.sensori[0]?.letto_il ?? dati.letture.apparati.letto_il;
    return { nome: "LibreNMS", esito: "assente", nota: ultima ? `non più in LibreNMS (ultima lettura ${ora(ultima)})` : "non più in LibreNMS" };
  }
  if (dati.apparato.last_polled === null) return { nome: "LibreNMS", esito: "non_abbinato", nota: "in LibreNMS ma mai interrogato (SNMP non risponde)" };
  return { nome: "LibreNMS", esito: "ok", quando: ora(dati.apparato.letto_il) };
}

/** Le fonti con la voce di LibreNMS al posto di quella di prima (o in fondo, se prima non c'era). */
export function conLibrenms<F extends VoceFonte>(fonti: F[], dati: DatiLibrenmsScheda | null | undefined, ora: (iso: string) => string): F[] {
  const i = fonti.findIndex((f) => f.nome === "LibreNMS");
  const vecchia = i >= 0 ? (fonti[i] ?? null) : null;
  const voce = voceLibrenms(dati, vecchia, ora) as F | null;
  if (voce === vecchia) return fonti;
  if (i >= 0) return voce ? fonti.map((f, k) => (k === i ? voce : f)) : fonti.filter((_, k) => k !== i);
  return voce ? [...fonti, voce] : fonti;
}
