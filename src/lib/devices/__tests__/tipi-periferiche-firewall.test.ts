/**
 * Tipi delle periferiche e marche dei firewall (Riccardo, 09/11/2026).
 *
 * Incidente: stampanti, UPS, centralini, telecamere e IoT diventavano apparati `switch` (`suggestDeviceTypeFromProductProfile`
 * ripiegava lì) e il giro ne leggeva porte e MAC; un FortiGate o un Palo Alto diventava `other` e perdeva la sua marca.
 * Gli host qui hanno la forma vera delle righe di `hosts` (campi inferred_* scritti da auto-classify).
 *
 * Run: node --import tsx --test src/lib/devices/__tests__/tipi-periferiche-firewall.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyProductProfileScanDefaults,
  resolveDeviceTypeForCreate,
  suggestDeviceTypeFromProductProfile,
  suggestProductProfileForClassification,
  variantiPer,
} from "@/lib/device-product-profiles";
import { proponiApparato, type HostPerProposta } from "../proposta-apparato";
import { inferVendorFromManufacturer } from "@/lib/vendor-inference";
import { inferNetworkDeviceVendorFromHostHint } from "@/lib/device-vendor-infer";
import { autoClassifyHost } from "../auto-classify";
import { NetworkDeviceSchema } from "@/lib/validators";

function host(campi: Partial<HostPerProposta>): HostPerProposta {
  return {
    ip: "10.0.0.1", hostname: null, custom_name: null, classification: "unknown", classification_manual: 0,
    inferred_vendor: null, inferred_os_family: null, inferred_protocol: null, inferred_device_type: null,
    inferred_scan_target: null, device_manufacturer: null, os_info: null, model: null, vendor: null, snmp_data: null,
    host_credentials: [], ...campi,
  };
}

describe("periferiche: un tipo proprio, mai switch", () => {
  it("dal profilo prodotto", () => {
    assert.equal(suggestDeviceTypeFromProductProfile("generic_ups"), "ups");
    assert.equal(suggestDeviceTypeFromProductProfile("generic_stampante"), "stampante");
    assert.equal(suggestDeviceTypeFromProductProfile("hp_stampante"), "stampante");
    assert.equal(suggestDeviceTypeFromProductProfile("generic_voip"), "voip");
    assert.equal(suggestDeviceTypeFromProductProfile("cisco_telefono"), "voip");
    assert.equal(suggestDeviceTypeFromProductProfile("generic_cam"), "telecamera");
    assert.equal(suggestDeviceTypeFromProductProfile("generic_iot"), "iot");
    // Gli switch restano switch.
    assert.equal(suggestDeviceTypeFromProductProfile("generic_switch"), "switch");
    assert.equal(suggestDeviceTypeFromProductProfile("hp_switch_procurve"), "switch");
  });

  it("dalla classificazione, anche con un device_type vecchio passato", () => {
    const casi: Array<[string, string]> = [
      ["ups", "ups"], ["stampante", "stampante"], ["multifunzione", "stampante"], ["scanner", "stampante"],
      ["voip", "voip"], ["telecamera", "telecamera"], ["iot", "iot"], ["sensore", "iot"], ["domotica", "iot"],
    ];
    for (const [classe, atteso] of casi) {
      assert.equal(resolveDeviceTypeForCreate({ product_profile: "generic_iot", device_type: "switch", classification: classe }), atteso, classe);
    }
    // La creazione da profilo (finestra, PUT) dà lo stesso tipo.
    assert.equal(applyProductProfileScanDefaults("generic_ups", "other", "ups").device_type, "ups");
    assert.equal(applyProductProfileScanDefaults("generic_ups", "other", "ups").use_for_arp_poll, 0);
  });

  it("l'API accetta i tipi nuovi", () => {
    const base = { name: "ups", host: "10.0.0.5", vendor: "other", protocol: "snmp_v2" };
    for (const t of ["stampante", "ups", "voip", "telecamera", "iot"]) {
      assert.equal(NetworkDeviceSchema.safeParse({ ...base, device_type: t }).success, true, t);
    }
  });
});

describe("firewall: la marca resta e il tipo è firewall", () => {
  const MARCHE = ["fortinet", "paloalto", "checkpoint", "watchguard", "sonicwall"] as const;

  it("ogni marca ha il suo profilo, che è sempre un firewall", () => {
    for (const m of MARCHE) {
      const profilo = `${m}_firewall`;
      assert.deepEqual(variantiPer(m, "firewall"), [profilo], m);
      assert.equal(suggestProductProfileForClassification(m, "firewall"), profilo, m);
      assert.equal(resolveDeviceTypeForCreate({ product_profile: profilo as never, classification: "server" }), "firewall", m);
      const d = applyProductProfileScanDefaults(profilo as never, m, "firewall");
      assert.equal(d.device_type, "firewall", m);
      assert.equal(d.use_for_arp_poll, 1, m);
      assert.equal(NetworkDeviceSchema.safeParse({ name: "fw", host: "10.0.0.1", device_type: "firewall", vendor: m, protocol: "snmp_v2" }).success, true, m);
    }
  });

  it("un FortiGate dedotto da auto-classify diventa apparato firewall Fortinet, non «other»", () => {
    const p = proponiApparato(host({ inferred_vendor: "fortinet", inferred_os_family: "network-os", inferred_device_type: "firewall", snmp_data: "{}" }), []);
    assert.equal(p.vendor, "fortinet");
    assert.equal(p.classification, "firewall");
    assert.equal(p.productProfile, "fortinet_firewall");
    assert.equal(p.useForArpPoll, true);
  });

  it("un Palo Alto riconosciuto solo dal produttore SNMP prende la sua marca", () => {
    const p = proponiApparato(host({ inferred_device_type: "firewall", snmp_data: JSON.stringify({ manufacturer: "Palo Alto Networks" }) }), []);
    assert.equal(p.vendor, "paloalto");
    assert.equal(p.productProfile, "paloalto_firewall");
  });

  it("le marche si riconoscono da OUI, produttore e stringhe dell'host", () => {
    assert.equal(inferVendorFromManufacturer("Palo Alto Networks"), "paloalto");
    assert.equal(inferVendorFromManufacturer("Check Point Software Technologies"), "checkpoint");
    assert.equal(inferVendorFromManufacturer("WatchGuard Technologies"), "watchguard");
    assert.equal(inferVendorFromManufacturer("SonicWALL"), "sonicwall");
    assert.equal(inferVendorFromManufacturer("Fortinet Inc."), "fortinet");
    assert.equal(inferNetworkDeviceVendorFromHostHint("FortiGate-60F v7.2.5"), "fortinet");
    assert.equal(inferNetworkDeviceVendorFromHostHint("Palo Alto Networks PA-440"), "paloalto");
    for (const [oui, marca] of [["Palo Alto Networks", "paloalto"], ["Check Point Software Technologies", "checkpoint"], ["WatchGuard Technologies, Inc.", "watchguard"]]) {
      const r = autoClassifyHost({ hostname: null, mac: null, vendor: oui, open_ports_json: JSON.stringify([{ port: 443, protocol: "tcp" }]) });
      assert.equal(r.inferred_vendor, marca, oui);
      assert.equal(r.inferred_device_type, "firewall", oui);
    }
  });
});
