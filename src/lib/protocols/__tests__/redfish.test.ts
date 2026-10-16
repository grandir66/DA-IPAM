// src/lib/protocols/__tests__/redfish.test.ts
import { describe, it } from "node:test";
import assert from "node:assert";
import {
  redfishEvidence,
  parseServiceRoot,
  parseSystemResource,
  parseFirstMemberPath,
  parseManagerFirmware,
  type RedfishInfo,
} from "../redfish";

function info(partial: Partial<RedfishInfo>): RedfishInfo {
  return {
    manufacturer: null,
    model: null,
    serialNumber: null,
    biosVersion: null,
    bmcFirmware: null,
    powerState: null,
    healthStatus: null,
    hostName: null,
    sku: null,
    ...partial,
  };
}

// ---------------------------------------------------------------------------
// redfishEvidence — tabellare (HPE/Dell/Lenovo, campi mancanti, placeholder)
// ---------------------------------------------------------------------------

describe("redfishEvidence", () => {
  it("HPE ProLiant → category compute.server 0.95 + vendor hpe 0.95, model/serial in raw_value", () => {
    const ev = redfishEvidence(
      info({ manufacturer: "HPE", model: "ProLiant DL380 Gen10", serialNumber: "MXQ12345XY" })
    );
    const cat = ev.find((e) => e.dimension === "category");
    const vend = ev.find((e) => e.dimension === "vendor");
    assert.ok(cat && vend);
    assert.equal(cat.claim, "compute.server");
    assert.equal(cat.confidence, 0.95);
    assert.equal(cat.source, "redfish");
    assert.equal(cat.phase, "credential_validate");
    assert.equal(cat.raw_value, "ProLiant DL380 Gen10, MXQ12345XY");
    assert.equal(vend.claim, "hpe");
    assert.equal(vend.confidence, 0.95);
    assert.equal(vend.raw_value, "HPE");
    assert.equal(ev.find((e) => e.dimension === "os"), undefined, "nessun claim os dal BMC");
  });

  it("Dell PowerEdge (manufacturer 'Dell Inc.') → vendor dell via vendorSlug", () => {
    const ev = redfishEvidence(
      info({ manufacturer: "Dell Inc.", model: "PowerEdge R740", serialNumber: "ABC1234" })
    );
    assert.equal(ev.find((e) => e.dimension === "vendor")?.claim, "dell");
    assert.equal(ev.find((e) => e.dimension === "category")?.claim, "compute.server");
  });

  it("Lenovo ThinkSystem → vendor lenovo", () => {
    const ev = redfishEvidence(
      info({ manufacturer: "Lenovo", model: "ThinkSystem SR650", serialNumber: "J10029A1" })
    );
    assert.equal(ev.find((e) => e.dimension === "vendor")?.claim, "lenovo");
  });

  it("campi mancanti (model/serial null) → category comunque presente, raw_value null", () => {
    const ev = redfishEvidence(info({ manufacturer: "HPE" }));
    const cat = ev.find((e) => e.dimension === "category");
    assert.ok(cat);
    assert.equal(cat.raw_value, null);
  });

  it("manufacturer assente (null) → nessuna evidenza vendor, category comunque presente", () => {
    const ev = redfishEvidence(info({ model: "ProLiant DL360" }));
    assert.equal(ev.find((e) => e.dimension === "vendor"), undefined);
    assert.ok(ev.find((e) => e.dimension === "category"));
  });

  it("manufacturer placeholder ('Unknown') → nessuna evidenza vendor", () => {
    const ev = redfishEvidence(info({ manufacturer: "Unknown", model: "X" }));
    assert.equal(ev.find((e) => e.dimension === "vendor"), undefined);
    assert.ok(ev.find((e) => e.dimension === "category"));
  });

  it("manufacturer placeholder ('N/A', case-insensitive) → nessuna evidenza vendor", () => {
    const ev = redfishEvidence(info({ manufacturer: "n/a" }));
    assert.equal(ev.find((e) => e.dimension === "vendor"), undefined);
  });
});

// ---------------------------------------------------------------------------
// parseServiceRoot — fixture reali abbreviate
// ---------------------------------------------------------------------------

describe("parseServiceRoot", () => {
  it("HPE iLO5: @odata.id + RedfishVersion + Oem.Hpe → present:true, vendorHint 'Hpe'", () => {
    const body = JSON.stringify({
      "@odata.id": "/redfish/v1/",
      "@odata.type": "#ServiceRoot.v1_5_0.ServiceRoot",
      Id: "RootService",
      Name: "HPE RESTful Root Service",
      RedfishVersion: "1.6.1",
      Systems: { "@odata.id": "/redfish/v1/Systems" },
      Managers: { "@odata.id": "/redfish/v1/Managers" },
      Oem: { Hpe: { Manager: [] } },
    });
    const r = parseServiceRoot(body);
    assert.equal(r.present, true);
    assert.equal(r.vendorHint, "Hpe");
  });

  it("Dell iDRAC9: campo Vendor diretto → vendorHint 'Dell'", () => {
    const body = JSON.stringify({
      "@odata.id": "/redfish/v1/",
      RedfishVersion: "1.8.0",
      Vendor: "Dell",
      Systems: { "@odata.id": "/redfish/v1/Systems" },
      Managers: { "@odata.id": "/redfish/v1/Managers" },
    });
    const r = parseServiceRoot(body);
    assert.equal(r.present, true);
    assert.equal(r.vendorHint, "Dell");
  });

  it("Lenovo XClarity: solo RedfishVersion + Oem.Lenovo → present:true, vendorHint 'Lenovo'", () => {
    const body = JSON.stringify({
      "@odata.id": "/redfish/v1/",
      RedfishVersion: "1.9.0",
      Systems: { "@odata.id": "/redfish/v1/Systems" },
      Managers: { "@odata.id": "/redfish/v1/Managers" },
      Oem: { Lenovo: { "@odata.type": "#LenovoServiceRoot.v1_0_0.LenovoServiceRoot" } },
    });
    const r = parseServiceRoot(body);
    assert.equal(r.present, true);
    assert.equal(r.vendorHint, "Lenovo");
  });

  it("solo RedfishVersion, senza @odata.id → present:true comunque", () => {
    const r = parseServiceRoot(JSON.stringify({ RedfishVersion: "1.0.0" }));
    assert.equal(r.present, true);
  });

  it("JSON valido ma non-Redfish (nessun @odata.id/RedfishVersion) → present:false", () => {
    const r = parseServiceRoot(JSON.stringify({ status: "ok", uptime: 12345 }));
    assert.equal(r.present, false);
    assert.equal(r.vendorHint, null);
  });

  it("JSON malformato → present:false, nessuna eccezione", () => {
    assert.doesNotThrow(() => parseServiceRoot("{not valid json"));
    const r = parseServiceRoot("{not valid json");
    assert.equal(r.present, false);
    assert.equal(r.vendorHint, null);
  });

  it("body vuoto → present:false", () => {
    const r = parseServiceRoot("");
    assert.equal(r.present, false);
  });

  it("JSON valido ma non è un oggetto (array) → present:false", () => {
    const r = parseServiceRoot("[1,2,3]");
    assert.equal(r.present, false);
  });
});

// ---------------------------------------------------------------------------
// parseSystemResource — fixture reali abbreviate
// ---------------------------------------------------------------------------

describe("parseSystemResource", () => {
  it("HPE: tutti i campi presenti", () => {
    const body = JSON.stringify({
      "@odata.id": "/redfish/v1/Systems/1",
      Manufacturer: "HPE",
      Model: "ProLiant DL380 Gen10",
      SerialNumber: "MXQ12345XY",
      SKU: "868703-B21",
      BiosVersion: "U30 v2.78",
      HostName: "ILOSGH942WX1N",
      PowerState: "On",
      Status: { Health: "OK", State: "Enabled" },
    });
    const sys = parseSystemResource(body);
    assert.ok(sys);
    assert.equal(sys.manufacturer, "HPE");
    assert.equal(sys.model, "ProLiant DL380 Gen10");
    assert.equal(sys.serialNumber, "MXQ12345XY");
    assert.equal(sys.sku, "868703-B21");
    assert.equal(sys.biosVersion, "U30 v2.78");
    assert.equal(sys.hostName, "ILOSGH942WX1N");
    assert.equal(sys.powerState, "On");
    assert.equal(sys.healthStatus, "OK");
  });

  it("Dell: HostName assente (null) → hostName null, resto dei campi presenti", () => {
    const body = JSON.stringify({
      "@odata.id": "/redfish/v1/Systems/System.Embedded.1",
      Manufacturer: "Dell Inc.",
      Model: "PowerEdge R740",
      SerialNumber: "ABC1234",
      SKU: "SKU=NotProvided;ModelName=PowerEdge R740",
      BiosVersion: "2.15.0",
      HostName: null,
      PowerState: "On",
      Status: { Health: "OK" },
    });
    const sys = parseSystemResource(body);
    assert.ok(sys);
    assert.equal(sys.hostName, null);
    assert.equal(sys.manufacturer, "Dell Inc.");
  });

  it("Status assente → healthStatus null, resto invariato", () => {
    const body = JSON.stringify({ Manufacturer: "Lenovo", Model: "ThinkSystem SR650" });
    const sys = parseSystemResource(body);
    assert.ok(sys);
    assert.equal(sys.healthStatus, null);
  });

  it("JSON malformato → null, nessuna eccezione", () => {
    assert.doesNotThrow(() => parseSystemResource("{broken"));
    assert.equal(parseSystemResource("{broken"), null);
  });

  it("JSON valido ma non oggetto → null", () => {
    assert.equal(parseSystemResource("42"), null);
  });
});

// ---------------------------------------------------------------------------
// parseFirstMemberPath / parseManagerFirmware
// ---------------------------------------------------------------------------

describe("parseFirstMemberPath", () => {
  it("Members con un elemento → primo @odata.id", () => {
    const body = JSON.stringify({
      "@odata.id": "/redfish/v1/Systems",
      "Members@odata.count": 1,
      Members: [{ "@odata.id": "/redfish/v1/Systems/1" }],
    });
    assert.equal(parseFirstMemberPath(body), "/redfish/v1/Systems/1");
  });

  it("Members vuoto → null", () => {
    const body = JSON.stringify({ Members: [] });
    assert.equal(parseFirstMemberPath(body), null);
  });

  it("Members assente → null", () => {
    assert.equal(parseFirstMemberPath(JSON.stringify({})), null);
  });

  it("JSON malformato → null", () => {
    assert.equal(parseFirstMemberPath("{oops"), null);
  });
});

describe("parseManagerFirmware", () => {
  it("FirmwareVersion presente → stringa", () => {
    const body = JSON.stringify({ "@odata.id": "/redfish/v1/Managers/1", FirmwareVersion: "2.44" });
    assert.equal(parseManagerFirmware(body), "2.44");
  });

  it("FirmwareVersion assente → null", () => {
    assert.equal(parseManagerFirmware(JSON.stringify({ Id: "1" })), null);
  });

  it("JSON malformato → null", () => {
    assert.equal(parseManagerFirmware("not json"), null);
  });
});
