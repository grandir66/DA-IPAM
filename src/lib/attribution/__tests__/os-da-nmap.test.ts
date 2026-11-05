/**
 * L'OS visto da nmap deve arrivare in tabella (Riccardo, 05/11/2026: «il detect dei
 * sistemi operativi del nmap aggiuntivo non riporta alcun dato alle tabelle delle subnet»).
 *
 * Il difetto non era l'evidenza mancante — c'era, `nmap_os` con confidenza 0.7 — ma
 * l'aritmetica: col peso 0.5 il punteggio era 0.35, sotto `MIN_CLAIM_SCORE` (0.56), e
 * **nessuna** confidenza poteva salvarlo (0.5 < 0.56). Misurato sul 72729: 9 host con
 * evidenza `linux` e la colonna vuota; sull'hub 31 su 378.
 *
 * Run: node --import tsx --test src/lib/attribution/__tests__/os-da-nmap.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fuseAttribution } from "../fuse";
import { ATTR_SOURCE_WEIGHTS } from "../weights";
import { MIN_CLAIM_SCORE } from "../types";
import { emitEvidenceFromSignals } from "../emitters";
import type { AttributionEvidenceRow } from "../types";

const ORA = "2026-11-05T01:00:00Z";
let id = 1;
const ev = (
  p: Partial<AttributionEvidenceRow> & Pick<AttributionEvidenceRow, "source" | "dimension" | "claim">,
): AttributionEvidenceRow =>
  ({
    id: id++, host_id: 1, phase: "scan_nmap_base", confidence: 0.7,
    weight: ATTR_SOURCE_WEIGHTS[p.source], raw_value: null, observed_at: ORA,
    expires_at: null, superseded_by: null, ...p,
  }) as AttributionEvidenceRow;

const segnali = (osInfo: string | null) => ({
  host: {
    id: 1, ip: "192.168.0.12", mac: null, vendor: null, hostname: null,
    os_info: osInfo, open_ports: null, snmp_data: null, detection_json: null,
  },
  adComputer: null,
  wazuh: null,
  neighborSightings: [],
});

describe("peso di nmap_os", () => {
  it("un host che solo nmap conosce ottiene la famiglia: il punteggio supera la soglia", () => {
    const r = fuseAttribution([ev({ source: "nmap_os", dimension: "os", claim: "linux", raw_value: "Linux 3.2 - 3.8" })], ORA);
    assert.equal(r.os.claim, "linux");
    assert.equal(r.os.os_name, "Linux 3.2 - 3.8", "il nome grezzo va in attr_os_name");
  });

  it("il conto è esplicito: peso per confidenza non può stare sotto la soglia", () => {
    assert.ok(
      ATTR_SOURCE_WEIGHTS.nmap_os * 0.7 >= MIN_CLAIM_SCORE,
      `nmap_os ${ATTR_SOURCE_WEIGHTS.nmap_os} x 0.7 = ${ATTR_SOURCE_WEIGHTS.nmap_os * 0.7}, soglia ${MIN_CLAIM_SCORE}`,
    );
  });

  it("chi parla col sistema operativo vince comunque su nmap", () => {
    const r = fuseAttribution(
      [
        ev({ source: "nmap_os", dimension: "os", claim: "linux", raw_value: "Linux 3.2 - 3.8" }),
        ev({ source: "rdp_ntlm", dimension: "os", claim: "windows", confidence: 0.9, weight: ATTR_SOURCE_WEIGHTS.rdp_ntlm }),
      ],
      ORA,
    );
    assert.equal(r.os.claim, "windows", "rdp_ntlm 0.81 batte nmap_os 0.56");
  });

  it("anche SMB resta più forte di nmap", () => {
    const r = fuseAttribution(
      [
        ev({ source: "nmap_os", dimension: "os", claim: "linux" }),
        ev({ source: "smb", dimension: "os", claim: "windows", confidence: 0.9, weight: ATTR_SOURCE_WEIGHTS.smb }),
      ],
      ORA,
    );
    assert.equal(r.os.claim, "windows");
  });

  it("netbios da solo continua a non bastare (0.5 x 0.45)", () => {
    const r = fuseAttribution([ev({ source: "netbios", dimension: "os", claim: "windows", confidence: 0.45, weight: ATTR_SOURCE_WEIGHTS.netbios })], ORA);
    assert.equal(r.os.claim, null);
  });
});

describe("famiglia dal testo di os_info", () => {
  const famiglia = (os: string | null): string | null => {
    const e = emitEvidenceFromSignals(segnali(os)).find((x) => x.dimension === "os");
    return e?.claim ?? null;
  };

  it("le stringhe vere del 72729 diventano famiglie", () => {
    assert.equal(famiglia("Linux 3.2 - 3.8"), "linux");
    assert.equal(famiglia("OpenWrt 19.07 (Linux 4.14)"), "linux");
    assert.equal(famiglia("Windows Server 2022 Standard"), "windows");
    assert.equal(famiglia("VMware ESXi 7.0.3 build 20036589"), "esxi");
  });

  it("ciò che non è un sistema operativo non diventa una famiglia inventata", () => {
    assert.equal(famiglia("HP iLO 4 or iLO 5 remote management interface"), null);
    assert.equal(famiglia("EPSON Built-in 11b/g/n & 10/100 Print Server"), null);
    assert.equal(famiglia("Crestron XPanel control system"), null);
    assert.equal(famiglia(null), null);
  });
});
