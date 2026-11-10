/**
 * Chi le scansioni interne non toccano, per rete: gli impianti (IoT, OT, PLC: stesso filtro
 * dell'Edge, `eImpianto`) e gli host esclusi a mano nella proposta dell'Edge. Serve a `/scans`
 * per dirlo prima del lancio (Riccardo, 10/11/2026).
 */
import { getHostsByNetwork } from "@/lib/db";
import { impiantiDellaRete, type HostPerImpianti } from "./impianti-in-rete";
import { leggiEsclusi } from "./proposta/store";

export interface CautelaRete {
  network_id: number;
  impianti: number;
  esempi_impianti: string[];
  esclusi: number;
  esempi_esclusi: string[];
}

export function cautelaDelleReti(ids: readonly number[]): CautelaRete[] {
  return ids.map((id) => {
    const imp = impiantiDellaRete(getHostsByNetwork(id) as unknown as HostPerImpianti[]);
    const esclusi = leggiEsclusi(id);
    return {
      network_id: id,
      impianti: imp.host,
      esempi_impianti: imp.esempi,
      esclusi: esclusi.length,
      esempi_esclusi: esclusi.slice(0, 5).map((e) => [e.ip, e.nome].filter(Boolean).join(" ")),
    };
  });
}
