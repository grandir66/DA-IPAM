/**
 * La risposta della pagina «Servizi di rete»: una pagina di servizi coi loro rilievi e il triage,
 * più gruppi, indicatori, conteggi per tipo e barre per rete calcolati sugli stessi dati.
 * La usano la rotta `/api/servizi-rete` e il primo caricamento della pagina: una copia sola.
 * Va chiamata dentro il contesto del tenant.
 */
import { getConteggiServiziRete, getServiziReteTutti, getTriageRilievi } from "@/lib/db-tenant";
import type { ConteggiServiziRete } from "./db";
import {
  barreReteServizi,
  conteggiPerTipo,
  eCidr,
  filtraServizi,
  indicatoriServizi,
  preparaServizi,
  raggruppaServizi,
  RAGGRUPPAMENTI_SERVIZI,
  SEGNALI,
  TIPI_SERVIZIO,
  type BarraReteServizi,
  type GruppoServizi,
  type IndicatoriServizi,
  type RaggruppamentoServizi,
  type Segnale,
  type ServizioVista,
  type TipoServizio,
} from "./viste";

export interface RichiestaServiziRete {
  q?: string;
  networkId?: number;
  hostId?: number;
  porta?: number;
  prodotto?: string;
  tipo?: string;
  segnale?: string;
  raggruppa?: string;
  conRilievi?: boolean;
  limit: number;
  pagina: number;
}

export interface ElencoServiziRete {
  righe: ServizioVista[];
  totale: number;
  /** I conteggi di prima (li legge il riquadro della rete): non seguono i filtri della pagina. */
  conteggi: ConteggiServiziRete;
  /** Seguono tutti i filtri tranne il segnale, così da un segnale si passa a un altro. */
  indicatori: IndicatoriServizi;
  /** Seguono tutti i filtri tranne il tipo. */
  perTipo: Record<TipoServizio, number>;
  /** Seguono tutti i filtri tranne la rete. */
  perRete: BarraReteServizi[];
  /** Presente solo se chiesto (`raggruppa=…`). */
  gruppi?: GruppoServizi[];
  /** Vero se il tenant ha più servizi del tetto letto: i numeri sono per difetto. */
  parziale: boolean;
}

const fra = <T extends string>(valori: readonly T[], v: string | undefined): T | undefined =>
  v && (valori as readonly string[]).includes(v) ? (v as T) : undefined;

export function elencoServiziRete(r: RichiestaServiziRete): ElencoServiziRete {
  const q = r.q?.trim() || undefined;
  const cidr = eCidr(q) ? q : undefined;
  const { righe: grezze, parziale } = getServiziReteTutti({
    q: cidr ? undefined : q,
    hostId: r.hostId,
    porta: r.porta,
    prodotto: r.prodotto || undefined,
  });
  const tutte = preparaServizi(grezze);
  const tipo = fra<TipoServizio>(TIPI_SERVIZIO, r.tipo);
  const segnale = fra<Segnale>(SEGNALI, r.segnale);
  const per = fra<RaggruppamentoServizi>(RAGGRUPPAMENTI_SERVIZI, r.raggruppa);
  const rete = r.networkId;
  const conRilievi = r.conRilievi;

  const finali = filtraServizi(tutte, { rete, tipo, segnale, cidr, conRilievi });
  const pagina = per ? [] : finali.slice((r.pagina - 1) * r.limit, r.pagina * r.limit);
  const triage = getTriageRilievi(pagina.flatMap((s) => s.rilievi.map((x) => x.chiave)));
  for (const s of pagina) {
    for (const x of s.rilievi) {
      const t = triage[x.chiave];
      if (t) x.triage = { stato: t.stato, nota: t.nota, aggiornato_il: t.aggiornato_il, aggiornato_da: t.aggiornato_da };
    }
  }
  return {
    righe: pagina,
    totale: finali.length,
    conteggi: getConteggiServiziRete(rete),
    indicatori: indicatoriServizi(filtraServizi(tutte, { rete, tipo, cidr, conRilievi })),
    perTipo: conteggiPerTipo(filtraServizi(tutte, { rete, segnale, cidr, conRilievi })),
    perRete: barreReteServizi(filtraServizi(tutte, { tipo, segnale, cidr, conRilievi })),
    gruppi: per ? raggruppaServizi(finali, per) : undefined,
    parziale,
  };
}
