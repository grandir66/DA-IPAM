/**
 * Aggancio del triage all'elenco dei rilievi (10/11/2026). Funzione pura, senza DB: `elencoRilievi`
 * legge le righe di triage con una sola query (`getTriageRilievi`) e le passa qui. Ogni rilievo prende
 * il suo stato/nota per `chiaveTriage`; chi non ha una riga vale «Da rivedere» (`da_fare`). Restituisce
 * i conteggi per stato su tutte le righe date (la testata «N di M rivisti»).
 */
import type { RigaTriage, StatoTriage } from "@/lib/triage/db";
import type { RilievoUnito } from "./tipi";

export function agganciaTriage(
  righe: RilievoUnito[],
  mappa: Record<string, RigaTriage>,
): Record<StatoTriage, number> {
  const conteggi: Record<StatoTriage, number> = { da_fare: 0, in_corso: 0, fatto: 0, ignorato: 0 };
  for (const r of righe) {
    const t = mappa[r.chiaveTriage];
    if (t) {
      r.triage = { stato: t.stato, nota: t.nota, aggiornato_il: t.aggiornato_il, aggiornato_da: t.aggiornato_da };
      conteggi[t.stato] += 1;
    } else {
      r.triage = undefined;
      conteggi.da_fare += 1;
    }
  }
  return conteggi;
}
