/**
 * Host «assenti» (Riccardo, 20/10): offline e non visti da oltre 7 giorni non contano
 * fra gli offline né nel totale del grafico «Stato host nel tempo». Sull'hub la salute
 * in alto diceva 51% e il grafico 98%: 115 dei 178 offline non si vedevano da giorni.
 *
 * Run: node --import tsx --test src/lib/__tests__/assenti-salute.test.ts
 */
import "@/lib/__tests__/support/data-dir-isolata";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { closeTenantDb, deleteTenantDatabase, getStatusOverTime, getTenantDb, withTenant } from "@/lib/db-tenant";
import { closeHubDb } from "@/lib/db-hub";
import { condizioneAssente } from "@/lib/hosts/assenti";

const T = "ASSENTI2010";
after(() => {
  try { closeTenantDb(T); deleteTenantDatabase(T); } catch { /* già tolto */ }
  closeHubDb();
});

test("gli assenti restano fuori dal totale e dagli offline del grafico", () => {
  withTenant(T, () => {
    const d = getTenantDb(T);
    const rete = Number(d.prepare("INSERT INTO networks (cidr, name) VALUES ('10.77.0.0/24', 'r')").run().lastInsertRowid);
    const host = (ip: string, status: string, giorniFa: number | null) =>
      Number(d.prepare(`INSERT INTO hosts (network_id, ip, status, last_seen) VALUES (?, ?, ?, ${giorniFa === null ? "NULL" : `datetime('now', '-${giorniFa} days')`})`).run(rete, ip, status).lastInsertRowid);
    const vivo = host("10.77.0.1", "online", 0);
    const offRecente = host("10.77.0.2", "offline", 2);
    const assente = host("10.77.0.3", "offline", 40);
    host("10.77.0.4", "offline", null); // mai visto: assente
    const storico = d.prepare("INSERT INTO status_history (host_id, status, checked_at) VALUES (?, ?, datetime('now', '-1 hour'))");
    storico.run(vivo, "online");
    storico.run(offRecente, "offline");
    storico.run(assente, "offline"); // un controllo degli host noti sull'assente: non conta
    assert.equal((d.prepare(`SELECT COUNT(*) AS n FROM hosts WHERE ${condizioneAssente()}`).get() as { n: number }).n, 2);
    const ultimo = getStatusOverTime(24).at(-1)!;
    assert.equal(ultimo.total, 2);
    assert.equal(ultimo.online, 1);
    assert.equal(ultimo.offline, 1);
  });
});
