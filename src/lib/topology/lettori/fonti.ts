/**
 * I valori delle colonne del DB in fatti neutri, per il modello per cavo (spec topologia §13.4.4: la logica di cavi/ non
 * nomina prodotti né i valori che li nominano, prova I37). Qui stanno le fonti dei vicini e dei fatti («device», «unifi»,
 * «ssh», «snmp», «host»; «controller» per i fatti) e i protocolli («lldp», «cdp», «mndp», «unknown») come li scrivono i
 * lettori, e le capacità annunciate che dicono «radio».
 */
import type { Classe, Lettore } from "@/lib/topology/cavi/prove";

/** La fonte con cui il controller scrive i vicini (device_neighbors.source). */
export const FONTE_CONTROLLER = "unifi";

export function lettoreDellaFonte(fonte: string): Lettore {
  switch (fonte) {
    case "unifi":
    case "controller":
      return "controller";
    case "snmp":
      return "snmp";
    case "host":
      return "host";
    case "manual":
      return "persona";
    default:
      return "apparato"; // device, ssh
  }
}

/**
 * La classe di un annuncio (spec §13.5.2): LLDP e CDP scritti come tali non attraversano un apparato gestito; «mndp» (che il
 * lettore di un MikroTik scrive anche per il CDP che attraversa gli switch, e SNMP per il CDP fra marche diverse) sì. Un
 * valore sconosciuto vale come LLDP, come nel modello di oggi (`unknown`).
 */
export function classeDelProtocollo(protocollo: string): Extract<Classe, "annuncio_collegamento" | "annuncio_segmento"> {
  return protocollo === "mndp" ? "annuncio_segmento" : "annuncio_collegamento";
}

/** Il protocollo in parole, per le frasi (mai per le regole): «discovered_by» dice quale, quando c'è (T2). */
export function dettoDelProtocollo(protocollo: string, discoveredBy: string | null): string {
  if (protocollo === "lldp" || protocollo === "unknown") return "LLDP";
  if (protocollo === "cdp") return "CDP";
  const elenco = (discoveredBy ?? "").split(",").map((s) => s.trim().toLowerCase()).filter((s) => s !== "");
  if (elenco.includes("cdp") && !elenco.includes("mndp")) return "CDP inoltrato";
  if (elenco.includes("mndp") && !elenco.includes("cdp")) return "MNDP";
  return "un annuncio di rete (MNDP o CDP)";
}

/** Le due radio di un ponte (spec §13.7.6, punto 3): capacità LLDP «WLAN» (o «station»), oppure «bridge» senza «router». */
export function eRadioDalleCapacita(capacita: string | null): boolean {
  const c = new Set((capacita ?? "").split(",").map((x) => x.trim().toLowerCase()).filter((x) => x !== ""));
  return c.has("wlan-ap") || c.has("wlan") || c.has("station") || (c.has("bridge") && !c.has("router"));
}

/**
 * Il gruppo di un fascio come sta in `lag_group`: il nome dell'interfaccia del fascio (scritto dal lettore che la legge dal
 * nome), oppure «if:<indice>» quando il lettore lo dice per indice dell'interfaccia (SNMP). Restituisce l'indice, o null se
 * il gruppo è un nome. Chi lo usa lo traduce col nome dell'interfaccia, così i due modi dicono la stessa cosa (§13.8.3, punto 1).
 */
export function indiceDelFascio(gruppo: string | null): number | null {
  const m = gruppo === null ? null : /^if:(\d+)$/.exec(gruppo);
  return m ? Number(m[1]) : null;
}
