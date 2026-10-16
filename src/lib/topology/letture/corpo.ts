/**
 * Il corpo delle PUT degli interruttori della topologia (spec §13.5.6 per le letture di T2, §13.11.4 per la mappa nuova di
 * T3): Zod strict, poi i controlli nello stesso ordine della rotta di T2 — la lettura che questa versione sa fare, poi lo
 * schema di T2, chiesto solo per accendere (spegnere si può sempre). Logica pura: lo schema arriva da fuori, così le prove
 * di comportamento (M6 della revisione finale di T2) non hanno bisogno né del DB né della sessione.
 */
import { z } from "zod";
import { LETTURE, LETTURE_DISPONIBILI, type Lettura } from "./interruttori";

export type DecisioneCorpo<T> = { ok: true; dati: T } | { ok: false; status: 400 | 409; error: string };

const RICHIESTA_NON_VALIDA = "Richiesta non valida";
const ACCESO = z.boolean({ error: "Indica se accendere (true) o spegnere (false)" });

// L'errore dell'oggetto vale per un corpo che non è un oggetto e per un campo in più (strict): in italiano, non il
// messaggio inglese predefinito di Zod.
const CorpoLetture = z.object({
  lettura: z.enum(LETTURE, { error: "Lettura sconosciuta" }),
  acceso: ACCESO,
}, { error: RICHIESTA_NON_VALIDA }).strict();

const CorpoMappa = z.object({ acceso: ACCESO }, { error: RICHIESTA_NON_VALIDA }).strict();

function errore(issues: ReadonlyArray<{ message: string }>): { ok: false; status: 400; error: string } {
  return { ok: false, status: 400, error: issues[0]?.message || RICHIESTA_NON_VALIDA };
}

export interface DipendenzeLetture {
  schemaPresente: () => boolean;
  /** Le letture che questa versione sa fare; assente = LETTURE_DISPONIBILI. Le prove lo restringono: con tutte e quattro
   *  disponibili (Task 7 di T2) il ramo «non disponibile» non avrebbe più una lettura vera con cui provarlo. */
  disponibili?: ReadonlySet<Lettura>;
}

export function decidiCorpoLetture(raw: unknown, dip: DipendenzeLetture): DecisioneCorpo<{ lettura: Lettura; acceso: boolean }> {
  const p = CorpoLetture.safeParse(raw);
  if (!p.success) return errore(p.error.issues);
  const { lettura, acceso } = p.data;
  if (acceso && !(dip.disponibili ?? LETTURE_DISPONIBILI).has(lettura)) {
    return { ok: false, status: 400, error: "Questa lettura non è disponibile in questa versione" };
  }
  if (acceso && !dip.schemaPresente()) {
    return { ok: false, status: 409, error: "Letture in più non disponibili: lo schema di questo cliente non è aggiornato" };
  }
  return { ok: true, dati: { lettura, acceso } };
}

export function decidiCorpoMappa(raw: unknown, dip: { schemaPresente: () => boolean }): DecisioneCorpo<{ acceso: boolean }> {
  const p = CorpoMappa.safeParse(raw);
  if (!p.success) return errore(p.error.issues);
  const { acceso } = p.data;
  if (acceso && !dip.schemaPresente()) {
    return { ok: false, status: 409, error: "Mappa nuova non disponibile: lo schema di questo cliente non è aggiornato" };
  }
  return { ok: true, dati: { acceso } };
}
