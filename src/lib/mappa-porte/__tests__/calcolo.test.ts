// Il calcolo sul DB vero (in memoria): migrazione idempotente, ricalcolo, spostamenti, freno sull'ingresso vuoto.
import { TEST_DATA_DIR } from "@/lib/__tests__/support/data-dir-isolata";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { closeHubDb } from "@/lib/db-hub";
import { deleteTenantDatabase, getTenantDb, migrateMappaPorte, withTenant } from "@/lib/db-tenant";
import { cercaOggetti, cercaPorte, dettaglioOggetto, ricalcolaMappaPorte, statoCalcolo } from "@/lib/mappa-porte/calcolo";

void TEST_DATA_DIR;
const CODICE = "TESTMAPPAPORTE";
after(() => {
  deleteTenantDatabase(CODICE);
  closeHubDb();
});
const ORA = Date.parse("2026-11-07T12:00:00Z");

function prepara() {
  const d = getTenantDb(CODICE);
  d.prepare("DELETE FROM mappa_porte_oggetti").run();
  d.prepare("DELETE FROM mappa_porte_calcolo").run();
  d.prepare("DELETE FROM mac_port_entries").run();
  d.prepare("DELETE FROM network_devices").run();
  const id = Number(d.prepare("INSERT INTO network_devices (name, host, device_type, vendor, protocol) VALUES ('SW-UNO', '192.0.2.1', 'switch', 'ubiquiti', 'snmp_v2')").run().lastInsertRowid);
  const mac = (porta: string) => d.prepare("INSERT OR REPLACE INTO mac_port_entries (device_id, mac, port_name, timestamp, source) VALUES (?, '02:00:00:00:00:01', ?, '2026-11-07 11:30:00', 'device')").run(id, porta);
  return { d, id, mac };
}

test("la migrazione è idempotente", () => {
  const d = getTenantDb(CODICE);
  assert.deepEqual(migrateMappaPorte(d), []);
  assert.deepEqual(migrateMappaPorte(d), []);
  assert.equal((d.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name LIKE 'mappa_porte_%' AND type = 'table'").get() as { n: number }).n, 4);
});

test("ricalcolo, filtro, spostamento visto in due calcoli, e tabelle dei MAC vuote che non cancellano la mappa", () => {
  withTenant(CODICE, () => {
    const { d, id, mac } = prepara();
    mac("Port 2");
    const a = ricalcolaMappaPorte(ORA);
    assert.ok(a.ok && a.conteggi.certe === 1, JSON.stringify(a));
    assert.equal(cercaOggetti({ confidenza: "certa", pagina: 0 }).righe[0]?.portaChiave, "i:2");
    assert.deepEqual(cercaOggetti({ confidenza: "non_so", pagina: 0 }).righe.map((o) => o.categoria), ["apparato"]);
    assert.equal(cercaPorte({ deviceId: id, pagina: 0 }).righe[0]?.nMac, 1);

    d.prepare("DELETE FROM mac_port_entries").run();
    mac("Port 3");
    const b = ricalcolaMappaPorte(ORA);
    assert.ok(b.ok && b.spostamenti === 1, JSON.stringify(b));
    const det = dettaglioOggetto("02:00:00:00:00:01");
    assert.equal(det?.spostamenti.length, 1);
    assert.equal(det?.spostamenti[0].daPorta, "Port 2");

    d.prepare("DELETE FROM mac_port_entries").run();
    const c = ricalcolaMappaPorte(ORA);
    assert.equal(c.ok, false);
    assert.equal(cercaOggetti({ pagina: 0 }).totale > 0, true);
    assert.ok(statoCalcolo());
  });
});

test("nessun segreto nell'ingresso: la query degli apparati elenca le colonne", () => {
  const sorgente = fs.readFileSync(path.join(process.cwd(), "src/lib/mappa-porte/calcolo.ts"), "utf8");
  assert.ok(!/SELECT \* FROM network_devices/.test(sorgente));
});
