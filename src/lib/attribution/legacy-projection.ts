// Proiezione della fusione v2 → colonne legacy (fase 4 del ritiro legacy).
// Inverte `mapLegacyClassification` (taxonomy.ts): quella mappa va da slug
// legacy → categoria v2 (many-to-one: più slug legacy diversi collassano sulla
// stessa categoria, es. proxy/dhcp_server/web_server/... → compute.server).
// L'inversa non può quindi ricostruire lo slug esatto di partenza in quei casi:
// sceglie UN canonico per categoria e lo documenta qui. Il round-trip completo
// (con l'elenco esplicito delle eccezioni non proiettabili) è testato in
// legacy-projection.test.ts.
import type { AttributionResult } from "./fuse";

export interface LegacyProjection {
  /** slug DeviceClassification, null = non proiettabile (nessuno slug legacy adatto) */
  classification: string | null;
  inferred_device_type: string | null;
  inferred_vendor: string | null;
  inferred_os_family: string | null;
  /** 0-100, dalla dimensione categoria della fusione */
  inferred_confidence: number;
}

/**
 * Categoria v2 (livello 2, "l1.l2") → slug legacy canonico.
 * `compute.server` NON è qui: dipende da os_family, gestito a parte in
 * `projectClassification` (server_windows/server_linux/server).
 * Le foglie `iot.*` non sono qui: tutte collassano su "iot" (vedi sotto),
 * coerente con la regola esplicita del brief "iot.* → iot".
 */
const CATEGORY_TO_LEGACY: Record<string, string> = {
  "network.router": "router",
  "network.switch": "switch",
  // "firewall" è il canonico; "vpn_gateway" mappava in avanti sulla stessa
  // categoria e non round-trippa (dichiarato in test).
  "network.firewall": "firewall",
  "network.access_point": "access_point",
  // "modem" è il canonico; "ont" collassa qui e non round-trippa.
  "network.modem": "modem",
  // "controller" è il canonico; "controller_wifi"/"network_controller" collassano
  // qui e non round-trippano.
  "network.controller": "controller",
  "compute.hypervisor": "hypervisor",
  "compute.vm": "vm",
  "compute.workstation": "workstation",
  "compute.laptop": "notebook",
  "peripheral.printer": "stampante",
  // "multifunzione" è il canonico (regola esplicita brief); "fotocopiatrice"
  // collassa qui e non round-trippa.
  "peripheral.mfp": "multifunzione",
  "peripheral.scanner": "scanner",
  // "nas" è il canonico; "nas_synology"/"nas_qnap" collassano qui e non
  // round-trippano (l'informazione vendor-specifica non ha uno slug dedicato).
  "storage.nas": "nas",
  "av.camera": "telecamera",
  "voip.phone": "voip",
  "power.ups": "ups",
  "mobile.phone": "smartphone",
  "mobile.tablet": "tablet",
  // "av.display" (smart_tv/decoder/media_player in avanti) NON ha un canonico
  // dichiarato dal brief: nessuna riga qui → null. Meglio non proiettare che
  // sceglierne uno arbitrariamente tra tre slug ugualmente validi.
  // "voip.pbx", "voip.gateway", "power.pdu", "storage.san", "storage.tape",
  // "av.nvr", "av.speaker": nessuno slug legacy dedicato → null.
};

function projectClassification(category: string | null, osFamily: string | null): string | null {
  if (category == null) return null;
  if (category === "compute.server") {
    // Le uniche due varianti con slug legacy dedicato sono windows/linux;
    // qualunque altro os_family (macos, network-os, null) ricade sul generico
    // "server" — non c'è "server_macos" nel vocabolario legacy.
    if (osFamily === "windows") return "server_windows";
    if (osFamily === "linux") return "server_linux";
    return "server";
  }
  // Livello 1 "storage": esiste lo slug legacy generico "storage" (a differenza
  // di "network", vedi sotto) → proiettabile direttamente.
  if (category === "storage") return "storage";
  // Livello 1 "network": nessuno slug legacy per "rete generica" (bridge,
  // repeater, load_balancer collassavano qui in avanti) → meglio null che
  // proiettare male scegliendo un tipo di rete a caso.
  if (category === "network") return null;
  // Livello 1 "iot" (da rete_ot) e qualunque foglia "iot.*" (sensor/thermostat/
  // plug/other): regola esplicita del brief "iot.* → iot", un solo slug
  // legacy generico copre tutta la sotto-tassonomia IoT/OT.
  if (category === "iot" || category.startsWith("iot.")) return "iot";
  return CATEGORY_TO_LEGACY[category] ?? null;
}

/**
 * Categoria v2 → InferredDeviceType (vocabolario ristretto di auto-classify:
 * router|switch|firewall|hypervisor|server|workstation|printer|iot|nas|ups).
 * null se la categoria non è rappresentabile in quel vocabolario (es. access_point,
 * vm, camera, phone: non esistono in InferredDeviceType).
 */
const DEVICE_TYPE_MAP: Record<string, string> = {
  "network.router": "router",
  "network.switch": "switch",
  "network.firewall": "firewall",
  "compute.server": "server",
  "compute.hypervisor": "hypervisor",
  "compute.workstation": "workstation",
  // "compute.laptop" non ha un tipo dedicato nel vocabolario ristretto: il
  // classifier legacy trattava già notebook e desktop Windows/macOS come
  // "workstation" (auto-classify.ts non distingue laptop), quindi è la resa
  // più fedele piuttosto che null.
  "compute.laptop": "workstation",
  "peripheral.printer": "printer",
  // "peripheral.mfp": un multifunzione stampa, non esiste "mfp" nel vocabolario
  // ristretto → "printer" è la resa più vicina.
  "peripheral.mfp": "printer",
  "storage.nas": "nas",
  "power.ups": "ups",
};

function projectDeviceType(category: string | null): string | null {
  if (category == null) return null;
  if (category === "iot" || category.startsWith("iot.")) return "iot";
  return DEVICE_TYPE_MAP[category] ?? null;
}

/**
 * Traduce l'esito della fusione v2 (AttributionResult) nei valori legacy
 * (`hosts.classification` + `inferred_*`). Pura, nessun accesso DB.
 *
 * `inferred_confidence` usa SEMPRE la confidence della dimensione categoria
 * (non quella di vendor/os): è quella colonna che storicamente rappresentava
 * "quanto siamo sicuri del tipo di device", coerente con l'uso originale.
 */
export function projectLegacy(result: AttributionResult): LegacyProjection {
  const category = result.category.claim;
  const osFamily = result.os.claim;
  return {
    classification: projectClassification(category, osFamily),
    inferred_device_type: projectDeviceType(category),
    inferred_vendor: result.vendor.claim,
    inferred_os_family: osFamily,
    inferred_confidence: result.category.confidence,
  };
}
