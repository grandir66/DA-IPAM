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
  ErroreApplica,
  ErroreConferma,
  GIORNI_ARCHIVIO_PRIMA_DI_CANCELLARE,
  ipPrecedentiDi,
  listaArchivio,
  recuperaHost,
} from "@/lib/hosts/pulizia-archivio";

export interface RispostaRotta { status: number; body: unknown }

const errore = (status: number, error: string): RispostaRotta => ({ status, body: { error } });

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

/** GET /api/hosts/pulizia — anteprima: cosa si archivierebbe e chi resta fuori, col perché. Non scrive niente. */
export function rispostaAnteprima(): RispostaRotta {
  const { candidati, esclusi } = candidatiPulizia();
  return {
    status: 200,
    body: { candidati, esclusi, giorni: GIORNI_ASSENZA_ARCHIVIO, giorniArchivio: GIORNI_ARCHIVIO_PRIMA_DI_CANCELLARE },
  };
}

/**
 * POST /api/hosts/pulizia — `{ ids, conferma }`: archivia i candidati di adesso fra gli `ids`. 400 su corpo storto o
 * conferma sbagliata (niente scritto); 500 con l'elenco per nome se l'archiviazione si interrompe a metà.
 */
export function rispostaApplica(corpo: unknown, da: string): RispostaRotta {
  const parsed = CorpoApplica.safeParse(corpo);
  if (!parsed.success) return errore(400, parsed.error.issues[0]?.message ?? "Richiesta non valida");
  try {
    return { status: 200, body: applicaPulizia(parsed.data.ids, parsed.data.conferma, da) };
  } catch (e) {
    if (e instanceof ErroreConferma) return errore(400, e.message);
    if (e instanceof ErroreApplica) {
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
