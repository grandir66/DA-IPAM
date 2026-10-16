import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import Database from "better-sqlite3";
import { TENANT_SCHEMA_SQL, TENANT_INDEXES_SQL } from "@/lib/db-tenant-schema";
import { recordEvidence, getActiveEvidence, retireStaleEvidence, normalizeExpiresAt } from "../evidence";

let db: Database.Database;
beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(TENANT_SCHEMA_SQL);
  db.exec(TENANT_INDEXES_SQL);
  db.exec("INSERT INTO networks (id, name, cidr) VALUES (1, 'n', '10.0.0.0/24')");
  db.exec("INSERT INTO hosts (id, network_id, ip) VALUES (1, 1, '10.0.0.1')");
});

describe("recordEvidence", () => {
  it("inserisce evidenza nuova con weight di default", () => {
    const r = recordEvidence(db, 1, [
      { source: "oui", phase: "scan_icmp", dimension: "vendor", claim: "ubiquiti", confidence: 0.9, raw_value: "Ubiquiti Inc" },
    ]);
    assert.equal(r.inserted, 1);
    const rows = getActiveEvidence(db, 1);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].weight, 0.9); // ATTR_SOURCE_WEIGHTS.oui
  });
  it("ri-emissione identica → refresh, non duplicato", () => {
    const input = { source: "oui" as const, phase: "scan_icmp" as const, dimension: "vendor" as const, claim: "ubiquiti", confidence: 0.9, raw_value: "Ubiquiti Inc" };
    recordEvidence(db, 1, [input]);
    const r2 = recordEvidence(db, 1, [input]);
    assert.equal(r2.refreshed, 1);
    assert.equal(r2.inserted, 0);
    assert.equal(getActiveEvidence(db, 1).length, 1);
  });
  it("claim diverso dalla stessa (source,dimension) → supersede", () => {
    recordEvidence(db, 1, [{ source: "hostname", phase: "scan_icmp", dimension: "category", claim: "network.access_point", confidence: 0.5 }]);
    const r2 = recordEvidence(db, 1, [{ source: "hostname", phase: "scan_icmp", dimension: "category", claim: "network.switch", confidence: 0.5 }]);
    assert.equal(r2.inserted, 1);
    assert.equal(r2.superseded, 1);
    const active = getActiveEvidence(db, 1);
    assert.equal(active.length, 1);
    assert.equal(active[0].claim, "network.switch");
    const all = db.prepare("SELECT COUNT(*) AS n FROM attribution_evidence WHERE host_id=1").get() as { n: number };
    assert.equal(all.n, 2); // la storia resta
  });
  it("manual non viene mai superseded da sorgenti automatiche", () => {
    recordEvidence(db, 1, [{ source: "manual", phase: "manual", dimension: "category", claim: "network.switch", confidence: 1 }]);
    recordEvidence(db, 1, [{ source: "hostname", phase: "scan_icmp", dimension: "category", claim: "network.access_point", confidence: 0.5 }]);
    const active = getActiveEvidence(db, 1);
    assert.ok(active.some((e) => e.source === "manual" && e.claim === "network.switch"));
  });
  it("nuovo manual supersede il manual precedente sulla stessa dimensione", () => {
    recordEvidence(db, 1, [{ source: "manual", phase: "manual", dimension: "category", claim: "network.switch", confidence: 1 }]);
    recordEvidence(db, 1, [{ source: "manual", phase: "manual", dimension: "category", claim: "network.router", confidence: 1 }]);
    const manuals = getActiveEvidence(db, 1).filter((e) => e.source === "manual");
    assert.equal(manuals.length, 1);
    assert.equal(manuals[0].claim, "network.router");
  });

  it("caso reale QNAP: claim co-emessi nello stesso batch dalla stessa (source,dimension) NON si superseded a vicenda", () => {
    const r = recordEvidence(db, 1, [
      { source: "mdns", phase: "scan_icmp", dimension: "category", claim: "storage.nas", confidence: 0.8 },
      { source: "mdns", phase: "scan_icmp", dimension: "category", claim: "compute", confidence: 0.5 },
    ]);
    assert.equal(r.inserted, 2);
    assert.equal(r.superseded, 0);
    const active = getActiveEvidence(db, 1).filter((e) => e.source === "mdns" && e.dimension === "category");
    const claims = active.map((e) => e.claim).sort();
    assert.deepEqual(claims, ["compute", "storage.nas"]);
  });

  it("batch successivo con un solo claim della coppia (source,dimension) → l'altro viene superseded, quello ripetuto refreshato", () => {
    recordEvidence(db, 1, [
      { source: "mdns", phase: "scan_icmp", dimension: "category", claim: "storage.nas", confidence: 0.8 },
      { source: "mdns", phase: "scan_icmp", dimension: "category", claim: "compute", confidence: 0.5 },
    ]);
    const r2 = recordEvidence(db, 1, [
      { source: "mdns", phase: "scan_icmp", dimension: "category", claim: "storage.nas", confidence: 0.8 },
    ]);
    assert.equal(r2.refreshed, 1);
    assert.equal(r2.superseded, 1);
    const active = getActiveEvidence(db, 1).filter((e) => e.source === "mdns" && e.dimension === "category");
    assert.equal(active.length, 1);
    assert.equal(active[0].claim, "storage.nas");
  });

  it("regressione: batch con claim diverso non tocca una riga attiva preesistente di ALTRA sorgente", () => {
    recordEvidence(db, 1, [{ source: "hostname", phase: "scan_icmp", dimension: "category", claim: "network.access_point", confidence: 0.5 }]);
    recordEvidence(db, 1, [{ source: "mdns", phase: "scan_icmp", dimension: "category", claim: "storage.nas", confidence: 0.8 }]);
    const active = getActiveEvidence(db, 1);
    assert.ok(active.some((e) => e.source === "hostname" && e.claim === "network.access_point"));
    assert.ok(active.some((e) => e.source === "mdns" && e.claim === "storage.nas"));
  });

  it("manual non viene mai superseded da un batch multi-claim di sorgenti automatiche", () => {
    recordEvidence(db, 1, [{ source: "manual", phase: "manual", dimension: "category", claim: "network.switch", confidence: 1 }]);
    recordEvidence(db, 1, [
      { source: "mdns", phase: "scan_icmp", dimension: "category", claim: "storage.nas", confidence: 0.8 },
      { source: "mdns", phase: "scan_icmp", dimension: "category", claim: "compute", confidence: 0.5 },
    ]);
    const active = getActiveEvidence(db, 1);
    assert.ok(active.some((e) => e.source === "manual" && e.claim === "network.switch"));
  });
});

describe("retireStaleEvidence", () => {
  it("ritira (expires_at valorizzato) una riga attiva la cui source è ricalcolata ma il claim non è più tra gli emitted", () => {
    recordEvidence(db, 1, [{ source: "oui", phase: "scan_icmp", dimension: "vendor", claim: "genericvendor", confidence: 0.9, raw_value: "Generic Vendor Inc" }]);
    const n = retireStaleEvidence(db, 1, [], ["oui"]);
    assert.equal(n, 1);
    const row = db.prepare("SELECT expires_at FROM attribution_evidence WHERE host_id=1 AND source='oui'").get() as { expires_at: string | null };
    assert.ok(row.expires_at, "expires_at deve essere valorizzato dal ritiro");
    // resta in storia: superseded_by non viene toccato, getActiveEvidence continua a vederla
    // (l'esclusione dalla FUSIONE è responsabilità di fuseAttribution via il filtro expires_at)
    assert.equal(getActiveEvidence(db, 1).length, 1);
  });
  it("NON ritira se il claim è ancora presente in emitted", () => {
    const input = { source: "oui" as const, phase: "scan_icmp" as const, dimension: "vendor" as const, claim: "ubiquiti", confidence: 0.9, raw_value: "Ubiquiti Inc" };
    recordEvidence(db, 1, [input]);
    const n = retireStaleEvidence(db, 1, [input], ["oui"]);
    assert.equal(n, 0);
    const row = db.prepare("SELECT expires_at FROM attribution_evidence WHERE host_id=1 AND source='oui'").get() as { expires_at: string | null };
    assert.equal(row.expires_at, null);
  });
  it("non tocca source non incluse nella lista sources passata", () => {
    recordEvidence(db, 1, [{ source: "hostname", phase: "scan_icmp", dimension: "category", claim: "network.access_point", confidence: 0.5 }]);
    const n = retireStaleEvidence(db, 1, [], ["oui"]); // "hostname" non è in sources
    assert.equal(n, 0);
    const row = db.prepare("SELECT expires_at FROM attribution_evidence WHERE host_id=1 AND source='hostname'").get() as { expires_at: string | null };
    assert.equal(row.expires_at, null);
  });
  it("non ritira MAI source='manual', anche se passata esplicitamente in sources", () => {
    recordEvidence(db, 1, [{ source: "manual", phase: "manual", dimension: "category", claim: "network.switch", confidence: 1 }]);
    const n = retireStaleEvidence(db, 1, [], ["manual", "oui"]);
    assert.equal(n, 0);
    const row = db.prepare("SELECT expires_at FROM attribution_evidence WHERE host_id=1 AND source='manual'").get() as { expires_at: string | null };
    assert.equal(row.expires_at, null);
  });
  it("nessuna riga attiva per le sources indicate → 0, nessun errore", () => {
    assert.equal(retireStaleEvidence(db, 1, [], ["oui", "wazuh"]), 0);
  });

  it("formati datetime incoerenti: expires_at ISO nel futuro è ATTIVA (candidata al ritiro), ISO nel passato è già esclusa", () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    recordEvidence(db, 1, [
      { source: "dhcp", phase: "scan_icmp", dimension: "vendor", claim: "vendor-a", confidence: 0.5, expires_at: future },
    ]);
    recordEvidence(db, 1, [
      { source: "ttl", phase: "scan_icmp", dimension: "os", claim: "linux", confidence: 0.5, expires_at: past },
    ]);
    // emitted vuoto: entrambe le sources sono candidate al ritiro (nessun claim ri-emesso).
    // Solo la riga ATTIVA (expires_at futuro) deve essere effettivamente ritirata da questa
    // chiamata: quella già scaduta (expires_at passato) è già esclusa dal filtro "attive ai
    // fini della fusione" e retireStaleEvidence non la deve toccare di nuovo.
    const n = retireStaleEvidence(db, 1, [], ["dhcp", "ttl"]);
    assert.equal(n, 1);
    const dhcpRow = db.prepare("SELECT expires_at FROM attribution_evidence WHERE host_id=1 AND source='dhcp'").get() as { expires_at: string };
    assert.notEqual(dhcpRow.expires_at, future, "la riga futura deve essere stata ritirata (expires_at riportato a ora)");
    const ttlRow = db.prepare("SELECT expires_at FROM attribution_evidence WHERE host_id=1 AND source='ttl'").get() as { expires_at: string };
    assert.equal(ttlRow.expires_at, past, "la riga già scaduta non va toccata di nuovo");
  });
});

describe("normalizeExpiresAt", () => {
  it("input ISO → invariato", () => {
    assert.equal(normalizeExpiresAt("2026-07-27T12:00:00.000Z"), "2026-07-27T12:00:00.000Z");
  });
  it("input formato SQLite 'YYYY-MM-DD HH:MM:SS' → ISO equivalente (UTC)", () => {
    assert.equal(normalizeExpiresAt("2026-07-27 12:00:00"), "2026-07-27T12:00:00.000Z");
  });
  it("null → null", () => {
    assert.equal(normalizeExpiresAt(null), null);
  });
  it("undefined → null", () => {
    assert.equal(normalizeExpiresAt(undefined), null);
  });
  it("stringa non parsabile → null, nessuna eccezione", () => {
    assert.doesNotThrow(() => normalizeExpiresAt("non-una-data"));
    assert.equal(normalizeExpiresAt("non-una-data"), null);
  });
});
