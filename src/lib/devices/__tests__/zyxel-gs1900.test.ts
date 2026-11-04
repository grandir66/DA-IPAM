/**
 * Zyxel GS1900 sulla sonda 72729 (04/11/2026): lo switch rispondeva in SNMP, ma senza un profilo proprio finiva creato come
 * HP ProCurve e la scheda non mostrava porte e VLAN. Fixture: walk vero di un GS1900-48HP V2.70(AAHO.5), MAC e seriale sostituiti.
 *
 * Run: DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test src/lib/devices/__tests__/zyxel-gs1900.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getSnmpPortSchema } from "@/lib/devices/snmp-port-schema";
import { getSnmpStpInfo } from "@/lib/devices/snmp-stp-info";
import { leggiVlanSwitch } from "@/lib/devices/snmp-vlan";
import { proponiApparato } from "@/lib/devices/proposta-apparato";
import { tipoLetturaApparato } from "@/lib/devices/lettura-info";
import { getDefaultProductProfileForVendor, getProductProfilesForVendor, isValidProductProfileForVendor, variantiPer } from "@/lib/device-product-profiles";
import { resolveSnmpVendorProfile } from "@/lib/scanner/snmp-vendor-profiles";
import { lookupSysObjectId } from "@/lib/scanner/snmp-sysobj-lookup";
import type { NetworkDevice } from "@/types";

const SYS_OBJECT_ID = "1.3.6.1.4.1.890.1.15";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/zyxel-gs1900-48hp.json", import.meta.url), "utf8")) as {
  voci: Array<{ oid: string; hex?: string; num?: number }>;
};
const voci = fixture.voci.map((v) => ({ oid: v.oid, value: v.hex !== undefined ? Buffer.from(v.hex, "hex") : (v.num as number) }));
const walk = Object.assign(async (base: string) => voci.filter((v) => v.oid.startsWith(`${base}.`)), { get: async () => [] });
const testoDi = (oid: string): string | undefined => {
  const v = voci.find((x) => x.oid === oid)?.value;
  return Buffer.isBuffer(v) ? v.toString("utf8") : undefined;
};

describe("Zyxel GS1900: riconoscimento", () => {
  it("il sysObjectID porta al profilo Zyxel, categoria switch", () => {
    const p = resolveSnmpVendorProfile(SYS_OBJECT_ID, "GS1900-48HP");
    assert.equal(p?.id, "zyxel_gs1900");
    assert.equal(p?.category, "switch");
  });

  it("modello, seriale e firmware vengono dagli OID che il walk ha davvero", () => {
    const f = resolveSnmpVendorProfile(SYS_OBJECT_ID, "GS1900-48HP")?.fields;
    assert.equal(testoDi(String(f?.model)), "GS1900-48HP");
    assert.equal(testoDi(String(f?.serial)), "S000X00000000");
    assert.equal(testoDi(String(f?.firmware)), "V2.70(AAHO.5) | 02/08/2023");
  });

  it("la tabella dei sysObjectID lo dice Zyxel, categoria switch", () => {
    const m = lookupSysObjectId(`${SYS_OBJECT_ID}`);
    assert.equal(m?.vendor, "Zyxel");
    assert.equal(m?.category, "switch");
  });
});

describe("Zyxel GS1900: lettura delle MIB standard", () => {
  it("58 porte: 50 fisiche e 8 LAG, 13 attive", async () => {
    const porte = await getSnmpPortSchema(walk);
    assert.equal(porte.length, 58);
    assert.equal(porte.filter((p) => p.status === "up").length, 13);
    assert.equal(porte.find((p) => p.port_index === 36)?.speed, "100 Mbps");
    assert.equal(porte.find((p) => p.port_index === 1000)?.port_name, "LAG1");
  });

  it("il duplex viene da EtherLike-MIB: il GS1900 non ha la MAU-MIB", async () => {
    const porte = await getSnmpPortSchema(walk);
    assert.equal(porte.find((p) => p.port_index === 36)?.duplex, "full");
    // Porta spenta: lo stato sconosciuto non è un dato.
    assert.equal(porte.find((p) => p.port_index === 1)?.duplex, null);
  });

  it("la VLAN 1 si legge con 58 porte e i PVID", async () => {
    const r = await leggiVlanSwitch(walk);
    assert.equal(r.esito, "letto");
    assert.deepEqual(r.vlan, [{ vlan_id: 1, nome: "default" }]);
    assert.equal(r.porte.length, 58);
    assert.equal(r.pvid.length, 58);
    assert.equal(r.porte_senza_mappa, 0);
  });

  it("STP: il root scritto come testo («0/00:00:…») resta sconosciuto, con la sua porta (52 su 50 porte)", async () => {
    const stp = await getSnmpStpInfo(walk);
    assert.equal(stp?.root_bridge_id, null);
    assert.equal(stp?.root_port, null);
    assert.equal(stp?.protocol, "rstp");
    assert.match(String(stp?.bridge_id), /02:00:00:00:00:01$/);
  });
});

describe("EtherLike e STP: gli altri switch non cambiano", () => {
  const riga = (oid: string, value: number | string | Buffer) => ({ oid, value });
  const IF_DESCR = "1.3.6.1.2.1.2.2.1.2", MAU = "1.3.6.1.2.1.26.2.1.1.14", ETHERLIKE = "1.3.6.1.2.1.10.7.2.1.19";

  it("con la MAU-MIB vale la MAU-MIB", async () => {
    const tabelle: Record<string, Array<{ oid: string; value: number | string }>> = {
      [IF_DESCR]: [riga(`${IF_DESCR}.1`, "Port 1") as { oid: string; value: string }],
      [MAU]: [riga(`${MAU}.1.1`, 2) as { oid: string; value: number }],
      [ETHERLIKE]: [riga(`${ETHERLIKE}.1`, 3) as { oid: string; value: number }],
    };
    const porte = await getSnmpPortSchema(async (oid) => tabelle[oid] ?? []);
    assert.equal(porte[0]?.duplex, "half");
  });

  it("un root di 8 ottetti si legge come prima", async () => {
    const root = Buffer.from("8000aabbccddeeff", "hex");
    const stp = await getSnmpStpInfo(async (oid) => {
      if (oid === "1.3.6.1.2.1.17.2.5") return [riga(`${oid}.0`, root)];
      if (oid === "1.3.6.1.2.1.17.2.7") return [riga(`${oid}.0`, 7)];
      return [];
    });
    assert.equal(stp?.root_bridge_id, "32768.aa:bb:cc:dd:ee:ff");
    assert.equal(stp?.root_port, "7");
  });
});

describe("Switch di una marca fuori elenco", () => {
  const hostZyxel = {
    id: 106, ip: "192.0.2.10", hostname: "GS1900", custom_name: null, vendor: "Zyxel Communications Corporation",
    classification: "switch", classification_manual: 0, inferred_device_type: "switch", inferred_vendor: "zyxel",
    device_manufacturer: "Zyxel Communications Corporation", snmp_data: JSON.stringify({ sysName: "GS1900", sysDescr: "GS1900-48HP" }),
  };

  it("la proposta è uno switch sotto «Altro», mai ProCurve", () => {
    const p = proponiApparato(hostZyxel as unknown as Parameters<typeof proponiApparato>[0], []);
    assert.equal(p.vendor, "other");
    assert.equal(p.classification, "switch");
    assert.equal(p.productProfile, "generic_switch");
  });

  it("«Altro» offre lo switch solo agli switch: gli altri profili di serie non cambiano", () => {
    assert.deepEqual(getProductProfilesForVendor("other", "switch").map((p) => p.id), ["generic_switch"]);
    assert.equal(getDefaultProductProfileForVendor("other"), "generic_ups");
    assert.equal(getDefaultProductProfileForVendor("other", "stampante"), "generic_stampante");
    assert.ok(!getProductProfilesForVendor("other", "workstation").some((p) => p.id === "generic_switch"));
    assert.ok(isValidProductProfileForVendor("other", "generic_switch"));
    assert.deepEqual(variantiPer("other", "switch"), ["generic_switch"]);
  });

  const apparato = (o: Partial<NetworkDevice>) =>
    ({ vendor: "other", protocol: "snmp_v2", device_type: "switch", classification: "switch", ...o }) as NetworkDevice;

  it("uno switch sotto «Altro» si interroga come switch, non come Linux", () => {
    assert.equal(tipoLetturaApparato(apparato({ product_profile: "generic_switch" })).tipo, "switch");
  });

  it("un altro «Altro» resta sul ramo di sempre", () => {
    assert.equal(tipoLetturaApparato(apparato({ product_profile: "generic_iot" })).tipo, "ssh");
  });
});
