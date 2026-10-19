/**
 * Discovery più leggibile (analisi del 19/10, F09, approvato da Riccardo). Modulo
 * puro: lo usa `app/(dashboard)/discovery/page.tsx`.
 *
 * L'ordine delle 19 colonne di default è una decisione di Riccardo (v0.2.500,
 * 23/05): non si tocca. Le viste per attività mostrano un sottoinsieme senza
 * cambiare la configurazione salvata; «Tutte» è quella di ognuno.
 */
export type Vista = "tutte" | "inventario" | "sicurezza" | "rete";

export const VISTE: Readonly<Record<Exclude<Vista, "tutte">, { etichetta: string; colonne: readonly string[] }>> = {
  inventario: {
    etichetta: "Inventario",
    colonne: ["profilo", "ip", "hostname", "device_manufacturer", "classification", "mac", "serial_number", "network_name", "last_seen"],
  },
  sicurezza: {
    etichetta: "Sicurezza",
    colonne: ["profilo", "ip", "hostname", "status", "vuln_max_severity", "vuln_counts", "open_ports_tcp", "validated_creds"],
  },
  rete: {
    etichetta: "Rete",
    colonne: ["profilo", "ip", "hostname", "mac", "network_name", "ip_assignment", "in_ad"],
  },
};

export function colonneDellaVista(vista: Vista, ordineUtente: readonly string[]): string[] {
  return vista === "tutte" ? [...ordineUtente] : [...VISTE[vista].colonne];
}

/** Le sigle delle intestazioni, in parole (si leggono passando sopra l'intestazione). */
export const GLOSSARIO: Readonly<Record<string, string>> = {
  validated_creds: "Cred: protocolli con una credenziale provata con successo su questo host (SSH, SNMP, WinRM…)",
  fp_confidence: "Conf: affidabilità del riconoscimento del tipo di apparato, in percentuale",
  known_host: "Manuale: host segnato a mano come conosciuto",
  ip_assignment: "DHCP: come ha avuto l'indirizzo (dinamico, riservato o statico)",
  in_ad: "AD: presente in Active Directory",
  vuln_max_severity: "CVE: gravità più alta fra le vulnerabilità trovate",
  vuln_counts: "CVE C/H/M: numero di vulnerabilità critiche / alte / medie",
  multihomed: "MH: apparato con più indirizzi IP (stesso dispositivo fisico)",
  open_ports_tcp: "Porte TCP aperte viste dall'ultima scansione",
  open_ports_udp: "Porte UDP aperte viste dall'ultima scansione",
};

/**
 * Etichette in italiano dei filtri di serie, applicate anche a quelli salvati prima,
 * ma solo se l'etichetta è ancora quella originale: un nome scelto dall'utente resta.
 */
const ETICHETTE_DI_SERIE: Readonly<Record<string, { originale: string; italiano: string }>> = {
  access_point: { originale: "AP", italiano: "Access point" },
  "group:net": { originale: "NET", italiano: "Altri apparati di rete" },
  "group:tel": { originale: "TEL", italiano: "Telefoni VoIP" },
  "group:print": { originale: "PRINT", italiano: "Stampanti" },
  "group:cam": { originale: "CAM", italiano: "Telecamere" },
  "group:iot": { originale: "IOT", italiano: "IoT e OT" },
  "group:mobile": { originale: "MOBILE", italiano: "Smartphone e tablet" },
  "group:storage": { originale: "STORAGE", italiano: "Storage" },
  "group:multihomed": { originale: "MH", italiano: "Più IP" },
  "group:other": { originale: "ALTRO", italiano: "Altro" },
};

export function etichettaPreset(p: { filter: string; label: string; builtin?: boolean }): string {
  const e = p.builtin ? ETICHETTE_DI_SERIE[p.filter] : undefined;
  return e && p.label === e.originale ? e.italiano : p.label;
}

/** Un host rientra in un filtro rapido? Una regola sola, per la tabella e per i conteggi. */
export function prendePreset(
  preset: { filter: string; match: readonly string[] },
  h: { classification?: string | null; multihomed?: unknown },
  presets: readonly { filter: string; match: readonly string[] }[],
): boolean {
  if (preset.filter === "group:multihomed") return h.multihomed != null;
  if (preset.filter === "group:other") {
    const presi = new Set(presets.filter((p) => p.filter !== "group:other" && p.filter !== "group:multihomed").flatMap((p) => p.match));
    return !presi.has(h.classification ?? "");
  }
  return preset.match.includes(h.classification ?? "");
}

/** Quanti host prende un filtro rapido, con la stessa regola del filtro della tabella. */
export function contaPreset(
  preset: { filter: string; match: readonly string[] },
  hosts: readonly { classification?: string | null; multihomed?: unknown }[],
  presets: readonly { filter: string; match: readonly string[] }[],
): number {
  return hosts.filter((h) => prendePreset(preset, h, presets)).length;
}
