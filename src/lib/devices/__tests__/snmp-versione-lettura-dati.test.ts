/**
 * Lettura dati SNMP di un apparato: la versione e il firmware airFiber.
 *
 * INCIDENTE (DTS, 2026-10-15): gli AP Ubiquiti 172.16.3.4-7 rispondono solo in
 * v1. La lettura dati parlava v1 per caso (createSession senza version): un
 * apparato non ancora rilevato (snmp_version NULL) deve continuare a parlare
 * v1, altrimenti quegli AP smettono di rispondere. Misurato lo stesso giorno:
 * il firmware sta in 1.3.6.1.4.1.41112.1.3.2.1.40.1 (MIB airFiber, «v4.1.0» e
 * «v4.0.3»), il nome del prodotto non c'è in nessun ramo. Valori qui anonimi,
 * forma vera (sysObjectID 10002.1, niente ENTITY-MIB).
 */
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb } from "@/lib/db-hub";
import { deleteTenantDatabase, getTenantDb, withTenant } from "@/lib/db-tenant";
import { getDeviceInfoFromSnmp, infoDaVarbindSnmp, oidLetturaDatiSnmp, OID_AIRFIBER_FW_VERSION } from "@/lib/devices/device-info";
import { avviaAgenteFinto, type AgenteFinto } from "@/lib/protocols/__tests__/support/agente-snmp-finto";
import type { NetworkDevice } from "@/types";

const T = "TESTSNMPLETT";
const VALORI_AP = {
  "1.3.6.1.2.1.1.1.0": "Linux 2.6.33 #1 armv5tejl",
  "1.3.6.1.2.1.1.5.0": "ap-finto-1",
  [OID_AIRFIBER_FW_VERSION]: "v9.8.7",
};
after(() => {
  deleteTenantDatabase(T);
  closeHubDb();
  removeTestHubDb();
});

test("oidLetturaDatiSnmp: il firmware airFiber solo per i Ubiquiti", () => {
  assert.ok(oidLetturaDatiSnmp({ vendor: "ubiquiti" }).includes(OID_AIRFIBER_FW_VERSION));
  assert.ok(!oidLetturaDatiSnmp({ vendor: "mikrotik" }).includes(OID_AIRFIBER_FW_VERSION));
});

test("infoDaVarbindSnmp: firmware airFiber e famiglia come modello, se nient'altro lo dice", () => {
  const vb = (oid: string, v: string) => ({ oid, value: Buffer.from(v) });
  assert.deepEqual(
    infoDaVarbindSnmp([vb("1.3.6.1.2.1.1.1.0", "Linux 2.6.33 #1 armv5tejl"), vb("1.3.6.1.2.1.1.5.0", "ap-finto-1"), vb(OID_AIRFIBER_FW_VERSION, "v9.8.7")]),
    { sysname: "ap-finto-1", sysdescr: "Linux 2.6.33 #1 armv5tejl", model: "airFiber", firmware: "v9.8.7", serial_number: null, part_number: null }
  );
  const conEntity = infoDaVarbindSnmp([vb("1.3.6.1.2.1.47.1.1.1.1.2.1", "Modello ENTITY"), vb(OID_AIRFIBER_FW_VERSION, "v9.8.7")]);
  assert.equal(conEntity.model, "Modello ENTITY", "un modello vero vince sulla famiglia");
  assert.equal(infoDaVarbindSnmp([{ oid: OID_AIRFIBER_FW_VERSION, value: "noSuchObject" }]).firmware, null);
});

async function agenteAp(versioni: Array<"1" | "2c">): Promise<AgenteFinto> {
  return avviaAgenteFinto({ versioni, valori: VALORI_AP });
}

function apparato(snmp_version: "1" | "2c" | null): NetworkDevice {
  return withTenant(T, () => {
    const db = getTenantDb(T);
    const id = Number(
      db.prepare("INSERT INTO network_devices (name, host, device_type, vendor, protocol, port, snmp_version) VALUES ('AP', '127.0.0.1', 'access_point', 'ubiquiti', 'snmp_v2', 161, ?)").run(snmp_version).lastInsertRowid
    );
    return db.prepare("SELECT * FROM network_devices WHERE id = ?").get(id) as NetworkDevice;
  });
}

for (const [snmp_version, attesa] of [[null, "1"], ["1", "1"], ["2c", "2c"]] as const) {
  test(`lettura dati con snmp_version ${snmp_version ?? "NULL"}: parla ${attesa}, legge firmware airFiber`, async () => {
    const a = await agenteAp(["1", "2c"]);
    try {
      const device = apparato(snmp_version);
      const info = await withTenant(T, () => getDeviceInfoFromSnmp(device, a.porta));
      assert.deepEqual([...new Set(a.versioniViste())], [attesa]);
      assert.equal(info.firmware, "v9.8.7");
      assert.equal(info.model, "airFiber");
      assert.equal(info.sysname, "ap-finto-1");
    } finally {
      await a.chiudi();
    }
  });
}

test("lettura dati di un apparato NULL su un agente solo v1 (gli AP di DTS): risponde ancora", async () => {
  const a = await agenteAp(["1"]);
  try {
    const info = await withTenant(T, () => getDeviceInfoFromSnmp(apparato(null), a.porta));
    assert.equal(info.sysname, "ap-finto-1");
    assert.deepEqual([...new Set(a.versioniViste())], ["1"], "nessuna richiesta v2c");
  } finally {
    await a.chiudi();
  }
});
