/**
 * Il riquadro «Acquisizione modulare (anteprima)» della scheda (tavola C1, oggetti 2-9): tabella delle sezioni con
 * stato, righe, fonti, avvisi in italiano col codice, e le prime 5 righe lette (sola lettura). Puro: riceve lo
 * snapshot già letto dall'archivio. Nessun segreto: lo snapshot salvato non ne ha (prova dell'archivio).
 */
import type { AcquisitionSnapshot } from "@/lib/acquisition";

export const RIGHE_ANTEPRIMA = 5;

export const NOMI_SEZIONI: Readonly<Record<string, string>> = {
  identity: "Identità", interfaces: "Interfacce", vlans: "VLAN", forwarding: "Tabella MAC", neighbors: "Vicini (LLDP)",
  spanning_tree: "Spanning tree", aggregation: "Aggregazioni", poe: "PoE", sensors: "Sensori", network: "Indirizzi e ARP",
  hardware: "Hardware", modules: "Moduli", resources: "Risorse", environment: "Ambiente", storage: "Storage",
  virtualization: "Virtualizzazione", system: "Sistema", host_storage: "Dischi dell'host", software: "Software",
  services: "Servizi", security: "Sicurezza",
};

/** Avvisi più comuni in parole; gli altri si mostrano col solo codice. */
const AVVISI: Readonly<Record<string, string>> = {
  ROW_OR_BYTE_LIMIT: "Letta solo in parte: raggiunto il limite di righe.",
  OUTPUT_LIMIT: "Letta solo in parte: uscita troppo lunga.",
  PAGE_LIMIT: "Letta solo in parte: troppe pagine.",
  TOTAL_TIMEOUT: "Tempo totale scaduto prima di questa lettura.",
  SSH_TIMEOUT: "L'apparato ha smesso di rispondere via SSH.",
  SSH_CONNECT_FAILED: "Connessione SSH non riuscita (apparato irraggiungibile o credenziale rifiutata).",
  SSH_PERMISSION_DENIED: "L'utente SSH non ha il permesso per questo comando.",
  SSH_CREDENTIAL_NOT_PROVIDED: "Nessuna credenziale SSH nella fonte: sezione non letta.",
  NO_SSH_CREDENTIAL: "Nessuna credenziale SSH nella fonte.",
  NO_SNMP_CREDENTIAL: "Nessuna credenziale SNMP nella fonte.",
  SNMP_TIMEOUT: "L'apparato non ha risposto via SNMP entro il tempo.",
  SNMP_EXCEPTION: "Alcune voci SNMP non esistono su questo apparato.",
  COMMAND_UNSUPPORTED: "Comando non previsto da questo firmware.",
  FORMAT_UNRECOGNIZED_OR_EMPTY: "Formato dell'uscita non riconosciuto o vuoto.",
  NUMERIC_SENSORS_NOT_IMPLEMENTED: "Sensori numerici non ancora letti da questo collector.",
  COLLECTOR_EXCEPTION: "Il collector si è interrotto: nessun dato letto.",
  CREDENTIAL_UNREADABLE: "Credenziale illeggibile: nessuna lettura fatta, nessun'altra credenziale provata.",
  CREDENTIAL_FORM_UNSUPPORTED: "La credenziale non ha la forma che il collector chiede.",
  REQUEST_INVALID: "Richiesta non valida per il collector.",
  DEVICE_NOT_IDENTIFIED_AS_PROCURVE: "L'apparato non si è riconosciuto come ProCurve.",
};

export function testoAvviso(codice: string): string | null {
  return AVVISI[codice] ?? null;
}

type Cella = string | number | null;
export interface SezioneScheda {
  chiave: string;
  nome: string;
  stato: string;
  righe: number;
  fonti: string[];
  avvisi: Array<{ codice: string; testo: string | null }>;
  colonne: string[];
  prime: Cella[][];
}

const cella = (v: unknown): Cella => (v === null || v === undefined ? null : typeof v === "number" || typeof v === "string" ? v : typeof v === "boolean" ? (v ? "sì" : "no") : Array.isArray(v) ? v.join(", ") : null);

/** Colonne da mostrare per sezione: [etichetta, campo]. Una sezione non elencata mostra i primi campi semplici. */
const COLONNE: Readonly<Record<string, ReadonlyArray<readonly [string, string]>>> = {
  identity: [["Modello", "model"], ["Firmware", "firmware"], ["Seriale", "serial_number"], ["Nome", "hostname"]],
  interfaces: [["Porta", "name"], ["Stato", "oper_status"], ["Velocità (bit/s)", "speed_bps"], ["PVID", "pvid"]],
  vlans: [["VLAN", "id"], ["Nome", "name"], ["Tagged", "tagged_ports"], ["Untagged", "untagged_ports"]],
  forwarding: [["MAC", "mac"], ["VLAN", "vlan_id"], ["Porta", "port"]],
  neighbors: [["Porta", "local_port"], ["Vicino", "system_name"], ["Porta remota", "remote_port"]],
  spanning_tree: [["Porta", "port"], ["Istanza", "instance"], ["Stato", "state"], ["Ruolo", "role"]],
  aggregation: [["Nome", "name"], ["Protocollo", "protocol"], ["Membri", "members"]],
  poe: [["Porta", "port"], ["Stato", "status"], ["Watt", "power_watts"]],
  sensors: [["Nome", "name"], ["Tipo", "kind"], ["Valore", "value"], ["Unità", "unit"]],
  network: [["Indirizzo", "address"], ["Maschera", "netmask"]],
};

/** Le righe di una sezione come elenco di oggetti (le sezioni a oggetto hanno un elenco dentro). */
function elenco(chiave: string, data: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(data)) return data as Array<Record<string, unknown>>;
  if (data && typeof data === "object") {
    if (chiave === "spanning_tree") return ((data as { ports?: unknown[] }).ports ?? []) as Array<Record<string, unknown>>;
    if (chiave === "network") return ((data as { ipv4_addresses?: unknown[] }).ipv4_addresses ?? []) as Array<Record<string, unknown>>;
    return [data as Record<string, unknown>];
  }
  return [];
}

export function sezioniPerScheda(s: AcquisitionSnapshot): SezioneScheda[] {
  const out: SezioneScheda[] = [];
  for (const [chiave, v] of Object.entries(s)) {
    if (!v || typeof v !== "object" || !("status" in v) || !("data" in v)) continue;
    const sez = v as { status: string; sources: string[]; warnings: string[]; data: unknown };
    const righe = elenco(chiave, sez.data);
    const colonne = COLONNE[chiave] ?? Object.entries(righe[0] ?? {}).filter(([, x]) => cella(x) !== null || x === null).slice(0, 4).map(([k]) => [k, k] as const);
    out.push({
      chiave,
      nome: NOMI_SEZIONI[chiave] ?? chiave,
      stato: sez.status,
      righe: righe.length,
      fonti: [...new Set(sez.sources.map((f) => f.split(":")[0]))],
      avvisi: sez.warnings.map((codice) => ({ codice, testo: testoAvviso(codice) })),
      colonne: colonne.map(([etichetta]) => etichetta),
      prime: righe.slice(0, RIGHE_ANTEPRIMA).map((r) => colonne.map(([, campo]) => cella(r[campo]))),
    });
  }
  return out;
}
