/**
 * Il conto dei logon rifiutati dalla ricerca della credenziale, fra una richiesta e l'altra (04/11/2026).
 *
 * Il client chiama `POST /api/hosts/trova-credenziale` una volta per host (`host_ids: [uno]`): il `CredentialRunBudget`
 * nasce a ogni richiesta, quindi il suo limite di 3 logon errati per utente non vale fra una richiesta e l'altra. Con la
 * password di dominio non verificabile (nessuna risposta certa dal DC) ogni host poteva fare i suoi logon errati, e su
 * un account di dominio è il blocco per tutti. Questo conto sta in memoria di processo, per tenant e utente normalizzato
 * (`utenteNormalizzato`: l'account è l'utente), con la stessa forma del ricordo delle password errate: finestra di 15
 * minuti, limite 3, scade da solo, stato su `globalThis` (scheduler e rotte possono caricare due copie del modulo).
 *
 * Un posto si PRENOTA prima del logon e si chiude con l'esito: le richieste del client possono arrivare insieme, e un
 * controllo fatto prima dell'`await` del logon le farebbe passare tutte. Esiti:
 * - `rifiutato`: il logon è partito ed è stato respinto: conta nella finestra;
 * - `riuscito`: l'account funziona, il conto riparte da zero;
 * - `nessunLogon`: il logon non è partito o non è una password sbagliata (host non raggiungibile, diritti mancanti con
 *   password verificata giusta, voce non provabile): il posto si libera, niente conta.
 *
 * Non conta la risposta `errata` del DC: quel bind lo ferma già il ricordo (una sola volta ogni 30 minuti per password) e
 * dopo non parte nessun logon sugli host.
 */
export const MAX_LOGON_RIFIUTATI = 3;
export const FINESTRA_LOGON_MS = 15 * 60 * 1000;

export type Prenotazione =
  | { ok: true; rifiutato: () => void; riuscito: () => void; nessunLogon: () => void }
  | { ok: false; /** Millisecondi prima che torni un posto; 0 se i posti sono tutti prenotati da logon ancora in corso. */ attesaMs: number };

interface StatoUtente {
  rifiuti: number[];
  inCorso: number;
}

export class ContoLogonRicerca {
  private readonly utenti = new Map<string, StatoUtente>();

  constructor(private readonly adesso: () => number = Date.now) {}

  /** Toglie i rifiuti fuori finestra e gli utenti ormai vuoti: la mappa non cresce. */
  private recenti(utente: string): StatoUtente {
    const ora = this.adesso();
    const stato = this.utenti.get(utente) ?? { rifiuti: [], inCorso: 0 };
    stato.rifiuti = stato.rifiuti.filter((t) => ora - t < FINESTRA_LOGON_MS);
    if (stato.rifiuti.length === 0 && stato.inCorso === 0) this.utenti.delete(utente);
    else this.utenti.set(utente, stato);
    return stato;
  }

  prenota(utente: string): Prenotazione {
    const stato = this.recenti(utente);
    if (stato.rifiuti.length + stato.inCorso >= MAX_LOGON_RIFIUTATI) {
      const attesaMs =
        stato.rifiuti.length >= MAX_LOGON_RIFIUTATI
          ? Math.max(0, stato.rifiuti[stato.rifiuti.length - MAX_LOGON_RIFIUTATI] + FINESTRA_LOGON_MS - this.adesso())
          : 0;
      return { ok: false, attesaMs };
    }
    stato.inCorso += 1;
    this.utenti.set(utente, stato);
    let chiusa = false;
    const chiudi = (agisci: (s: StatoUtente) => void) => () => {
      if (chiusa) return;
      chiusa = true;
      const s = this.utenti.get(utente) ?? stato;
      s.inCorso = Math.max(0, s.inCorso - 1);
      agisci(s);
      this.utenti.set(utente, s);
      this.recenti(utente);
    };
    return {
      ok: true,
      rifiutato: chiudi((s) => s.rifiuti.push(this.adesso())),
      riuscito: chiudi((s) => {
        s.rifiuti = [];
      }),
      nessunLogon: chiudi(() => undefined),
    };
  }
}

interface StatoDiProcesso {
  conti: Map<string, ContoLogonRicerca>;
}

const CHIAVE_STATO = Symbol.for("da-ipam.credentials.conto-logon-ricerca");

function stato(): StatoDiProcesso {
  const g = globalThis as Record<symbol, unknown>;
  if (!g[CHIAVE_STATO]) g[CHIAVE_STATO] = { conti: new Map() } satisfies StatoDiProcesso;
  return g[CHIAVE_STATO] as StatoDiProcesso;
}

export function contoLogonDelTenant(tenant: string): ContoLogonRicerca {
  const { conti } = stato();
  let conto = conti.get(tenant);
  if (!conto) {
    conto = new ContoLogonRicerca();
    conti.set(tenant, conto);
  }
  return conto;
}
