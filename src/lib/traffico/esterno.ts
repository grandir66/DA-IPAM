/**
 * Verso l'esterno (23/11/2026, tappa 4 dei «dati in più»): con quali indirizzi fuori parla ogni host, per
 * nome, paese e fornitore. Il collector tiene i primi N indirizzi esterni per host e finestra; il resto
 * arriva in una riga con ip = «altri», che dice quanti indirizzi e quanti byte sono rimasti senza nome.
 *
 * Regole da non rompere:
 * - le coppie di `traffico_coppie` non cambiano: lì l'esterno resta una riga sola. Queste righe sono in più,
 *   non vanno sommate a quelle;
 * - lo stesso scambio visto da più collector si prende al massimo, mai sommato;
 * - paese e fornitore si cercano nell'archivio locale (`geo.ts`), mai chiedendo fuori;
 * - `paese_nuovo` tace nei primi 14 giorni e senza archivio; un paese si segnala una volta sola.
 */
import type Database from "better-sqlite3";
import type { AnomaliaNuova } from "./anomalie";
import { creaCercaGeo, statoGeo, type Geo, type StatoGeo } from "./geo";
import { dbTraffico } from "./lettura";
import { creaCercatore, elencoOggetti } from "./oggetti";
import { creaCercaListe, type SegnoLista } from "./liste";
import { nomiDegliIp, type NomeDiIp } from "./quadro";

export const GIORNI_ESTERNI = 30;
export const GIORNI_APPRENDIMENTO_PAESI = 14;
export const ALTRI = "altri";
export const PER = ["destinazione", "paese", "fornitore", "host"] as const;
export type Per = (typeof PER)[number];
export const PER_PAGINA = 50;
const MASSIMO_RIGHE = 100000;

export interface EsternoCollector {
  seq: number; inizio: string; interno: string; ip: string; verso: string;
  proto: number; porta: number; byte: number; pacchetti: number; flussi: number;
}
export interface NomeIpCollector { seq: number; visto: string; ip: string; tipo: string; nome: string }

const DATA = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const testo = (v: unknown, max: number): v is string => typeof v === "string" && v.length > 0 && v.length <= max;

export function esternoValido(r: EsternoCollector): boolean {
  return (
    !!r && Number.isInteger(r.seq) && typeof r.inizio === "string" && DATA.test(r.inizio) && testo(r.interno, 64) && testo(r.ip, 64) &&
    (r.verso === "fuori" || r.verso === "dentro") && Number.isInteger(r.proto) && Number.isInteger(r.porta) &&
    Number.isFinite(r.byte) && Number.isFinite(r.pacchetti) && Number.isFinite(r.flussi)
  );
}

/** I paesi nuovi fra le righe date. Pura: `noti` sono i paesi già visti, `geo` la ricerca in archivio. */
export function paesiNuovi(righe: Pick<EsternoCollector, "interno" | "ip" | "verso">[], noti: Set<string>, geo: (ip: string) => Geo): AnomaliaNuova[] {
  const uscite = new Map<string, AnomaliaNuova>();
  for (const r of righe) {
    // conta chi da dentro apre verso fuori: quello che bussa da fuori non è una scelta di un nostro host
    if (r.ip === ALTRI || r.verso !== "fuori") continue;
    const paese = geo(r.ip).paese;
    if (!paese || noti.has(paese) || uscite.has(paese)) continue;
    uscite.set(paese, { tipo: "paese_nuovo", gravita: 2, client: r.interno, server: r.ip, proto: 0, porta: 0, dettaglio: { paese } });
  }
  return [...uscite.values()];
}

/** Scrive le destinazioni esterne di una pagina e ritorna i paesi mai visti (da segnalare, se l'apprendimento è finito). */
export function registraEsterni(d: Database.Database, collectorId: number, tutte: EsternoCollector[], spento: (ip: string) => boolean = () => false): AnomaliaNuova[] {
  const righe = tutte.filter(esternoValido);
  if (righe.length === 0) return [];
  const ins = d.prepare(`
    INSERT INTO traffico_esterni (giorno, ip, interno, verso, proto, porta, collector_id, byte, pacchetti, flussi, prima_vista, ultima_vista)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(giorno, ip, interno, verso, proto, porta, collector_id) DO UPDATE SET
      byte = traffico_esterni.byte + excluded.byte,
      pacchetti = traffico_esterni.pacchetti + excluded.pacchetti,
      -- nella riga «altri» i flussi sono QUANTI indirizzi sono rimasti fuori in una finestra: si tiene il più alto
      flussi = CASE WHEN excluded.ip = 'altri' THEN MAX(traffico_esterni.flussi, excluded.flussi) ELSE traffico_esterni.flussi + excluded.flussi END,
      prima_vista = MIN(traffico_esterni.prima_vista, excluded.prima_vista),
      ultima_vista = MAX(traffico_esterni.ultima_vista, excluded.ultima_vista)`);
  for (const r of righe) ins.run(r.inizio.slice(0, 10), r.ip, r.interno, r.verso, r.proto, r.porta, collectorId, r.byte, r.pacchetti, r.flussi, r.inizio, r.inizio);

  const geo = creaCercaGeo();
  const noti = new Set((d.prepare("SELECT paese FROM traffico_paesi").all() as { paese: string }[]).map((p) => p.paese));
  const nuovi = paesiNuovi(righe, noti, geo);
  if (nuovi.length === 0) return [];
  const quando = righe.reduce((m, r) => (r.inizio > m ? r.inizio : m), righe[0].inizio);
  const metti = d.prepare("INSERT OR IGNORE INTO traffico_paesi (paese, prima_vista) VALUES (?, ?)");
  for (const a of nuovi) metti.run(String(a.dettaglio.paese), quando);
  // L'apprendimento parte dal primo paese visto: per 14 giorni si impara e basta.
  const dal = (d.prepare("SELECT MIN(prima_vista) AS dal FROM traffico_paesi").get() as { dal: string | null }).dal ?? quando;
  const finito = Date.parse(`${quando.replace(" ", "T")}Z`) - Date.parse(`${dal.replace(" ", "T")}Z`) >= GIORNI_APPRENDIMENTO_PAESI * 86_400_000;
  return finito ? nuovi.filter((a) => !spento(a.client)) : [];
}

export function registraNomiIp(d: Database.Database, righe: NomeIpCollector[]): void {
  const ins = d.prepare(`
    INSERT INTO traffico_nomi_ip (ip, tipo, nome, ultima_vista) VALUES (?, ?, ?, ?)
    ON CONFLICT(ip, tipo) DO UPDATE SET nome = excluded.nome, ultima_vista = excluded.ultima_vista WHERE excluded.ultima_vista >= traffico_nomi_ip.ultima_vista`);
  for (const r of righe) {
    if (!r || !DATA.test(r.visto ?? "") || !testo(r.ip, 64) || (r.tipo !== "dns" && r.tipo !== "sni") || !testo(r.nome, 253)) continue;
    ins.run(r.ip, r.tipo, r.nome, r.visto);
  }
}

export function sfoltisciEsterni(d: Database.Database): void {
  d.prepare("DELETE FROM traffico_esterni WHERE giorno < date('now', ?)").run(`-${GIORNI_ESTERNI} days`);
  d.prepare("DELETE FROM traffico_nomi_ip WHERE ultima_vista < datetime('now', ?)").run(`-${GIORNI_ESTERNI} days`);
}

// ── La vista ─────────────────────────────────────────────────────────────────

export interface RigaEsterna { interno: string; ip: string; verso: string; proto: number; porta: number; byte: number; flussi: number; ultima_vista: string }
export interface Servizio { proto: number; porta: number; byte: number }
export interface RigaVista {
  /** L'indirizzo esterno, il codice del paese, il numero del fornitore o l'indirizzo dell'host, secondo la vista. */
  chiave: string;
  nome: string | null;
  /** Il nome l'ha dato una persona (oggetto con nome), non viene dal traffico. */
  a_mano: boolean;
  paese: string | null;
  fornitore: string | null;
  /** Quanti host interni (viste per destinazione, paese, fornitore) o quante destinazioni (vista per host). */
  host: number;
  destinazioni: number;
  byte: number;
  byte_dentro: number;
  servizi: Servizio[];
  ultima_vista: string;
  /** Destinazioni del gruppo in una lista di reputazione, e quante ne taglierebbe il geoblocking (liste di DA-GEO). */
  compromesse: number;
  bloccherebbe: number;
  /** Solo per destinazione: le liste in cui sta. */
  liste: SegnoLista[];
}
export const SEGNATE = ["compromesse", "bloccate"] as const;
export type Segnate = (typeof SEGNATE)[number];
export interface TettoScattato { host: number; byte: number; indirizzi: number }
export interface VistaEsterno {
  tessere: { destinazioni: number; paesi: number; fornitori: number; byte: number; host: number; compromesse: number; bloccherebbe: number };
  righe: RigaVista[];
  totale: number;
  pagina: number;
  perPagina: number;
  /** Null se il tetto del collector non è mai scattato nel periodo. */
  altri: TettoScattato | null;
}

/**
 * `info(ip)`: nome (dato a mano, poi TLS, poi DNS), paese e fornitore. La ricerca cerca in indirizzo, nome,
 * paese e fornitore. Pura: la provano i test senza database.
 */
export function calcolaEsterno(
  righe: RigaEsterna[],
  info: (ip: string) => { nome: string | null; a_mano?: boolean; paese: string | null; asn: number | null; fornitore: string | null; liste?: SegnoLista[] },
  filtro: { per: Per; pagina?: number; cerca?: string; segnate?: Segnate },
): VistaEsterno {
  const cerca = (filtro.cerca ?? "").trim().toLowerCase();
  const altri: TettoScattato = { host: 0, byte: 0, indirizzi: 0 };
  const hostAltri = new Set<string>();
  const compromesse = new Set<string>();
  const bloccate = new Set<string>();
  const gruppi = new Map<string, { riga: RigaVista; host: Set<string>; dest: Set<string>; comp: Set<string>; bloc: Set<string>; servizi: Map<string, Servizio> }>();
  const tutteDest = new Set<string>();
  const paesi = new Set<string>();
  const fornitori = new Set<string>();
  const tuttiHost = new Set<string>();
  let byte = 0;
  for (const r of righe) {
    if (r.ip === ALTRI) {
      hostAltri.add(r.interno);
      altri.byte += r.byte;
      altri.indirizzi += r.flussi;
      continue;
    }
    const i = info(r.ip);
    if (cerca && ![r.ip, r.interno, i.nome ?? "", i.paese ?? "", i.fornitore ?? ""].some((x) => x.toLowerCase().includes(cerca))) continue;
    const liste = i.liste ?? [];
    const compromessa = liste.some((l) => l.tipo === "reputazione");
    const bloccata = liste.some((l) => l.tipo === "geo");
    if ((filtro.segnate === "compromesse" && !compromessa) || (filtro.segnate === "bloccate" && !bloccata)) continue;
    byte += r.byte;
    if (compromessa) compromesse.add(r.ip);
    if (bloccata) bloccate.add(r.ip);
    tutteDest.add(r.ip);
    tuttiHost.add(r.interno);
    if (i.paese) paesi.add(i.paese);
    if (i.asn !== null) fornitori.add(String(i.asn));
    const chiave = filtro.per === "destinazione" ? r.ip : filtro.per === "paese" ? i.paese ?? "" : filtro.per === "fornitore" ? (i.asn === null ? "" : String(i.asn)) : r.interno;
    let g = gruppi.get(chiave);
    if (!g) {
      g = {
        riga: {
          chiave, nome: filtro.per === "destinazione" ? i.nome : filtro.per === "fornitore" ? i.fornitore : null,
          a_mano: filtro.per === "destinazione" && i.a_mano === true,
          paese: filtro.per === "destinazione" || filtro.per === "paese" ? i.paese : null,
          fornitore: filtro.per === "destinazione" || filtro.per === "fornitore" ? i.fornitore : null,
          host: 0, destinazioni: 0, byte: 0, byte_dentro: 0, servizi: [], ultima_vista: r.ultima_vista,
          compromesse: 0, bloccherebbe: 0, liste: filtro.per === "destinazione" ? liste : [],
        },
        host: new Set(), dest: new Set(), comp: new Set(), bloc: new Set(), servizi: new Map(),
      };
      gruppi.set(chiave, g);
    }
    g.host.add(r.interno);
    g.dest.add(r.ip);
    if (compromessa) g.comp.add(r.ip);
    if (bloccata) g.bloc.add(r.ip);
    g.riga.byte += r.byte;
    if (r.verso === "dentro") g.riga.byte_dentro += r.byte;
    if (r.ultima_vista > g.riga.ultima_vista) g.riga.ultima_vista = r.ultima_vista;
    const ks = `${r.proto}/${r.porta}`;
    const s = g.servizi.get(ks);
    if (s) s.byte += r.byte;
    else g.servizi.set(ks, { proto: r.proto, porta: r.porta, byte: r.byte });
  }
  altri.host = hostAltri.size;
  const tutte = [...gruppi.values()].map((g) => ({
    ...g.riga, host: g.host.size, destinazioni: g.dest.size, compromesse: g.comp.size, bloccherebbe: g.bloc.size,
    servizi: [...g.servizi.values()].sort((a, b) => b.byte - a.byte).slice(0, 3),
  })).sort((a, b) => b.byte - a.byte);
  const pagina = Math.max(1, Math.trunc(filtro.pagina ?? 1));
  return {
    tessere: { destinazioni: tutteDest.size, paesi: paesi.size, fornitori: fornitori.size, byte, host: tuttiHost.size, compromesse: compromesse.size, bloccherebbe: bloccate.size },
    righe: tutte.slice((pagina - 1) * PER_PAGINA, pagina * PER_PAGINA), totale: tutte.length, pagina, perPagina: PER_PAGINA,
    altri: altri.host > 0 ? altri : null,
  };
}

export interface EsternoTraffico extends VistaEsterno { giorni: number; per: Per; archivio: StatoGeo; nomi_host: Record<string, NomeDiIp>; troncato: boolean }

export function esternoTraffico(filtro: { giorni?: number; per: Per; pagina?: number; cerca?: string; segnate?: Segnate }): EsternoTraffico {
  const d = dbTraffico();
  const giorni = Math.max(1, Math.min(GIORNI_ESTERNI, Math.trunc(filtro.giorni ?? 1)));
  const righe = d.prepare(`
    SELECT interno, ip, verso, proto, porta, MAX(byte) AS byte, MAX(flussi) AS flussi, MAX(ultima_vista) AS ultima_vista
    FROM (
      SELECT collector_id, interno, ip, verso, proto, porta, SUM(byte) AS byte,
             CASE WHEN ip = 'altri' THEN MAX(flussi) ELSE SUM(flussi) END AS flussi, MAX(ultima_vista) AS ultima_vista
      FROM traffico_esterni WHERE giorno >= date('now', ?)
      GROUP BY collector_id, interno, ip, verso, proto, porta)
    GROUP BY interno, ip, verso, proto, porta ORDER BY byte DESC LIMIT ${MASSIMO_RIGHE + 1}`).all(`-${giorni - 1} days`) as RigaEsterna[];
  const troncato = righe.length > MASSIMO_RIGHE;
  if (troncato) righe.length = MASSIMO_RIGHE;

  const geo = creaCercaGeo();
  const cercaListe = creaCercaListe(d);
  const oggetti = elencoOggetti(d);
  const nomeOggetto = new Map(oggetti.map((o) => [o.chiave, o.nome]));
  const diOggetto = creaCercatore(oggetti.map((o) => o.chiave));
  const nomi = new Map<string, string>();
  // il nome del saluto TLS vale più di quello chiesto al DNS: è il servizio a cui ci si è davvero collegati
  for (const n of d.prepare("SELECT ip, tipo, nome FROM traffico_nomi_ip ORDER BY tipo").all() as { ip: string; tipo: string; nome: string }[]) nomi.set(n.ip, n.nome);
  const memo = new Map<string, ReturnType<Parameters<typeof calcolaEsterno>[1]>>();
  const info = (ip: string) => {
    let i = memo.get(ip);
    if (!i) {
      const o = diOggetto(ip);
      const dato = o ? nomeOggetto.get(o) ?? null : null;
      i = { nome: dato ?? nomi.get(ip) ?? null, a_mano: dato !== null, ...geo(ip), liste: cercaListe(ip) };
      memo.set(ip, i);
    }
    return i;
  };
  const vista = calcolaEsterno(righe, info, filtro);
  const nomiHost = filtro.per === "host" ? nomiDegliIp(vista.righe.map((r) => r.chiave)) : {};
  return { ...vista, giorni, per: filtro.per, archivio: statoGeo(), nomi_host: nomiHost, troncato };
}
