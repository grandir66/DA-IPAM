/**
 * Budget di run condiviso per i tentativi di autenticazione dentro un singolo
 * scan (fase 1b credenziali, fix post-review Critical §catene detect senza
 * anti-lockout). Generalizza il pattern già scritto per `credential_validate`
 * (runFailStreak/runExcludedAt/runSkippedAfterExclusion + `gateCredential`)
 * cosi' i loop detect (`scanType:"windows"`, `scanType:"ssh"`, fase 4 di
 * `ipam_full`) riusano la STESSA logica invece di copiarla tre volte.
 *
 * Pura/testabile: nessun DB, nessuna rete. Il chiamante (discovery.ts) passa
 * un logger e, per ogni tentativo, lo stato già calcolato altrove (backoff
 * persistito via `resolveCredentialsFor(..., { includeBackoff: true })`,
 * indicatori Windows sull'host). Dopo l'esito reale del tentativo (I/O in
 * discovery.ts), il chiamante notifica `recordFailure`/`recordSuccess` per
 * aggiornare il contatore in-memory — lo stesso identico contatore che
 * `gate()` consulta alla chiamata successiva.
 */
import { shouldAttemptCredential, MAX_CONSECUTIVE_FAILURES_PER_RUN } from "./credential-anti-lockout";

export type CredentialRunBudgetLogger = (msg: string) => void;

export interface CredentialGateInput {
  /** IP dell'host, solo per il messaggio di log. */
  ip: string;
  credId: number;
  /** credential_type normalizzato lowercase (es. "windows", "ssh", "linux"). */
  credType: string;
  /** Indicatori Windows sull'host — false se irrilevante (es. chain SSH-only). */
  hasWindowsIndicator: boolean;
  /** `host_credentials.backoff_until` risolto per QUESTA credenziale/protocollo/porta, o null. */
  backoffUntil: string | null;
  /** "now" ISO-8601 iniettabile per test deterministici; default `new Date().toISOString()`. */
  nowIso?: string;
}

/**
 * Stato in-memory (per singola esecuzione di scan) dei fallimenti consecutivi
 * per credenziale + gate `shouldAttemptCredential` (Task 3) applicato prima di
 * ogni tentativo. Un'istanza per scan, condivisa fra tutti gli host del loop
 * (il budget è per credenziale nel RUN, non per host — §7.5).
 */
export class CredentialRunBudget {
  private readonly failStreak = new Map<number, number>();
  private readonly excludedAt = new Map<number, number>();
  private readonly skippedAfterExclusion = new Map<number, number>();
  private readonly denied = new Map<number, number>();
  private readonly wrongPassword = new Set<number>();
  /** Voce → prima voce vista dello stesso account: tutti i conti stanno su quella. */
  private readonly primaVoce = new Map<number, number>();
  private readonly voceDiAccount = new Map<string, number>();

  constructor(private readonly log: CredentialRunBudgetLogger) {}

  /**
   * Dichiara l'account della voce: due voci con lo stesso account hanno un conto solo. Il limite è sui logon errati di un
   * account, e due voci uguali raddoppierebbero quelli ammessi. Una voce non dichiarata conta da sola.
   */
  legaAccount(credId: number, account: string): void {
    if (this.primaVoce.has(credId)) return;
    const prima = this.voceDiAccount.get(account) ?? credId;
    this.voceDiAccount.set(account, prima);
    this.primaVoce.set(credId, prima);
  }

  private conto(credId: number): number {
    return this.primaVoce.get(credId) ?? credId;
  }

  /** Fallimenti consecutivi correnti di questa credenziale in questo run. */
  consecutiveFailures(credId: number): number {
    return this.failStreak.get(this.conto(credId)) ?? 0;
  }

  /**
   * true se il tentativo è ammesso. Se false, il motivo è già stato loggato
   * (mai troncamento silenzioso, §Task3) — il chiamante deve solo `continue`.
   */
  gate(input: CredentialGateInput): boolean {
    const consecutiveFailures = this.consecutiveFailures(input.credId);
    const decision = shouldAttemptCredential({
      credType: input.credType,
      hasWindowsIndicator: input.hasWindowsIndicator,
      backoffUntil: input.backoffUntil,
      consecutiveFailures,
      isMultihomedSecondary: false,
      nowIso: input.nowIso ?? new Date().toISOString(),
    });
    if (decision.attempt) return true;

    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES_PER_RUN) {
      const conto = this.conto(input.credId);
      if (!this.excludedAt.has(conto)) {
        this.excludedAt.set(conto, consecutiveFailures);
        this.log(`⛔ credenziale #${input.credId} esclusa per il resto del run: ${decision.reason}`);
      }
      this.skippedAfterExclusion.set(conto, (this.skippedAfterExclusion.get(conto) ?? 0) + 1);
    } else {
      this.log(`⏭ ${input.ip} cred#${input.credId}: ${decision.reason}`);
    }
    return false;
  }

  /** Fallimento reale osservato dal chiamante: incrementa lo streak. */
  recordFailure(credId: number): void {
    this.failStreak.set(this.conto(credId), this.consecutiveFailures(credId) + 1);
  }

  /** Successo reale osservato dal chiamante: azzera lo streak — SOLO qui. */
  recordSuccess(credId: number): void {
    this.failStreak.set(this.conto(credId), 0);
  }

  /**
   * Accesso negato con password verificata giusta: non è un logon errato, non consuma il budget e non tocca lo
   * streak (né lo azzera: non è un accesso riuscito). Alimenta solo `logSummary`.
   *
   * Incidente: 72729, 04/11/2026. 12 PC rifiutano un account di dominio con password giusta, perché mancano i
   * diritti e non la password. Contati come fallimenti, il budget avrebbe fermato la scansione dopo 3 macchine.
   */
  recordDenied(credId: number): void {
    const conto = this.conto(credId);
    this.denied.set(conto, (this.denied.get(conto) ?? 0) + 1);
  }

  /**
   * La verifica ha trovato la password errata: quel logon sbagliato è reale e va contato, una volta sola per voce
   * perché la verifica è una sola per esecuzione, per quanti host la leggano. Così il limite resta sui logon errati
   * veri anche se la stessa voce passa da un percorso che non usa la verifica.
   */
  recordWrongPassword(credId: number): void {
    const conto = this.conto(credId);
    if (this.wrongPassword.has(conto)) return;
    this.wrongPassword.add(conto);
    this.recordFailure(credId);
  }

  /**
   * Riepilogo finale a fine run: quante credenziali sono state escluse e
   * quanti tentativi risparmiati — mai un'esclusione silenziosa (§Task3).
   * Idempotente: non azzera lo stato, può essere chiamato una sola volta a
   * fine loop.
   */
  logSummary(): void {
    for (const [credId, failCountAtExclusion] of this.excludedAt) {
      const skipped = this.skippedAfterExclusion.get(credId) ?? 0;
      this.log(
        `⛔ Riepilogo budget: credenziale #${credId} esclusa dopo ${failCountAtExclusion} fallimenti consecutivi — ${skipped} tentativi successivi risparmiati in questo run.`
      );
    }
    for (const [credId, quanti] of this.denied) {
      this.log(
        `ℹ Riepilogo budget: credenziale #${credId} con password giusta, accesso negato da ${quanti} tentativi (diritti mancanti): non contano sul budget.`
      );
    }
  }
}
