/**
 * A che cosa appartiene un IP visto sul trunk (Riccardo, 08/11/2026: «troppi IP fuori da quelli
 * ufficiali… un'indicazione per gli IP ufficiali della VLAN e una per tutto il resto con i tag»).
 *
 * Misura del 08/11 (sola lettura): su un'appliance 73 IP su 1.002 cadevano nella rete dichiarata
 * per la loro VLAN, sull'hub 225 su 488. La causa principale era la VLAN nativa: i pacchetti senza tag
 * arrivano dal sensore come VID 0, mentre in DA-IPAM la stessa rete è dichiarata VLAN 1. Letta la
 * VID 0 come nativa, gli ufficiali diventano 672 e 293. Il resto ha cause diverse,
 * che qui diventano un tag ciascuna:
 *  - `altra_vlan`: l'IP sta in una rete dichiarata per un'altra VLAN (rete o VLAN da controllare);
 *  - `vlan_non_ipam`: la VLAN non ha reti in DA-IPAM (linee internet, apparati in CDP…);
 *  - `link_local`: 169.254, un PC che non ha avuto risposta dal DHCP;
 *  - `instradato`: l'IP si è visto solo dentro un pacchetto IP, mai in ARP né in un protocollo
 *    che resta nella VLAN: è traffico che passa dal router, il MAC è quello del router;
 *  - `pubblico` / `fuori_rete`: VLAN dichiarata ma IP che non sta in nessuna rete dichiarata.
 *
 * Funzioni pure: niente DB, così si provano da sole.
 */
import { isIpInCidr } from "@/lib/utils";

export type TagAppartenenza = "ufficiale" | "altra_vlan" | "vlan_non_ipam" | "link_local" | "instradato" | "pubblico" | "fuori_rete";

export const TAG_APPARTENENZA: readonly TagAppartenenza[] = [
  "ufficiale", "altra_vlan", "vlan_non_ipam", "link_local", "pubblico", "fuori_rete", "instradato",
];

export interface ReteDichiarata {
  cidr: string;
  vlan_id: number | null;
}

export interface Appartenenza {
  tag: TagAppartenenza;
  /** Per `altra_vlan`: la rete che contiene l'IP e la VLAN per cui è dichiarata. */
  rete?: string;
  vlan?: number | null;
}

/**
 * Protocolli che restano nella VLAN: chi li manda è collegato lì (ARP, DHCP, i nomi in
 * multicast, gli annunci degli apparati, il giro ARP del sensore). «ipv4» da solo no: è
 * l'indirizzo letto dentro un pacchetto, che può venire da un'altra rete attraverso il router.
 */
const PROTOCOLLI_LOCALI = new Set(["arp", "giro-arp", "dhcp", "mdns", "llmnr", "nbns", "ssdp", "cdp", "lldp", "mndp", "ubnt"]);

export function vistoNellaVlan(protocolli: readonly string[], attivo: number): boolean {
  // Senza protocolli (righe di prima della colonna, o sensori che non li mandano) non si può dire:
  // la riga resta un host della VLAN, non si nasconde.
  return attivo === 1 || protocolli.length === 0 || protocolli.some((p) => PROTOCOLLI_LOCALI.has(p));
}

/** La VLAN vera di un'osservazione: la VID 0 (senza tag) è la nativa, se la si conosce. */
export function vidEffettivo(vid: number, nativa: number | null): number {
  return vid === 0 && nativa != null ? nativa : vid;
}

function privato(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a === 127 || (a === 100 && b >= 64 && b <= 127);
}

export function appartenenzaIp(
  o: { ip: string; vid: number; protocolli: readonly string[]; attivo: number },
  reti: readonly ReteDichiarata[],
  nativa: number | null,
): Appartenenza {
  const vid = vidEffettivo(o.vid, nativa);
  if (o.ip.startsWith("169.254.")) return { tag: "link_local" };
  const sue = reti.filter((r) => r.vlan_id === vid);
  if (sue.some((r) => isIpInCidr(o.ip, r.cidr))) return { tag: "ufficiale" };
  if (!vistoNellaVlan(o.protocolli, o.attivo)) return { tag: "instradato" };
  if (sue.length === 0) return { tag: "vlan_non_ipam" };
  const altra = reti.find((r) => r.vlan_id !== vid && isIpInCidr(o.ip, r.cidr));
  if (altra) return { tag: "altra_vlan", rete: altra.cidr, vlan: altra.vlan_id };
  return { tag: privato(o.ip) ? "fuori_rete" : "pubblico" };
}

export interface NativaDedotta {
  vid: number;
  rete: string;
  /** IP senza tag che stanno in quella rete, sul totale degli IP senza tag. */
  dentro: number;
  totale: number;
}

/**
 * Quale VLAN è la nativa, dagli IP senza tag: la rete dichiarata che ne contiene di più, se ne
 * contiene almeno la metà e ha una VLAN. Altrimenti niente: meglio chiedere che indovinare.
 */
export function deduciVlanNativa(ipSenzaTag: readonly string[], reti: readonly ReteDichiarata[]): NativaDedotta | null {
  const validi = ipSenzaTag.filter((ip) => ip && !ip.startsWith("169.254."));
  if (validi.length === 0) return null;
  let migliore: NativaDedotta | null = null;
  for (const r of reti) {
    if (r.vlan_id == null || r.vlan_id === 0) continue;
    const dentro = validi.filter((ip) => isIpInCidr(ip, r.cidr)).length;
    if (!migliore || dentro > migliore.dentro) migliore = { vid: r.vlan_id, rete: r.cidr, dentro, totale: validi.length };
  }
  return migliore && migliore.dentro * 2 >= migliore.totale ? migliore : null;
}

/** Il filtro della tabella: di serie tutto tranne gli instradati, che non sono host della VLAN. */
export type FiltroAppartenenza = "" | "tutti" | "altri" | TagAppartenenza;

export function passaFiltroAppartenenza(filtro: FiltroAppartenenza, tag: TagAppartenenza): boolean {
  if (filtro === "tutti") return true;
  if (filtro === "") return tag !== "instradato";
  if (filtro === "altri") return tag !== "ufficiale" && tag !== "instradato";
  return tag === filtro;
}

/** Come si dice ogni tag a schermo: segno, parola breve, spiegazione per il riquadro al passaggio del mouse. */
export const ETICHETTA_APPARTENENZA: Readonly<Record<TagAppartenenza, { segno: string; testo: string; spiega: string; tono: "ok" | "attenzione" | "neutro" | "tratteggio" }>> = {
  ufficiale: { segno: "✓", testo: "ufficiale", spiega: "Sta nella rete dichiarata in DA-IPAM per questa VLAN.", tono: "ok" },
  altra_vlan: { segno: "▲", testo: "altra VLAN", spiega: "Sta in una rete che DA-IPAM dichiara per un'altra VLAN: o è sbagliata la VLAN della rete, o l'apparato è sulla porta sbagliata.", tono: "attenzione" },
  fuori_rete: { segno: "▲", testo: "fuori rete", spiega: "IP privato che non sta in nessuna rete di DA-IPAM: indirizzo scritto a mano sbagliato o rete non dichiarata.", tono: "attenzione" },
  vlan_non_ipam: { segno: "●", testo: "VLAN non in DA-IPAM", spiega: "Questa VLAN non ha reti dichiarate in DA-IPAM (linee internet, gestione degli apparati…).", tono: "neutro" },
  pubblico: { segno: "●", testo: "pubblico", spiega: "Indirizzo pubblico in una VLAN interna: di solito una linea internet portata sul trunk.", tono: "neutro" },
  link_local: { segno: "●", testo: "169.254", spiega: "Il PC non ha avuto risposta dal DHCP e si è dato un indirizzo da solo.", tono: "neutro" },
  instradato: { segno: "–", testo: "instradato", spiega: "Visto solo dentro un pacchetto IP, mai in ARP: è traffico che passa dal router, il MAC è quello del router. Non è un host di questa VLAN.", tono: "tratteggio" },
};
