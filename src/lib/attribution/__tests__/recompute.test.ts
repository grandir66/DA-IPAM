import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import Database from "better-sqlite3";
import { TENANT_SCHEMA_SQL, TENANT_INDEXES_SQL } from "@/lib/db-tenant-schema";
import { recomputeHostAttribution } from "../recompute";
import { recordEvidence } from "../evidence";
import type { AttributionSignals } from "../emitters";

let db: Database.Database;
beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(TENANT_SCHEMA_SQL);
  db.exec(TENANT_INDEXES_SQL);
  // le colonne attr_* sono nel CREATE TABLE dello schema? No: vengono da ALTER in getTenantDb.
  // Nei test in-memory le aggiungiamo come farebbe la migrazione:
  for (const c of ["attr_vendor TEXT","attr_vendor_name TEXT","attr_category TEXT","attr_os_family TEXT","attr_os_name TEXT","attr_confidence_vendor INTEGER","attr_confidence_category INTEGER","attr_confidence_os INTEGER","attr_min_phase TEXT","attr_at TEXT","attr_engine_version TEXT"]) {
    try { db.exec(`ALTER TABLE hosts ADD COLUMN ${c}`); } catch { /* già presente */ }
  }
  db.exec("INSERT INTO networks (id, name, cidr) VALUES (1, 'n', '10.0.0.0/24')");
  db.exec("INSERT INTO hosts (id, network_id, ip, vendor, hostname) VALUES (1, 1, '10.0.0.1', 'Ubiquiti Inc', 'ap-piano2')");
});

function signals(): AttributionSignals {
  return {
    host: { id: 1, ip: "10.0.0.1", mac: "24:5a:4c:00:00:01", vendor: "Ubiquiti Inc", hostname: "ap-piano2", os_info: null, open_ports: null, snmp_data: JSON.stringify({ sysDescr: "U6-Pro 6.5.28", sysObjectID: "1.3.6.1.4.1.41112", collected_at: "x" }), detection_json: null },
    adComputer: null, wazuh: null, neighborSightings: [],
  };
}

describe("recomputeHostAttribution", () => {
  it("emette evidenze, fonde e scrive hosts.attr_*", () => {
    const r = recomputeHostAttribution(db, signals(), "scan");
    assert.equal(r.vendor.claim, "ubiquiti");
    assert.equal(r.category.claim, "network.access_point");
    const row = db.prepare("SELECT attr_vendor, attr_category, attr_confidence_category, attr_min_phase, attr_engine_version FROM hosts WHERE id=1").get() as Record<string, unknown>;
    assert.equal(row.attr_vendor, "ubiquiti");
    assert.equal(row.attr_category, "network.access_point");
    assert.ok((row.attr_confidence_category as number) >= 56);
    assert.equal(row.attr_min_phase, "scan_snmp_verify");
    assert.equal(row.attr_engine_version, "2.0.0");
    const hist = db.prepare("SELECT attr_category, trigger FROM host_classification_history WHERE host_id=1 ORDER BY id DESC LIMIT 1").get() as Record<string, unknown>;
    assert.equal(hist.attr_category, "network.access_point");
    assert.equal(hist.trigger, "scan");
  });
  it("è idempotente: secondo run non duplica evidenze né cambia l'esito", () => {
    recomputeHostAttribution(db, signals(), "scan");
    const n1 = (db.prepare("SELECT COUNT(*) n FROM attribution_evidence WHERE superseded_by IS NULL").get() as { n: number }).n;
    const r2 = recomputeHostAttribution(db, signals(), "scan");
    const n2 = (db.prepare("SELECT COUNT(*) n FROM attribution_evidence WHERE superseded_by IS NULL").get() as { n: number }).n;
    assert.equal(n1, n2);
    assert.equal(r2.category.claim, "network.access_point");
  });
  it("progressività: l'arrivo di SNMP non peggiora l'attribuzione da sola fase ICMP", () => {
    const icmpOnly = signals();
    icmpOnly.host.snmp_data = null;
    const r1 = recomputeHostAttribution(db, icmpOnly, "scan");
    const r2 = recomputeHostAttribution(db, signals(), "scan");
    // il claim di r2 deve essere uguale o più profondo di r1, mai contraddirlo salendo di livello
    if (r1.category.claim) {
      assert.ok(r2.category.claim === r1.category.claim || r2.category.claim?.startsWith(r1.category.claim.split(".")[0]));
    }
    assert.ok(r2.category.confidence >= r1.category.confidence);
  });
  it("write amplification: due recompute identici consecutivi scrivono una sola riga in history", () => {
    recomputeHostAttribution(db, signals(), "scan");
    recomputeHostAttribution(db, signals(), "scan");
    const n = (db.prepare("SELECT COUNT(*) n FROM host_classification_history WHERE host_id=1").get() as { n: number }).n;
    assert.equal(n, 1);
  });
});

// Gap ciclo di vita evidenze trovato in produzione: un emettitore che smette di produrre
// un claim (es. vendor placeholder ora filtrato) lasciava la vecchia riga attiva a
// vincere per sempre la fusione (5 host bloccati sul vendor placeholder). Fix:
// retireStaleEvidence chiamata da previewHostAttribution dopo ogni recordEvidence.
describe("ritiro evidenze non più emesse (retireStaleEvidence via recompute)", () => {
  function vendorOnlySignals(vendor: string | null): AttributionSignals {
    return {
      host: { id: 1, ip: "10.0.0.1", mac: "24:5a:4c:00:00:01", vendor, hostname: null, os_info: null, open_ports: null, snmp_data: null, detection_json: null },
      adComputer: null, wazuh: null, neighborSightings: [],
    };
  }

  it("(a) il vendor sparisce dal segnale → la fusione torna null e la riga viene ritirata (expires_at valorizzato)", () => {
    const r1 = recomputeHostAttribution(db, vendorOnlySignals("Ubiquiti Inc"), "scan");
    assert.equal(r1.vendor.claim, "ubiquiti");
    const before = db.prepare("SELECT expires_at FROM attribution_evidence WHERE host_id=1 AND source='oui' AND dimension='vendor'").get() as { expires_at: string | null };
    assert.equal(before.expires_at, null);

    // es. host.vendor tornato null, o ora è un placeholder che l'emettitore filtra
    const r2 = recomputeHostAttribution(db, vendorOnlySignals(null), "scan");
    assert.equal(r2.vendor.claim, null);
    const after = db.prepare("SELECT expires_at FROM attribution_evidence WHERE host_id=1 AND source='oui' AND dimension='vendor'").get() as { expires_at: string | null };
    assert.ok(after.expires_at, "expires_at deve essere valorizzato dopo il ritiro");
    const hostRow = db.prepare("SELECT attr_vendor FROM hosts WHERE id=1").get() as { attr_vendor: string | null };
    assert.equal(hostRow.attr_vendor, null, "hosts.attr_vendor deve seguire la fusione (null)");
  });

  it("(b) una ri-emissione identica successiva rianima l'evidenza: expires_at torna null, il claim torna a vincere", () => {
    recomputeHostAttribution(db, vendorOnlySignals("Ubiquiti Inc"), "scan");
    recomputeHostAttribution(db, vendorOnlySignals(null), "scan"); // ritira
    const r3 = recomputeHostAttribution(db, vendorOnlySignals("Ubiquiti Inc"), "scan"); // ri-emesso
    assert.equal(r3.vendor.claim, "ubiquiti");
    const row = db.prepare("SELECT expires_at FROM attribution_evidence WHERE host_id=1 AND source='oui' AND dimension='vendor'").get() as { expires_at: string | null };
    assert.equal(row.expires_at, null, "la rianimazione deve azzerare expires_at");
  });

  it("(c) un'evidenza manual non viene mai ritirata dal recompute, anche senza segnali automatici", () => {
    recordEvidence(db, 1, [{ source: "manual", phase: "manual", dimension: "vendor", claim: "manual-vendor", confidence: 1 }]);
    const r = recomputeHostAttribution(db, vendorOnlySignals(null), "scan"); // nessun segnale vendor automatico
    assert.equal(r.vendor.claim, "manual-vendor", "manual deve continuare a vincere la fusione");
    const row = db.prepare("SELECT expires_at FROM attribution_evidence WHERE host_id=1 AND source='manual'").get() as { expires_at: string | null };
    assert.equal(row.expires_at, null, "manual non deve mai essere ritirata");
  });
});
