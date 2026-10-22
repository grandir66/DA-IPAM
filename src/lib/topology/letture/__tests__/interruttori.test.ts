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
import { COMANDI_MK_SCHEDA } from "@/lib/devices/mikrotik-letture";
import { OID_QBRIDGE } from "@/lib/devices/snmp-vlan";
import { DESCRIZIONE_LETTURE } from "@/lib/topology/letture/testi";

const T = "TESTLETTUREINT";
beforeEach(() => { getTenantDb(T).exec("DELETE FROM tenant_settings WHERE key LIKE 'topologia.lettura.%'"); });
after(() => { deleteTenantDatabase(T); closeHubDb(); removeTestHubDb(); });

// ADR 0031 (22/10, 70151: le VLAN del router non arrivavano perché la lettura nasceva spenta): accese di serie.
test("accese di serie: chiave assente o valore rovinato → accesa; si spegne solo con acceso:false", () => {
  withTenant(T, () => {
    for (const l of LETTURE) assert.deepEqual(leggiInterruttore(l), { acceso: l !== "librenms", da: null, il: null }, l);
    // librenms scrive in LibreNMS (aggiunge apparati): spenta di serie e accesa solo da un `acceso: true` scritto (22/10).
    for (const v of ["{", "true", '{"acceso":"si"}', '{"acceso":1}', "[]"]) {
      setTenantSetting(chiaveLettura("librenms"), v);
      assert.equal(letturaAccesa("librenms"), false, `librenms ${v}`);
    }
    setTenantSetting(chiaveLettura("librenms"), '{"acceso":true}');
    assert.equal(letturaAccesa("librenms"), true, "librenms accesa scritta");
    for (const v of ["{", "true", '{"acceso":"si"}', '{"acceso":1}', "[]"]) {
      setTenantSetting(chiaveLettura("mikrotik"), v);
      assert.equal(letturaAccesa("mikrotik"), true, v);
    }
    setTenantSetting(chiaveLettura("mikrotik"), '{"acceso":false}');
    assert.equal(letturaAccesa("mikrotik"), false, "spenta scritta");
  });
});

test("accesa e spenta da un admin, con chi e quando (UTC)", () => {
  withTenant(T, () => {
    scriviInterruttore("snmp", true, "admin", new Date("2026-10-15T08:30:00Z"));
    assert.deepEqual(leggiInterruttore("snmp"), { acceso: true, da: "admin", il: "2026-10-15 08:30:00" });
    scriviInterruttore("snmp", false, "admin", new Date("2026-10-15T09:00:00Z"));
    assert.equal(letturaAccesa("snmp"), false);
    assert.equal(letturaAccesa("mikrotik"), true, "le altre restano accese di serie");
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

// Cinque dal Task 10 della scheda MikroTik: `mikrotik_scheda` (VLAN, DNS e utenti) è una lettura in più come le altre, con il
// suo interruttore nella card «Letture in più» e la sua cadenza; accesa di serie come tutte (ADR 0031). Eccezione: `librenms`
// (piano 2026-10-22 LibreNMS) resta spenta di serie perché aggiunge apparati a LibreNMS, cioè scrive (unione del 22/10).
test("tutte e cinque le letture sono disponibili (`host` col Task 7 di T2, `mikrotik_scheda` col Task 10 della scheda): la PUT le accetta; accese di serie, tranne librenms", () => {
  assert.deepEqual([...LETTURE], ["mikrotik", "controller", "snmp", "host", "mikrotik_scheda", "switch_vlan", "librenms"]);
  assert.deepEqual([...LETTURE].filter((l) => !LETTURE_DISPONIBILI.has(l)), []);
  withTenant(T, () => assert.equal(letturaAccesa("host"), true));
  withTenant(T, () => assert.equal(letturaAccesa("mikrotik_scheda"), true));
  withTenant(T, () => assert.equal(letturaAccesa("librenms"), false));
  assert.equal(chiaveLettura("mikrotik_scheda"), "topologia.lettura.mikrotik_scheda");
  // I comandi che la riga della pagina elenca sono quelli che la lettura manda (senza le opzioni di stampa).
  for (const c of Object.values(COMANDI_MK_SCHEDA)) assert.ok(DESCRIZIONE_LETTURE.mikrotik_scheda.comandi.includes(c.replace(/ terse| without-paging/g, "")), c);
  // La riga della pagina elenca i comandi che la lettura manda davvero, uno per uno.
  assert.equal(DESCRIZIONE_LETTURE.host.comandi.startsWith(Object.values(COMANDI_HOST).join(" · ")), true);
});

// Sei dal Task 9 del piano accorpamento/VLAN (ADR 0029): `switch_vlan`, letture SNMP sugli switch dei clienti; dall'ADR 0031
// accesa di serie: chiave assente = accesa; valore rovinato = accesa; spenta solo da un admin.
test("`switch_vlan`: disponibile, la PUT la accetta, accesa di serie finché un admin non la spegne; chiave e valore rovinato", () => {
  assert.ok(LETTURE.includes("switch_vlan") && LETTURE_DISPONIBILI.has("switch_vlan"));
  assert.equal(chiaveLettura("switch_vlan"), "topologia.lettura.switch_vlan");
  withTenant(T, () => {
    getTenantDb(T).prepare("DELETE FROM tenant_settings WHERE key = ?").run("topologia.lettura.switch_vlan");
    assert.equal(letturaAccesa("switch_vlan"), true, "chiave assente");
    getTenantDb(T).prepare("INSERT INTO tenant_settings (key, value) VALUES (?, ?)").run("topologia.lettura.switch_vlan", "{rotto");
    assert.equal(letturaAccesa("switch_vlan"), true, "valore rovinato");
    scriviInterruttore("switch_vlan", false, "admin");
    assert.equal(letturaAccesa("switch_vlan"), false);
    scriviInterruttore("switch_vlan", true, "admin");
    assert.equal(letturaAccesa("switch_vlan"), true);
  });
  // Le walk che la riga della pagina elenca sono le sette di OID_QBRIDGE.
  assert.equal(Object.keys(OID_QBRIDGE).length, 7);
  assert.ok(DESCRIZIONE_LETTURE.switch_vlan.comandi.startsWith("7 letture in sola lettura"));
});
