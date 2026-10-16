/**
 * La lista Dispositivi mostrava "Online" per ogni dispositivo ABILITATO in
 * anagrafica, acceso o spento che fosse, e il filtro Online/Offline guardava lo
 * stesso campo (difetto UI-8, analisi 2026-10-12). Lo stato vero è quello degli
 * host scansionati con lo stesso IP: `getHostStatusesByIp` lo legge per tutti i
 * dispositivi in una query sola.
 *
 * Gira su un tenant temporaneo: lanciare con DA_INVENT_DATA_DIR puntato a una
 * cartella di prova, come tutto `npm test`.
 */
process.env.ENCRYPTION_KEY ||= "test-encryption-key-host-status-by-ip";

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { withTenant, getTenantDb, deleteTenantDatabase, getHostStatusesByIp } from "@/lib/db-tenant";

const T = "TESTHOSTSTATUSBYIP";
after(() => deleteTenantDatabase(T));

test("stato per IP: un IP per host, il più recente se l'IP sta in più reti, assenti esclusi", () => {
  withTenant(T, () => {
    const db = getTenantDb(T);
    const rete = (cidr: string) =>
      Number(db.prepare("INSERT INTO networks (cidr, name) VALUES (?, ?)").run(cidr, cidr).lastInsertRowid);
    const a = rete("10.0.0.0/24");
    const b = rete("10.0.1.0/24");
    const host = db.prepare("INSERT INTO hosts (network_id, ip, status, last_seen) VALUES (?, ?, ?, ?)");
    host.run(a, "10.0.0.1", "online", "2026-10-12 08:00:00");
    host.run(a, "10.0.0.2", "offline", "2026-10-01 08:00:00");
    // stesso IP in due reti: vince quello visto più di recente
    host.run(a, "10.0.0.9", "offline", "2026-10-01 08:00:00");
    host.run(b, "10.0.0.9", "online", "2026-10-12 09:00:00");

    const stati = getHostStatusesByIp(["10.0.0.1", "10.0.0.2", "10.0.0.9", "10.0.0.77", "router.local", ""]);
    assert.deepEqual(stati.get("10.0.0.1"), { status: "online", last_seen: "2026-10-12 08:00:00" });
    assert.equal(stati.get("10.0.0.2")?.status, "offline");
    assert.deepEqual(stati.get("10.0.0.9"), { status: "online", last_seen: "2026-10-12 09:00:00" });
    assert.equal(stati.has("10.0.0.77"), false);
    assert.equal(stati.has("router.local"), false);
    assert.equal(getHostStatusesByIp([]).size, 0);
  });
});
