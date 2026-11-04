/**
 * La richiesta per l'IT del cliente (piano accesso Windows, Task 8): i diritti che mancano davvero, con i comandi del
 * catalogo. Riccardo, 04/11/2026: «deve essere chiaro cosa abilitare per l'utente e cosa per la sicurezza del dominio».
 *
 * Mancante è lo stato «no», e «in parte»: su alcuni host manca davvero. Un diritto «non verificato» non si chiede, perché non
 * si sa se manca. Nel testo non c'è nessuna password (i comandi del catalogo usano nomi d'esempio e la password si digita al
 * momento) e nessun utente vero.
 *
 * La richiesta è una, con un blocco per famiglia e un account per blocco: le due famiglie sono due account separati, e chi
 * riceve il testo non li deve unire.
 * Puro: lo importano anche i componenti client.
 */
import { DIRITTI, FAMIGLIE_DIRITTI, REGOLA_ACCOUNT_SEPARATI, dirittoPerId, type DirittoRichiesto, type FamigliaDiritti } from "./diritti";

export interface StatoDiRiga {
  dirittoId: string;
  stato: "si" | "in_parte" | "no" | "non_verificato";
}

const FAMIGLIE: readonly FamigliaDiritti[] = ["utente_scansioni", "sicurezza_dominio"];

/** I nomi d'esempio dei comandi del catalogo: tutti, chi li legge li deve sostituire tutti. */
const NOMI_ESEMPIO: readonly string[] = [...FAMIGLIE.map((f) => FAMIGLIE_DIRITTI[f].accountEsempio), "DOMINIO", "dominio.fqdn"];

/** I diritti che mancano, nell'ordine del catalogo. Un id che non c'è lancia: è un errore di programmazione. */
export function dirittiMancanti(righe: readonly StatoDiRiga[]): DirittoRichiesto[] {
  const mancanti = new Set(righe.filter((r) => r.stato === "no" || r.stato === "in_parte").map((r) => dirittoPerId(r.dirittoId).id));
  return DIRITTI.filter((d) => mancanti.has(d.id));
}

/** «Mancano 2 per l'utente delle scansioni · 1 per la sicurezza del dominio»: i due account chiedono cose diverse. Vuoto se non manca niente. */
export function testoConteggioMancanti(mancanti: readonly DirittoRichiesto[]): string {
  const parti = FAMIGLIE.flatMap((f) => {
    const n = mancanti.filter((d) => d.famiglia === f).length;
    return n > 0 ? [`${n} per ${FAMIGLIE_DIRITTI[f].conArticolo}`] : [];
  });
  return parti.length === 0 ? "" : `${mancanti.length === 1 ? "Manca" : "Mancano"} ${parti.join(" · ")}`;
}

/** Il testo da copiare. Vuoto se non manca niente. */
export function testoRichiestaIt(mancanti: readonly DirittoRichiesto[]): string {
  if (mancanti.length === 0) return "";
  const account = FAMIGLIE.map((f) => `${FAMIGLIE_DIRITTI[f].accountEsempio} per ${FAMIGLIE_DIRITTI[f].conArticolo}`).join(" e ");
  const righe: string[] = [
    "Richiesta per l'IT: diritti da abilitare per DA-IPAM",
    "",
    `Servono due account separati: ${account}. ${REGOLA_ACCOUNT_SEPARATI}`,
    `Nei comandi i nomi (${NOMI_ESEMPIO.join(", ")}) sono d'esempio: vanno sostituiti con quelli del cliente.`,
  ];
  const comandiScritti = new Set<string>();
  for (const famiglia of FAMIGLIE) {
    const diFamiglia = mancanti.filter((d) => d.famiglia === famiglia);
    if (diFamiglia.length === 0) continue;
    righe.push("", `== ${FAMIGLIE_DIRITTI[famiglia].nome} — account ${FAMIGLIE_DIRITTI[famiglia].accountEsempio} ==`);
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
