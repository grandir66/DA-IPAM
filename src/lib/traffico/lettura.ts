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
import { collectorGet, CollectorErrore, type CollectorAccesso } from "./collector-client";
import { calcolaVolumi, creaRegistratore, creaRegistratoreEsterni, creaRegistratoreFatti, creaRegistratoreIdentita } from "./anomalie";
import { GIORNI_IDENTITA, identitaValida, type IdentitaCollector } from "./identita";
import { registraNomiIp, sfoltisciEsterni, type EsternoCollector, type NomeIpCollector } from "./esterno";
import { ripulisciRumore, rumoreDiSonda } from "./sonde";

export const PAGINA = 1000;
export const PAGINE_PER_GIRO = 20;
export const GIORNI_TENUTI = 90;
/** Le coppie per ora (`traffico_ore`) si tengono una settimana. */
export const GIORNI_ORE = 7;
const FONTI = new Set(["mirror", "netflow", "sflow"]);

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
  /** `mirror`, `netflow` o `sflow`; un collector vecchio non la manda: mirror. */
  fonte?: string;
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
interface Pagina<T> {
  righe: T[];
  ultimo_seq: number;
  altri: boolean;
  buco: boolean;
}
type PaginaCoppie = Pagina<RigaCollector>;
/** Un fatto dei controlli sul contenuto: dice cosa è successo, mai il valore (password, comunità). */
export interface FattoCollector {
  seq: number;
  visto: string;
  tipo: string;
  client: string;
  server: string;
  porta: number;
  dettaglio: unknown;
}
export interface NomeCollector {
  seq: number;
  visto: string;
  client: string;
  tipo: string;
  nome: string;
  conteggio: number;
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
    d.prepare("DELETE FROM traffico_ore WHERE collector_id = ?").run(id);
    d.prepare("DELETE FROM traffico_identita WHERE collector_id = ?").run(id);
    d.prepare("DELETE FROM traffico_esterni WHERE collector_id = ?").run(id);
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
function scriviPagina(d: Database.Database, collectorId: number, p: PaginaCoppie, dopoFinestra: DopoFinestra | undefined, sonde: Set<string>): number {
  const ins = d.prepare(`
    INSERT INTO traffico_coppie (giorno, collector_id, fonte, client, server, proto, porta, byte, pacchetti, flussi, esterni, prima_vista, ultima_vista)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(giorno, collector_id, fonte, client, server, proto, porta) DO UPDATE SET
      byte = traffico_coppie.byte + excluded.byte,
      pacchetti = traffico_coppie.pacchetti + excluded.pacchetti,
      flussi = traffico_coppie.flussi + excluded.flussi,
      esterni = MAX(traffico_coppie.esterni, excluded.esterni),
      prima_vista = MIN(traffico_coppie.prima_vista, excluded.prima_vista),
      ultima_vista = MAX(traffico_coppie.ultima_vista, excluded.ultima_vista)`);
  // La stessa riga anche per ora: «Ultima ora» e l'andamento (piano del 23/11, tappa 1).
  const insOra = d.prepare(`
    INSERT INTO traffico_ore (ora, client, server, proto, porta, collector_id, fonte, byte, pacchetti, flussi, esterni)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(ora, client, server, proto, porta, collector_id, fonte) DO UPDATE SET
      byte = traffico_ore.byte + excluded.byte,
      pacchetti = traffico_ore.pacchetti + excluded.pacchetti,
      flussi = traffico_ore.flussi + excluded.flussi,
      esterni = MAX(traffico_ore.esterni, excluded.esterni)`);
  return d.transaction(() => {
    // Le scansioni di una sonda nota non si salvano (vedi `sonde.ts`); il cursore avanza lo stesso.
    const buone = p.righe.filter((r) => rigaValida(r) && !rumoreDiSonda(r, sonde));
    const finestre = new Map<string, RigaCollector[]>();
    for (const r of buone) {
      const fonte = FONTI.has(r.fonte ?? "") ? r.fonte : "mirror";
      ins.run(r.inizio.slice(0, 10), collectorId, fonte, r.client, r.server, r.proto, r.porta, r.byte, r.pacchetti, r.flussi, r.esterni ?? 0, r.inizio, r.inizio);
      insOra.run(`${r.inizio.slice(0, 13)}:00:00`, r.client, r.server, r.proto, r.porta, collectorId, fonte, r.byte, r.pacchetti, r.flussi, r.esterni ?? 0);
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

/**
 * Fatti e nomi: stessa lettura a pagine delle coppie, ognuno col suo cursore. Un collector
 * senza l'ascolto (versione vecchia) risponde 404: non è un errore, non c'è niente da leggere.
 */
async function leggiFattiENomi(
  d: Database.Database, leggi: Lettore, accesso: CollectorAccesso, c: { id: number; cursore_fatti: number; cursore_nomi: number; cursore_identita: number; cursore_esterni: number; cursore_nomi_ip: number },
  registraFatti: (d: Database.Database, fatti: FattoCollector[]) => void,
  registraIdentita: (d: Database.Database, collectorId: number, righe: IdentitaCollector[]) => void,
  registraEsterni: (d: Database.Database, collectorId: number, righe: EsternoCollector[]) => void,
  sonde: Set<string>,
): Promise<void> {
  const aPagine = async <T extends { seq: number }>(percorso: string, da: number, scrivi: (p: Pagina<T>) => void) => {
    let cursore = da;
    for (let n = 0; n < PAGINE_PER_GIRO; n++) {
      let p: Pagina<T>;
      try {
        p = await leggi<Pagina<T>>(accesso, `${percorso}?dopo=${cursore}&limite=${PAGINA}`);
      } catch (e) {
        if (e instanceof CollectorErrore && e.stato === 404) return;
        throw e;
      }
      if (!p || !Array.isArray(p.righe) || !Number.isInteger(p.ultimo_seq)) throw new Error("Risposta del collector senza righe");
      d.transaction(() => scrivi(p))();
      cursore = p.ultimo_seq;
      if (!p.altri) break;
    }
  };
  const testo = (v: unknown, max: number): v is string => typeof v === "string" && v.length > 0 && v.length <= max;
  await aPagine<FattoCollector>("/v1/fatti", c.cursore_fatti, (p) => {
    registraFatti(d, p.righe.filter((f) => DATA.test(f.visto ?? "") && testo(f.tipo, 40) && testo(f.client, 64) && typeof f.server === "string" && f.server.length <= 64 && Number.isInteger(f.porta)));
    d.prepare("UPDATE traffico_collector SET cursore_fatti = ? WHERE id = ?").run(p.ultimo_seq, c.id);
  });
  const ins = d.prepare(`
    INSERT INTO traffico_nomi (giorno, client, tipo, nome, conteggio, prima_vista, ultima_vista) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(giorno, client, tipo, nome) DO UPDATE SET
      conteggio = traffico_nomi.conteggio + excluded.conteggio,
      prima_vista = MIN(traffico_nomi.prima_vista, excluded.prima_vista),
      ultima_vista = MAX(traffico_nomi.ultima_vista, excluded.ultima_vista)`);
  await aPagine<NomeCollector>("/v1/nomi", c.cursore_nomi, (p) => {
    for (const n of p.righe) {
      if (!DATA.test(n.visto ?? "") || !testo(n.client, 64) || (n.tipo !== "dns" && n.tipo !== "sni") || !testo(n.nome, 253) || !Number.isFinite(n.conteggio)) continue;
      ins.run(n.visto.slice(0, 10), n.client, n.tipo, n.nome, n.conteggio, n.visto, n.visto);
    }
    d.prepare("UPDATE traffico_collector SET cursore_nomi = ? WHERE id = ?").run(p.ultimo_seq, c.id);
  });
  // Chi è un indirizzo (23/11): un collector che non le legge ancora risponde 404, come sopra.
  await aPagine<IdentitaCollector>("/v1/identita", c.cursore_identita, (p) => {
    registraIdentita(d, c.id, p.righe.filter(identitaValida));
    d.prepare("UPDATE traffico_collector SET cursore_identita = ? WHERE id = ?").run(p.ultimo_seq, c.id);
  });
  // Verso l'esterno (23/11): le destinazioni tenute dal collector e il nome con cui sono state chiamate.
  await aPagine<EsternoCollector>("/v1/esterni", c.cursore_esterni, (p) => {
    registraEsterni(d, c.id, p.righe.filter((r) => !rumoreDiSonda({ client: r?.interno ?? "", server: "", proto: 0, porta: 1 }, sonde)));
    d.prepare("UPDATE traffico_collector SET cursore_esterni = ? WHERE id = ?").run(p.ultimo_seq, c.id);
  });
  await aPagine<NomeIpCollector>("/v1/nomi-ip", c.cursore_nomi_ip, (p) => {
    registraNomiIp(d, p.righe);
    d.prepare("UPDATE traffico_collector SET cursore_nomi_ip = ? WHERE id = ?").run(p.ultimo_seq, c.id);
  });
}

function sfoltisciUnaVoltaAlGiorno(d: Database.Database): void {
  const oggi = new Date().toISOString().slice(0, 10);
  if (getTenantSetting("traffico_ultima_pulizia") === oggi) return;
  d.prepare("DELETE FROM traffico_coppie WHERE giorno < date('now', ?)").run(`-${GIORNI_TENUTI} days`);
  d.prepare("DELETE FROM traffico_nomi WHERE giorno < date('now', ?)").run(`-${GIORNI_TENUTI} days`);
  d.prepare("DELETE FROM traffico_ore WHERE ora < datetime('now', ?)").run(`-${GIORNI_ORE} days`);
  d.prepare("DELETE FROM traffico_identita WHERE ultima_vista < datetime('now', ?)").run(`-${GIORNI_IDENTITA} days`);
  sfoltisciEsterni(d);
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
  /** Le sonde note; il job passa `sondeNote()`. Vuoto di serie: una prova non dipende dagli indirizzi della macchina. */
  sonde: Set<string> = new Set(),
): Promise<{ collector: number; righe: number; errori: number }> {
  const d = dbTraffico();
  ripulisciRumore(d, sonde);
  const attivi = d.prepare("SELECT id, url, gettone_enc, impronta, cursore_coppie, cursore_fatti, cursore_nomi, cursore_identita, cursore_esterni, cursore_nomi_ip FROM traffico_collector WHERE attivo = 1 ORDER BY id").all() as
    { id: number; url: string; gettone_enc: string; impronta: string; cursore_coppie: number; cursore_fatti: number; cursore_nomi: number; cursore_identita: number; cursore_esterni: number; cursore_nomi_ip: number }[];
  const esito = { collector: attivi.length, righe: 0, errori: 0 };
  if (attivi.length === 0) return esito;
  // Abitudini e anomalie: reti, host e matrice si leggono una volta per giro.
  const registra = dopoFinestra ?? creaRegistratore();
  const registraFatti = creaRegistratoreFatti(sonde);
  const registraIdentita = creaRegistratoreIdentita(sonde);
  const registraEsterni = creaRegistratoreEsterni(sonde);
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
        esito.righe += scriviPagina(d, c.id, p, registra, sonde);
        cursore = p.ultimo_seq;
        if (!p.altri) break;
      }
      await leggiFattiENomi(d, leggi, accesso, c, registraFatti, registraIdentita, registraEsterni, sonde);
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
  /** Le fonti che hanno visto la coppia, separate da virgola (`mirror`, `netflow`, `sflow`). */
  fonti: string;
}

/**
 * Con chi parla un host negli ultimi `giorni`. Per ogni coppia il totale del periodo si fa
 * collector per collector e fonte per fonte, e poi si prende il massimo: due punti di ascolto
 * sulla stessa strada (o il mirror e il NetFlow dello stesso tratto) vedono lo stesso flusso,
 * sommarli lo conterebbe due volte.
 */
export function coppieDiHost(ip: string, giorni = 7): { parlaCon: CoppiaHost[]; gliParlano: CoppiaHost[] } {
  const d = dbTraffico();
  const da = `-${Math.max(1, Math.min(GIORNI_TENUTI, Math.trunc(giorni)))} days`;
  const leggi = (mio: "client" | "server", altro: "client" | "server") =>
    d.prepare(`
      SELECT altro, proto, porta, MAX(byte) AS byte, MAX(pacchetti) AS pacchetti, MAX(flussi) AS flussi, MAX(esterni) AS esterni,
             MIN(prima_vista) AS prima_vista, MAX(ultima_vista) AS ultima_vista, GROUP_CONCAT(DISTINCT fonte) AS fonti
      FROM (
        SELECT collector_id, fonte, ${altro} AS altro, proto, porta, SUM(byte) AS byte, SUM(pacchetti) AS pacchetti, SUM(flussi) AS flussi,
               MAX(esterni) AS esterni, MIN(prima_vista) AS prima_vista, MAX(ultima_vista) AS ultima_vista
        FROM traffico_coppie WHERE ${mio} = ? AND giorno >= date('now', ?)
        GROUP BY collector_id, fonte, ${altro}, proto, porta)
      GROUP BY altro, proto, porta ORDER BY byte DESC LIMIT 500`).all(ip, da) as CoppiaHost[];
  return { parlaCon: leggi("client", "server"), gliParlano: leggi("server", "client") };
}

export interface NomeHost {
  tipo: "dns" | "sni";
  nome: string;
  conteggio: number;
  ultima_vista: string;
}

/** I nomi che un host ha chiesto al DNS o a cui si è presentato in TLS, negli ultimi `giorni`. */
export function nomiDiHost(ip: string, giorni = 7): NomeHost[] {
  const da = `-${Math.max(1, Math.min(GIORNI_TENUTI, Math.trunc(giorni)))} days`;
  return dbTraffico().prepare(`
    SELECT tipo, nome, SUM(conteggio) AS conteggio, MAX(ultima_vista) AS ultima_vista FROM traffico_nomi
    WHERE client = ? AND giorno >= date('now', ?) GROUP BY tipo, nome ORDER BY conteggio DESC LIMIT 200`).all(ip, da) as NomeHost[];
}
