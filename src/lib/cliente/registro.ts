import type { ContestoCliente } from "./contesto";
import { schedaApparati } from "./schede/apparati";
import { schedaDaSistemare } from "./schede/da-sistemare";
import { schedaDominio } from "./schede/dominio";
import { schedaLogSicurezza } from "./schede/log-sicurezza";
import { schedaMonitoring } from "./schede/monitoring";
import { schedaReti } from "./schede/reti";

export type Gravita = "grave" | "attenzione" | "nota";
export type StatoRiquadro = "a_posto" | "attenzione" | "grave";

export interface VoceAttenzione {
  gravita: Gravita;
  testo: string;
  href: string;
  /** Titolo della scheda, mostrato a destra della voce. */
  scheda: string;
}

export interface RiquadroCliente {
  numero: string;
  unita?: string;
  contesto: string;
  stato: StatoRiquadro;
  aperti: number;
}

export interface SchedaCliente {
  /** Segmento di URL: /cliente/<id>. */
  id: string;
  titolo: string;
  ordine: number;
  /** Nome di un'icona lucide-react. */
  icona: string;
  attiva(c: ContestoCliente): boolean | Promise<boolean>;
  riquadro(c: ContestoCliente): RiquadroCliente | Promise<RiquadroCliente>;
  attenzione(c: ContestoCliente): VoceAttenzione[] | Promise<VoceAttenzione[]>;
}

/** L'ordine a schermo è il campo `ordine`, non questo elenco. */
export const SCHEDE_CLIENTE: readonly SchedaCliente[] = [schedaReti, schedaMonitoring, schedaApparati, schedaDaSistemare, schedaDominio, schedaLogSicurezza];

const PESO_GRAVITA: Record<Gravita, number> = { grave: 0, attenzione: 1, nota: 2 };

/**
 * Schede attive, per `ordine`. Una scheda che lancia è scartata e l'errore
 * va in console.error: il resto della casa resta in piedi.
 */
export async function schedeAttive(
  c: ContestoCliente,
  schede: readonly SchedaCliente[] = SCHEDE_CLIENTE,
): Promise<SchedaCliente[]> {
  const attive: SchedaCliente[] = [];
  for (const scheda of schede) {
    try {
      if (await scheda.attiva(c)) attive.push(scheda);
    } catch (e) {
      console.error("[cliente] scheda", scheda.id, e instanceof Error ? e.message : String(e));
    }
  }
  return attive.sort((a, b) => a.ordine - b.ordine);
}

/** grave, attenzione, nota; a parità resta l'ordine d'arrivo. */
export function ordinaAttenzione(v: VoceAttenzione[]): VoceAttenzione[] {
  return v
    .map((voce, indice) => ({ voce, indice }))
    .sort((a, b) => PESO_GRAVITA[a.voce.gravita] - PESO_GRAVITA[b.voce.gravita] || a.indice - b.indice)
    .map((riga) => riga.voce);
}
