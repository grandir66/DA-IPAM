/**
 * La sezione «Apparati e lettura dei dati» della pagina del modulo LibreNMS (piano 2026-10-22 LibreNMS, task 8, tavola L5):
 * i testi di ogni parte, dei rifiuti e delle liste lunghe. Modulo puro.
 */
import type { LetturaParte, Parte } from "@/lib/integrations/librenms-fonte";

export const ETICHETTA_PARTE: Readonly<Record<Parte, string>> = {
  apparati: "Apparati", porte: "Porte", vicini: "Vicini", vlan: "VLAN", mac_porta: "MAC per porta", arp: "ARP", sensori: "Sensori", inventario: "Inventario",
};
export const ORDINE_PARTI: readonly Parte[] = ["apparati", "porte", "vicini", "vlan", "mac_porta", "arp", "sensori", "inventario"];

export type TonoParte = "ok" | "att" | "nd";
export interface StatoParte { tono: TonoParte; segno: string; testo: string }

/** «http_500» → «HTTP 500»; gli altri codici (`forma`, `timeout`…) restano come sono. */
export function codiceLeggibile(codice: string | null): string {
  const m = /^http_(\d+)$/.exec(codice ?? "");
  return m ? `HTTP ${m[1]}` : (codice ?? "?");
}

/** L'esito di una parte: letta ✓, «non so» ▲ (le righe di prima restano), mai letta –. */
export function statoParte(l: LetturaParte): StatoParte {
  if (l.esito === "letto") return { tono: "ok", segno: "✓", testo: "letta" };
  if (l.esito === "non_so") {
    return { tono: "att", segno: "▲", testo: `non so (${codiceLeggibile(l.codice)})${l.letto_il ? ": restano le righe di prima" : ""}` };
  }
  return { tono: "nd", segno: "–", testo: "mai letta" };
}

/** Il motivo breve di un rifiuto, dal codice; il testo di LibreNMS resta com'è, sotto. */
export function motivoRifiuto(codice: string): string {
  switch (codice) {
    case "snmp_non_risponde": return "SNMP non risponde";
    case "gia_presente": return "già presente in LibreNMS";
    default: return "rifiutato";
  }
}

export const RIGHE_VISIBILI = 10;

/** Le prime `RIGHE_VISIBILI` righe di una lista lunga, o tutte se si è chiesto di vederle. */
export function visibili<T>(righe: T[], tutte: boolean): { mostrate: T[]; altre: number } {
  if (tutte || righe.length <= RIGHE_VISIBILI) return { mostrate: righe, altre: 0 };
  return { mostrate: righe.slice(0, RIGHE_VISIBILI), altre: righe.length - RIGHE_VISIBILI };
}
