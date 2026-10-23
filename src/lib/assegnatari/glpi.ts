/**
 * L'ultimo utente dell'inventario GLPI come presenza sul PC (piano 2026-10-23-assegnatari-da-ad, passo 3). Si chiama
 * dalla rotta di ingresso dentro il contesto del cliente; un errore si scrive nel journal e non ferma l'ingresso.
 */
import { schemaAssegnatariAdPresente } from "@/lib/db-tenant";
import { eAccountDiSistema, normalizzaAccount } from "./account";
import { dbCliente, registraAccessi } from "./db";

export function registraUtenteGlpi(hostId: number, ultimoUtente: string | null | undefined): void {
  try {
    const account = normalizzaAccount(ultimoUtente);
    if (!account || eAccountDiSistema(account)) return;
    const db = dbCliente();
    if (!schemaAssegnatariAdPresente(db)) return;
    const ora = new Date().toISOString().replace("T", " ").slice(0, 19);
    registraAccessi(db, [{ hostId, account, fonte: "glpi", giorno: ora.slice(0, 10), conteggio: 1, ultimo: ora }], "presenza");
  } catch (e) {
    console.error("[assegnatari] utente GLPI non registrato:", e instanceof Error ? e.message : e);
  }
}
