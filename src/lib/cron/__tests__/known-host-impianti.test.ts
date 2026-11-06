/**
 * `known_host_check` su un impianto: resta il ping, niente ripiego TCP (72729, 06/11/2026). Un impianto
 * che tace non riceve una connessione in più; lo stesso vale nel secondo passaggio di `fast`.
 *
 * Run: DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test src/lib/cron/__tests__/known-host-impianti.test.ts
 */
import "@/lib/vuln/__tests__/support/dati-isolati";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { closeTenantDb, deleteTenantDatabase, getTenantDb, withTenant } from "@/lib/db-tenant";
import { closeHubDb } from "@/lib/db-hub";
import { runKnownHostCheck } from "@/lib/cron/jobs";
import { creaEsecutoreFinto, installaEsecutoreFinto, togliEsecutoreFinto } from "@/lib/scanner/__tests__/support/esecutore-finto";

const T = "KNOWNIMP06";

after(() => {
  togliEsecutoreFinto();
  try { closeTenantDb(T); deleteTenantDatabase(T); } catch { /* già tolto */ }
  closeHubDb();
});

test("un PC che tace riceve il TCP, un impianto no", async () => {
  await withTenant(T, async () => {
    const d = getTenantDb(T);
    const n = Number(d.prepare("INSERT INTO networks (cidr, name) VALUES ('10.8.0.0/24', 'x')").run().lastInsertRowid);
    const h = d.prepare("INSERT INTO hosts (network_id, ip, status, classification, vendor, known_host) VALUES (?, ?, 'online', ?, ?, 1)");
    h.run(n, "10.8.0.1", "workstation", "HP Inc.");
    h.run(n, "10.8.0.2", "unknown", "Kronotech Srl");
  });
  const toccati = new Set<string>();
  const { override } = creaEsecutoreFinto({ vivi: [] });
  installaEsecutoreFinto({
    ...override,
    tcpConnect: async (ip: string) => {
      toccati.add(ip);
      return false;
    },
  });
  await withTenant(T, () => runKnownHostCheck(null));
  assert.deepEqual([...toccati], ["10.8.0.1"]);
});
