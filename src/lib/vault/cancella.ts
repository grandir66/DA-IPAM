/**
 * Cancellazione del segreto in OpenBao quando si elimina una credenziale (piano da-vault 2026-10-23, revisione del
 * 23/10, rilievo 7).
 *
 * `eliminaCredenzialeDb` è sincrona e OpenBao no: la voce si cancella dal database e la cancellazione dei METADATA del
 * percorso (`DELETE kv-domarc/metadata/<percorso>`, tutte le versioni) parte subito dopo. Se fallisce (OpenBao giù, policy
 * dell'AppRole senza `delete` sui metadata) la voce resta cancellata e l'avviso nel log lo dice col cliente e la voce:
 * il percorso diventa un orfano, e `da-vault-migra-openbao --verifica` lo elenca. Niente ripieghi muti.
 *
 * Con `DA_VAULT_OPENBAO` spento non fa niente.
 */
import { statoVaultProcesso, vaultOpenBaoAcceso } from "./stato";
import { ErroreVault } from "./tipi";

const incorso = new Set<Promise<void>>();

/** Avvia la cancellazione del percorso; `chi` = «cliente#voce» per il log. Non lancia mai. */
export function cancellaDaOpenBao(percorso: string, chi: string): void {
  if (!vaultOpenBaoAcceso()) return;
  const store = statoVaultProcesso().openbao;
  if (!store) {
    console.warn(`[vault] credenziale ${chi} cancellata ma OpenBao non è configurato: il suo segreto resta in OpenBao (orfano, lo elenca da-vault-migra-openbao --verifica)`);
    return;
  }
  const p: Promise<void> = store
    .delete(percorso)
    .catch((e: unknown) => {
      console.warn(
        `[vault] credenziale ${chi} cancellata ma il suo segreto in OpenBao no (${e instanceof ErroreVault ? e.codice : "errore"}): ` +
          "percorso orfano, lo elenca da-vault-migra-openbao --verifica",
      );
    })
    .finally(() => {
      incorso.delete(p);
    });
  incorso.add(p);
}

/** Aspetta le cancellazioni in corso (per le prove e per uno spegnimento ordinato). */
export async function attendiCancellazioniOpenBao(): Promise<void> {
  await Promise.allSettled([...incorso]);
}
