/**
 * IPAM legge i collector di traffico (20/11/2026), a giri, col cursore: chiede solo le
 * righe dopo l'ultima ricevuta. Stesso schema di `trunk/sensore-trunk.ts`.
 *
 * Regole da non rompere:
 * - cursore e righe nella stessa transazione: una pagina o entra intera o non entra;
 * - un errore scrive `ultimo_errore` e NON tocca il cursore (si riparte da lì);
 * - lo stesso flusso visto da due collector non si somma: la lettura per host prende
 *   il massimo fra i collector (caso 4 del piano).
 */
import type Database from "better-sqlite3";
import { getCurrentTenantCode, getTenantDb, getTenantSetting, setTenantSetting } from "@/lib/db-tenant";
import { encrypt, safeDecrypt } from "@/lib/crypto";
import { assicuraTabelleTraffico } from "./schema";
import { collectorGet, type CollectorAccesso } from "./collector-client";
import { calcolaVolumi, creaRegistratore } from "./anomalie";

export const PAGINA = 1000;
export const PAGINE_PER_GIRO = 20;
export const GIORNI_TENUTI = 90;

export interface RigaCollector {
  seq: number;
  inizio: string;
  durata_s: number;
  client: string;
  server: string;
  proto: number;
  porta: number;
  byte: number;
  pacchetti: number;
  flussi: number;
  esterni: number;
}
export interface StatoCollector {
  versione: string;
  nome: string;
  avviato: string;
  ultimo_seq: number;
  pacchetti_visti: number;
  pacchetti_persi: number;
  copertura: number;
}
interface PaginaCoppie {
  righe: RigaCollector[];
  ultimo_seq: number;
  altri: boolean;
  buco: boolean;
}

/** Un collector come lo vede l'interfaccia: senza gettone, nemmeno cifrato. */
export interface CollectorTraffico {
  id: number;
  nome: string;
  sede: string;
  url: string;
  impronta: string;
  attivo: boolean;
  cursore_coppie: number;
  ultimo_contatto: string | null;
  ultimo_errore: string | null;
  ultimo_buco: string | null;
  copertura: number | null;
  creato: string;
}
interface RigaCollectorDb extends Omit<CollectorTraffico, "attivo"> {
  attivo: number;
  gettone_enc: string;
}

export type Lettore = <T>(c: CollectorAccesso, percorso: string) => Promise<T>;
/** Chiamata dopo ogni finestra scritta, dentro la stessa transazione. Di serie: `creaRegistratore` (abitudini e anomalie). */
export type DopoFinestra = (db: Database.Database, inizio: string, righe: RigaCollector[]) => void;

export function dbTraffico(): Database.Database {
  const d = getTenantDb(getCurrentTenantCode() ?? "DEFAULT");
  assicuraTabelleTraffico(d);
  return d;
}

const CAMPI = "id, nome, sede, url, impronta, attivo, cursore_coppie, ultimo_contatto, ultimo_errore, ultimo_buco, copertura, creato";

export function elencoCollector(): CollectorTraffico[] {
  const righe = dbTraffico().prepare(`SELECT ${CAMPI} FROM traffico_collector ORDER BY nome, id`).all() as RigaCollectorDb[];
  return righe.map((r) => ({ ...r, attivo: r.attivo === 1 }));
}

export function contaCollectorAttivi(): number {
  return (dbTraffico().prepare("SELECT COUNT(*) AS n FROM traffico_collector WHERE attivo = 1").get() as { n: number }).n;
}

export function creaCollector(c: { nome: string; sede: string; url: string; gettone: string; impronta: string }): number {
  const r = dbTraffico()
    .prepare("INSERT INTO traffico_collector (nome, sede, url, gettone_enc, impronta, creato) VALUES (?, ?, ?, ?, ?, datetime('now'))")
    .run(c.nome, c.sede, c.url, encrypt(c.gettone), c.impronta);
  return Number(r.lastInsertRowid);
}

export function aggiornaCollector(
  id: number,
  c: Partial<{ nome: string; sede: string; url: string; gettone: string; impronta: string; attivo: boolean }>,
): boolean {
  const campi: string[] = [];
  const valori: (string | number)[] = [];
  if (c.nome !== undefined) { campi.push("nome = ?"); valori.push(c.nome); }
  if (c.sede !== undefined) { campi.push("sede = ?"); valori.push(c.sede); }
  if (c.url !== undefined) { campi.push("url = ?"); valori.push(c.url); }
  if (c.impronta !== undefined) { campi.push("impronta = ?"); valori.push(c.impronta); }
  if (c.gettone !== undefined) { campi.push("gettone_enc = ?"); valori.push(encrypt(c.gettone)); }
  if (c.attivo !== undefined) { campi.push("attivo = ?"); valori.push(c.attivo ? 1 : 0); }
  if (campi.length === 0) return dbTraffico().prepare("SELECT 1 FROM traffico_collector WHERE id = ?").get(id) !== undefined;
  return dbTraffico().prepare(`UPDATE traffico_collector SET ${campi.join(", ")} WHERE id = ?`).run(...valori, id).changes > 0;
}

/** Toglie il collector e le sue coppie: senza di lui non hanno più una fonte da cui aggiornarsi. */
export function eliminaCollector(id: number): boolean {
  const d = dbTraffico();
  return d.transaction(() => {
    d.prepare("DELETE FROM traffico_coppie WHERE collector_id = ?").run(id);
    return d.prepare("DELETE FROM traffico_collector WHERE id = ?").run(id).changes > 0;
  })();
}

/** L'accesso a un collector registrato, col gettone decifrato. Null se non c'è o il gettone non si legge. */
export function accessoCollector(id: number): CollectorAccesso | null {
  const r = dbTraffico().prepare("SELECT url, gettone_enc, impronta FROM traffico_collector WHERE id = ?").get(id) as
    | { url: string; gettone_enc: string; impronta: string }
    | undefined;
  if (!r) return null;
  const gettone = safeDecrypt(r.gettone_enc);
  return gettone ? { url: r.url, gettone, impronta: r.impronta } : null;
}

const DATA = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
function rigaValida(r: RigaCollector): boolean {
  return (
    Number.isInteger(r.seq) && typeof r.inizio === "string" && DATA.test(r.inizio) &&
    typeof r.client === "string" && r.client.length > 0 && r.client.length <= 64 &&
    typeof r.server === "string" && r.server.length > 0 && r.server.length <= 64 &&
    Number.isInteger(r.proto) && Number.isInteger(r.porta) &&
    Number.isFinite(r.byte) && Number.isFinite(r.pacchetti) && Number.isFinite(r.flussi)
  );
}

/** Scrive una pagina e sposta il cursore, tutto insieme. Ritorna le righe entrate. */
function scriviPagina(d: Database.Database, collectorId: number, p: PaginaCoppie, dopoFinestra?: DopoFinestra): number {
  const ins = d.prepare(`
    INSERT INTO traffico_coppie (giorno, collector_id, client, server, proto, porta, byte, pacchetti, flussi, esterni, prima_vista, ultima_vista)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(giorno, collector_id, client, server, proto, porta) DO UPDATE SET
      byte = traffico_coppie.byte + excluded.byte,
      pacchetti = traffico_coppie.pacchetti + excluded.pacchetti,
      flussi = traffico_coppie.flussi + excluded.flussi,
      esterni = MAX(traffico_coppie.esterni, excluded.esterni),
      prima_vista = MIN(traffico_coppie.prima_vista, excluded.prima_vista),
      ultima_vista = MAX(traffico_coppie.ultima_vista, excluded.ultima_vista)`);
  return d.transaction(() => {
    const buone = p.righe.filter(rigaValida);
    const finestre = new Map<string, RigaCollector[]>();
    for (const r of buone) {
      ins.run(r.inizio.slice(0, 10), collectorId, r.client, r.server, r.proto, r.porta, r.byte, r.pacchetti, r.flussi, r.esterni ?? 0, r.inizio, r.inizio);
      const f = finestre.get(r.inizio);
      if (f) f.push(r);
      else finestre.set(r.inizio, [r]);
    }
    if (dopoFinestra) for (const [inizio, righe] of finestre) dopoFinestra(d, inizio, righe);
    d.prepare("UPDATE traffico_collector SET cursore_coppie = ?, ultimo_buco = CASE WHEN ? = 1 THEN datetime('now') ELSE ultimo_buco END WHERE id = ?")
      .run(p.ultimo_seq, p.buco ? 1 : 0, collectorId);
    return buone.length;
  })();
}

function sfoltisciUnaVoltaAlGiorno(d: Database.Database): void {
  const oggi = new Date().toISOString().slice(0, 10);
  if (getTenantSetting("traffico_ultima_pulizia") === oggi) return;
  d.prepare("DELETE FROM traffico_coppie WHERE giorno < date('now', ?)").run(`-${GIORNI_TENUTI} days`);
  // Il volume si giudica sul giorno chiuso: ieri contro i 14 giorni prima.
  calcolaVolumi(d, new Date(Date.now() - 86_400_000).toISOString().slice(0, 10));
  setTenantSetting("traffico_ultima_pulizia", oggi);
}

/** Messaggio d'errore da tenere nel database: corto e senza indirizzi. */
function motivo(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return m.replace(/\b\d{1,3}(\.\d{1,3}){3}(:\d+)?\b/g, "…").slice(0, 200);
}

export async function sincronizzaTraffico(
  leggi: Lettore = collectorGet,
  dopoFinestra?: DopoFinestra,
): Promise<{ collector: number; righe: number; errori: number }> {
  const d = dbTraffico();
  const attivi = d.prepare("SELECT id, url, gettone_enc, impronta, cursore_coppie FROM traffico_collector WHERE attivo = 1 ORDER BY id").all() as
    { id: number; url: string; gettone_enc: string; impronta: string; cursore_coppie: number }[];
  const esito = { collector: attivi.length, righe: 0, errori: 0 };
  if (attivi.length === 0) return esito;
  // Abitudini e anomalie: reti, host e matrice si leggono una volta per giro.
  const registra = dopoFinestra ?? creaRegistratore();
  for (const c of attivi) {
    try {
      const gettone = safeDecrypt(c.gettone_enc);
      if (!gettone) throw new Error("Gettone del collector illeggibile: va reinserito");
      const accesso: CollectorAccesso = { url: c.url, gettone, impronta: c.impronta };
      const stato = await leggi<StatoCollector>(accesso, "/v1/stato");
      let cursore = c.cursore_coppie;
      for (let n = 0; n < PAGINE_PER_GIRO; n++) {
        const p = await leggi<PaginaCoppie>(accesso, `/v1/coppie?dopo=${cursore}&limite=${PAGINA}`);
        if (!p || !Array.isArray(p.righe) || !Number.isInteger(p.ultimo_seq)) throw new Error("Risposta del collector senza righe");
        esito.righe += scriviPagina(d, c.id, p, registra);
        cursore = p.ultimo_seq;
        if (!p.altri) break;
      }
      d.prepare("UPDATE traffico_collector SET ultimo_contatto = datetime('now'), ultimo_errore = NULL, copertura = ? WHERE id = ?")
        .run(typeof stato?.copertura === "number" ? stato.copertura : null, c.id);
    } catch (e) {
      esito.errori++;
      d.prepare("UPDATE traffico_collector SET ultimo_errore = ? WHERE id = ?").run(motivo(e), c.id);
    }
  }
  sfoltisciUnaVoltaAlGiorno(d);
  return esito;
}

export interface CoppiaHost {
  altro: string;
  proto: number;
  porta: number;
  byte: number;
  pacchetti: number;
  flussi: number;
  esterni: number;
  prima_vista: string;
  ultima_vista: string;
}

/**
 * Con chi parla un host negli ultimi `giorni`. Per ogni coppia il totale del periodo si fa
 * collector per collector e poi si prende il massimo: due punti di ascolto sulla stessa strada
 * vedono lo stesso flusso, sommarli lo conterebbe due volte.
 */
export function coppieDiHost(ip: string, giorni = 7): { parlaCon: CoppiaHost[]; gliParlano: CoppiaHost[] } {
  const d = dbTraffico();
  const da = `-${Math.max(1, Math.min(GIORNI_TENUTI, Math.trunc(giorni)))} days`;
  const leggi = (mio: "client" | "server", altro: "client" | "server") =>
    d.prepare(`
      SELECT altro, proto, porta, MAX(byte) AS byte, MAX(pacchetti) AS pacchetti, MAX(flussi) AS flussi, MAX(esterni) AS esterni,
             MIN(prima_vista) AS prima_vista, MAX(ultima_vista) AS ultima_vista
      FROM (
        SELECT collector_id, ${altro} AS altro, proto, porta, SUM(byte) AS byte, SUM(pacchetti) AS pacchetti, SUM(flussi) AS flussi,
               MAX(esterni) AS esterni, MIN(prima_vista) AS prima_vista, MAX(ultima_vista) AS ultima_vista
        FROM traffico_coppie WHERE ${mio} = ? AND giorno >= date('now', ?)
        GROUP BY collector_id, ${altro}, proto, porta)
      GROUP BY altro, proto, porta ORDER BY byte DESC LIMIT 500`).all(ip, da) as CoppiaHost[];
  return { parlaCon: leggi("client", "server"), gliParlano: leggi("server", "client") };
}
