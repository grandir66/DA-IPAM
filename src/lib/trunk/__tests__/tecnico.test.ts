/**
 * Sonda trunk sul Mac del tecnico (installazione «tecnico», ADR 0037; 08/11/2026).
 *
 * Riccardo, 08/11: «l'opzione deve essere abilitata per default» e «l'acquisizione deve essere da
 * resettare e riabilitare ad ogni cambio cliente». Il Mac passa da un cliente all'altro, la sonda
 * no: quello che ha visto dal cliente di prima non deve finire nel profilo di quello dopo.
 *
 * Si prova: il cambio di profilo segna «azzerare» e il profilo; il giro seguente azzera la sonda,
 * accende la lettura solo del profilo scelto (cursore da capo) e la spegne negli altri; se
 * l'azzeramento fallisce non si legge niente e si riprova al giro dopo; senza profilo scelto non
 * si legge niente; la vista «tutti i profili» non cambia il profilo della sonda.
 *
 * Run: node --import tsx --test src/lib/trunk/__tests__/tecnico.test.ts
 */
import "@/lib/__tests__/support/data-dir-isolata";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb, createTenant, getSetting, setSetting, type CreateTenantInput } from "@/lib/db-hub";
import { closeTenantDb, deleteTenantDatabase, getTenantSetting, setTenantSetting, withTenant } from "@/lib/db-tenant";
import { preparaTrunkTecnico, segnaCambioProfiloTrunk } from "@/lib/trunk/tecnico";

const A = "70001";
const B = "70002";

function tenant(codice: string): CreateTenantInput {
  return {
    codice_cliente: codice, ragione_sociale: `Cliente ${codice}`, indirizzo: null, citta: null, provincia: null,
    cap: null, telefono: null, email: null, piva: null, cf: null, referente: null, note: null, active: 1,
  } as CreateTenantInput;
}

createTenant(tenant(A));
createTenant(tenant(B));

after(() => {
  for (const t of [A, B]) {
    try { closeTenantDb(t); deleteTenantDatabase(t); } catch { /* già tolto */ }
  }
  closeHubDb();
});

beforeEach(() => {
  setSetting("trunk_tecnico_profilo", "");
  setSetting("trunk_tecnico_azzera", "");
  for (const t of [A, B]) withTenant(t, () => {
    setTenantSetting("trunk_lettura", "1");
    setTenantSetting("trunk_cursore", JSON.stringify({ dopo: "2026-11-08 10:00:00", dopo_id: 42 }));
  });
});

const lettura = (t: string) => withTenant(t, () => getTenantSetting("trunk_lettura"));
const cursore = (t: string) => withTenant(t, () => getTenantSetting("trunk_cursore"));

test("cambio di profilo: segna azzerare e il profilo, senza toccare la sonda subito", () => {
  segnaCambioProfiloTrunk(B);
  assert.equal(getSetting("trunk_tecnico_profilo"), B);
  assert.equal(getSetting("trunk_tecnico_azzera"), "1");
});

test("stesso profilo di prima (rientro sullo stesso cliente): niente azzeramento", () => {
  segnaCambioProfiloTrunk(A);
  setSetting("trunk_tecnico_azzera", "");
  segnaCambioProfiloTrunk(A);
  assert.equal(getSetting("trunk_tecnico_azzera"), "");
});

test("vista «tutti i profili»: il profilo della sonda resta quello di prima", () => {
  segnaCambioProfiloTrunk(A);
  setSetting("trunk_tecnico_azzera", "");
  segnaCambioProfiloTrunk("__ALL__");
  assert.equal(getSetting("trunk_tecnico_profilo"), A);
  assert.equal(getSetting("trunk_tecnico_azzera"), "");
});

test("giro dopo il cambio: azzera, lettura solo sul profilo scelto, cursore da capo", async () => {
  segnaCambioProfiloTrunk(B);
  let azzerate = 0;
  const esito = await preparaTrunkTecnico(async () => { azzerate++; });
  assert.deepEqual(esito, { leggi: true, profilo: B });
  assert.equal(azzerate, 1);
  assert.equal(lettura(B), "1");
  assert.equal(lettura(A), "0");
  assert.equal(cursore(B), "");
  assert.notEqual(cursore(A), "", "il cursore degli altri profili non si tocca");
  assert.equal(getSetting("trunk_tecnico_azzera"), "");

  const di_nuovo = await preparaTrunkTecnico(async () => { azzerate++; });
  assert.deepEqual(di_nuovo, { leggi: true, profilo: B });
  assert.equal(azzerate, 1, "senza un cambio nuovo non si azzera di nuovo");
});

test("azzeramento fallito: non si legge niente e si riprova al giro dopo", async () => {
  segnaCambioProfiloTrunk(B);
  const esito = await preparaTrunkTecnico(async () => { throw new Error("un giro è in corso"); });
  assert.equal(esito.leggi, false);
  assert.equal(lettura(A), "0", "fallito: lettura spenta ovunque");
  assert.equal(lettura(B), "0");
  assert.equal(getSetting("trunk_tecnico_azzera"), "1");
  const poi = await preparaTrunkTecnico(async () => {});
  assert.deepEqual(poi, { leggi: true, profilo: B });
  assert.equal(lettura(B), "1");
});

test("nessun profilo scelto: non si legge niente", async () => {
  const esito = await preparaTrunkTecnico(async () => { assert.fail("niente da azzerare"); });
  assert.equal(esito.leggi, false);
  assert.equal(lettura(A), "0");
  assert.equal(lettura(B), "0");
});
