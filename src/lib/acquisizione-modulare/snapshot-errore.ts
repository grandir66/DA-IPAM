/**
 * Snapshot di un tentativo che non ha prodotto uno snapshot del collector (eccezione, richiesta rifiutata dallo schema,
 * credenziale illeggibile): ogni sezione obbligatoria in errore col solo codice, mai il messaggio grezzo. Così anche un
 * fallimento si salva come un fatto e la scheda lo mostra (riga «Errore» della tavola C1, oggetto 13).
 */
import { snapshotSchema, type AcquisitionSnapshot, type CollectorId } from "@/lib/acquisition";
import { descrittore } from "@/lib/acquisition/catalogo";

export function snapshotDiErrore(collector: CollectorId, host: string, codice: string, adesso: Date = new Date(), durataMs = 0): AcquisitionSnapshot {
  const at = adesso.toISOString();
  const sezione = <T>(data: T) => ({ status: "error" as const, collected_at: at, sources: [], warnings: [codice], data });
  return snapshotSchema.parse({
    schema_version: "1.0",
    collector,
    collector_version: descrittore(collector).versione,
    target: host,
    collected_at: at,
    duration_ms: durataMs,
    status: "error",
    network: sezione({ ipv4_addresses: [], arp: [] }),
    identity: sezione(null),
    interfaces: sezione([]),
    vlans: sezione([]),
    forwarding: sezione([]),
    neighbors: sezione([]),
    spanning_tree: sezione({ enabled: null, protocol: null, ports: [] }),
    aggregation: sezione([]),
    poe: sezione([]),
    sensors: sezione([]),
  });
}
