/**
 * `recomputeMultihomedLinks` (NUC-2 gruppo 2, T3-07): una copia sola, quella
 * tenant.
 *
 * Il ricalcolo dei gruppi multi-indirizzo (stesso apparato con IP in reti
 * diverse) girava in due versioni: la discovery chiamava quella della
 * facciata, il riconoscimento degli apparati e la pagina di ricalcolo quella
 * tenant, e la tabella prendeva la forma dell'ultima che era passata. La copia
 * tenant raggruppa anche per apparato fisico dichiarato (`physical_device_id`),
 * pure nella stessa rete; per le altre chiavi resta la regola «reti diverse».
 *
 * Misura sulla copia del DB DTS (13/10): nessun host ha un apparato fisico;
 * le due copie danno gli stessi 34 gruppi e 221 legami.
 */
import { TEST_DATA_DIR } from "../support/data-dir-isolata";

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import type Database from "better-sqlite3";
import * as facciata from "@/lib/db";
import * as tenant from "@/lib/db-tenant";
import { closeHubDb } from "@/lib/db-hub";
import { HOST, RETE_SERVER, RETE_UFFICI, retiHostCredenziali } from "./gruppo1b/fixture";
import { nelTenant } from "./comportamento";

after(() => {
  facciata.closeDb();
  tenant.closeAllTenantDbs();
  closeHubDb();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

/**
 * Switch core e pc (rete uffici) dichiarati come lo stesso apparato fisico;
 * il server file ha un gemello per nome nella rete server; il NAS ha un
 * omonimo nella sua stessa rete.
 */
function conApparati(db: Database.Database): void {
  retiHostCredenziali(db);
  db.prepare("INSERT INTO physical_devices (id, vendor, model) VALUES (1, 'HP', 'Aruba 2930')").run();
  db.prepare("UPDATE hosts SET physical_device_id = 1 WHERE id IN (?, ?)").run(HOST.switchCore, HOST.pcAmmin);
  const h = db.prepare("INSERT INTO hosts (network_id, ip, hostname, status) VALUES (?, ?, ?, 'online')");
  h.run(RETE_SERVER, "10.41.0.30", "srv-file.dominio.local");
  h.run(RETE_UFFICI, "10.40.0.41", "nas-01");
}

function gruppi(db: Database.Database): number[][] {
  const righe = db.prepare("SELECT group_id, host_id FROM multihomed_links ORDER BY host_id").all() as { group_id: string; host_id: number }[];
  const per = new Map<string, number[]>();
  for (const r of righe) per.set(r.group_id, [...(per.get(r.group_id) ?? []), r.host_id]);
  return [...per.values()].sort((a, b) => a[0] - b[0]);
}

test("recomputeMultihomedLinks: l'apparato fisico dichiarato fa gruppo anche nella stessa rete", () => {
  const r = nelTenant("rmlfisico", conApparati, (db) => {
    const esito = facciata.recomputeMultihomedLinks();
    const srvFileGemello = (db.prepare("SELECT id FROM hosts WHERE ip = '10.41.0.30'").get() as { id: number }).id;
    return { esito, gruppi: gruppi(db), srvFileGemello };
  });
  assert.deepEqual(r.esito, { groups: 2, hosts_linked: 4 });
  assert.deepEqual(r.gruppi, [[HOST.switchCore, HOST.pcAmmin], [HOST.server, r.srvFileGemello]]);
});

test("recomputeMultihomedLinks: lo stesso nome nella stessa rete non fa gruppo", () => {
  const r = nelTenant("rmlstessarete", conApparati, (db) => {
    facciata.recomputeMultihomedLinks();
    return db.prepare("SELECT COUNT(*) c FROM multihomed_links WHERE host_id = ?").get(HOST.nas) as { c: number };
  });
  assert.equal(r.c, 0);
});

test("recomputeMultihomedLinks: il primario è l'host gestito come apparato, poi l'IP più basso", () => {
  const primari = nelTenant("rmlprimario", conApparati, (db) => {
    facciata.recomputeMultihomedLinks();
    return (db.prepare("SELECT host_id FROM multihomed_links WHERE is_primary = 1 ORDER BY host_id").all() as { host_id: number }[]).map((x) => x.host_id);
  });
  // Lo switch core ha un apparato di rete sul suo IP; il server file ha l'IP più basso del suo gruppo.
  assert.deepEqual(primari, [HOST.switchCore, HOST.server]);
});
