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
  assert.equal((d.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name LIKE 'mappa_porte_%' AND type = 'table'").get() as { n: number }).n, 8, "anche mappa_porte_avvistamenti (08/11)");
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

// Riccardo, 08/11: filtrando per la UDM non compariva niente, eppure le sue porte trunk erano vive. «B, oggetti visti»: anche
// gli oggetti che passano sulle porte dell'apparato, con la porta locale; «se gli oggetti sono troppi mostra solo i primi».
test("filtro per apparato: oggetti posizionati lì e oggetti visti sulle sue porte trunk, al massimo 20 per porta", () => {
  withTenant(CODICE, () => {
    const { d, id } = prepara();
    d.prepare("DELETE FROM mappa_porte_avvistamenti").run();
    const rt = Number(d.prepare("INSERT INTO network_devices (name, host, device_type, vendor, protocol) VALUES ('RT-UNO', '192.0.2.2', 'router', 'ubiquiti', 'api')").run().lastInsertRowid);
    const ins = d.prepare("INSERT OR REPLACE INTO mac_port_entries (device_id, mac, port_name, timestamp, source) VALUES (?, ?, ?, '2026-11-07 11:30:00', 'device')");
    // 25 PC, ognuno sulla sua porta di SW-UNO, tutti visti anche sulla porta trunk «Port 9» di RT-UNO.
    for (let n = 1; n <= 25; n++) {
      const m = `02:00:00:00:01:${n.toString(16).padStart(2, "0")}`;
      ins.run(id, m, `Port ${n}`);
      ins.run(rt, m, "Port 9");
    }
    assert.equal(ricalcolaMappaPorte(ORA).ok, true);
    const r = cercaOggetti({ deviceId: rt, pagina: 0 });
    assert.equal(r.righe.length, 20, "i primi 20 della porta trunk");
    assert.ok(r.righe.every((o) => o.qui?.porta === "Port 9" && o.apparato === "SW-UNO"), "la porta locale in «qui», la posizione vera resta");
    assert.deepEqual(r.troncate, [{ porta: "Port 9", totale: 25, mostrati: 20 }]);
    const sw = cercaOggetti({ deviceId: id, pagina: 0 });
    assert.equal(sw.righe.filter((o) => o.categoria === "dispositivo").length, 25, "sull'apparato dove stanno: tutti, senza tetto");
    assert.ok(sw.righe.every((o) => !o.qui));
    assert.equal(cercaOggetti({ pagina: 0 }).troncate.length, 0, "senza filtro niente di nuovo");
  });
});
