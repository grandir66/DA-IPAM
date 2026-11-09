/**
 * Giro delle sonde sui servizi di rete di un tenant: allinea le porte già note, poi
 * sonda in parallelo (tetto di connessioni) e salva dopo ogni porta, così la pagina
 * vede i risultati mentre il giro va avanti e un'interruzione non perde il lavoro fatto.
 *
 * Un giro per tenant alla volta. Gira dentro il contesto del tenant (`withTenant`):
 * AsyncLocalStorage lo porta attraverso gli `await`.
 */
import {
  withTenant,
  allineaServiziRete,
  getPorteServiziDaSondare,
  salvaEsitoSondaServizio,
} from "@/lib/db-tenant";
import { sondaPorta, type EsitoSonda } from "./sonde";
import { PORTE_DA_NON_TOCCARE, PRODUTTORE_DI_CAMPO } from "@/lib/scanner/profili/sconosciuti";

/**
 * Freno: le porte di campo e di stampa non si sondano (sulla 9100 il nostro GET verrebbe
 * stampato), e nemmeno gli apparati di campo. Stesso elenco della ricognizione degli sconosciuti.
 */
export function daSaltare(porta: number, vendor: string | null): boolean {
  return PORTE_DA_NON_TOCCARE.has(porta) || (vendor !== null && PRODUTTORE_DI_CAMPO.test(vendor));
}

export interface StatoGiro {
  inCorso: boolean;
  networkId: number | null;
  totale: number;
  fatte: number;
  iniziato: string | null;
  finito: string | null;
  errore: string | null;
}

const PARALLELE = 32;
const giri = new Map<string, StatoGiro>();

export function statoGiro(tenant: string): StatoGiro {
  return giri.get(tenant) ?? { inCorso: false, networkId: null, totale: 0, fatte: 0, iniziato: null, finito: null, errore: null };
}

type Sonda = (ip: string, porta: number) => Promise<EsitoSonda | null>;

/**
 * Avvia il giro e ritorna subito. `false` se ce n'è già uno in corso per il tenant.
 * `sonda` è sostituibile nelle prove.
 */
export function avviaGiro(tenant: string, networkId: number | null, sonda: Sonda = (ip, p) => sondaPorta(ip, p)): boolean {
  if (giri.get(tenant)?.inCorso) return false;
  const stato: StatoGiro = { inCorso: true, networkId, totale: 0, fatte: 0, iniziato: new Date().toISOString(), finito: null, errore: null };
  giri.set(tenant, stato);
  void withTenant(tenant, async () => {
    try {
      allineaServiziRete(networkId ?? undefined);
      const coda = getPorteServiziDaSondare(networkId ?? undefined).filter((p) => !daSaltare(p.porta, p.vendor));
      stato.totale = coda.length;
      let i = 0;
      const lavoratore = async () => {
        while (i < coda.length) {
          const p = coda[i++];
          let esito: EsitoSonda | null = null;
          try {
            esito = await sonda(p.ip, p.porta);
          } catch {
            esito = null; // un errore di rete è «non risponde», non ferma il giro
          }
          salvaEsitoSondaServizio(p.host_id, p.porta, esito);
          stato.fatte += 1;
        }
      };
      await Promise.all(Array.from({ length: Math.min(PARALLELE, coda.length) }, lavoratore));
    } catch (e) {
      stato.errore = e instanceof Error ? e.message : String(e);
      console.error(`[servizi-rete] giro fallito per ${tenant}:`, e);
    } finally {
      stato.inCorso = false;
      stato.finito = new Date().toISOString();
    }
  });
  return true;
}
