/**
 * Le rotte della pulizia degli host (piano 2026-10-20, Task 4), lato server: leggono il corpo, chiamano
 * `pulizia-archivio.ts` / `pulizia-candidati.ts` e rendono `{ status, body }`. Le rotte sotto `src/app/api/hosts/`
 * ne sono l'involucro (contesto tenant, guardia, la risposta così com'è), sul modello di `topology/unioni-server.ts`:
 * così 400 e 409 si provano senza sessione (`mock.module` non gira sotto Node 22 con tsx).
 *
 * Lavorano nel contesto tenant della rotta (`withTenantFromSession`); senza contesto `dbCorrente()` lancia.
 */
import { z } from "zod";
import { parseControllerId } from "@/lib/controllers/route-helpers";
import { GIORNI_ASSENZA_ARCHIVIO } from "@/lib/hosts/pulizia";
import { candidatiPulizia } from "@/lib/hosts/pulizia-candidati";
import {
  applicaPulizia,
  archivioScaduto,
  ErroreApplica,
  ErroreConferma,
  GIORNI_ARCHIVIO_PRIMA_DI_CANCELLARE,
  ipPrecedentiDi,
  listaArchivio,
  recuperaHost,
} from "@/lib/hosts/pulizia-archivio";

export interface RispostaRotta { status: number; body: unknown }

const errore = (status: number, error: string): RispostaRotta => ({ status, body: { error } });

/** Il nome dell'errore, per il journal: il testo può contenere nomi e IP degli host del cliente (niente PII nei log). */
const nomeErrore = (e: unknown): string => (e instanceof Error ? e.name : "errore");

/**
 * L'involucro delle rotte GET (m3 della revisione finale): un errore diventa 500 col messaggio fisso, e nel journal
 * va `[hosts] <contesto>` col solo nome dell'errore, come i POST.
 */
export function rispostaOGuasto(contesto: string, messaggio500: string, calcola: () => RispostaRotta): RispostaRotta {
  try {
    return calcola();
  } catch (e) {
    console.error(`[hosts] ${contesto}:`, nomeErrore(e));
    return errore(500, messaggio500);
  }
}

const CorpoApplica = z.object({
  ids: z.array(
    z.number({ error: "Gli host si indicano con il loro id numerico" })
      .int({ error: "Id di host non valido" })
      .positive({ error: "Id di host non valido" }),
    { error: "Manca l'elenco degli host da archiviare" },
  ).min(1, { error: "Nessun host da archiviare nell'elenco" }),
  conferma: z.number({ error: "Manca il numero di host confermato" })
    .int({ error: "Il numero confermato deve essere un intero" })
    .nonnegative({ error: "Il numero confermato non può essere negativo" }),
}, {
  error: (iss) => (iss.code === "unrecognized_keys" ? "La richiesta contiene campi non previsti" : "Corpo della richiesta non valido: servono ids e conferma"),
}).strict();

/**
 * GET /api/hosts/pulizia — anteprima: cosa si archivierebbe, chi resta fuori col perché, e le righe d'archivio
 * scadute che lo stesso «Applica» cancellerà per sempre (`scadute`, per nome: m7 della revisione finale). Non scrive niente.
 */
export function rispostaAnteprima(): RispostaRotta {
  const { candidati, esclusi } = candidatiPulizia();
  return {
    status: 200,
    body: {
      candidati, esclusi, scadute: archivioScaduto(),
      giorni: GIORNI_ASSENZA_ARCHIVIO, giorniArchivio: GIORNI_ARCHIVIO_PRIMA_DI_CANCELLARE,
    },
  };
}

/**
 * POST /api/hosts/pulizia — `{ ids, conferma }`: archivia i candidati di adesso fra gli `ids`. 400 su corpo storto o
 * conferma sbagliata (niente scritto); 500 con l'elenco per nome se l'archiviazione si interrompe a metà. Nel 500 il
 * messaggio è fisso (dove si è fermato, per nome); nel journal solo il nome dell'errore e l'id dell'host (m2).
 */
export function rispostaApplica(corpo: unknown, da: string): RispostaRotta {
  const parsed = CorpoApplica.safeParse(corpo);
  if (!parsed.success) return errore(400, parsed.error.issues[0]?.message ?? "Richiesta non valida");
  try {
    return { status: 200, body: applicaPulizia(parsed.data.ids, parsed.data.conferma, da) };
  } catch (e) {
    if (e instanceof ErroreConferma) return errore(400, e.message);
    if (e instanceof ErroreApplica) {
      console.error("[hosts] pulizia, applica interrotta:", nomeErrore(e.cause),
        e.hostIdFallito !== null ? `all'host #${e.hostIdFallito}` : "alla cancellazione dell'archivio scaduto",
        `(${e.archiviati.length} archiviati, ${e.nonArchiviati.length} ancora fra gli host)`);
      return {
        status: 500,
        body: { error: e.message, archiviati: e.archiviati, nonArchiviati: e.nonArchiviati, nonPiuCandidati: e.nonPiuCandidati },
      };
    }
    throw e;
  }
}

/** GET /api/hosts/archivio — righe archiviate e non recuperate (più recenti prima, al massimo 500) e quante sono in tutto. */
export function rispostaArchivio(): RispostaRotta {
  return { status: 200, body: listaArchivio() };
}

/** POST /api/hosts/archivio/[id]/recupera — 400 su id storto, 409 col motivo se il recupero si rifiuta. */
export function rispostaRecupera(idGrezzo: string, da: string): RispostaRotta {
  const id = parseControllerId(idGrezzo);
  if (id === null) return errore(400, "Id della riga d'archivio non valido");
  const esito = recuperaHost(id, da);
  return { status: esito.ok ? 200 : 409, body: esito };
}

/** GET /api/hosts/[id]/ip-precedenti — gli IP che il MAC dell'host ha avuto prima (storico e archivio). */
export function rispostaIpPrecedenti(idGrezzo: string): RispostaRotta {
  const id = parseControllerId(idGrezzo);
  if (id === null) return errore(400, "Id dell'host non valido");
  return { status: 200, body: { righe: ipPrecedentiDi(id) } };
}
