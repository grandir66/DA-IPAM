/**
 * Il freno di ogni logon Windows fatto a mano, in un posto solo (piano accesso Windows, revisione finale).
 *
 * Un logon con una password sbagliata su un account di dominio conta per il blocco dell'account, per tutti. La scansione
 * ha i suoi freni. Usano questa funzione i logon a clic che provano una voce o un legame su un host: «Prova» del legame,
 * «Test» di una voce, la ricerca della credenziale, «Test» di un apparato (`GET /api/devices/[id]/test`) e la prova
 * prima di salvarlo (`POST /api/devices/test-provisional`). Resta fuori `/api/ad/kerberos`: è la diagnostica dell'integrazione
 * AD, con l'account dell'integrazione. Un account non di dominio passa senza freni. Nell'ordine:
 * 1. il ricordo delle password errate: se la password è già nota errata non si fa niente;
 * 2. 3 logon RIFIUTATI in 15 minuti per utente, non per voce (`utenteNormalizzato`): l'account è l'utente. Il posto si
 *    prenota prima del logon (il parallelo non passa tutto insieme) e chi chiama lo chiude con `chiudi(rifiutato)`: se il logon
 *    non è un rifiuto (riuscito, porta chiusa, nessun logon) il posto torna libero, e togliendo solo il proprio non azzera i
 *    rifiuti di altre password. Solo se chi chiama lo chiede: la ricerca su più host ha il suo conto, `CredentialRunBudget`;
 * 3. la verifica sul DC, un bind che non lascia effetti sull'host e dà la sola risposta certa: `errata` aggiorna il ricordo.
 *
 * Un rifiuto dell'host non aggiorna il ricordo: WMI e WinRM rispondono allo stesso modo a una password sbagliata e a un
 * diritto che manca, e `errata` toglierebbe la validazione a tutta la voce.
 */
import { getCurrentTenantCode } from "@/lib/db-tenant";
import { annullaTentativo, attesaRateLimitMs, getAttemptCount, prenotaTentativo } from "@/lib/rate-limit";
import { leggiErrore, puoNascondereUnRifiuto } from "@/lib/scanner/accesso-windows";
import { chiaveAccount, ricordoDelTenant, utenteNormalizzato, type RicordoErrate } from "@/lib/scanner/account-windows";
import { provaLdapDellaVoce, type EsitoPassword } from "@/lib/scanner/verifica-password-run";

/** I logon rifiutati a mano su un account, come il limite della scansione: oltre, l'account si blocca. */
export const MAX_PROVE_PER_ACCOUNT = 3;
export const FINESTRA_PROVE_MS = 15 * 60 * 1000;

export interface DipendenzeFreno {
  ricordo?: RicordoErrate;
  verificaPassword?: (username: string, password: string) => Promise<EsitoPassword>;
}

export interface OpzioniFreno {
  /** Il dominio dell'integrazione AD accesa, `null` se non ce n'è una. Si legge da chi chiama, che ha il suo accesso al database. */
  realm: string | null;
  /** Il limite di 3 prove in 15 minuti per utente. Di serie sì; la ricerca lo toglie perché ha il suo budget. */
  limitePerUtente?: boolean;
}

/** Perché il logon non parte: `errata` è la sola che dice qualcosa sulla password. */
export type MotivoFermata = "ricordo" | "limite" | "errata";

export type EsitoFreno =
  | { fermata: { motivo: MotivoFermata; messaggio: string } }
  | {
      password: EsitoPassword;
      /** Da chiamare a logon finito: `true` se l'host lo ha rifiutato (il posto resta preso), `false` altrimenti (il posto torna libero). */
      chiudi: (rifiutato: boolean) => void;
    };

/**
 * Il logon fallito con questo errore può essere un rifiuto? Porta chiusa, bridge non partito, errore del servizio non lo sono.
 * Con la password verificata giusta il rifiuto dell'host dice che mancano i diritti: la password non è sbagliata, non conta.
 */
export function logonRifiutato(err: unknown, passwordValida: boolean): boolean {
  const letto = leggiErrore(err);
  if (!puoNascondereUnRifiuto(letto)) return false;
  return !(passwordValida && letto.codice === "AUTH_REJECTED");
}

/**
 * Un logon con questo utente può bloccare un account di dominio? `DOM\mario` e `mario@dom.local` sempre. Con un'integrazione AD
 * accesa ogni utente: `winrm-bridge.py` fa `kinit utente@REALM` anche per `mario` e per `.\mario`. `realm` è il dominio
 * dell'integrazione, anche vuoto; `null` vuol dire nessuna integrazione accesa. Una sola definizione per tutti i freni.
 */
export function eAccountDiDominio(username: string, realm: string | null): boolean {
  return realm !== null || utenteNormalizzato(username).includes("@");
}

/** «tra circa 5 minuti», mai un conto che non torna: si arrotonda per eccesso. */
export function attesaInParole(ms: number): string {
  const minuti = Math.ceil(ms / 60_000);
  if (minuti <= 1) return "tra meno di un minuto";
  return `tra circa ${minuti} minuti`;
}

export async function freniDelLogon(username: string, password: string, deps: DipendenzeFreno, opzioni: OpzioniFreno): Promise<EsitoFreno> {
  if (!eAccountDiDominio(username, opzioni.realm)) return { password: "non_so", chiudi: () => undefined };
  const tenant = getCurrentTenantCode() ?? "DEFAULT";
  const ricordo = deps.ricordo ?? ricordoDelTenant(tenant);
  const chiave = chiaveAccount(username, password);
  if (ricordo.ricorda(chiave)) {
    return { fermata: { motivo: "ricordo", messaggio: "Password errata, già verificata di recente: nessun tentativo. Correggi la voce." } };
  }
  let chiudi = (_rifiutato: boolean): void => undefined;
  if (opzioni.limitePerUtente !== false) {
    const limite = `prova-legame:${tenant}:${utenteNormalizzato(username)}`;
    if (getAttemptCount(limite, FINESTRA_PROVE_MS) >= MAX_PROVE_PER_ACCOUNT) {
      const attesa = attesaInParole(attesaRateLimitMs(limite, MAX_PROVE_PER_ACCOUNT, FINESTRA_PROVE_MS));
      return {
        fermata: {
          motivo: "limite",
          messaggio: `Troppe prove su questo account: al massimo ${MAX_PROVE_PER_ACCOUNT} in 15 minuti, per non bloccarlo. Riprova ${attesa}.`,
        },
      };
    }
    // Controllo e prenotazione senza un `await` in mezzo: due richieste insieme non passano entrambe sull'ultimo posto.
    const segno = prenotaTentativo(limite);
    let chiuso = false;
    chiudi = (rifiutato) => {
      if (chiuso) return;
      chiuso = true;
      if (!rifiutato) annullaTentativo(limite, segno);
    };
  }
  const verifica = deps.verificaPassword ?? ((u: string, p: string) => provaLdapDellaVoce(0, { account: () => ({ username: u, password: p }) }));
  let esito: EsitoPassword;
  try {
    esito = await verifica(username, password);
  } catch (err) {
    console.warn(`[freno-logon-windows] verifica della password non riuscita: ${err instanceof Error ? err.name : "errore"}`);
    esito = "non_so";
  }
  if (esito !== "errata") return { password: esito, chiudi };
  // Il bind sul DC non è un logon sull'host, e il ricordo ferma le prove successive: il posto si libera.
  chiudi(false);
  ricordo.segna(chiave);
  return { fermata: { motivo: "errata", messaggio: "Password errata, verificata sul controller di dominio: nessun tentativo su questo host. Correggi la voce." } };
}
