/**
 * Cosa non va (23/11/2026, tappa 5 dei «dati in più»): chi bussa a vuoto, servizi che rifiutano o non
 * rispondono, servizi lenti; e per un host i servizi davvero usati contro le porte che IPAM conosce.
 *
 * Il collector guarda solo l'apertura delle connessioni TCP. Sono **indizi, non misure esatte**: la copia
 * del traffico può perdere pacchetti (GRO sui nodi) e una risposta che torna per un'altra strada non si vede.
 *
 * Regole da non rompere:
 * - le scansioni delle sonde note (IPAM per primo) non si salvano: bussano a vuoto per mestiere;
 * - lo stesso fatto visto da più collector si prende al massimo, mai sommato;
 * - «aperta e mai usata» vale solo per il traffico che passa da un collector: va detto nella pagina.
 */
import type Database from "better-sqlite3";
import { dbTraffico } from "./lettura";
import { nomiDegliIp, type NomeDiIp } from "./quadro";

export const GIORNI_CONNESSIONI = 30;
/** Sopra questo tempo mediano fra SYN e SYN-ACK un servizio interno è «lento». */
export const SOGLIA_LENTO_MS = 200;
/** Con meno aperture riuscite di così il tempo non dice niente. */
export const MINIMO_PER_IL_TEMPO = 5;
const ESTERNO = "esterno";

export interface ConnessioneCollector {
  seq: number; inizio: string; client: string; server: string; porta: number;
  tentate: number; senza_risposta: number; rifiutate: number; ripetute: number; riuscite: number; ms_minimo: number; ms_mediano: number;
}

const DATA = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const conta = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0 && n < 1e12;

export function connessioneValida(r: ConnessioneCollector): boolean {
  return (
    !!r && Number.isInteger(r.seq) && typeof r.inizio === "string" && DATA.test(r.inizio) &&
    typeof r.client === "string" && r.client.length <= 64 && typeof r.server === "string" && r.server.length > 0 && r.server.length <= 64 &&
    conta(r.porta) && r.porta <= 65535 && conta(r.tentate) && conta(r.senza_risposta) && conta(r.rifiutate) && conta(r.ripetute) &&
    conta(r.riuscite) && conta(r.ms_minimo) && conta(r.ms_mediano)
  );
}

/** Scrive una pagina. Chi bussa da una sonda nota non si salva. */
export function registraConnessioni(d: Database.Database, collectorId: number, righe: ConnessioneCollector[], sonde: Set<string> = new Set()): void {
  const ins = d.prepare(`
    INSERT INTO traffico_connessioni (giorno, client, server, porta, collector_id, tentate, senza_risposta, rifiutate, ripetute, riuscite, ms_minimo, ms_mediano, prima_vista, ultima_vista)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(giorno, client, server, porta, collector_id) DO UPDATE SET
      tentate = traffico_connessioni.tentate + excluded.tentate,
      senza_risposta = traffico_connessioni.senza_risposta + excluded.senza_risposta,
      rifiutate = traffico_connessioni.rifiutate + excluded.rifiutate,
      ripetute = traffico_connessioni.ripetute + excluded.ripetute,
      -- il tempo mediano del giorno è la media delle mediane delle finestre, pesata sulle aperture riuscite
      ms_mediano = CASE WHEN traffico_connessioni.riuscite + excluded.riuscite = 0 THEN 0
        ELSE (traffico_connessioni.ms_mediano * traffico_connessioni.riuscite + excluded.ms_mediano * excluded.riuscite) / (traffico_connessioni.riuscite + excluded.riuscite) END,
      ms_minimo = CASE WHEN traffico_connessioni.riuscite = 0 THEN excluded.ms_minimo WHEN excluded.riuscite = 0 THEN traffico_connessioni.ms_minimo
        ELSE MIN(traffico_connessioni.ms_minimo, excluded.ms_minimo) END,
      riuscite = traffico_connessioni.riuscite + excluded.riuscite,
      prima_vista = MIN(traffico_connessioni.prima_vista, excluded.prima_vista),
      ultima_vista = MAX(traffico_connessioni.ultima_vista, excluded.ultima_vista)`);
  for (const r of righe) {
    if (!connessioneValida(r) || (r.client !== "" && sonde.has(r.client))) continue;
    ins.run(r.inizio.slice(0, 10), r.client, r.server, r.porta, collectorId, r.tentate, r.senza_risposta, r.rifiutate, r.ripetute, r.riuscite, r.ms_minimo, r.ms_mediano, r.inizio, r.inizio);
  }
}

export function sfoltisciConnessioni(d: Database.Database): void {
  d.prepare("DELETE FROM traffico_connessioni WHERE giorno < date('now', ?)").run(`-${GIORNI_CONNESSIONI} days`);
}

export interface RigaConnessione {
  client: string; server: string; porta: number; tentate: number; senza_risposta: number; rifiutate: number; ripetute: number;
  riuscite: number; ms_minimo: number; ms_mediano: number; ultima_vista: string;
}
export interface ChiBussa { client: string; destinazioni: number; tentate: number; senza_risposta: number; rifiutate: number; ultima_vista: string }
export interface ServizioCheNonVa {
  server: string; porta: number; client: number; senza_risposta: number; rifiutate: number;
  /** Le aperture riuscite dello stesso servizio nel periodo: 0 = non ha mai risposto a nessuno. */
  riuscite: number;
  ultima_vista: string;
}
export interface ServizioLento { server: string; porta: number; riuscite: number; ms_minimo: number; ms_mediano: number; ultima_vista: string }
export interface CosaNonVa { bussano: ChiBussa[]; servizi: ServizioCheNonVa[]; lenti: ServizioLento[] }

const QUANTI = 100;

/** Dalle righe del periodo (già senza doppioni fra collector) alle tre liste. Pura. */
export function calcolaCosaNonVa(righe: RigaConnessione[]): CosaNonVa {
  const bussano = new Map<string, ChiBussa & { dest: Set<string> }>();
  const servizi = new Map<string, ServizioCheNonVa & { chi: Set<string> }>();
  const riuscite = new Map<string, RigaConnessione>();
  for (const r of righe) {
    const ks = `${r.server}|${r.porta}`;
    if (r.client === "") { riuscite.set(ks, r); continue; }
    const falliti = r.senza_risposta + r.rifiutate;
    if (falliti === 0) continue; // solo SYN ripetuti e poi riuscita: lentezza, non fallimento
    let b = bussano.get(r.client);
    if (!b) bussano.set(r.client, (b = { client: r.client, destinazioni: 0, tentate: 0, senza_risposta: 0, rifiutate: 0, ultima_vista: r.ultima_vista, dest: new Set() }));
    b.dest.add(ks);
    b.tentate += r.tentate; b.senza_risposta += r.senza_risposta; b.rifiutate += r.rifiutate;
    if (r.ultima_vista > b.ultima_vista) b.ultima_vista = r.ultima_vista;
    // un servizio «che non va» è uno di casa: di quelli fuori non possiamo fare niente
    if (r.server === ESTERNO) continue;
    let s = servizi.get(ks);
    if (!s) servizi.set(ks, (s = { server: r.server, porta: r.porta, client: 0, senza_risposta: 0, rifiutate: 0, riuscite: 0, ultima_vista: r.ultima_vista, chi: new Set() }));
    s.chi.add(r.client);
    s.senza_risposta += r.senza_risposta; s.rifiutate += r.rifiutate;
    if (r.ultima_vista > s.ultima_vista) s.ultima_vista = r.ultima_vista;
  }
  const lenti: ServizioLento[] = [];
  for (const r of riuscite.values()) {
    if (r.server !== ESTERNO && r.riuscite >= MINIMO_PER_IL_TEMPO && r.ms_mediano >= SOGLIA_LENTO_MS) {
      lenti.push({ server: r.server, porta: r.porta, riuscite: r.riuscite, ms_minimo: r.ms_minimo, ms_mediano: r.ms_mediano, ultima_vista: r.ultima_vista });
    }
  }
  return {
    bussano: [...bussano.values()].map(({ dest, ...b }) => ({ ...b, destinazioni: dest.size }))
      .sort((a, b) => (b.senza_risposta + b.rifiutate) - (a.senza_risposta + a.rifiutate)).slice(0, QUANTI),
    servizi: [...servizi.entries()].map(([k, { chi, ...s }]) => ({ ...s, client: chi.size, riuscite: riuscite.get(k)?.riuscite ?? 0 }))
      .sort((a, b) => (b.senza_risposta + b.rifiutate) - (a.senza_risposta + a.rifiutate)).slice(0, QUANTI),
    lenti: lenti.sort((a, b) => b.ms_mediano - a.ms_mediano).slice(0, QUANTI),
  };
}

export interface CosaNonVaTraffico extends CosaNonVa { giorni: number; nomi: Record<string, NomeDiIp>; ci_sono_dati: boolean }

export function cosaNonVa(giorniChiesti = 1): CosaNonVaTraffico {
  const d = dbTraffico();
  const giorni = Math.max(1, Math.min(GIORNI_CONNESSIONI, Math.trunc(giorniChiesti)));
  const righe = d.prepare(`
    SELECT client, server, porta, MAX(tentate) AS tentate, MAX(senza_risposta) AS senza_risposta, MAX(rifiutate) AS rifiutate, MAX(ripetute) AS ripetute,
           MAX(riuscite) AS riuscite, MIN(ms_minimo) AS ms_minimo, MAX(ms_mediano) AS ms_mediano, MAX(ultima_vista) AS ultima_vista
    FROM (
      SELECT collector_id, client, server, porta, SUM(tentate) AS tentate, SUM(senza_risposta) AS senza_risposta, SUM(rifiutate) AS rifiutate,
             SUM(ripetute) AS ripetute, SUM(riuscite) AS riuscite, MIN(CASE WHEN riuscite > 0 THEN ms_minimo END) AS ms_minimo,
             CASE WHEN SUM(riuscite) = 0 THEN 0 ELSE SUM(ms_mediano * riuscite) / SUM(riuscite) END AS ms_mediano, MAX(ultima_vista) AS ultima_vista
      FROM traffico_connessioni WHERE giorno >= date('now', ?)
      GROUP BY collector_id, client, server, porta)
    GROUP BY client, server, porta`).all(`-${giorni - 1} days`) as RigaConnessione[];
  const esito = calcolaCosaNonVa(righe.map((r) => ({ ...r, ms_minimo: r.ms_minimo ?? 0 })));
  const ip = [...esito.bussano.map((b) => b.client), ...esito.servizi.map((s) => s.server), ...esito.lenti.map((s) => s.server)];
  return { ...esito, giorni, nomi: nomiDegliIp(ip), ci_sono_dati: righe.length > 0 };
}

export interface PortaNota { porta: number; proto: "tcp" | "udp"; servizio: string | null }
export interface ServiziDiHost {
  /** Usate nel traffico e note a IPAM dalle scansioni. */
  usate_note: (PortaNota & { byte: number; client: number })[];
  /** Usate nel traffico ma che IPAM non conosce come aperte. */
  usate_non_note: (PortaNota & { byte: number; client: number })[];
  /** Aperte per IPAM, ma nessuno le ha usate nel traffico che passa da un collector. */
  aperte_mai_usate: PortaNota[];
  giorni: number;
}

/** Confronta ciò che è stato usato con ciò che IPAM sa aperto. Pura. */
export function confrontaServizi(usate: { proto: number; porta: number; byte: number; client: number }[], note: PortaNota[], giorni: number): ServiziDiHost {
  const chiave = (proto: string, porta: number) => `${proto}/${porta}`;
  const perNota = new Map(note.map((n) => [chiave(n.proto, n.porta), n]));
  const viste = new Set<string>();
  const esito: ServiziDiHost = { usate_note: [], usate_non_note: [], aperte_mai_usate: [], giorni };
  for (const u of usate) {
    const proto = u.proto === 6 ? "tcp" : u.proto === 17 ? "udp" : null;
    if (!proto || u.porta === 0) continue;
    const k = chiave(proto, u.porta);
    viste.add(k);
    const n = perNota.get(k);
    (n ? esito.usate_note : esito.usate_non_note).push({ porta: u.porta, proto, servizio: n?.servizio ?? null, byte: u.byte, client: u.client });
  }
  esito.aperte_mai_usate = note.filter((n) => !viste.has(chiave(n.proto, n.porta)));
  return esito;
}

export function serviziDiHost(ip: string, giorni = 30): ServiziDiHost {
  const d = dbTraffico();
  const usate = d.prepare(`
    SELECT proto, porta, SUM(byte) AS byte, COUNT(DISTINCT client) AS client FROM (
      SELECT client, proto, porta, MAX(byte) AS byte FROM (
        SELECT collector_id, fonte, client, proto, porta, SUM(byte) AS byte FROM traffico_coppie
        WHERE server = ? AND porta <> 0 AND giorno >= date('now', ?) GROUP BY collector_id, fonte, client, proto, porta)
      GROUP BY client, proto, porta)
    GROUP BY proto, porta ORDER BY byte DESC LIMIT 200`).all(ip, `-${Math.max(1, Math.trunc(giorni)) - 1} days`) as { proto: number; porta: number; byte: number; client: number }[];
  const riga = d.prepare("SELECT open_ports FROM hosts WHERE ip = ?").get(ip) as { open_ports: string | null } | undefined;
  let note: PortaNota[] = [];
  try {
    const grezze: unknown = JSON.parse(riga?.open_ports || "[]");
    if (Array.isArray(grezze)) {
      note = grezze.flatMap((p: { port?: unknown; protocol?: unknown; service?: unknown }) =>
        Number.isInteger(p?.port) && (p.protocol === "tcp" || p.protocol === "udp")
          ? [{ porta: p.port as number, proto: p.protocol, servizio: typeof p.service === "string" ? p.service : null }] : []);
    }
  } catch {
    note = []; // porte scritte male: si confronta con «nessuna nota», la pagina lo mostra come tale
  }
  return confrontaServizi(usate, note, giorni);
}
