import { describe, it } from "node:test";
import assert from "node:assert";
import { projectLegacy } from "../legacy-projection";
import { mapLegacyClassification } from "../taxonomy";
import { DEVICE_CLASSIFICATIONS } from "@/lib/device-classifications";
import type { AttributionResult, DimensionResult } from "../fuse";

/** Costruisce un AttributionResult sintetico con solo i campi rilevanti per projectLegacy. */
function result(opts: {
  category?: string | null;
  categoryConfidence?: number;
  os?: string | null;
  vendor?: string | null;
}): AttributionResult {
  const dim = (claim: string | null, confidence = 80): DimensionResult => ({
    claim, confidence, min_phase: null, evidence_ids: [], conflicts: [], authoritative: false,
  });
  return {
    vendor: { ...dim(opts.vendor ?? null), vendor_name: null },
    category: dim(opts.category ?? null, opts.categoryConfidence ?? 80),
    os: { ...dim(opts.os ?? null), os_name: null },
    engine_version: "2.0.0",
  };
}

describe("projectLegacy", () => {
  it("risultato vuoto → tutti null e confidence 0", () => {
    const r = result({ category: null, categoryConfidence: 0, os: null, vendor: null });
    assert.deepEqual(projectLegacy(r), {
      classification: null,
      inferred_device_type: null,
      inferred_vendor: null,
      inferred_os_family: null,
      inferred_confidence: 0,
    });
  });

  it("compute.server + os=windows → server_windows", () => {
    const r = result({ category: "compute.server", os: "windows" });
    assert.equal(projectLegacy(r).classification, "server_windows");
  });
  it("compute.server + os=linux → server_linux", () => {
    const r = result({ category: "compute.server", os: "linux" });
    assert.equal(projectLegacy(r).classification, "server_linux");
  });
  it("compute.server senza OS → server", () => {
    const r = result({ category: "compute.server", os: null });
    assert.equal(projectLegacy(r).classification, "server");
  });
  it("compute.server con os non windows/linux (es. macos) → server (nessuno slug legacy dedicato)", () => {
    const r = result({ category: "compute.server", os: "macos" });
    assert.equal(projectLegacy(r).classification, "server");
  });

  it("storage (livello 1) → storage", () => {
    const r = result({ category: "storage" });
    assert.equal(projectLegacy(r).classification, "storage");
  });
  it("network (livello 1) → null (nessuno slug legacy per 'rete generica')", () => {
    const r = result({ category: "network" });
    assert.equal(projectLegacy(r).classification, null);
  });
  it("compute (livello 1, bare) → null (nessuno slug legacy generico per 'compute')", () => {
    const r = result({ category: "compute" });
    assert.equal(projectLegacy(r).classification, null);
  });
  it("iot (livello 1, da rete_ot) → iot", () => {
    const r = result({ category: "iot" });
    assert.equal(projectLegacy(r).classification, "iot");
  });

  // Tabellare: ogni riga della mappa inversa dichiarata nel brief.
  const TABLE: Array<{ category: string; os?: string | null; classification: string | null }> = [
    { category: "network.router", classification: "router" },
    { category: "network.switch", classification: "switch" },
    { category: "network.firewall", classification: "firewall" },
    { category: "network.access_point", classification: "access_point" },
    { category: "network.modem", classification: "modem" },
    { category: "network.controller", classification: "controller" },
    { category: "storage.nas", classification: "nas" },
    { category: "peripheral.printer", classification: "stampante" },
    { category: "peripheral.mfp", classification: "multifunzione" },
    { category: "peripheral.scanner", classification: "scanner" },
    { category: "av.camera", classification: "telecamera" },
    { category: "voip.phone", classification: "voip" },
    { category: "power.ups", classification: "ups" },
    { category: "compute.laptop", classification: "notebook" },
    { category: "compute.vm", classification: "vm" },
    { category: "compute.hypervisor", classification: "hypervisor" },
    { category: "compute.workstation", classification: "workstation" },
    { category: "mobile.phone", classification: "smartphone" },
    { category: "mobile.tablet", classification: "tablet" },
    { category: "iot.sensor", classification: "iot" },
    { category: "iot.thermostat", classification: "iot" },
    { category: "iot.plug", classification: "iot" },
    { category: "iot.other", classification: "iot" },
    // Foglie senza slug legacy dedicato → null (meglio non proiettare che proiettare male)
    { category: "storage.san", classification: null },
    { category: "storage.tape", classification: null },
    { category: "av.display", classification: null },
    { category: "av.nvr", classification: null },
    { category: "av.speaker", classification: null },
    { category: "voip.pbx", classification: null },
    { category: "voip.gateway", classification: null },
    { category: "power.pdu", classification: null },
  ];
  for (const row of TABLE) {
    it(`categoria ${row.category}${row.os ? ` (os=${row.os})` : ""} → classification ${row.classification ?? "null"}`, () => {
      const r = result({ category: row.category, os: row.os ?? null });
      assert.equal(projectLegacy(r).classification, row.classification);
    });
  }

  it("inferred_confidence usa la confidence della dimensione categoria", () => {
    const r = result({ category: "network.router", categoryConfidence: 73 });
    assert.equal(projectLegacy(r).inferred_confidence, 73);
  });
  it("inferred_vendor passa il claim della dimensione vendor", () => {
    const r = result({ category: "network.router", vendor: "cisco" });
    assert.equal(projectLegacy(r).inferred_vendor, "cisco");
  });
  it("inferred_os_family passa il claim della dimensione os", () => {
    const r = result({ category: "compute.server", os: "linux" });
    assert.equal(projectLegacy(r).inferred_os_family, "linux");
  });
  it("inferred_device_type: vocabolario ristretto, null se non rappresentabile", () => {
    assert.equal(projectLegacy(result({ category: "network.router" })).inferred_device_type, "router");
    assert.equal(projectLegacy(result({ category: "network.switch" })).inferred_device_type, "switch");
    assert.equal(projectLegacy(result({ category: "network.firewall" })).inferred_device_type, "firewall");
    assert.equal(projectLegacy(result({ category: "compute.server" })).inferred_device_type, "server");
    assert.equal(projectLegacy(result({ category: "compute.hypervisor" })).inferred_device_type, "hypervisor");
    assert.equal(projectLegacy(result({ category: "compute.workstation" })).inferred_device_type, "workstation");
    assert.equal(projectLegacy(result({ category: "peripheral.printer" })).inferred_device_type, "printer");
    assert.equal(projectLegacy(result({ category: "storage.nas" })).inferred_device_type, "nas");
    assert.equal(projectLegacy(result({ category: "power.ups" })).inferred_device_type, "ups");
    assert.equal(projectLegacy(result({ category: "iot.sensor" })).inferred_device_type, "iot");
    // non rappresentabile nel vocabolario ristretto
    assert.equal(projectLegacy(result({ category: "network.access_point" })).inferred_device_type, null);
    assert.equal(projectLegacy(result({ category: "av.camera" })).inferred_device_type, null);
    assert.equal(projectLegacy(result({ category: "mobile.phone" })).inferred_device_type, null);
  });

  // Proprietà round-trip: per ogni slug legacy che mapLegacyClassification mappa a una
  // categoria di LIVELLO 2, projectLegacy(fusione costruita da quello slug) deve
  // ritornare lo slug di partenza — TRANNE le eccezioni esplicite sotto, dove la
  // mappa diretta è many-to-one (più slug legacy collassano sulla stessa categoria
  // v2) e quindi l'inversa non può ricostruire lo slug esatto: sceglie un canonico
  // e gli altri restano dichiarati come non proiettabili.
  const ROUND_TRIP_EXCEPTIONS: Record<string, string> = {
    ont: "collassa su network.modem insieme a 'modem' → canonico 'modem'",
    controller_wifi: "collassa su network.controller insieme a 'controller' → canonico 'controller'",
    network_controller: "collassa su network.controller insieme a 'controller' → canonico 'controller'",
    vpn_gateway: "collassa su network.firewall insieme a 'firewall' → canonico 'firewall'",
    proxy: "collassa su compute.server senza os_family → canonico 'server'",
    dhcp_server: "collassa su compute.server senza os_family → canonico 'server'",
    dns_server: "collassa su compute.server senza os_family → canonico 'server'",
    nfs_server: "collassa su compute.server senza os_family → canonico 'server'",
    mail_server: "collassa su compute.server senza os_family → canonico 'server'",
    web_server: "collassa su compute.server senza os_family → canonico 'server'",
    database_server: "collassa su compute.server senza os_family → canonico 'server'",
    backup_server: "collassa su compute.server senza os_family → canonico 'server'",
    fotocopiatrice: "collassa su peripheral.mfp insieme a 'multifunzione' → canonico 'multifunzione'",
    nas_synology: "collassa su storage.nas insieme a 'nas' → canonico 'nas'",
    nas_qnap: "collassa su storage.nas insieme a 'nas' → canonico 'nas'",
    smart_tv: "av.display senza canonico dichiarato dal brief → null",
    decoder: "av.display senza canonico dichiarato dal brief → null",
    media_player: "av.display senza canonico dichiarato dal brief → null",
    domotica: "collassa su iot.other, tutte le foglie iot.* proiettano 'iot' → canonico 'iot'",
    console: "collassa su iot.other, tutte le foglie iot.* proiettano 'iot' → canonico 'iot'",
    plc: "collassa su iot.sensor, tutte le foglie iot.* proiettano 'iot' → canonico 'iot'",
    hmi: "collassa su iot.sensor, tutte le foglie iot.* proiettano 'iot' → canonico 'iot'",
    sensore: "collassa su iot.sensor, tutte le foglie iot.* proiettano 'iot' → canonico 'iot'",
  };

  it("round-trip su tutti gli slug legacy che mappano a categoria di livello 2 (tranne eccezioni dichiarate)", () => {
    let level2Count = 0;
    for (const slug of DEVICE_CLASSIFICATIONS) {
      const mapped = mapLegacyClassification(slug);
      if (mapped.category == null || !mapped.category.includes(".")) continue; // solo livello 2
      level2Count += 1;
      const r = result({ category: mapped.category, os: mapped.os_family });
      const projected = projectLegacy(r).classification;
      if (slug in ROUND_TRIP_EXCEPTIONS) {
        assert.notEqual(
          projected, slug,
          `${slug} era attesa come eccezione (${ROUND_TRIP_EXCEPTIONS[slug]}) ma il round-trip è tornato a coincidere: aggiornare la lista eccezioni`
        );
      } else {
        assert.equal(projected, slug, `round-trip fallito per slug legacy '${slug}' (categoria ${mapped.category})`);
      }
    }
    // sanity: assicura che il test stia davvero esercitando la mappa (non silenziosamente vuoto)
    assert.ok(level2Count >= 40, `attesi almeno 40 slug di livello 2, trovati ${level2Count}`);
  });
});
