/**
 * Gemelli di MAC (10/11/2026, hub 533): un PC che cambia IP lascia la riga vecchia senza evidenze.
 * La riga vecchia prende la categoria di quella nuova, ma solo se quella se la regge da sé.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { gemelloDiMac, MAX_RIGHE_STESSO_MAC } from "../gemelli";

let db: Database.Database;
function host(id: number, mac: string | null, categoria: string | null, fonte?: string, scaduta = false) {
  db.prepare("INSERT INTO hosts (id, ip, mac, attr_category) VALUES (?, ?, ?, ?)").run(id, `10.0.0.${id}`, mac, categoria);
  if (fonte) {
    db.prepare("INSERT INTO attribution_evidence (host_id, source, dimension, claim, expires_at, superseded_by) VALUES (?, ?, 'category', ?, ?, NULL)")
      .run(id, fonte, categoria, scaduta ? "2020-01-01T00:00:00.000Z" : null);
  }
}

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(`CREATE TABLE hosts (id INTEGER PRIMARY KEY, ip TEXT, mac TEXT, attr_category TEXT);
           CREATE TABLE attribution_evidence (id INTEGER PRIMARY KEY, host_id INTEGER, source TEXT, dimension TEXT, claim TEXT, expires_at TEXT, superseded_by INTEGER);`);
});

describe("gemelloDiMac", () => {
  it("stesso MAC, gemello con categoria propria → la prende", () => {
    host(1, "AA:AA", null); host(2, "AA:AA", "compute.workstation", "ad");
    assert.deepEqual(gemelloDiMac(db, 1), { categoria: "compute.workstation", ip: "10.0.0.2" });
  });
  it("il gemello che si regge solo su un altro gemello, o su un'evidenza scaduta, non conta", () => {
    host(1, "AA:AA", null); host(2, "AA:AA", "compute.workstation", "mac_gemello");
    assert.equal(gemelloDiMac(db, 1), null);
    host(3, "BB:BB", null); host(4, "BB:BB", "compute.workstation", "ad", true);
    assert.equal(gemelloDiMac(db, 3), null);
  });
  it("gemelli in disaccordo → niente", () => {
    host(1, "AA:AA", null); host(2, "AA:AA", "compute.workstation", "ad"); host(3, "AA:AA", "mobile.phone", "hostname");
    assert.equal(gemelloDiMac(db, 1), null);
  });
  it("senza MAC, o MAC su troppe righe (proxy ARP) → niente", () => {
    host(1, null, null); host(2, null, "network.router", "ports");
    assert.equal(gemelloDiMac(db, 1), null);
    for (let i = 10; i < 10 + MAX_RIGHE_STESSO_MAC + 1; i++) host(i, "CC:CC", i === 10 ? null : "network.router", i === 10 ? undefined : "ports");
    assert.equal(gemelloDiMac(db, 10), null);
  });
});
