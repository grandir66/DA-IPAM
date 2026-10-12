/**
 * getStatusOverTime sul database vero: a parità di checked_at (risoluzione al
 * secondo) per lo stesso host deve valere la riga scritta per ultima. Prima
 * vinceva la più vecchia, e con l'ultimo stato portato avanti l'errore durava
 * fino al controllo successivo (revisione 2026-10-12).
 * Gira su un tenant temporaneo: lanciare con DA_INVENT_DATA_DIR di prova.
 */
process.env.ENCRYPTION_KEY ||= "test-encryption-key-status-over-time-db";

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { withTenant, getTenantDb, deleteTenantDatabase } from "@/lib/db-tenant";
import { getStatusOverTime } from "@/lib/db";

const T = "TESTSTATUSOVERTIME";
after(() => deleteTenantDatabase(T));

test("stesso secondo, stesso host: vale l'ultima riga scritta", () => {
  withTenant(T, () => {
    const db = getTenantDb(T);
    const rete = Number(db.prepare("INSERT INTO networks (cidr, name) VALUES ('10.9.0.0/24', 'prova')").run().lastInsertRowid);
    const host = (ip: string) => Number(db.prepare("INSERT INTO hosts (network_id, ip) VALUES (?, ?)").run(rete, ip).lastInsertRowid);
    const a = host("10.9.0.1");
    const b = host("10.9.0.2");
    const quando = new Date(Date.now() - 10 * 60_000).toISOString().replace("T", " ").slice(0, 19);
    const scrivi = db.prepare("INSERT INTO status_history (host_id, status, checked_at) VALUES (?, ?, ?)");
    scrivi.run(a, "online", quando);
    scrivi.run(a, "offline", quando); // scritta dopo: deve vincere
    scrivi.run(b, "offline", quando);
    scrivi.run(b, "online", quando); // scritta dopo: deve vincere
    const ultimo = getStatusOverTime(24).at(-1)!;
    assert.equal(ultimo.online, 1);
    assert.equal(ultimo.offline, 1);
  });
});

test("hours non numerico: niente eccezione", () => {
  withTenant(T, () => {
    assert.doesNotThrow(() => getStatusOverTime(Number("abc")));
  });
});
