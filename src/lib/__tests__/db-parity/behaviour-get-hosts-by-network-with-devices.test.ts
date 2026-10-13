/**
 * `getHostsByNetworkWithDevices` (NUC-2 gruppo 2, T3-07): una copia sola,
 * quella tenant.
 *
 * La lista degli host di una rete porta il gruppo multi-indirizzo di ogni
 * host. La copia della facciata mostrava solo i peer nelle ALTRE reti e non
 * diceva chi è il primario; la copia tenant mostra tutti i peer del gruppo
 * (escluso l'host stesso) con `is_primary`, e il primario del gruppo. È la
 * forma che la pagina Discovery usa già.
 *
 * Misura sulla copia del DB DTS (13/10): 6 reti, 79 host su 114 con gruppo
 * cambiano lista dei peer; i peer mostrati passano da 348 a 934.
 */
import { TEST_DATA_DIR } from "../support/data-dir-isolata";

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import type Database from "better-sqlite3";
import * as facciata from "@/lib/db";
import * as tenant from "@/lib/db-tenant";
import { closeHubDb } from "@/lib/db-hub";
import { HOST, RETE_UFFICI, retiHostCredenziali } from "./gruppo1b/fixture";
import { nelTenant } from "./comportamento";

after(() => {
  facciata.closeDb();
  tenant.closeAllTenantDbs();
  closeHubDb();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

/**
 * Gruppo «srv»: server file e NAS (rete uffici) con il server db (rete server),
 * primario il server db. Gruppo «sw»: switch e pc, tutti e due nella rete uffici
 * (un gruppo dichiarato a mano, che non attraversa reti).
 */
function conGruppi(db: Database.Database): void {
  retiHostCredenziali(db);
  const l = db.prepare("INSERT INTO multihomed_links (group_id, host_id, match_type, match_value, is_primary) VALUES (?, ?, ?, ?, ?)");
  l.run("gruppo-srv", HOST.server, "hostname", "srv", 0);
  l.run("gruppo-srv", HOST.nas, "hostname", "srv", 0);
  l.run("gruppo-srv", HOST.srvDb, "hostname", "srv", 1);
  l.run("gruppo-sw", HOST.switchCore, "serial_number", "physical_device:1", 1);
  l.run("gruppo-sw", HOST.pcAmmin, "serial_number", "physical_device:1", 0);
}

function perId(rete: number) {
  return new Map(facciata.getHostsByNetworkWithDevices(rete).map((h) => [h.id, h]));
}

test("getHostsByNetworkWithDevices: i peer del gruppo sono tutti, anche nella stessa rete, con il primario", () => {
  const h = nelTenant("ghbnwdpeer", conGruppi, () => perId(RETE_UFFICI).get(HOST.server));
  assert.deepEqual(h?.multihomed, {
    group_id: "gruppo-srv",
    match_type: "hostname",
    is_primary: false,
    primary_host_id: HOST.srvDb,
    primary_ip: "10.41.0.10",
    peers: [
      { ip: "10.40.0.40", network_name: "Uffici", host_id: HOST.nas, is_primary: false },
      { ip: "10.41.0.10", network_name: "Server", host_id: HOST.srvDb, is_primary: true },
    ],
  });
});

test("getHostsByNetworkWithDevices: un gruppo tutto nella stessa rete si vede", () => {
  const h = nelTenant("ghbnwdstessarete", conGruppi, () => perId(RETE_UFFICI).get(HOST.switchCore));
  assert.equal(h?.multihomed?.is_primary, true);
  assert.deepEqual(h?.multihomed?.peers.map((p) => p.host_id), [HOST.pcAmmin]);
});

test("getHostsByNetworkWithDevices: un host fuori dai gruppi resta senza gruppo, la lista resta ordinata per IP", () => {
  const r = nelTenant("ghbnwdsenza", conGruppi, () => facciata.getHostsByNetworkWithDevices(RETE_UFFICI));
  assert.deepEqual(r.map((h) => h.ip), ["10.40.0.2", "10.40.0.20", "10.40.0.30", "10.40.0.40"]);
  const senza = nelTenant("ghbnwdsenza2", retiHostCredenziali, () => facciata.getHostsByNetworkWithDevices(RETE_UFFICI));
  assert.ok(senza.every((h) => h.multihomed === null));
});
