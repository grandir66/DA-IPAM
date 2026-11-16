/**
 * Il software di ESET nell'archivio del software (17/11/2026): si unisce in lettura a quello delle
 * sonde, solo per le macchine agganciate a un host; lo stesso programma da due fonti è una voce sola.
 * Run: node --import tsx --test src/lib/integrations/__tests__/eset-software.test.ts
 */
import "@/lib/__tests__/support/data-dir-isolata";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb } from "@/lib/db-hub";
import { closeTenantDb, deleteTenantDatabase, getAggregatedSoftware, getTenantDb, withTenant } from "@/lib/db-tenant";
import { assicuraSchemaEset } from "../eset-dalink";

const T = "PROVAESETSW";
after(() => {
  closeTenantDb(T);
  deleteTenantDatabase(T);
  closeHubDb();
});

test("il software ESET entra nell'archivio con la sua fonte, solo per le macchine agganciate", () => withTenant(T, () => {
  const d = getTenantDb(T);
  assicuraSchemaEset(d);
  const n = Number(d.prepare("INSERT INTO networks (cidr, name) VALUES ('10.7.0.0/24', 'lan')").run().lastInsertRowid);
  const h1 = Number(d.prepare("INSERT INTO hosts (network_id, ip, status, hostname) VALUES (?, '10.7.0.11', 'online', 'pc-uno')").run(n).lastInsertRowid);
  const h2 = Number(d.prepare("INSERT INTO hosts (network_id, ip, status, hostname) VALUES (?, '10.7.0.12', 'online', 'pc-due')").run(n).lastInsertRowid);
  // pc-uno ha una scansione della sonda con Chrome; pc-due non ne ha nessuna
  const scan = Number(d.prepare("INSERT INTO software_scans (host_id, started_at, status, os_family, probe) VALUES (?, datetime('now'), 'ok', 'windows', 'winrm')").run(h1).lastInsertRowid);
  d.prepare("INSERT INTO software_inventory (scan_id, name, version, publisher, source) VALUES (?, 'Google Chrome', '120', 'Google LLC', 'registry')").run(scan);
  const m = d.prepare("INSERT INTO eset_macchina (uuid, nome, mac, letto_il) VALUES (?, ?, '[]', '2026-11-17T08:00:00.000Z')");
  const a = d.prepare("INSERT INTO eset_abbinamento (macchina_uuid, host_id, per, a_mano, quando) VALUES (?, ?, 'nome', 0, 'x')");
  const s = d.prepare("INSERT INTO eset_software (macchina_uuid, nome, editore, versione) VALUES (?,?,?,?)");
  m.run("e1", "pc-uno"); a.run("e1", h1);
  m.run("e2", "pc-due"); a.run("e2", h2);
  m.run("e3", "non-agganciata"); a.run("e3", null);
  s.run("e1", "google chrome", "Google", "120");
  s.run("e2", "Google Chrome", "Google", "121");
  s.run("e2", "7-Zip", "Igor Pavlov", "23.01");
  s.run("e3", "Programma Fantasma", "", "1");

  const tutto = getAggregatedSoftware({ page: 1, pageSize: 100 });
  const per = Object.fromEntries(tutto.data.map((x) => [x.name.toLowerCase(), x]));
  assert.deepEqual(Object.keys(per).sort(), ["7-zip", "google chrome"]);
  // stessa voce da sonda ed ESET: una riga, due fonti, due host; nome ed editore restano quelli della sonda
  assert.deepEqual([...per["google chrome"]!.sources].sort(), ["ESET", "Probe"]);
  assert.equal(per["google chrome"]!.host_count, 2);
  assert.equal(per["google chrome"]!.name, "Google Chrome");
  assert.equal(per["google chrome"]!.publisher, "Google LLC");
  // un host senza scansione ma con ESET non resta vuoto
  assert.deepEqual(per["7-zip"]!.sources, ["ESET"]);
  assert.equal(per["7-zip"]!.host_count, 1);
  // il filtro per fonte
  const soloEset = getAggregatedSoftware({ page: 1, pageSize: 100, sources: ["ESET"] });
  assert.deepEqual(soloEset.data.map((x) => x.name.toLowerCase()).sort(), ["7-zip", "google chrome"]);
  const soloSonda = getAggregatedSoftware({ page: 1, pageSize: 100, sources: ["Probe"] });
  assert.deepEqual(soloSonda.data.map((x) => x.name), ["Google Chrome"]);
}));
