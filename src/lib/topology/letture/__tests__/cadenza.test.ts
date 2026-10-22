// Spec §13.5.1, «Una cadenza propria»: le letture in più partono al più una volta l'ora per apparato, qualunque job chiami
// il giro (sulla rete B il router si legge ogni 15 minuti da sei scansioni veloci in parallelo, più volte nello stesso
// secondo); un lucchetto per apparato, nel processo, impedisce che due giri paralleli le ripetano.
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb } from "@/lib/db-hub";
import { deleteTenantDatabase, getTenantDb, rileggiSchemaCavi, withTenant } from "@/lib/db-tenant";
import { conCadenza, riassuntoLetture } from "@/lib/topology/letture/cadenza";
import { leggiEsiti, scriviInterruttore } from "@/lib/topology/letture/interruttori";
import { LETTURE_SPENTE_SQL } from "@/lib/topology/letture/__tests__/letture-spente";

const T = "TESTLETTURECAD";
const ore = (h: number, m = 0) => () => new Date(Date.UTC(2026, 9, 15, h, m, 0));
beforeEach(() => {
  getTenantDb(T).exec("DELETE FROM tenant_settings WHERE key LIKE 'topologia.lettura.%'");
  getTenantDb(T).exec(LETTURE_SPENTE_SQL);
  withTenant(T, () => rileggiSchemaCavi());
});
after(() => { deleteTenantDatabase(T); closeHubDb(); removeTestHubDb(); });

const leggi = (conteggio = { comandi: 6, riusciti: 6, codice: null }) => async () => ({ valore: "fatto", conteggio });

test("spenta: non si legge niente", async () => {
  let chiamate = 0;
  const r = await withTenant(T, () => conCadenza("mikrotik", 1, async () => { chiamate++; return { valore: 1, conteggio: { comandi: 0, riusciti: 0, codice: null } }; }, ore(8)));
  assert.deepEqual(r, { stato: "saltato", motivo: "spenta" });
  assert.equal(chiamate, 0);
});

test("accesa: legge, scrive l'esito; dopo 30 minuti salta per la cadenza; dopo 61 rilegge", async () => {
  await withTenant(T, async () => {
    scriviInterruttore("mikrotik", true, "admin");
    assert.equal((await conCadenza("mikrotik", 1, leggi(), ore(8))).stato, "letto");
    assert.deepEqual(leggiEsiti("mikrotik")["1"], { il: "2026-10-15 08:00:00", comandi: 6, riusciti: 6, codice: null });
    assert.deepEqual(await conCadenza("mikrotik", 1, leggi(), ore(8, 30)), { stato: "saltato", motivo: "cadenza" });
    assert.equal((await conCadenza("mikrotik", 2, leggi(), ore(8, 30))).stato, "letto", "la cadenza è per apparato");
    assert.equal((await conCadenza("mikrotik", 1, leggi(), ore(9, 1))).stato, "letto");
  });
});

test("due giri paralleli dello stesso apparato: una lettura sola", async () => {
  await withTenant(T, async () => {
    scriviInterruttore("snmp", true, "admin");
    let libera: () => void = () => undefined;
    const attesa = new Promise<void>((r) => { libera = r; });
    let chiamate = 0;
    const lenta = async () => { chiamate++; await attesa; return { valore: 1, conteggio: { comandi: 9, riusciti: 9, codice: null } }; };
    const primo = conCadenza("snmp", 5, lenta, ore(10));
    const secondo = await conCadenza("snmp", 5, lenta, ore(10));
    assert.deepEqual(secondo, { stato: "saltato", motivo: "lucchetto" });
    libera();
    assert.equal((await primo).stato, "letto");
    assert.equal(chiamate, 1);
  });
});

test("un errore: esito col solo codice, e il lucchetto si libera", async () => {
  await withTenant(T, async () => {
    scriviInterruttore("mikrotik", true, "admin");
    const r = await conCadenza("mikrotik", 7, async () => { throw Object.assign(new Error("connect ETIMEDOUT 192.0.2.1:22"), { code: "ETIMEDOUT" }); }, ore(11));
    assert.deepEqual(r, { stato: "errore", esito: { il: "2026-10-15 11:00:00", comandi: 0, riusciti: 0, codice: "ETIMEDOUT" } });
    assert.equal((await conCadenza("mikrotik", 7, leggi(), ore(12, 1))).stato, "letto");
  });
});

test("schema assente: non si legge, e il resoconto lo dice", async () => {
  await withTenant(T, async () => {
    scriviInterruttore("mikrotik", true, "admin");
    getTenantDb(T).exec("ALTER TABLE device_neighbors DROP COLUMN remote_caps");
    rileggiSchemaCavi();
    const r = await conCadenza("mikrotik", 1, leggi(), ore(8));
    assert.deepEqual(r, { stato: "saltato", motivo: "schema" });
    assert.equal(riassuntoLetture([r]), "letture in più non disponibili: lo schema di questo cliente non è aggiornato");
    getTenantDb(T).exec("ALTER TABLE device_neighbors ADD COLUMN remote_caps TEXT");
    rileggiSchemaCavi(); // l'annotazione torna com'era: il prossimo test parte da uno schema completo
  });
});

test("il riassunto conta, nomina i codici e mai un indirizzo", () => {
  const s = riassuntoLetture([
    { stato: "letto", valore: 1, esito: { il: "x", comandi: 6, riusciti: 6, codice: null } },
    { stato: "letto", valore: 1, esito: { il: "x", comandi: 6, riusciti: 4, codice: "TEMPO_SCADUTO" } },
    { stato: "saltato", motivo: "cadenza" }, { stato: "saltato", motivo: "lucchetto" }, { stato: "saltato", motivo: "spenta" },
    { stato: "errore", esito: { il: "x", comandi: 0, riusciti: 0, codice: "ETIMEDOUT" } },
  ]);
  assert.equal(s, "letture in più: 2 lette (1 in parte), 2 saltate (cadenza 1, lucchetto 1), 1 non riuscita; codici: ETIMEDOUT, TEMPO_SCADUTO");
  assert.equal(riassuntoLetture([{ stato: "saltato", motivo: "spenta" }]), null, "tutto spento: niente da dire");
});
