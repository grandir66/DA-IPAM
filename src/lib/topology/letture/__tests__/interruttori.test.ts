// Spec §13.5.6: un interruttore per lettura e per cliente; chiave assente = SPENTO, e lo stesso un valore rovinato (freno
// a prova di guasto, D4). L'esito per apparato serve alla cadenza e alla pagina; uno rovinato vale «mai letto».
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb } from "@/lib/db-hub";
import { deleteTenantDatabase, getTenantDb, setTenantSetting, withTenant } from "@/lib/db-tenant";
import {
  LETTURE, LETTURE_DISPONIBILI, chiaveEsito, chiaveLettura, leggiEsiti, leggiInterruttore, letturaAccesa, scriviEsito, scriviInterruttore, senzaCampiCavi,
} from "@/lib/topology/letture/interruttori";
import { COMANDI_HOST } from "@/lib/proxmox/lldp-host";
import { DESCRIZIONE_LETTURE } from "@/lib/topology/letture/testi";

const T = "TESTLETTUREINT";
beforeEach(() => { getTenantDb(T).exec("DELETE FROM tenant_settings WHERE key LIKE 'topologia.lettura.%'"); });
after(() => { deleteTenantDatabase(T); closeHubDb(); removeTestHubDb(); });

test("chiave assente, valore rovinato o diverso da acceso:true → spento", () => {
  withTenant(T, () => {
    assert.equal(letturaAccesa("mikrotik"), false);
    for (const v of ["{", "true", '{"acceso":"si"}', '{"acceso":1}', "[]"]) {
      setTenantSetting(chiaveLettura("mikrotik"), v);
      assert.equal(letturaAccesa("mikrotik"), false, v);
    }
  });
});

test("accesa e spenta da un admin, con chi e quando (UTC)", () => {
  withTenant(T, () => {
    scriviInterruttore("snmp", true, "admin", new Date("2026-10-15T08:30:00Z"));
    assert.deepEqual(leggiInterruttore("snmp"), { acceso: true, da: "admin", il: "2026-10-15 08:30:00" });
    scriviInterruttore("snmp", false, "admin", new Date("2026-10-15T09:00:00Z"));
    assert.equal(letturaAccesa("snmp"), false);
    assert.equal(letturaAccesa("mikrotik"), false, "le altre restano spente");
  });
});

test("esiti per apparato: si uniscono; uno rovinato o con un id non numerico non c'è", () => {
  withTenant(T, () => {
    scriviEsito("mikrotik", 3, { il: "2026-10-15 08:00:00", comandi: 6, riusciti: 6, codice: null });
    scriviEsito("mikrotik", 4, { il: "2026-10-15 08:01:00", comandi: 6, riusciti: 4, codice: "TEMPO_SCADUTO" });
    assert.deepEqual(Object.keys(leggiEsiti("mikrotik")).sort(), ["3", "4"]);
    setTenantSetting(chiaveEsito("mikrotik"), '{"3":{"il":"x","comandi":"sei"},"abc":{"il":"2026-10-15 08:00:00","comandi":1,"riusciti":1,"codice":null}}');
    assert.deepEqual(leggiEsiti("mikrotik"), {});
    setTenantSetting(chiaveEsito("mikrotik"), "{tagliato");
    assert.deepEqual(leggiEsiti("mikrotik"), {});
    scriviEsito("mikrotik", 3, { il: "2026-10-15 09:00:00", comandi: 6, riusciti: 6, codice: null });
    assert.deepEqual(Object.keys(leggiEsiti("mikrotik")), ["3"], "si riscrive pulito");
  });
});

test("senzaCampiCavi toglie solo le colonne nuove dei vicini", () => {
  const n = { localPort: "ether2", remoteDevice: "SW", remotePort: "Port 3", protocol: "lldp", discoveredBy: "lldp", remoteCaps: "bridge", localPortIndex: 2, remotePortIndex: 3 };
  assert.deepEqual(senzaCampiCavi(n), { localPort: "ether2", remoteDevice: "SW", remotePort: "Port 3", protocol: "lldp" });
});

test("tutte e quattro le letture sono disponibili (`host` col Task 7 di T2): la pagina non dice più «non disponibile» e la PUT le accetta; spente finché un admin non le accende", () => {
  assert.deepEqual([...LETTURE].filter((l) => !LETTURE_DISPONIBILI.has(l)), []);
  withTenant(T, () => assert.equal(letturaAccesa("host"), false));
  // La riga della pagina elenca i comandi che la lettura manda davvero, uno per uno.
  assert.equal(DESCRIZIONE_LETTURE.host.comandi.startsWith(Object.values(COMANDI_HOST).join(" · ")), true);
});
