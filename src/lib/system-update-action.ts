/**
 * L'azione di POST /api/system/update: `check`, `apply` o `restart`.
 *
 * Arriva in due forme, e la rotta le accetta tutte e due:
 *  - nell'indirizzo, `?action=apply` (banner degli aggiornamenti, update-checker.tsx);
 *  - nel corpo JSON, `{ "action": "apply" }` (Impostazioni → Aggiornamenti,
 *    updates-tab.tsx).
 * Fino al 12/10/2026 la rotta leggeva solo l'indirizzo, e «Aggiorna ora» di
 * Impostazioni riceveva 400 «Azione non supportata».
 *
 * Provata in src/lib/__tests__/system-update-action.test.ts.
 */
import { z } from "zod";

export const UPDATE_ACTIONS = ["check", "apply", "restart"] as const;
export type UpdateAction = (typeof UPDATE_ACTIONS)[number];

export type UpdateActionResult = { ok: true; action: UpdateAction } | { ok: false; error: string };

const CorpoSchema = z.object({ action: z.string().optional() });

function isUpdateAction(valore: string): valore is UpdateAction {
  return (UPDATE_ACTIONS as readonly string[]).includes(valore);
}

/**
 * L'azione dall'indirizzo (`query`, il valore di `?action=`) o dal corpo
 * (`corpo`, il testo della richiesta, vuoto se non c'è). Se ci sono tutte e due
 * devono coincidere: due azioni diverse sono un errore, non se ne sceglie una.
 */
export function readUpdateAction(query: string | null, corpo: string): UpdateActionResult {
  let dalCorpo: string | undefined;
  const testo = corpo.trim();
  if (testo !== "") {
    let json: unknown;
    try {
      json = JSON.parse(testo);
    } catch {
      return { ok: false, error: "Il corpo della richiesta non è JSON valido" };
    }
    const letto = CorpoSchema.safeParse(json);
    if (!letto.success) {
      return {
        ok: false,
        error: "Corpo della richiesta non valido: atteso un oggetto con «action» testuale",
      };
    }
    dalCorpo = letto.data.action;
  }

  const dallIndirizzo = query?.trim() || undefined;
  if (dallIndirizzo && dalCorpo && dallIndirizzo !== dalCorpo) {
    return {
      ok: false,
      error: `Azione indicata due volte in modo diverso: «${dallIndirizzo}» nell'indirizzo, «${dalCorpo}» nel corpo`,
    };
  }

  const azione = dallIndirizzo ?? dalCorpo;
  if (!azione) {
    return { ok: false, error: "Azione mancante: indicare action=check, apply o restart" };
  }
  if (!isUpdateAction(azione)) {
    return { ok: false, error: `Azione non supportata: «${azione}»` };
  }
  return { ok: true, action: azione };
}
