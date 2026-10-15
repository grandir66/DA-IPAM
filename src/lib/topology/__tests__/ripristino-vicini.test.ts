// Spec topologia §13.11.1 («Tornare indietro») e R6. Verifica del piano (15/10): col codice di prima e `lldp` fra router
// dai due lati un padre cambiava; queste righe tornano `mndp`, solo per i MikroTik letti via SSH e solo dal rilascio in
// poi. DB finto in memoria, con le colonne vere di device_neighbors.
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { sqlApplica, sqlConta, sqlCopia } from "@/lib/topology/ripristino-vicini";

const RILASCIO = "2026-10-15 08:00:00";

function dbFinto() {
  const d = new Database(":memory:");
  d.exec(`
    CREATE TABLE network_devices (id INTEGER PRIMARY KEY, vendor TEXT, protocol TEXT);
    CREATE TABLE device_neighbors (
      id INTEGER PRIMARY KEY AUTOINCREMENT, device_id INTEGER NOT NULL, local_port TEXT NOT NULL, remote_device_name TEXT NOT NULL DEFAULT '',
      remote_port TEXT NOT NULL DEFAULT '', protocol TEXT NOT NULL CHECK(protocol IN ('lldp', 'cdp', 'mndp', 'unknown')),
      source TEXT NOT NULL DEFAULT 'device', timestamp TEXT, UNIQUE(device_id, local_port, remote_device_name, remote_port));
    INSERT INTO network_devices VALUES (1, 'MikroTik', 'ssh'), (2, 'mikrotik', 'snmp_v2'), (3, 'ubiquiti', 'api');
    INSERT INTO device_neighbors (device_id, local_port, remote_device_name, remote_port, protocol, source, timestamp) VALUES
      (1, 'ether3', 'RTR-2', 'ether3', 'lldp', 'device', '2026-10-15 09:00:00'),
      (1, 'sfp-sfpplus1', 'CORE-1', 'Port 10', 'lldp', 'device', '2026-10-15 09:00:00'),
      (1, 'ether8', 'CORE-1', 'Port', 'mndp', 'device', '2026-10-14 10:00:00'),
      (1, 'ether2', 'RTR-2', 'ether2', 'lldp', 'device', '2026-10-14 10:00:00'),
      (2, 'ether4', 'RTR-3', 'ether4', 'lldp', 'device', '2026-10-15 09:00:00'),
      (3, 'Port 9', 'ACC-A', 'SFP+ 2', 'lldp', 'unifi', '2026-10-15 09:00:00');
  `);
  return d;
}
const protocolli = (d: Database.Database) => d.prepare("SELECT id, protocol FROM device_neighbors ORDER BY id").all();

test("prova a vuoto e copia: solo le righe del lettore di T1 dal rilascio in poi; niente si scrive", () => {
  const d = dbFinto();
  const prima = protocolli(d);
  assert.deepEqual(d.prepare(sqlConta(RILASCIO)).all(), [{ device_id: 1, protocol: "lldp", righe: 2 }]);
  assert.deepEqual(d.prepare(sqlCopia(RILASCIO)).all().map((r) => (r as { id: number }).id), [1, 2]);
  assert.deepEqual(protocolli(d), prima);
});

test("applica: le due righe tornano mndp e le altre restano; una seconda volta non cambia niente", () => {
  const d = dbFinto();
  d.exec(sqlApplica(RILASCIO));
  const dopo = protocolli(d);
  assert.deepEqual(dopo, [
    { id: 1, protocol: "mndp" }, { id: 2, protocol: "mndp" }, { id: 3, protocol: "mndp" },
    { id: 4, protocol: "lldp" }, { id: 5, protocol: "lldp" }, { id: 6, protocol: "lldp" },
  ]);
  d.exec(sqlApplica(RILASCIO));
  assert.deepEqual(protocolli(d), dopo);
  assert.deepEqual(d.prepare(sqlConta(RILASCIO)).all(), []);
});

test("l'ora del rilascio si scrive in un modo solo: altrimenti nessun testo SQL", () => {
  for (const x of ["2026-10-15", "2026-10-15T08:00:00Z", "2026-10-15 08:00:00' OR '1'='1", ""]) {
    assert.throws(() => sqlApplica(x), /AAAA-MM-GG HH:MM:SS/, x);
  }
});

// Livello completo (zona rossa): nelle prove sopra il produttore, la fonte e «non già mndp» tengono fuori righe che
// un'altra condizione esclude comunque; qui ognuna è la sola a tenere fuori la sua riga, e una riga senza data (nessuno
// scrittore la lascia così, ma la colonna lo ammette) non si tocca: non si sa quando è stata scritta.
test("ogni condizione tiene fuori da sola la sua riga: altro produttore via SSH, altra fonte, già mndp, senza data", () => {
  const d = dbFinto();
  d.exec(`
    INSERT INTO network_devices VALUES (4, 'cisco', 'ssh');
    INSERT INTO device_neighbors (device_id, local_port, remote_device_name, remote_port, protocol, source, timestamp) VALUES
      (4, 'Gi0/1', 'SW-9', 'Gi0/2', 'cdp', 'device', '2026-10-15 09:00:00'),
      (1, 'ether5', 'AP-7', 'eth0', 'lldp', 'unifi', '2026-10-15 09:00:00'),
      (1, 'ether6', 'RTR-4', 'ether6', 'mndp', 'device', '2026-10-15 09:00:00'),
      (1, 'ether7', 'RTR-5', 'ether7', 'lldp', 'device', NULL);
  `);
  assert.deepEqual(d.prepare(sqlConta(RILASCIO)).all(), [{ device_id: 1, protocol: "lldp", righe: 2 }]);
  assert.deepEqual(d.prepare(sqlCopia(RILASCIO)).all().map((r) => (r as { id: number }).id), [1, 2]);
  d.exec(sqlApplica(RILASCIO));
  assert.deepEqual(protocolli(d).slice(6), [
    { id: 7, protocol: "cdp" }, { id: 8, protocol: "lldp" }, { id: 9, protocol: "mndp" }, { id: 10, protocol: "lldp" },
  ]);
});

// Revisione finale di T1: il lettore di T1 scrive solo `lldp` o `mndp` (`mikrotikProtocol`: il CDP diventa `mndp`). Se un
// giro di `/ip neighbor` fallisce, il ripiego SNMP dei vicini (router-client.ts) scrive righe `lldp` o `cdp` con fonte
// `device` sullo stesso MikroTik, come faceva il codice di prima: una riga `cdp` (o `unknown`) non viene dal lettore di T1 e
// non si tocca. Le righe `lldp` del ripiego non si distinguono da quelle del lettore: lo si dice a Riccardo prima di applicare.
test("una riga `cdp` o `unknown` del ripiego SNMP non è del lettore di T1: né contata, né copiata, né scritta", () => {
  const d = dbFinto();
  d.exec(`
    INSERT INTO device_neighbors (device_id, local_port, remote_device_name, remote_port, protocol, source, timestamp) VALUES
      (1, 'ether9', 'SW-9', 'Gi0/9', 'cdp', 'device', '2026-10-15 09:00:00'),
      (1, 'ether10', 'SW-10', 'Port 10', 'unknown', 'device', '2026-10-15 09:00:00');
  `);
  assert.deepEqual(d.prepare(sqlConta(RILASCIO)).all(), [{ device_id: 1, protocol: "lldp", righe: 2 }]);
  assert.deepEqual(d.prepare(sqlCopia(RILASCIO)).all().map((r) => (r as { id: number }).id), [1, 2]);
  d.exec(sqlApplica(RILASCIO));
  assert.deepEqual(protocolli(d).slice(6), [{ id: 7, protocol: "cdp" }, { id: 8, protocol: "unknown" }]);
});
