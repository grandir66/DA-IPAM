// src/lib/protocols/__tests__/onvif.test.ts
import { describe, it } from "node:test";
import assert from "node:assert";
import crypto from "crypto";
import {
  onvifEvidence,
  parseDeviceInformation,
  buildWsSecurityHeader,
  type OnvifInfo,
} from "../onvif";

function info(partial: Partial<OnvifInfo>): OnvifInfo {
  return {
    manufacturer: null,
    model: null,
    firmwareVersion: null,
    serialNumber: null,
    hardwareId: null,
    ...partial,
  };
}

// ---------------------------------------------------------------------------
// Fixture SOAP realistiche abbreviate — namespace diversi per vendor, come
// osservato realmente (i prefissi non sono standardizzati fra implementazioni).
// ---------------------------------------------------------------------------

// Dahua: prefisso "tds:" sul body, nessun prefisso esplicito sui campi figli
// (eredita il default namespace) — caso reale che ha richiesto WS-Security
// per rispondere (dato dal campo 2026-07-28, 13 telecamere Dahua).
const DAHUA_RESPONSE = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">
  <soap:Body>
    <tds:GetDeviceInformationResponse xmlns:tds="http://www.onvif.org/ver10/device/wsdl">
      <tds:Manufacturer>Dahua</tds:Manufacturer>
      <tds:Model>IPC-HFW2231S-S-S2</tds:Model>
      <tds:FirmwareVersion>2.800.0000018.0.R</tds:FirmwareVersion>
      <tds:SerialNumber>4J0186FPAG00123</tds:SerialNumber>
      <tds:HardwareId>1.00</tds:HardwareId>
    </tds:GetDeviceInformationResponse>
  </soap:Body>
</soap:Envelope>`;

// Hikvision: prefisso "ns0:" generico (comune nei toolkit SOAP autogenerati).
const HIKVISION_RESPONSE = `<?xml version="1.0" encoding="UTF-8"?>
<env:Envelope xmlns:env="http://www.w3.org/2003/05/soap-envelope">
  <env:Body>
    <ns0:GetDeviceInformationResponse xmlns:ns0="http://www.onvif.org/ver10/device/wsdl">
      <ns0:Manufacturer>Hikvision</ns0:Manufacturer>
      <ns0:Model>DS-2CD2143G0-I</ns0:Model>
      <ns0:FirmwareVersion>V5.6.3 build 200909</ns0:FirmwareVersion>
      <ns0:SerialNumber>DS-2CD2143G0-I20200909AAWR123456789</ns0:SerialNumber>
      <ns0:HardwareId>88</ns0:HardwareId>
    </ns0:GetDeviceInformationResponse>
  </env:Body>
</env:Envelope>`;

// Axis: nessun prefisso sui figli (default namespace, comune sulle Axis).
const AXIS_RESPONSE = `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://www.w3.org/2003/05/soap-envelope">
  <SOAP-ENV:Body>
    <GetDeviceInformationResponse xmlns="http://www.onvif.org/ver10/device/wsdl">
      <Manufacturer>AXIS</Manufacturer>
      <Model>M3067-P</Model>
      <FirmwareVersion>10.12.220</FirmwareVersion>
      <SerialNumber>ACCC8ED4A1B2</SerialNumber>
      <HardwareId>M3067</HardwareId>
    </GetDeviceInformationResponse>
  </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;

const SOAP_FAULT_RESPONSE = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">
  <soap:Body>
    <soap:Fault>
      <soap:Code><soap:Value>soap:Sender</soap:Value></soap:Code>
      <soap:Reason><soap:Text xml:lang="en">Sender not Authorized</soap:Text></soap:Reason>
    </soap:Fault>
  </soap:Body>
</soap:Envelope>`;

// ---------------------------------------------------------------------------
// parseDeviceInformation — namespace-agnostico, mai eccezioni
// ---------------------------------------------------------------------------

describe("parseDeviceInformation", () => {
  it("Dahua (prefisso tds:) → tutti i campi estratti", () => {
    const info2 = parseDeviceInformation(DAHUA_RESPONSE);
    assert.ok(info2);
    assert.equal(info2.manufacturer, "Dahua");
    assert.equal(info2.model, "IPC-HFW2231S-S-S2");
    assert.equal(info2.firmwareVersion, "2.800.0000018.0.R");
    assert.equal(info2.serialNumber, "4J0186FPAG00123");
    assert.equal(info2.hardwareId, "1.00");
  });

  it("Hikvision (prefisso ns0:) → tutti i campi estratti indipendentemente dal prefisso", () => {
    const info2 = parseDeviceInformation(HIKVISION_RESPONSE);
    assert.ok(info2);
    assert.equal(info2.manufacturer, "Hikvision");
    assert.equal(info2.model, "DS-2CD2143G0-I");
    assert.equal(info2.firmwareVersion, "V5.6.3 build 200909");
  });

  it("Axis (nessun prefisso, default namespace) → tutti i campi estratti", () => {
    const info2 = parseDeviceInformation(AXIS_RESPONSE);
    assert.ok(info2);
    assert.equal(info2.manufacturer, "AXIS");
    assert.equal(info2.model, "M3067-P");
    assert.equal(info2.serialNumber, "ACCC8ED4A1B2");
  });

  it("SOAP Fault (es. credenziali non valide) → null", () => {
    assert.equal(parseDeviceInformation(SOAP_FAULT_RESPONSE), null);
  });

  it("risposta vuota → null senza eccezioni", () => {
    assert.equal(parseDeviceInformation(""), null);
    assert.equal(parseDeviceInformation("   "), null);
  });

  it("XML malformato → null senza eccezioni", () => {
    assert.equal(parseDeviceInformation("<soap:Envelope><unclosed>"), null);
    assert.equal(parseDeviceInformation("{not xml at all}"), null);
    assert.equal(parseDeviceInformation("<<<>>>"), null);
  });

  it("XML valido ma senza alcun campo utile → null", () => {
    const xml = `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><tds:Empty xmlns:tds="x"/></soap:Body></soap:Envelope>`;
    assert.equal(parseDeviceInformation(xml), null);
  });
});

// ---------------------------------------------------------------------------
// buildWsSecurityHeader — digest WS-Security con nonce/created fissi (PURA)
// ---------------------------------------------------------------------------

describe("buildWsSecurityHeader", () => {
  it("digest deterministico per (user, pass, nonce, created) fissi", () => {
    const nonceB64 = Buffer.from("0123456789abcdef").toString("base64");
    const created = "2026-07-28T10:00:00.000Z";
    const header = buildWsSecurityHeader("admin", "s3cr3t", nonceB64, created);

    // Digest atteso ricalcolato indipendentemente con lo stesso algoritmo
    // (SHA1(nonceBytes + createdUtf8 + passwordUtf8), Base64) — verifica che
    // la funzione non silenziosamente cambi ordine/encoding.
    const expectedDigest = crypto
      .createHash("sha1")
      .update(Buffer.concat([Buffer.from(nonceB64, "base64"), Buffer.from(created, "utf8"), Buffer.from("s3cr3t", "utf8")]))
      .digest("base64");

    assert.ok(header.includes(`<wsse:Username>admin</wsse:Username>`));
    assert.ok(header.includes(`>${expectedDigest}<`));
    assert.ok(header.includes(`<wsse:Nonce EncodingType`));
    assert.ok(header.includes(nonceB64));
    assert.ok(header.includes(created));
    assert.ok(header.includes("PasswordDigest"));
  });

  it("stesso input → stesso output (determinismo, nessuna randomness interna)", () => {
    const nonceB64 = Buffer.from("fixed-nonce-bytes").toString("base64");
    const created = "2026-01-01T00:00:00.000Z";
    const h1 = buildWsSecurityHeader("user1", "pass1", nonceB64, created);
    const h2 = buildWsSecurityHeader("user1", "pass1", nonceB64, created);
    assert.equal(h1, h2);
  });

  it("password diversa → digest diverso", () => {
    const nonceB64 = Buffer.from("same-nonce-here!").toString("base64");
    const created = "2026-01-01T00:00:00.000Z";
    const h1 = buildWsSecurityHeader("user1", "pass1", nonceB64, created);
    const h2 = buildWsSecurityHeader("user1", "pass2", nonceB64, created);
    assert.notEqual(h1, h2);
  });

  it("username con caratteri XML speciali → escaping corretto", () => {
    const nonceB64 = Buffer.from("nonce-bytes-here").toString("base64");
    const header = buildWsSecurityHeader("a&b<c>", "pass", nonceB64, "2026-01-01T00:00:00.000Z");
    assert.ok(header.includes("a&amp;b&lt;c&gt;"));
    assert.ok(!header.includes("<c>")); // non deve comparire il tag non escapato
  });
});

// ---------------------------------------------------------------------------
// onvifEvidence — tabellare (Dahua/Hikvision/Axis, campi mancanti, placeholder)
// ---------------------------------------------------------------------------

describe("onvifEvidence", () => {
  it("Dahua → category av.camera 0.95 + vendor dahua 0.95, model/firmware in raw_value", () => {
    const ev = onvifEvidence(info({ manufacturer: "Dahua", model: "IPC-HFW2231S-S-S2", firmwareVersion: "2.800.0000018.0.R" }));
    const cat = ev.find((e) => e.dimension === "category");
    const vend = ev.find((e) => e.dimension === "vendor");
    assert.ok(cat && vend);
    assert.equal(cat.claim, "av.camera");
    assert.equal(cat.confidence, 0.95);
    assert.equal(cat.source, "onvif");
    assert.equal(cat.phase, "credential_validate");
    assert.equal(cat.raw_value, "IPC-HFW2231S-S-S2, 2.800.0000018.0.R");
    assert.equal(vend.claim, "dahua");
    assert.equal(vend.confidence, 0.95);
    assert.equal(vend.raw_value, "Dahua");
  });

  it("Hikvision → vendor hikvision", () => {
    const ev = onvifEvidence(info({ manufacturer: "Hikvision", model: "DS-2CD2143G0-I" }));
    assert.equal(ev.find((e) => e.dimension === "vendor")?.claim, "hikvision");
  });

  it("AXIS (maiuscolo) → vendor axis via vendorSlug", () => {
    const ev = onvifEvidence(info({ manufacturer: "AXIS", model: "M3067-P" }));
    assert.equal(ev.find((e) => e.dimension === "vendor")?.claim, "axis");
  });

  it("campi mancanti (model/firmware null) → category comunque presente, raw_value null", () => {
    const ev = onvifEvidence(info({ manufacturer: "Dahua" }));
    const cat = ev.find((e) => e.dimension === "category");
    assert.ok(cat);
    assert.equal(cat.raw_value, null);
  });

  it("manufacturer assente (null) → nessuna evidenza vendor, category comunque presente", () => {
    const ev = onvifEvidence(info({ model: "IPC-HFW2231S" }));
    assert.equal(ev.find((e) => e.dimension === "vendor"), undefined);
    assert.ok(ev.find((e) => e.dimension === "category"));
  });

  it("manufacturer placeholder ('Unknown') → nessuna evidenza vendor", () => {
    const ev = onvifEvidence(info({ manufacturer: "Unknown", model: "X" }));
    assert.equal(ev.find((e) => e.dimension === "vendor"), undefined);
    assert.ok(ev.find((e) => e.dimension === "category"));
  });
});
