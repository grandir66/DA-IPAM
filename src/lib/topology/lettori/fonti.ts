/**
 * I valori delle colonne del DB in fatti neutri, per il modello per cavo (spec topologia §13.4.4: la logica di cavi/ non
 * nomina prodotti né i valori che li nominano, prova I37). Qui stanno le fonti dei vicini e dei fatti («device», «unifi»,
 * «ssh», «snmp», «host»; «controller» per i fatti) e i protocolli («lldp», «cdp», «mndp», «unknown») come li scrivono i
 * lettori, e le capacità annunciate che dicono «radio» o «apparato di rete».
 */
import type { Classe, Lettore } from "@/lib/topology/cavi/prove";
import type { ModelDeviceRow } from "@/lib/topology/model-types";

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
 * Le fonti dei vicini che dicono «lo interroghiamo come apparato di rete» (prova di ruolo «legge vicini», spec §13.8.2):
 * l'apparato («device», e «ssh» del lettore che lo scrive via SSH), il controller («unifi», «controller») e SNMP. Non la
 * lettura dal lato dell'host («host»: un hypervisor letto come host). Elenco chiuso: una fonte nuova non diventa una prova di
 * ruolo senza una decisione (revisione del Task 3 di T3).
 */
const FONTI_DI_RETE: ReadonlySet<string> = new Set(["device", "ssh", FONTE_CONTROLLER, "controller", "snmp"]);
export function leggeViciniDiRete(fonte: string): boolean {
  return FONTI_DI_RETE.has(fonte);
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

/** Le capacità annunciate, come le scrivono i lettori: un elenco con virgole, minuscolo. */
function capacitaDi(capacita: string | null): Set<string> {
  return new Set((capacita ?? "").split(",").map((x) => x.trim().toLowerCase()).filter((x) => x !== ""));
}

/** Le due radio di un ponte (spec §13.7.6, punto 3): capacità LLDP «WLAN» (o «station»), oppure «bridge» senza «router». */
export function eRadioDalleCapacita(capacita: string | null): boolean {
  const c = capacitaDi(capacita);
  return c.has("wlan-ap") || c.has("wlan") || c.has("station") || (c.has("bridge") && !c.has("router"));
}

/**
 * Capacità annunciate che dicono «apparato di rete» (spec §13.8.2): bridge, router, AP («wlan-ap», e «wlan» come la legge
 * eRadioDalleCapacita). Nel formato dei lettori (elenco con virgole). Chi la usa la vale solo con il nome di sistema e mai per
 * un server o un hypervisor noto: lo dice la regola, non le capacità (cavi/ruolo.ts).
 */
export function eReteDalleCapacita(capacita: string | null): boolean {
  const c = capacitaDi(capacita);
  return c.has("bridge") || c.has("router") || c.has("wlan-ap") || c.has("wlan");
}

/**
 * Gli hypervisor censiti e letti: chi ha la scansione delle sue VM accesa (spec §11.5). È una prova del ruolo «hypervisor»
 * (§13.8.2, I65), come nel modello di oggi; la colonna ha il nome del prodotto, quindi si legge qui.
 */
export function ipervisoriLetti(devices: ReadonlyArray<Pick<ModelDeviceRow, "id" | "proxmox_scan">>): Set<string> {
  return new Set(devices.filter((d) => d.proxmox_scan === 1).map((d) => `dev:${d.id}`));
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
