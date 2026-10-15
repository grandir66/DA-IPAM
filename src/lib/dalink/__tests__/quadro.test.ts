/**
 * Tappa C1, Task 9: il quadro della pagina «Cosa esce da questa istanza».
 *
 * - Il token non compare mai: la pagina dice solo «token presente».
 * - L'anteprima è il corpo che partirebbe adesso, costruito con lo stesso
 *   `costruisciSegnale` del giro: a «solo stato» non ha inventario.
 * - Senza configurazione si mostra lo stesso cosa conterrebbe il segnale (col cliente
 *   dell'istanza), e si dice che non parte niente.
 *
 * Hub di prova isolato: `support/hub-isolato` va importato PER PRIMO.
 */
import { removeTestHubDb } from "../../integrations/__tests__/support/hub-isolato";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb, getHubDb } from "@/lib/db-hub";
import { quadroCosaEsce, type DipendenzeQuadro } from "../quadro";
import { impostaLivello } from "../stato";
import type { FattiIstanza } from "../segnale";

after(() => {
  closeHubDb();
  removeTestHubDb();
});
beforeEach(() => {
  getHubDb().exec("DELETE FROM dalink_livello_registro; DELETE FROM dalink_segnale_stato;");
});

const TOKEN = "dlk_" + "Q".repeat(43);
const FATTI: FattiIstanza = { versione: "0.3.281", moduli: { edge: true, wazuh: false }, salute: { edge: "ok" }, ultimoErrore: null, porte: [22, 443] };

function dip(extra: Partial<DipendenzeQuadro> = {}): Partial<DipendenzeQuadro> {
  return {
    config: () => ({
      stato: "pronta",
      url: new URL("https://da-link.netbird.selfhosted:8443"),
      impronta: `sha256/${"A".repeat(43)}=`,
      codcli: "99999",
      nodo: "99999-ipam",
      token: TOKEN,
    }),
    clienteUnico: () => null,
    fatti: async () => ({ fatti: FATTI, clienteTrovato: true }),
    inventario: () => ({ dispositivi: 7, reti: 1, ultima_scansione: null, esito_scansione: null }),
    proxyZabbix: () => false,
    ...extra,
  };
}

test("il quadro non contiene mai il token", async () => {
  const q = await quadroCosaEsce(dip());
  const testo = JSON.stringify(q);
  assert.ok(!testo.includes(TOKEN));
  assert.ok(!/dlk_/.test(testo));
  assert.equal(q.configurazione.stato, "pronta");
  if (q.configurazione.stato === "pronta") {
    assert.equal(q.configurazione.destinazione, "da-link.netbird.selfhosted:8443");
    assert.equal(q.configurazione.token_presente, true);
  }
});

test("a solo stato l'anteprima non ha inventario; a stato + inventario sì", async () => {
  impostaLivello("solo_stato", "u");
  let q = await quadroCosaEsce(dip());
  assert.equal(q.anteprima?.inventario, null);
  impostaLivello("stato_inventario", "u");
  q = await quadroCosaEsce(dip());
  assert.equal(q.anteprima?.inventario?.dispositivi, 7);
});

test("senza configurazione: si dice, e l'anteprima usa il cliente dell'istanza", async () => {
  const q = await quadroCosaEsce(dip({ config: () => ({ stato: "assente" }), clienteUnico: () => "88888" }));
  assert.equal(q.configurazione.stato, "assente");
  assert.equal(q.anteprima?.codcli, "88888");
  assert.equal(q.anteprima?.nodo, "88888-ipam");
});

test("senza configurazione e senza un cliente unico: nessuna anteprima, ma nessun errore", async () => {
  const q = await quadroCosaEsce(dip({ config: () => ({ stato: "assente" }), clienteUnico: () => null }));
  assert.equal(q.anteprima, null);
});

test("altri flussi: edge dal registro dei moduli, proxy Zabbix dal file", async () => {
  let q = await quadroCosaEsce(dip());
  assert.deepEqual(q.altri_flussi, { edge: "acceso", zabbix_proxy: "non_rilevato" });
  q = await quadroCosaEsce(
    dip({ fatti: async () => ({ fatti: { ...FATTI, moduli: { edge: false } }, clienteTrovato: true }), proxyZabbix: () => true }),
  );
  assert.deepEqual(q.altri_flussi, { edge: "spento", zabbix_proxy: "presente" });
});

test("la raccolta che fallisce: anteprima assente col motivo, il resto c'è", async () => {
  const q = await quadroCosaEsce(
    dip({
      fatti: async () => {
        throw new Error("x");
      },
    }),
  );
  assert.equal(q.anteprima, null);
  assert.match(q.anteprima_errore ?? "", /raccolta/);
  assert.equal(q.altri_flussi.edge, "non_so");
  assert.equal(q.ogni_minuti, 5);
});
