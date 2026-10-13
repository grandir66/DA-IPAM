/**
 * `getHostById` (NUC-2 gruppo 2, T3-07): una copia sola, quella tenant.
 *
 * Il piano la elencava fra le funzioni che si comportano in modo diverso
 * (`is_primary` del gruppo multi-indirizzo). Le correzioni erano già arrivate
 * alla facciata: sulla copia del DB DTS (13/10) le due copie danno lo stesso
 * esito per tutti i 965 host. Questa prova fissa il comportamento voluto; la
 * prova che fallisce prima è quella d'identità (`db-facade-als.test.ts`).
 */
import { TEST_DATA_DIR } from "../support/data-dir-isolata";

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import type Database from "better-sqlite3";
import * as facciata from "@/lib/db";
import * as tenant from "@/lib/db-tenant";
import { closeHubDb } from "@/lib/db-hub";
import { APPARATO, HOST, retiHostCredenziali } from "./gruppo1b/fixture";
import { nelTenant } from "./comportamento";

after(() => {
  facciata.closeDb();
  tenant.closeAllTenantDbs();
  closeHubDb();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

/** Il server file (10.40.0.30) e il server db (10.41.0.10) sono lo stesso apparato; il primario è il secondo. */
function conGruppo(db: Database.Database): void {
  retiHostCredenziali(db);
  const l = db.prepare("INSERT INTO multihomed_links (group_id, host_id, match_type, match_value, is_primary) VALUES (?, ?, 'hostname', 'srv', ?)");
  l.run("gruppo-srv", HOST.server, 0);
  l.run("gruppo-srv", HOST.srvDb, 1);
  db.prepare("UPDATE hosts SET mac = '00:1A:2B:3C:4D:03' WHERE id = ?").run(HOST.server);
  // Lo stesso MAC visto da due switch nello stesso secondo: vale l'ultima riga scritta.
  const p = db.prepare("INSERT INTO mac_port_entries (device_id, mac, port_name, vlan, port_status, speed, timestamp) VALUES (?, ?, ?, ?, 'up', '1G', '2026-10-13 08:00:00')");
  p.run(APPARATO.switchCore, "00:1A:2B:3C:4D:03", "1/48", 1);
  p.run(APPARATO.switchCore, "00:1a:2b:3c:4d:03", "1/7", 10);
}

test("getHostById: il gruppo multi-indirizzo dice chi è il primario, anche per i peer", () => {
  const h = nelTenant("ghbidgruppo", conGruppo, () => facciata.getHostById(HOST.server));
  assert.ok(h?.multihomed);
  assert.equal(h.multihomed.is_primary, false);
  assert.equal(h.multihomed.primary_host_id, HOST.srvDb);
  assert.equal(h.multihomed.primary_ip, "10.41.0.10");
  assert.deepEqual(h.multihomed.peers, [{ ip: "10.41.0.10", network_name: "Server", host_id: HOST.srvDb, is_primary: true }]);
});

test("getHostById: la porta dello switch è quella dell'ultima riga scritta, non una a caso", () => {
  const h = nelTenant("ghbidporta", conGruppo, () => facciata.getHostById(HOST.server));
  assert.equal(h?.switch_port?.port_name, "1/7");
});

test("getHostById: un id che non c'è, nessun host", () => {
  assert.equal(nelTenant("ghbidassente", conGruppo, () => facciata.getHostById(999)), undefined);
});
