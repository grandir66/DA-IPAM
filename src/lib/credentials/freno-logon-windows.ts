/**
 * Il freno di ogni logon Windows fatto a mano, in un posto solo (piano accesso Windows, revisione finale).
 *
 * Un logon con una password sbagliata su un account di dominio conta per il blocco dell'account, per tutti. La scansione
 * ha i suoi freni; il pulsante «Prova» del legame, il pulsante «Test» di una voce e la ricerca della credenziale sono logon
 * veri a ogni clic, e li usano questa stessa funzione. Nell'ordine:
 * 1. il ricordo delle password errate: se la password è già nota errata non si fa niente;
 * 2. 3 prove in 15 minuti per utente, non per voce (`utenteNormalizzato`): l'account è l'utente. Solo se chi chiama lo chiede:
 *    la ricerca su più host ha il suo conto, `CredentialRunBudget`, e non deve consumare anche questo;
 * 3. la verifica sul DC, un bind che non lascia effetti sull'host e dà la sola risposta certa: `errata` aggiorna il ricordo.
 *
 * Un rifiuto dell'host non aggiorna il ricordo: WMI e WinRM rispondono allo stesso modo a una password sbagliata e a un
 * diritto che manca, e `errata` toglierebbe la validazione a tutta la voce.
 */
import { getCurrentTenantCode } from "@/lib/db-tenant";
import { attesaRateLimitMs, checkRateLimit } from "@/lib/rate-limit";
import { chiaveAccount, ricordoDelTenant, utenteNormalizzato, type RicordoErrate } from "@/lib/scanner/account-windows";
import { provaLdapDellaVoce, type EsitoPassword } from "@/lib/scanner/verifica-password-run";

/** Le prove a mano di un account, come il limite della scansione: oltre, l'account si blocca. */
export const MAX_PROVE_PER_ACCOUNT = 3;
export const FINESTRA_PROVE_MS = 15 * 60 * 1000;

export interface DipendenzeFreno {
  ricordo?: RicordoErrate;
  verificaPassword?: (username: string, password: string) => Promise<EsitoPassword>;
}

export interface OpzioniFreno {
  /** Il limite di 3 prove in 15 minuti per utente. Di serie sì; la ricerca lo toglie perché ha il suo budget. */
  limitePerUtente?: boolean;
}

/** Perché il logon non parte: `errata` è la sola che dice qualcosa sulla password. */
export type MotivoFermata = "ricordo" | "limite" | "errata";

export type EsitoFreno = { fermata: { motivo: MotivoFermata; messaggio: string } } | { password: EsitoPassword };

/** Una forma di utente di dominio (`DOM\mario`, `mario@dom.local`): solo questi possono bloccare un account per tutti. */
export function eUtenteDiDominio(username: string): boolean {
  return utenteNormalizzato(username).includes("@");
}

/** «tra circa 5 minuti», mai un conto che non torna: si arrotonda per eccesso. */
export function attesaInParole(ms: number): string {
  const minuti = Math.ceil(ms / 60_000);
  if (minuti <= 1) return "tra meno di un minuto";
  return `tra circa ${minuti} minuti`;
}

export async function freniDelLogon(username: string, password: string, deps: DipendenzeFreno = {}, opzioni: OpzioniFreno = {}): Promise<EsitoFreno> {
  const tenant = getCurrentTenantCode() ?? "DEFAULT";
  const ricordo = deps.ricordo ?? ricordoDelTenant(tenant);
  const chiave = chiaveAccount(username, password);
  if (ricordo.ricorda(chiave)) {
    return { fermata: { motivo: "ricordo", messaggio: "Password errata, già verificata di recente: nessun tentativo. Correggi la voce." } };
  }
  if (opzioni.limitePerUtente !== false) {
    const limite = `prova-legame:${tenant}:${utenteNormalizzato(username)}`;
    if (!checkRateLimit(limite, MAX_PROVE_PER_ACCOUNT, FINESTRA_PROVE_MS)) {
      const attesa = attesaInParole(attesaRateLimitMs(limite, MAX_PROVE_PER_ACCOUNT, FINESTRA_PROVE_MS));
      return {
        fermata: {
          motivo: "limite",
          messaggio: `Troppe prove su questo account: al massimo ${MAX_PROVE_PER_ACCOUNT} in 15 minuti, per non bloccarlo. Riprova ${attesa}.`,
        },
      };
    }
  }
  const verifica = deps.verificaPassword ?? ((u: string, p: string) => provaLdapDellaVoce(0, { account: () => ({ username: u, password: p }) }));
  let esito: EsitoPassword;
  try {
    esito = await verifica(username, password);
  } catch (err) {
    console.warn(`[freno-logon-windows] verifica della password non riuscita: ${err instanceof Error ? err.name : "errore"}`);
    esito = "non_so";
  }
  if (esito !== "errata") return { password: esito };
  ricordo.segna(chiave);
  return { fermata: { motivo: "errata", messaggio: "Password errata, verificata sul controller di dominio: nessun tentativo su questo host. Correggi la voce." } };
}
