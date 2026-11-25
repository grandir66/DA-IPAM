/**
 * Il collegamento guidato con DA-GEO (25/11/2026, Riccardo: «la procedura deve essere facile e guidata»).
 * IPAM apre una richiesta, un tecnico la conferma in DA-GEO confrontando il numero, IPAM ritira il codice da solo.
 *
 * Regole da non rompere:
 * - il segreto e il codice non escono mai da qui: al browser vanno solo il numero e l'indirizzo da aprire;
 * - il codice si ritira una volta sola, quindi si salva PRIMA di provare a scaricare;
 * - se DA-GEO non risponde la richiesta resta in attesa: non so non è un no.
 */
import type Database from "better-sqlite3";
import { safeDecrypt, encrypt } from "@/lib/crypto";
import { CODCLI, leggiConfigDalink } from "@/lib/dalink/config";
import { getCurrentTenantCode } from "@/lib/db-tenant";
import { dbTraffico } from "./lettura";
import { aggiornaListe, codiceValido, impostaFonte, type StatoListe } from "./liste";

const NUMERO = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/;
const SEGRETO = /^[0-9a-f]{64}$/;

export interface Richiesta { numero: string; apri: string; scade: string }
export type EsitoCollegamento =
  | { stato: "nessuna" | "rifiutata" | "scaduta" }
  | { stato: "attesa"; richiesta: Richiesta; avviso: string | null }
  | { stato: "collegato"; liste: StatoListe };

interface Riga { url: string; numero: string; segreto_enc: string; scade: string }
const riga = (d: Database.Database): Riga | undefined => d.prepare("SELECT url, numero, segreto_enc, scade FROM traffico_liste_richiesta WHERE id = 1").get() as Riga | undefined;
const pubblica = (r: Riga): Richiesta => ({ numero: r.numero, apri: `${r.url}/admin/collega?numero=${r.numero}`, scade: r.scade });
const togli = (d: Database.Database) => d.prepare("DELETE FROM traffico_liste_richiesta").run();

async function chiama(url: string, corpo: unknown): Promise<Record<string, unknown>> {
  let r: Response;
  try {
    r = await fetch(url, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000),
      headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0" }, body: JSON.stringify(corpo),
    });
  } catch {
    throw new Error("DA-GEO non risponde");
  }
  if (r.status === 429) throw new Error("Troppe richieste aperte da qui: riprova fra qualche minuto");
  if (!r.ok) throw new Error(r.status === 404 ? "DA-GEO qui non ha il collegamento guidato" : `DA-GEO risponde ${r.status}`);
  try {
    return JSON.parse((await r.text()).slice(0, 4000)) as Record<string, unknown>;
  } catch {
    throw new Error("DA-GEO ha risposto qualcosa che non si legge");
  }
}

/** Il codice cliente del gestionale, se questa installazione lo sa: in DA-GEO è solo un suggerimento. */
function codiceCliente(): string {
  const t = getCurrentTenantCode() ?? "";
  if (CODCLI.test(t)) return t;
  const c = leggiConfigDalink();
  return c.stato === "pronta" ? c.codcli : "";
}

/** La richiesta aperta, se non è scaduta. */
export function richiestaAperta(adesso: Date = new Date()): Richiesta | null {
  const r = riga(dbTraffico());
  return r && Date.parse(r.scade) > adesso.getTime() ? pubblica(r) : null;
}

export async function apriRichiesta(url: string, adesso: Date = new Date()): Promise<Richiesta> {
  const e = await chiama(`${url}/collega`, { cliente: codiceCliente() });
  if (typeof e.numero !== "string" || !NUMERO.test(e.numero) || typeof e.segreto !== "string" || !SEGRETO.test(e.segreto)) throw new Error("DA-GEO ha risposto qualcosa che non si legge");
  const minuti = typeof e.minuti === "number" && e.minuti > 0 && e.minuti <= 60 ? e.minuti : 15;
  const r: Riga = { url, numero: e.numero, segreto_enc: encrypt(e.segreto), scade: new Date(adesso.getTime() + minuti * 60_000).toISOString() };
  dbTraffico().prepare("INSERT OR REPLACE INTO traffico_liste_richiesta (id, url, numero, segreto_enc, scade) VALUES (1, ?, ?, ?, ?)").run(r.url, r.numero, r.segreto_enc, r.scade);
  return pubblica(r);
}

export function annullaRichiesta(): void {
  togli(dbTraffico());
}

// due schede aperte chiedono insieme: il codice esce una volta sola, quindi il ritiro è uno solo
const inCorso = new WeakMap<Database.Database, Promise<EsitoCollegamento>>();

export function controllaRichiesta(adesso: Date = new Date()): Promise<EsitoCollegamento> {
  const d = dbTraffico();
  const gia = inCorso.get(d);
  if (gia) return gia;
  const p = controlla(d, adesso).finally(() => inCorso.delete(d));
  inCorso.set(d, p);
  return p;
}

async function controlla(d: Database.Database, adesso: Date): Promise<EsitoCollegamento> {
  const r = riga(d);
  if (!r) return { stato: "nessuna" };
  const segreto = safeDecrypt(r.segreto_enc);
  if (!segreto || Date.parse(r.scade) <= adesso.getTime()) {
    togli(d);
    return { stato: "scaduta" };
  }
  let e: Record<string, unknown>;
  try {
    e = await chiama(`${r.url}/collega/esito`, { segreto });
  } catch (x) {
    return { stato: "attesa", richiesta: pubblica(r), avviso: x instanceof Error ? x.message : "DA-GEO non risponde" };
  }
  if (e.stato === "attesa") return { stato: "attesa", richiesta: pubblica(r), avviso: null };
  // mentre si aspettava la risposta la richiesta può essere stata annullata o sostituita
  const ancora = riga(d)?.numero === r.numero;
  if (e.stato === "confermata" && typeof e.codice === "string" && codiceValido(e.codice)) {
    if (!ancora) return { stato: "nessuna" };
    const codice = e.codice;
    const cliente = typeof e.nome_cliente === "string" ? e.nome_cliente.slice(0, 80) : "";
    d.transaction(() => { impostaFonte(r.url, codice, cliente); togli(d); })();
    return { stato: "collegato", liste: await aggiornaListe() };
  }
  if (ancora) togli(d);
  return { stato: e.stato === "rifiutata" ? "rifiutata" : "scaduta" };
}
