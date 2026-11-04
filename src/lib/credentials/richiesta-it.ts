/**
 * La richiesta per l'IT del cliente (piano accesso Windows, Task 8): i diritti che mancano davvero, con i comandi del
 * catalogo. Riccardo, 04/11/2026: «deve essere chiaro cosa abilitare per l'utente e cosa per la sicurezza del dominio».
 *
 * Mancante è solo lo stato «no»: un diritto «non verificato» non si chiede, perché non si sa se manca. Nel testo non c'è
 * nessuna password (i comandi del catalogo usano nomi d'esempio e la password si digita al momento) e nessun utente vero.
 * Puro: lo importano anche i componenti client.
 */
import { DIRITTI, FAMIGLIE_DIRITTI, dirittoPerId, type DirittoRichiesto } from "./diritti";

export interface StatoDiRiga {
  dirittoId: string;
  stato: "si" | "no" | "non_verificato";
}

/** I diritti dello stato «no», nell'ordine del catalogo. Un id che non c'è lancia: è un errore di programmazione. */
export function dirittiMancanti(righe: readonly StatoDiRiga[]): DirittoRichiesto[] {
  const mancanti = new Set(righe.filter((r) => r.stato === "no").map((r) => dirittoPerId(r.dirittoId).id));
  return DIRITTI.filter((d) => mancanti.has(d.id));
}

/** Il testo da copiare. Vuoto se non manca niente. */
export function testoRichiestaIt(mancanti: readonly DirittoRichiesto[]): string {
  if (mancanti.length === 0) return "";
  const righe: string[] = [
    "Richiesta per l'IT: diritti da abilitare per DA-IPAM",
    "",
    "Servono questi diritti per l'account di DA-IPAM. Nei comandi i nomi (svc-ipam, DOMINIO) sono d'esempio: vanno sostituiti con quelli del cliente.",
  ];
  const comandiScritti = new Set<string>();
  for (const famiglia of ["utente_scansioni", "sicurezza_dominio"] as const) {
    const diFamiglia = mancanti.filter((d) => d.famiglia === famiglia);
    if (diFamiglia.length === 0) continue;
    righe.push("", `== ${FAMIGLIE_DIRITTI[famiglia].nome} ==`);
    for (const d of diFamiglia) {
      righe.push("", `- ${d.funzione}: ${d.abilitare} (${d.dove})`);
      if (d.comandoIt && !comandiScritti.has(d.comandoIt)) {
        comandiScritti.add(d.comandoIt);
        righe.push("", d.comandoIt);
      }
    }
  }
  return righe.join("\n");
}
