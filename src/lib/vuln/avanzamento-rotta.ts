/**
 * Il lavoro della rotta `/api/networks/[id]/edge-scan/avanzamento`, senza il rivestimento HTTP:
 * provabile contro un finto edge. Come la finestra, la GET risponde 200 con `stato`: «ok» (con i dati),
 * «nessuna» (la sonda risponde, la rete non ha scansioni aperte), «da_aggiornare» (sonda senza la
 * rotta), «sonda_assente» o «errore» col motivo. Sono stati della sonda, non guasti della rotta.
 */
import { leggiAvanzamento } from "@/lib/vuln/edge-subnet-bridge";

export interface RispostaRotta {
  status: number;
  body: unknown;
}

export async function leggiAvanzamentoRotta(networkId: number): Promise<RispostaRotta> {
  const a = await leggiAvanzamento(networkId);
  return { status: 200, body: a ?? { stato: "nessuna" } };
}
