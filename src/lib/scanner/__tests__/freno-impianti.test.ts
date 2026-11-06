/**
 * Freno sulle scansioni manuali (72729, 06/11/2026): un impianto resta nello sweep, così non finisce
 * offline, ma nmap, TCP di secondo passaggio e SNMP non lo toccano e le porte note non si perdono.
 */
import "@/lib/vuln/__tests__/support/dati-isolati";
import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { withTenant, getTenantDb, deleteTenantDatabase } from "@/lib/db-tenant";
import { closeHubDb } from "@/lib/db-hub";
import { discoverNetwork } from "@/lib/scanner/discovery";
import { getHostsByNetwork } from "@/lib/db";
import { creaEsecutoreFinto, installaEsecutoreFinto, togliEsecutoreFinto } from "./support/esecutore-finto";

const T = "TESTFRENOIMPIANTI";
const PLC = "10.9.0.77";
const PC = "10.9.0.10";
const PORTE = JSON.stringify([{ port: 502, protocol: "tcp", service: "modbus" }]);

afterEach(() => togliEsecutoreFinto());
after(() => {
  deleteTenantDatabase(T);
  closeHubDb();
});

function rete(): number {
  const d = getTenantDb(T);
  d.prepare("DELETE FROM hosts").run();
  d.prepare("DELETE FROM networks").run();
  const id = Number(d.prepare("INSERT INTO networks(name,cidr) VALUES('Impianto','10.9.0.0/24')").run().lastInsertRowid);
  const h = d.prepare("INSERT INTO hosts(network_id,ip,classification,status,open_ports) VALUES(?,?,?,?,?)");
  h.run(id, PLC, "plc", "online", PORTE);
  h.run(id, PC, "workstation", "online", null);
  return id;
}

for (const tipo of ["network_discovery", "ipam_full", "nmap", "scan_nmap_base"] as const) {
  test(`${tipo}: l'impianto non riceve nmap, resta online e tiene le sue porte`, async () => {
    const f = creaEsecutoreFinto({ vivi: [PLC, PC] });
    installaEsecutoreFinto(f.override);
    await withTenant(T, async () => {
      const id = rete();
      const avvio = await discoverNetwork(id, tipo, undefined, null, { targetIps: [PLC, PC] });
      const esito = await avvio.done;
      assert.equal(esito.status, "completed", (avvio.progress.logs ?? []).join("\n"));
      assert.equal(f.chiamate.nmapPortScan, 1, "un solo host riceve nmap");
      const plc = getHostsByNetwork(id).find((h) => h.ip === PLC);
      assert.equal(plc?.status, "online");
      assert.equal(plc?.open_ports, PORTE);
    });
  });
}

test("un profilo Approfondito su un impianto si rifiuta; IoT/OT scelto a mano resta possibile", () => {
  const src = readFileSync(join(process.cwd(), "src/app/api/scans/profilo/route.ts"), "utf8");
  assert.match(src, /eImpianto\(/);
  assert.match(src, /profilo\.id !== "iot_ot"/);
});

test("il TCP di secondo passaggio non tocca un impianto che tace", async () => {
  const f = creaEsecutoreFinto({ vivi: [] });
  installaEsecutoreFinto(f.override);
  await withTenant(T, async () => {
    const id = rete();
    getTenantDb(T).prepare("UPDATE hosts SET status='offline' WHERE ip=?").run(PC);
    const avvio = await discoverNetwork(id, "network_discovery", undefined, null, { targetIps: [PLC] });
    await avvio.done;
    assert.equal(f.chiamate.tcpConnect, 0);
  });
});
