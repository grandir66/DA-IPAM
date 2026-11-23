/**
 * Reti viste e oggetti con nome (23/11/2026, tappa 3 dei «dati in più»). Riccardo: «censire sicuramente le
 * network sconosciute, dando un nome agli oggetti pur non inserendoli tra le subnet interne».
 *
 * `traffico_oggetti` NON è la tabella `networks`: un oggetto ha solo un nome e una nota. Niente scansioni,
 * niente host creati, non entra fra le subnet interne, non fa partire l'apprendimento.
 *
 * - «rete vista»: indirizzi interni (per il collector) che non stanno in nessuna rete censita, raggruppati
 *   per /24, oppure per l'oggetto con nome che li contiene (anche più largo o più stretto di un /24);
 * - il nome compare al posto di «Rete non censita» nelle viste di `insieme.ts` (chiave `o:<rete>`);
 * - lo stesso flusso visto da più collector o fonti si prende al massimo, mai sommato.
 * Solo IPv4: gli indirizzi IPv6 fuori dal censimento restano «Rete non censita».
 */
import type Database from "better-sqlite3";
import { getNetworks } from "@/lib/db-tenant";
import { DIFFUSIONE, ESTERNO } from "./anomalie";
import { dbTraffico, GIORNI_TENUTI } from "./lettura";

export const PREFISSO_CHIAVE_OGGETTO = "o:";
export const NOME_MASSIMO = 60;
export const NOTA_MASSIMA = 300;
export const MASSIMO_OGGETTI = 500;

export interface OggettoTraffico {
  /** Una rete (`10.9.8.0/24`) o un indirizzo solo (`10.9.8.7/32`), sempre scritta come rete. */
  chiave: string;
  ambito: "interno" | "esterno";
  nome: string;
  nota: string;
  creato_da: string;
  creato_il: string;
  aggiornato_il: string;
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const numero = (ip: string): number => ip.split(".").reduce((n, p) => n * 256 + Number(p), 0);
const indirizzo = (n: number): string => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
const maschera = (prefisso: number): number => (prefisso === 0 ? 0 : (~0 << (32 - prefisso)) >>> 0);

/** Da `10.9.8.7`, `10.9.8.7/24` o `10.9.8.0/24` alla rete scritta in un modo solo. Null se non è IPv4 o il prefisso è fuori da 8-32. */
export function normalizzaChiave(testo: string): string | null {
  const [ip, p, ...resto] = testo.trim().split("/");
  if (resto.length > 0 || !IPV4.test(ip)) return null;
  const prefisso = p === undefined ? 32 : /^\d{1,2}$/.test(p) ? Number(p) : -1;
  if (prefisso < 8 || prefisso > 32) return null;
  return `${indirizzo((numero(ip) & maschera(prefisso)) >>> 0)}/${prefisso}`;
}

/** Indirizzi privati (RFC 1918), di collegamento locale e CGNAT: quello che di solito sta dentro. */
export function privato(ip: string): boolean {
  if (!IPV4.test(ip)) return false;
  const n = numero(ip);
  const dentro = (rete: string, prefisso: number): boolean => ((n & maschera(prefisso)) >>> 0) === numero(rete);
  return dentro("10.0.0.0", 8) || dentro("172.16.0.0", 12) || dentro("192.168.0.0", 16) || dentro("169.254.0.0", 16) || dentro("100.64.0.0", 10);
}

interface Rete { chiave: string; base: number; maschera: number; prefisso: number }
const comeRete = (chiave: string): Rete => {
  const [ip, p] = chiave.split("/");
  return { chiave, base: numero(ip), maschera: maschera(Number(p)), prefisso: Number(p) };
};

/** Trova, fra le reti date, la più stretta che contiene un indirizzo. Le reti si preparano una volta. */
export function creaCercatore(chiavi: string[]): (ip: string) => string | null {
  const reti = chiavi.map(comeRete).sort((a, b) => b.prefisso - a.prefisso);
  const memo = new Map<string, string | null>();
  return (ip) => {
    let r = memo.get(ip);
    if (r === undefined) {
      if (!IPV4.test(ip)) r = null;
      else {
        const n = numero(ip);
        r = reti.find((x) => ((n & x.maschera) >>> 0) === x.base)?.chiave ?? null;
      }
      memo.set(ip, r);
    }
    return r;
  };
}

export interface CoppiaVista { client: string; server: string; byte: number; prima_vista: string; ultima_vista: string }
export interface ReteVista {
  /** La rete: quella dell'oggetto con nome, oppure il /24. */
  chiave: string;
  nome: string | null;
  nota: string;
  host: number;
  byte: number;
  /** Con chi parlano, i tre più pesanti: chiave di una rete censita, `o:<rete>`, `esterno`, `diffusione`, `nessuna`. */
  con: { rete: string; byte: number }[];
  prima_vista: string;
  ultima_vista: string;
}

/**
 * Le reti viste nel traffico e non censite. `censita(ip)`: l'indirizzo sta in una rete censita.
 * `altraParte(ip)`: la chiave della rete di chi sta dall'altra parte, come in `insieme.ts`.
 */
export function calcolaRetiViste(
  coppie: CoppiaVista[],
  censita: (ip: string) => boolean,
  oggetti: Pick<OggettoTraffico, "chiave" | "nome" | "nota">[],
  altraParte: (ip: string) => string,
): ReteVista[] {
  const perChiave = new Map(oggetti.map((o) => [o.chiave, o]));
  const diOggetto = creaCercatore(oggetti.map((o) => o.chiave));
  const reteVista = (ip: string): string | null => {
    if (ip === ESTERNO || ip === DIFFUSIONE || !IPV4.test(ip) || censita(ip)) return null;
    return diOggetto(ip) ?? normalizzaChiave(`${ip}/24`);
  };
  const gruppi = new Map<string, { host: Set<string>; byte: number; con: Map<string, number>; prima: string; ultima: string }>();
  const metti = (chiave: string, ip: string, altro: string, c: CoppiaVista) => {
    let g = gruppi.get(chiave);
    if (!g) gruppi.set(chiave, (g = { host: new Set(), byte: 0, con: new Map(), prima: c.prima_vista, ultima: c.ultima_vista }));
    g.host.add(ip);
    g.byte += c.byte;
    if (c.prima_vista < g.prima) g.prima = c.prima_vista;
    if (c.ultima_vista > g.ultima) g.ultima = c.ultima_vista;
    g.con.set(altro, (g.con.get(altro) ?? 0) + c.byte);
  };
  for (const c of coppie) {
    const rc = reteVista(c.client);
    const rs = reteVista(c.server);
    if (rc) metti(rc, c.client, rs ? `${PREFISSO_CHIAVE_OGGETTO}${rs}` : altraParte(c.server), c);
    // una coppia tutta dentro la stessa rete vista conta una volta sola
    if (rs && rs !== rc) metti(rs, c.server, rc ? `${PREFISSO_CHIAVE_OGGETTO}${rc}` : altraParte(c.client), c);
    else if (rs) gruppi.get(rs)!.host.add(c.server);
  }
  return [...gruppi.entries()]
    .map(([chiave, g]) => ({
      chiave, nome: perChiave.get(chiave)?.nome ?? null, nota: perChiave.get(chiave)?.nota ?? "",
      host: g.host.size, byte: g.byte,
      con: [...g.con.entries()].map(([rete, byte]) => ({ rete, byte })).sort((a, b) => b.byte - a.byte).slice(0, 3),
      prima_vista: g.prima, ultima_vista: g.ultima,
    }))
    .sort((a, b) => b.byte - a.byte);
}

// ── Aggancio al database del tenant ──────────────────────────────────────────

export function elencoOggetti(d: Database.Database = dbTraffico()): OggettoTraffico[] {
  return d.prepare("SELECT chiave, ambito, nome, nota, creato_da, creato_il, aggiornato_il FROM traffico_oggetti ORDER BY nome, chiave").all() as OggettoTraffico[];
}

export type EsitoOggetto = { ok: true; oggetto: OggettoTraffico } | { ok: false; motivo: "chiave" | "nome" | "censita" | "troppi" };

/** Dà o cambia il nome di una rete o di un indirizzo. Una rete già censita ha già il suo nome: si rifiuta. */
export function salvaOggetto(dati: { chiave: string; nome: string; nota?: string; chi: string }): EsitoOggetto {
  const d = dbTraffico();
  const chiave = normalizzaChiave(dati.chiave);
  const nome = dati.nome.trim().slice(0, NOME_MASSIMO);
  if (!chiave) return { ok: false, motivo: "chiave" };
  if (!nome) return { ok: false, motivo: "nome" };
  const censite = creaCercatore(getNetworks().map((n) => normalizzaChiave(n.cidr)).filter((x): x is string => x !== null));
  if (censite(chiave.split("/")[0]) !== null) return { ok: false, motivo: "censita" };
  const c = (d.prepare("SELECT COUNT(*) AS n FROM traffico_oggetti WHERE chiave <> ?").get(chiave) as { n: number }).n;
  if (c >= MASSIMO_OGGETTI) return { ok: false, motivo: "troppi" };
  d.prepare(`
    INSERT INTO traffico_oggetti (chiave, ambito, nome, nota, creato_da, creato_il, aggiornato_il) VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(chiave) DO UPDATE SET nome = excluded.nome, nota = excluded.nota, creato_da = excluded.creato_da, aggiornato_il = excluded.aggiornato_il`)
    .run(chiave, privato(chiave.split("/")[0]) ? "interno" : "esterno", nome, (dati.nota ?? "").trim().slice(0, NOTA_MASSIMA), dati.chi.slice(0, 80));
  return { ok: true, oggetto: d.prepare("SELECT chiave, ambito, nome, nota, creato_da, creato_il, aggiornato_il FROM traffico_oggetti WHERE chiave = ?").get(chiave) as OggettoTraffico };
}

export function togliOggetto(chiaveData: string): boolean {
  const chiave = normalizzaChiave(chiaveData);
  return chiave !== null && dbTraffico().prepare("DELETE FROM traffico_oggetti WHERE chiave = ?").run(chiave).changes > 0;
}

export interface RetiViste { giorni: number; reti: ReteVista[]; nomi_reti: Record<string, string>; troncato: boolean }
const MASSIMO_RIGHE = 50000;

/** Le reti viste negli ultimi `giorni` (1 = oggi), con le reti censite per dare un nome a «con chi parlano». */
export function retiViste(giorniChiesti = 7): RetiViste {
  const d = dbTraffico();
  const giorni = Math.max(1, Math.min(GIORNI_TENUTI, Math.trunc(giorniChiesti)));
  const reti = getNetworks();
  const censite = creaCercatore(reti.map((n) => normalizzaChiave(n.cidr)).filter((x): x is string => x !== null));
  const idDi = new Map(reti.map((n) => [normalizzaChiave(n.cidr), String(n.id)]));
  // solo le coppie con almeno un lato IPv4 fuori dall'esterno: il resto non può dare una rete vista
  const righe = d.prepare(`
    SELECT client, server, MAX(byte) AS byte, MIN(prima_vista) AS prima_vista, MAX(ultima_vista) AS ultima_vista
    FROM (
      SELECT collector_id, fonte, client, server, SUM(byte) AS byte, MIN(prima_vista) AS prima_vista, MAX(ultima_vista) AS ultima_vista
      FROM traffico_coppie WHERE giorno >= date('now', ?)
      GROUP BY collector_id, fonte, client, server)
    GROUP BY client, server ORDER BY byte DESC LIMIT ${MASSIMO_RIGHE + 1}`).all(`-${giorni - 1} days`) as CoppiaVista[];
  const troncato = righe.length > MASSIMO_RIGHE;
  if (troncato) righe.length = MASSIMO_RIGHE;
  const altraParte = (ip: string): string => {
    if (ip === ESTERNO) return "esterno";
    if (ip === DIFFUSIONE || ip === "") return "diffusione";
    const r = censite(ip);
    return r ? idDi.get(r) ?? "nessuna" : "nessuna";
  };
  const oggetti = elencoOggetti(d);
  const viste = calcolaRetiViste(righe, (ip) => censite(ip) !== null, oggetti, altraParte);
  const nomi: Record<string, string> = {};
  for (const n of reti) nomi[String(n.id)] = n.name;
  for (const o of oggetti) nomi[`${PREFISSO_CHIAVE_OGGETTO}${o.chiave}`] = o.nome;
  return { giorni, reti: viste, nomi_reti: nomi, troncato };
}
