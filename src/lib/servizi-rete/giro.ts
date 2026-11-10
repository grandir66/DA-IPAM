/**
 * Giro delle sonde sui servizi di rete di un tenant: allinea le porte già note, poi
 * sonda in parallelo (tetto di connessioni) e salva dopo ogni porta, così la pagina
 * vede i risultati mentre il giro va avanti e un'interruzione non perde il lavoro fatto.
 *
 * Con `porteComuni` (rete appena confermata dal trunk, Riccardo 09/11: «Sì, alla conferma»)
 * prima prova le porte TCP più comuni sugli host della rete, che dal giro ARP arrivano
 * senza porte note: solo connessione e chiusura, niente nmap.
 *
 * Un giro per tenant alla volta. Gira dentro il contesto del tenant (`withTenant`):
 * AsyncLocalStorage lo porta attraverso gli `await`.
 */
import {
  withTenant,
  allineaServiziRete,
  getPorteServiziDaSondare,
  salvaEsitoSondaServizio,
  getHostServiziDellaRete,
  registraPorteAperteServizi,
  getHostSenzaPorteServizi,
  segnaHostProvatoServizi,
  raccogliIdentita,
  riempiOsVuotiServizi,
  getPorteServiziDaControllare,
  salvaControlloServizioRete,
} from "@/lib/db-tenant";
import { portaAperta, sondaPorta, type EsitoSonda } from "./sonde";
import { portePerGiro } from "./porte";
import { PORTE_DA_NON_TOCCARE, PRODUTTORE_DI_CAMPO } from "@/lib/scanner/profili/sconosciuti";
import { TETTO_FABBRICA_PER_HOST } from "@/lib/rilievi/controlli";
import { PORTE_CONTROLLO, sondaControllo, type EsitoSondaControllo } from "@/lib/rilievi/sonde-controlli";

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
  /** «porte» mentre prova le porte comuni, «sonde» mentre legge le risposte. */
  fase: "porte" | "sonde" | null;
  totale: number;
  fatte: number;
  iniziato: string | null;
  finito: string | null;
  errore: string | null;
}

const PARALLELE = 32;
const PARALLELE_PORTE = 256;
// Su globalThis: rotte, discovery e `server.ts` possono avere istanze diverse del modulo, e la
// pagina deve vedere anche un giro partito dal programmatore (come `trunk/job.ts`).
const g = globalThis as typeof globalThis & { __giriServiziRete?: Map<string, StatoGiro> };
const giri = (g.__giriServiziRete ??= new Map<string, StatoGiro>());

export function statoGiro(tenant: string): StatoGiro {
  return giri.get(tenant) ?? { inCorso: false, networkId: null, fase: null, totale: 0, fatte: 0, iniziato: null, finito: null, errore: null };
}

export interface Strumenti {
  sonda: (ip: string, porta: number) => Promise<EsitoSonda | null>;
  aperta: (ip: string, porta: number) => Promise<boolean>;
  /** Assente nelle prove iniettate: i controlli veri non partono. */
  controllo?: (ip: string, porta: number, opz: { proveFabbrica: boolean; tentativiRestanti: number }) => Promise<EsitoSondaControllo>;
}

const STRUMENTI: Strumenti = {
  sonda: (ip, p) => sondaPorta(ip, p),
  aperta: (ip, p) => portaAperta(ip, p),
  controllo: (ip, p, opz) => sondaControllo(ip, p, opz),
};

/** Esegue `lavoro` su ogni voce con al massimo `n` in parallelo. */
async function inParallelo<T>(voci: T[], n: number, lavoro: (v: T) => Promise<void>): Promise<void> {
  let i = 0;
  const lavoratore = async () => {
    while (i < voci.length) await lavoro(voci[i++]);
  };
  await Promise.all(Array.from({ length: Math.min(n, voci.length) }, lavoratore));
}

/**
 * Avvia il giro e ritorna subito. `false` se ce n'è già uno in corso per il tenant.
 * `strumenti` è sostituibile nelle prove.
 */
export function avviaGiro(
  tenant: string,
  networkId: number | null,
  /** `porteComuni`: «rete» = gli host della rete (conferma dal trunk); «senza-porte» = gli host
   *  del tenant che non hanno porte note (giro automatico). */
  opzioni: {
    porteComuni?: "rete" | "senza-porte";
    strumenti?: Strumenti;
    porte?: number[];
    /** Login di fabbrica: solo da `/scans`, mai dai giri automatici. */
    proveFabbrica?: boolean;
  } = {},
): boolean {
  if (giri.get(tenant)?.inCorso) return false;
  const { sonda, aperta, controllo } = opzioni.strumenti ?? STRUMENTI;
  const proveFabbrica = opzioni.proveFabbrica === true;
  const stato: StatoGiro = { inCorso: true, networkId, fase: null, totale: 0, fatte: 0, iniziato: new Date().toISOString(), finito: null, errore: null };
  giri.set(tenant, stato);
  void withTenant(tenant, async () => {
    try {
      if (opzioni.porteComuni) {
        const candidati =
          opzioni.porteComuni === "rete" ? (networkId ? getHostServiziDellaRete(networkId) : []) : getHostSenzaPorteServizi();
        const host = candidati.filter((h) => !(h.vendor && PRODUTTORE_DI_CAMPO.test(h.vendor)));
        const elenco = opzioni.porte ?? portePerGiro();
        const prove = host.flatMap((h) => elenco.map((porta) => ({ h, porta })));
        stato.fase = "porte";
        stato.totale = prove.length;
        stato.fatte = 0;
        const trovate = new Map<number, number[]>();
        await inParallelo(prove, PARALLELE_PORTE, async ({ h, porta }) => {
          let si = false;
          try {
            si = await aperta(h.ip, porta);
          } catch {
            si = false;
          }
          if (si) trovate.set(h.host_id, [...(trovate.get(h.host_id) ?? []), porta]);
          stato.fatte += 1;
        });
        for (const h of host) {
          const porte = (trovate.get(h.host_id) ?? []).sort((a, b) => a - b);
          registraPorteAperteServizi(h.host_id, porte);
          segnaHostProvatoServizi(h.host_id, elenco.length, porte.length);
        }
      }
      allineaServiziRete(networkId ?? undefined);
      const coda = getPorteServiziDaSondare(networkId ?? undefined).filter((p) => !daSaltare(p.porta, p.vendor));
      stato.fase = "sonde";
      stato.totale = coda.length;
      stato.fatte = 0;
      await inParallelo(coda, PARALLELE, async (p) => {
        let esito: EsitoSonda | null = null;
        try {
          esito = await sonda(p.ip, p.porta);
        } catch {
          esito = null; // un errore di rete è «non risponde», non ferma il giro
        }
        salvaEsitoSondaServizio(p.host_id, p.porta, esito);
        stato.fatte += 1;
      });
      if (controllo) {
        const extra = getPorteServiziDaControllare(networkId ?? undefined, PORTE_CONTROLLO, true).filter(
          (p) => !daSaltare(p.porta, p.vendor),
        );
        const restanti = new Map<number, number>();
        await inParallelo(extra, PARALLELE, async (p) => {
          const budget = restanti.get(p.host_id) ?? TETTO_FABBRICA_PER_HOST;
          let esito: EsitoSondaControllo = { info: null, tentativiUsati: 0 };
          try {
            esito = await controllo(p.ip, p.porta, { proveFabbrica, tentativiRestanti: budget });
          } catch {
            esito = { info: null, tentativiUsati: 0 };
          }
          if (esito.tentativiUsati > 0) restanti.set(p.host_id, Math.max(0, budget - esito.tentativiUsati));
          if (esito.info) salvaControlloServizioRete(p.host_id, p.porta, p.protocollo, esito.info);
        });
      }
      raccogliIdentita();
      riempiOsVuotiServizi();
    } catch (e) {
      stato.errore = e instanceof Error ? e.message : String(e);
      console.error(`[servizi-rete] giro fallito per ${tenant}:`, e);
    } finally {
      stato.inCorso = false;
      stato.fase = null;
      stato.finito = new Date().toISOString();
    }
  });
  return true;
}
