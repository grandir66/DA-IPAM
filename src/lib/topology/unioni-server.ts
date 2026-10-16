/**
 * Le rotte di «Unisci con…» e «Separa…» (piano 2026-10-16, Task 3; ADR 0021), lato server: legge il DB del cliente (import
 * statico di db-tenant, ADR 0002; lo importano solo le rotte /api/topology/unioni, nessun componente della pagina), decide con
 * `unioni.ts` (puro) e, solo con `applica: true`, scrive il piano in UNA transazione (`scriviPianoUnioni`). Le rotte ne sono
 * l'involucro: guardia, `readJson`, la risposta così com'è.
 *
 * Tutto sincrono: fra la lettura delle righe e la scrittura nessun `await`. Se nel frattempo un'altra richiesta ha tolto una riga
 * da togliere, la scrittura non fa niente e risponde 409 «cambiato» (UnioniCambiate). Le fonti si possono passare: le prove
 * simulano chi ha letto le righe prima di un altro; le rotte usano sempre quelle del DB.
 */
import { UnioniCambiate, getIngressoNodi, getRigheScelte, schemaUnioniPresente, scriviPianoUnioni } from "@/lib/db-tenant";
import { parseOggettoParam, parseRicercaParam, parseSeparaBody, parseUnioneBody } from "@/lib/topology/api-input";
import {
  anteprimaSeparazione, anteprimaUnione, cercaCandidati, decidiSeparazione, decidiUnione, statoDelNodo, type IngressoNodi, type RigheScelte,
} from "@/lib/topology/unioni";
import { TESTI_UNIONI, type PianoUnioni } from "@/lib/topology/unioni-tipi";

export interface RispostaRotta { status: number; body: unknown }

/** Da dove le rotte leggono e dove scrivono. */
export interface FontiUnioni {
  /** Le due tabelle ci sono (annotato all'apertura del tenant). */
  presente: () => boolean;
  ingresso: () => IngressoNodi;
  righe: () => RigheScelte;
  scrivi: (piano: PianoUnioni, da: string) => void;
}

export const FONTI_UNIONI: FontiUnioni = {
  presente: schemaUnioniPresente,
  ingresso: getIngressoNodi,
  righe: getRigheScelte,
  scrivi: (piano, da) => scriviPianoUnioni(piano, da),
};

const errore = (status: number, error: string): RispostaRotta => ({ status, body: { error } });
const NESSUNA: RigheScelte = { unioni: [], separazioni: [] };

/** GET /api/topology/unioni?oggetto=… — lo stato sulla mappa di un oggetto; `disponibile: false` senza le tabelle. */
export function rispostaStato(oggetto: string | null, fonti: FontiUnioni = FONTI_UNIONI): RispostaRotta {
  const o = parseOggettoParam(oggetto);
  if (!o.ok) return errore(400, o.error);
  const presente = fonti.presente();
  const e = statoDelNodo(fonti.ingresso(), presente ? fonti.righe() : NESSUNA, o.data);
  if (!e.ok) return errore(e.status, e.error);
  return { status: 200, body: { ...e.dati, disponibile: presente } };
}

/** GET /api/topology/unioni/candidati?da=…&q=… — con chi si può unire `da`, per nome, IP o MAC. */
export function rispostaCandidati(da: string | null, q: string | null, fonti: FontiUnioni = FONTI_UNIONI): RispostaRotta {
  const d = parseOggettoParam(da);
  if (!d.ok) return errore(400, d.error);
  const t = parseRicercaParam(q);
  if (!t.ok) return errore(400, t.error);
  const e = cercaCandidati(fonti.ingresso(), fonti.presente() ? fonti.righe() : NESSUNA, d.data, t.data);
  return e.ok ? { status: 200, body: e.dati } : errore(e.status, e.error);
}

/**
 * Scrive il piano; `null` se è scritto, la risposta 409 se nel frattempo le righe sono cambiate. Ogni altro errore passa alla
 * rotta (500 e il journal): non diventa una risposta «riuscita».
 */
function scrivi(fonti: FontiUnioni, piano: PianoUnioni, utente: string): RispostaRotta | null {
  try {
    fonti.scrivi(piano, utente);
    return null;
  } catch (e) {
    if (e instanceof UnioniCambiate) return errore(409, TESTI_UNIONI.cambiato);
    throw e;
  }
}

/** POST /api/topology/unioni `{ membri, applica }` — l'anteprima (`applica: false`, non scrive) o l'unione. */
export function rispostaUnione(raw: unknown, utente: string, fonti: FontiUnioni = FONTI_UNIONI): RispostaRotta {
  const corpo = parseUnioneBody(raw);
  if (!corpo.ok) return errore(400, corpo.error);
  if (!fonti.presente()) return errore(409, TESTI_UNIONI.schemaAssente);
  const ing = fonti.ingresso();
  const righe = fonti.righe();
  const d = decidiUnione(ing, righe, corpo.data.membri);
  if (!d.ok) return errore(d.status, d.error);
  if (!corpo.data.applica) return { status: 200, body: { ...d.dati.anteprima, scritto: false } };
  const fallita = scrivi(fonti, d.dati.piano, utente);
  if (fallita) return fallita;
  // Scritto: l'anteprima si rifà sulle righe rilette dal DB (è quella che la mappa avrà adesso).
  const tolte = righe.separazioni.filter((s) => d.dati.piano.togliSeparazioni.includes(s.id));
  const a = anteprimaUnione(ing, righe, fonti.righe(), corpo.data.membri, tolte);
  if (!a.ok) {
    console.error("[topology] unioni: unione scritta, ma rileggendola non torna:", a.error);
    return errore(500, "L'unione è scritta, ma rileggendola non torna: ricarica la pagina e controlla l'oggetto.");
  }
  return { status: 200, body: { ...a.dati, scritto: true } };
}

/** POST /api/topology/unioni/separa `{ nodo, membro, applica }` — l'anteprima (`applica: false`, non scrive) o la separazione. */
export function rispostaSeparazione(raw: unknown, utente: string, fonti: FontiUnioni = FONTI_UNIONI): RispostaRotta {
  const corpo = parseSeparaBody(raw);
  if (!corpo.ok) return errore(400, corpo.error);
  if (!fonti.presente()) return errore(409, TESTI_UNIONI.schemaAssente);
  const ing = fonti.ingresso();
  const righe = fonti.righe();
  const d = decidiSeparazione(ing, righe, corpo.data.nodo, corpo.data.membro);
  if (!d.ok) return errore(d.status, d.error);
  if (!corpo.data.applica) return { status: 200, body: { ...d.dati.anteprima, scritto: false } };
  const fallita = scrivi(fonti, d.dati.piano, utente);
  if (fallita) return fallita;
  const a = anteprimaSeparazione(ing, righe, fonti.righe(), corpo.data.nodo, corpo.data.membro);
  return { status: 200, body: { ...a, scritto: true } };
}
