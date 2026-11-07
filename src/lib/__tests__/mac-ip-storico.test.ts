/**
 * Lo storico MAC-IP registra i cambi, non i passaggi fra IP che il MAC ha insieme.
 *
 * Incidente 07/11/2026: `mac_ip_mapping` tiene un solo IP per MAC. Un MAC con più IP
 * (router con più VLAN, bridge Proxmox, due host col MAC uguale) lo cambiava a ogni
 * lettura, e ogni passaggio finiva in `mac_ip_history`: sull'hub 13,6 milioni di righe
 * per 772 coppie MAC/IP, 2,2 GB di database.
 */
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb } from "@/lib/db-hub";
import { deleteTenantDatabase, getTenantDb, upsertMacIpMapping, withTenant } from "@/lib/db-tenant";

const T = "TESTMACIPSTORICO";
const db = () => getTenantDb(T);
const MAC = "AA:00:00:00:00:01";
const A = "10.0.0.1";
const B = "10.0.0.2";
const C = "10.0.0.3";
const vede = (ip: string, source: "arp" | "host" = "arp") => withTenant(T, () => upsertMacIpMapping({ mac: MAC, ip, source }));
const storico = () => (db().prepare("SELECT ip FROM mac_ip_history ORDER BY id").all() as { ip: string }[]).map((r) => r.ip);

beforeEach(() => {
  db().exec("DELETE FROM mac_ip_history; DELETE FROM mac_ip_mapping;");
});
after(() => {
  deleteTenantDatabase(T);
  closeHubDb();
  removeTestHubDb();
});

test("un MAC che alterna due IP lascia una riga per coppia, non una a ogni giro", () => {
  vede(A);
  for (let giro = 0; giro < 50; giro++) {
    vede(B);
    vede(A);
  }
  assert.deepEqual(storico(), [B, A]);
});

test("anche quando la fonte cambia a ogni passaggio (ARP e scansione host)", () => {
  vede(A, "host");
  for (let giro = 0; giro < 10; giro++) {
    vede(B, "arp");
    vede(A, "host");
  }
  assert.deepEqual(storico(), [B, A]);
});

test("un IP mai visto si registra subito: un cambio vero non si perde", () => {
  vede(A);
  vede(B);
  vede(A);
  vede(C);
  assert.deepEqual(storico(), [B, A, C]);
});

test("una coppia non vista da più di un giorno si registra di nuovo: un ritorno resta nello storico", () => {
  vede(A);
  vede(B);
  vede(A);
  db().exec("UPDATE mac_ip_history SET changed_at = datetime('now', '-25 hours')");
  vede(B);
  assert.deepEqual(storico(), [B, A, B]);
});

test("la mappa segue comunque l'ultimo IP visto", () => {
  vede(A);
  vede(B);
  vede(A);
  vede(B);
  const riga = db().prepare("SELECT ip, previous_ip FROM mac_ip_mapping").get() as { ip: string; previous_ip: string };
  assert.deepEqual({ ...riga }, { ip: B, previous_ip: A });
});

test("il controllo non scorre le righe del MAC: su uno storico grande sarebbe una scansione a ogni passaggio", () => {
  const piano = db().prepare(`EXPLAIN QUERY PLAN
    SELECT 1 FROM mac_ip_history WHERE mac_normalized = ? AND ip = ? AND changed_at >= datetime('now', '-1 day')`).all("aa", A) as { detail: string }[];
  assert.match(piano.map((p) => p.detail).join(" "), /idx_mac_ip_history_coppia/);
});
