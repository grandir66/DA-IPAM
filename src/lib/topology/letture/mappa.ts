/**
 * L'interruttore della mappa nuova (spec topologia §13.11.4, T3.7; forma del §13.5.6): per cliente, in tenant_settings del
 * DB del cliente, valore `{"acceso": true, "da": "<utente>", "il": "<UTC>"}`. Nasce spento (D4): chiave assente, valore
 * rovinato o `acceso` diverso da `true` = la mappa di T1. Lo scrive solo `PUT /api/topology/settings/mappa` (un admin);
 * nessun codice lo accende da solo.
 */
import { leggiStatoChiave, scriviStatoChiave, type StatoInterruttore } from "./interruttori";

export const CHIAVE_MAPPA_CAVI = "topologia.mappa.cavi";

export function leggiMappaCavi(): StatoInterruttore {
  return leggiStatoChiave(CHIAVE_MAPPA_CAVI);
}

export function mappaCaviAccesa(): boolean {
  return leggiMappaCavi().acceso;
}

/** Accende o spegne (solo un admin, dalla rotta PUT). Spento si scrive comunque, con chi e quando: resta la storia. */
export function scriviMappaCavi(acceso: boolean, da: string, adesso: Date = new Date()): StatoInterruttore {
  return scriviStatoChiave(CHIAVE_MAPPA_CAVI, acceso, da, adesso);
}
