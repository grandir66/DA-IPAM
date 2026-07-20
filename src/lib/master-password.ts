/**
 * Password master dei moduli — un solo punto da ricordare.
 *
 * Ogni modulo installato dalla UI (MeshCentral, LibreNMS, …) crea la propria
 * utenza di servizio. Senza un riferimento comune ogni installazione genera una
 * password diversa e l'amministratore si ritrova a rincorrere N segreti sparsi,
 * uno per modulo. Qui la password vive in UN posto: la si cambia lì e i moduli
 * installati dopo la usano, senza doversela ricordare a memoria.
 *
 * DOVE VIVE: nel vault esistente `system_credentials` (hub.db, quindi valida per
 * tutta l'appliance), NON in una tabella nuova — cifrata at-rest con
 * ENCRYPTION_KEY come ogni altro segreto, con audit in `system_credential_events`.
 * Il plaintext non esce mai da `listCredentials`/`getCredential`: si legge solo
 * con `getCredentialSecrets`, e le rotte che lo espongono sono protette da
 * `requireAdmin` (/api/system-credentials/[id]/reveal).
 *
 * ATTENZIONE — cosa NON fa: cambiare la master NON riscrive all'indietro la
 * password dei moduli GIÀ installati. Propagare richiede, per ogni modulo, una
 * procedura di cambio password sul servizio remoto (per MeshCentral:
 * `--resetaccount` a container fermo + riscrittura di mc_config). Finché quei
 * ganci non esistono, `rotateMasterPassword()` riporta esplicitamente quali
 * moduli restano indietro, invece di lasciar credere a un allineamento che non
 * c'è. È la stessa cosa che fa `da-appliance sync-credentials` lato CLI, che
 * riallinea root SSH / DA-IPAM / Scanner-Edge / LibreNMS / Greenbone.
 */
import { randomBytes } from "crypto";
import {
  listCredentials,
  getCredentialSecrets,
  createCredential,
  updateCredential,
  type SystemCredential,
} from "./credentials-vault";

/** Etichetta riservata: identifica il record master dentro il vault. */
export const MASTER_LABEL = "Password master moduli";
/** `kind` riservato. La colonna è TEXT libera: nessuna migrazione necessaria. */
export const MASTER_KIND = "master" as const;

/**
 * Password generata: alfabeto senza caratteri ambigui (0/O, 1/l/I) e senza
 * quelli che complicano il quoting quando finiscono in CLI di terze parti.
 */
export function generatePassword(length = 24): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = randomBytes(length);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

/** Record master nel vault, se presente (mai il plaintext). */
export function getMasterRecord(): SystemCredential | null {
  return (
    listCredentials().find((c) => c.kind === MASTER_KIND && c.label === MASTER_LABEL) ?? null
  );
}

/**
 * Password master in chiaro. Uso INTERNO (installazione moduli): non va mai
 * restituita da una rotta senza `requireAdmin`.
 * Ritorna null se non è mai stata impostata.
 */
export function getMasterPassword(): string | null {
  const rec = getMasterRecord();
  if (!rec) return null;
  return getCredentialSecrets(rec.id)?.password ?? null;
}

/**
 * Password master, creandola se non esiste. È il punto di ingresso per gli
 * installer dei moduli: alla prima installazione la genera e la registra, dalle
 * successive riusa la stessa — così i moduli condividono un segreto solo.
 */
export function ensureMasterPassword(): string {
  const existing = getMasterPassword();
  if (existing) return existing;

  const password = generatePassword();
  const rec = getMasterRecord();
  if (rec) {
    // Record presente ma senza password (o non decifrabile: ENCRYPTION_KEY
    // cambiata). La riscriviamo invece di fallire.
    updateCredential(rec.id, { password });
  } else {
    createCredential({
      kind: MASTER_KIND,
      label: MASTER_LABEL,
      username: "admin",
      password,
      notes:
        "Password condivisa dalle utenze di servizio create durante l'installazione dei moduli. " +
        "Cambiarla qui NON riallinea i moduli già installati: usa Rigenera nella pagina Moduli.",
      launch_mode: "copy",
      sort_order: 0,
    });
  }
  return password;
}

/** Imposta/ruota la master. Non propaga: vedi il docblock in testa al file. */
export function setMasterPassword(password: string): void {
  if (!password || password.length < 8) {
    throw new Error("La password master deve essere di almeno 8 caratteri");
  }
  const rec = getMasterRecord();
  if (rec) {
    updateCredential(rec.id, { password });
    return;
  }
  createCredential({
    kind: MASTER_KIND,
    label: MASTER_LABEL,
    username: "admin",
    password,
    launch_mode: "copy",
    sort_order: 0,
  });
}
