/**
 * Avvio del vault da `server.ts` (piano da-vault 2026-10-23). `server.ts` lo importa solo con un interruttore acceso
 * (`DA_VAULT_LOCALE=1` o `DA_VAULT_OPENBAO=1`): spenti di serie, l'avvio è quello di oggi.
 *
 * - vault locale: sblocco dallo slot TPM, altrimenti bloccato col motivo (banner e scansioni in pausa).
 */
import { avviaVaultLocale } from "./appliance";

export function avviaVault(): void {
  avviaVaultLocale();
}
