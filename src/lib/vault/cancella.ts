/**
 * Cancellazione del segreto nel vault remoto (DA-Link) quando si elimina una credenziale (piano da-vault 2026-10-23,
 * revisione del 23/10, rilievo 7).
 *
 * `eliminaCredenzialeDb` è sincrona e il vault remoto no: la voce si cancella dal database e la cancellazione del
 * percorso in DA-Link parte subito dopo. Se fallisce (DA-Link giù, conflitto di versione) la voce resta cancellata e
 * l'avviso nel log lo dice col cliente e la voce: il percorso diventa un orfano, e `da-vault-migra-verso-dalink
 * --verifica` lo elenca. Niente ripieghi muti.
 *
 * Con il vault remoto spento non fa niente.
 */
import { nomeBackendRemoto, statoVaultProcesso, vaultRemotoAcceso } from "./stato";
import { ErroreVault } from "./tipi";

const incorso = new Set<Promise<void>>();

/** Avvia la cancellazione del percorso; `chi` = «cliente#voce» per il log. Non lancia mai. */
export function cancellaDalVaultRemoto(percorso: string, chi: string): void {
  if (!vaultRemotoAcceso()) return;
  const store = statoVaultProcesso().remoto;
  if (!store) {
    console.warn(
      `[vault] credenziale ${chi} cancellata ma il vault remoto non è avviato: il suo segreto resta lì (orfano, lo elenca da-vault-migra-verso-dalink --verifica)`,
    );
    return;
  }
  const p: Promise<void> = store
    .delete(percorso)
    .catch((e: unknown) => {
      console.warn(
        `[vault] credenziale ${chi} cancellata ma il suo segreto in ${nomeBackendRemoto()} no (${e instanceof ErroreVault ? e.codice : "errore"}): ` +
          "percorso orfano, lo elenca da-vault-migra-verso-dalink --verifica",
      );
    })
    .finally(() => {
      incorso.delete(p);
    });
  incorso.add(p);
}

/** Aspetta le cancellazioni in corso (per le prove e per uno spegnimento ordinato). */
export async function attendiCancellazioniRemote(): Promise<void> {
  await Promise.allSettled([...incorso]);
}
