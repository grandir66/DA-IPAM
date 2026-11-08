/**
 * Il testo delle celle della lista host nella pagina della subnet, per i filtri dal tasto
 * destro (Riccardo, 08/11: «l'utilizzo del tasto destro come in altre schermate per
 * abilitare i filtri ed avere le funzioni subito pronte»). La regola dei filtri è quella
 * della Discovery (`lib/discovery/filtri-valore.ts`); qui solo che cosa c'è scritto in
 * ogni colonna. Modulo puro.
 */
import { getClassificationLabel } from "@/lib/device-classifications";
import { ipAssignmentShortLabel, type IpAssignment } from "@/lib/ip-assignment";

export interface HostCella {
  ip: string;
  status: string;
  known_host?: number | null;
  ip_assignment?: string | null;
  ad_dns_host_name?: string | null;
  custom_name?: string | null;
  hostname?: string | null;
  dns_reverse?: string | null;
  device?: { name: string; sysname: string | null } | null;
  classification?: string | null;
  vendor?: string | null;
  notes?: string | null;
}

/**
 * Le colonne della tabella, nell'ordine in cui la pagina le disegna: la cella premuta si
 * riconosce dalla sua posizione. `null` = colonna senza filtro (casella, pulsanti, badge).
 * Se si aggiunge o si sposta una colonna nella pagina, si cambia anche qui.
 */
export const COLONNE_SUBNET: ReadonlyArray<string | null> = [
  null, // selezione
  null, // dettagli
  "ip",
  "stato",
  null, // credenziali
  "conosciuto",
  "dhcp",
  "ad",
  "nome",
  "classificazione",
  null, // rilevato
  null, // dispositivo
  null, // multihomed
  "vendor",
  "note",
  null, // porte
  null, // LibreNMS
  null, // Wazuh
];

const ETICHETTE: Record<string, string> = {
  ip: "IP",
  stato: "Stato",
  conosciuto: "Conosciuto",
  dhcp: "DHCP",
  ad: "AD",
  nome: "Nome",
  classificazione: "Classificazione",
  vendor: "Vendor",
  note: "Note",
};

export function etichettaColonnaSubnet(colonna: string): string {
  return ETICHETTE[colonna] ?? colonna;
}

const STATI: Record<string, string> = { online: "Online", offline: "Offline", unknown: "Sconosciuto" };

/** Il nome come lo mostra la colonna «Nome». */
export function nomeHost(h: HostCella): string {
  const nomeApparato = h.device && h.device.name !== h.ip ? h.device.name : null;
  return h.custom_name || h.hostname || h.dns_reverse || h.device?.sysname || nomeApparato || "";
}

export function testoCellaSubnet(h: HostCella, colonna: string): string {
  switch (colonna) {
    case "ip":
      return h.ip;
    case "stato":
      return STATI[h.status] ?? h.status;
    case "conosciuto":
      return h.known_host ? "Sì" : "No";
    case "dhcp":
      return ipAssignmentShortLabel((h.ip_assignment ?? undefined) as IpAssignment | undefined) ?? "";
    case "ad":
      return h.ad_dns_host_name ? "Sì" : "No";
    case "nome":
      return nomeHost(h);
    case "classificazione":
      return h.classification ? getClassificationLabel(h.classification) : "";
    case "vendor":
      return h.vendor || "";
    case "note":
      return h.notes || "";
    default:
      return "";
  }
}

/** La colonna della cella premuta, dalla sua posizione nella riga. */
export function colonnaDaIndice(indice: number): string | null {
  return COLONNE_SUBNET[indice] ?? null;
}

/**
 * Su quali host vale un'azione del menu: tutta la selezione se la riga premuta ne fa parte,
 * altrimenti solo la riga premuta (come in un file manager).
 */
export function hostDelMenu(selezionati: ReadonlySet<number>, premuto: number): number[] {
  return selezionati.has(premuto) ? [...selezionati] : [premuto];
}
