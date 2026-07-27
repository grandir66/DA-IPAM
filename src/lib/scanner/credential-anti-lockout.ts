/**
 * Decisione anti-lockout per un singolo tentativo di autenticazione dentro
 * `credential_validate` (fase 1b credenziali, §7.5 della spec). Funzione
 * PURA e testabile senza DB né socket: isola la domanda "posso provare
 * QUESTA credenziale ORA, su QUESTO host?" da tutto il resto del loop
 * (I/O di rete, log, persistenza), che resta in `scanner/discovery.ts`.
 *
 * Il chiamante (discovery.ts) fornisce quattro stati indipendenti già
 * calcolati altrove — questa funzione applica solo l'ordine di priorità:
 *
 * 1. Host multihomed secondary → mai testare (dedup identico a
 *    `/api/devices/[id]/test`, che usa `getMultihomedStatus`).
 * 2. Credenziale `windows` su host senza ALCUN indicatore Windows → mai:
 *    prima della fase 1b `hasWindowsIndicator` era solo una condizione di
 *    ramo (il credType "windows" veniva semplicemente ignorato se falsa);
 *    qui diventa un divieto esplicito con motivo, cosi' il chiamante logga
 *    perché niente è stato tentato invece di un silenzio ambiguo.
 * 3. Credenziale in backoff persistito (Task 1 — `host_credentials.backoff_until`
 *    nel futuro): il backoff esponenziale calcolato da `recordCredentialFailure`
 *    decide da solo "quando riprovare", non lo decidiamo qui.
 * 4. Budget di RUN: N fallimenti CONSECUTIVI della stessa credenziale in
 *    QUESTA esecuzione (contatore in-memory, resettato da un successo)
 *    escludono la credenziale per il resto del run — indipendente dal
 *    backoff persistito, che potrebbe non essere ancora scattato entro la
 *    finestra dei primi minuti (200 host in un run possono esaurire il
 *    budget ben prima che il backoff esponenziale diventi rilevante).
 */

export const MAX_CONSECUTIVE_FAILURES_PER_RUN = 3;

export interface ShouldAttemptCredentialInput {
  /** credential_type normalizzato lowercase (es. "windows", "ssh", "linux", "snmp", "api"). */
  credType: string;
  /** Indicatori Windows sull'host (porte SMB/WinRM, classificazione, os_info) — calcolato dal chiamante. */
  hasWindowsIndicator: boolean;
  /** `host_credentials.backoff_until` persistito (Task 1), o null se assente/mai fallita. */
  backoffUntil: string | null;
  /** Fallimenti consecutivi di QUESTA credenziale in QUESTA esecuzione (contatore in-memory per run). */
  consecutiveFailures: number;
  /** Host secondary di un gruppo multihomed (dedup, vedi `getMultihomedStatus`). */
  isMultihomedSecondary: boolean;
  /** "now" in ISO-8601, iniettato per rendere la funzione deterministica nei test. */
  nowIso: string;
}

export interface ShouldAttemptCredentialResult {
  attempt: boolean;
  /** Motivo dello skip in italiano, per il log. Sempre presente quando attempt=false — mai troncamento silenzioso. */
  reason?: string;
}

export function shouldAttemptCredential(
  input: ShouldAttemptCredentialInput
): ShouldAttemptCredentialResult {
  if (input.isMultihomedSecondary) {
    return { attempt: false, reason: "host multihomed secondary (dedup: usare il primary)" };
  }
  if (input.credType === "windows" && !input.hasWindowsIndicator) {
    return { attempt: false, reason: "credenziale windows vietata: nessun indicatore Windows sull'host" };
  }
  if (input.backoffUntil && input.backoffUntil > input.nowIso) {
    return { attempt: false, reason: `credenziale in backoff fino a ${input.backoffUntil}` };
  }
  if (input.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES_PER_RUN) {
    return {
      attempt: false,
      reason: `budget esaurito: ${input.consecutiveFailures} fallimenti consecutivi in questa esecuzione, esclusa per il resto del run`,
    };
  }
  return { attempt: true };
}
