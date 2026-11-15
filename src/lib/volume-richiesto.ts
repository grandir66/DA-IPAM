/**
 * Freno del volume cifrato sulle appliance (piano di sicurezza, P0-3, 15/11/2026). `scripts/volume-cifrato.sh`
 * lascia un segno in chiaro accanto all'app; se c'è, la cartella dati DEVE stare su un volume cifrato, altrimenti
 * `server.ts` non parte: a volume chiuso non nasce un database vuoto sul disco in chiaro. Il segno sta fuori dalla
 * cartella dati apposta: a volume chiuso deve restare leggibile.
 */
import fs from "node:fs";
import { unisci } from "@/lib/percorsi";
import { cifraturaCartella, type EsitoCifratura } from "@/lib/profilo-cifratura";

export const SEGNO_VOLUME = ".volume-cifrato";

export type EsitoVolume =
  | { richiesto: false }
  | { richiesto: true; ok: true; come: string }
  | { richiesto: true; ok: false; messaggio: string };

export function controlloVolume(
  cartellaApp: string,
  cartellaDati: string,
  cifratura: (dir: string) => EsitoCifratura = cifraturaCartella,
): EsitoVolume {
  if (!fs.existsSync(unisci(cartellaApp, SEGNO_VOLUME))) return { richiesto: false };
  const esito = cifratura(cartellaDati);
  if (esito.stato === "cifrato") return { richiesto: true, ok: true, come: esito.come };
  const perche = esito.stato === "in_chiaro" ? `è in chiaro: ${esito.come}` : `non so dire se è cifrata: ${esito.motivo}`;
  return {
    richiesto: true,
    ok: false,
    messaggio: `questa installazione vuole il volume cifrato (${SEGNO_VOLUME}) ma la cartella dati ${cartellaDati} ${perche}. Aprire il volume (scripts/volume-cifrato.sh apri) e riavviare.`,
  };
}
