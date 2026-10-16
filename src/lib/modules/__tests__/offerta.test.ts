/**
 * Passo 4c del piano di solidità (16/10): moduli opzionali, potenzialmente a
 * pagamento. Si prepara il campo `offerta` e la presentazione degli stati;
 * nessun blocco finché la licenza di DA-Link non esiste.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { MODULE_DESCRIPTORS } from "@/lib/modules/registry";
import {
  ETICHETTA_STATO_OFFERTA,
  OFFERTA_MODULO,
  opzioneAcquistata,
  statoOfferta,
  type IngressoStatoOfferta,
  type StatoOfferta,
} from "@/lib/modules/offerta";

test("le opzioni del catalogo sono Patch, MeshCentral e Wazuh; LibreNMS è base", () => {
  const opzioni = MODULE_DESCRIPTORS.filter((d) => d.offerta === "opzione").map((d) => d.key).sort();
  assert.deepEqual(opzioni, ["meshcentral", "patch_management", "wazuh"]);
  const librenms = MODULE_DESCRIPTORS.find((d) => d.key === "librenms");
  assert.equal(librenms?.offerta, "base");
});

test("ogni descrittore porta l'offerta della tabella pura (una sola fonte)", () => {
  for (const d of MODULE_DESCRIPTORS) {
    assert.equal(d.offerta, OFFERTA_MODULO[d.key], `offerta di ${d.key}`);
  }
  assert.deepEqual(
    Object.keys(OFFERTA_MODULO).sort(),
    MODULE_DESCRIPTORS.map((d) => d.key).sort(),
  );
});

test("oggi ogni opzione vale come acquistata: nessuna installazione cambia comportamento", () => {
  for (const d of MODULE_DESCRIPTORS) {
    assert.equal(opzioneAcquistata(d.key), true, d.key);
  }
});

const casi: Array<[string, IngressoStatoOfferta, StatoOfferta]> = [
  ["non acquistata, anche se guasta", { acquistato: false, configured: true, enabled: true, verdict: "fail" }, "non_acquistato"],
  ["non acquistata e mai configurata", { acquistato: false, configured: false, enabled: false }, "non_acquistato"],
  ["acquistata, mai configurata", { acquistato: true, configured: false, enabled: false, verdict: "off" }, "da_configurare"],
  ["acquistata, mai configurata, salute non ancora arrivata", { acquistato: true, configured: false, enabled: false }, "da_configurare"],
  ["acceso a metà (fail della salute)", { acquistato: true, configured: false, enabled: false, verdict: "fail" }, "guasto"],
  ["configurata ma spenta", { acquistato: true, configured: true, enabled: false }, "spento"],
  ["configurata, la salute dice off", { acquistato: true, configured: true, enabled: true, verdict: "off" }, "spento"],
  ["attiva e connessa", { acquistato: true, configured: true, enabled: true, verdict: "ok" }, "attivo"],
  ["attiva, degradata", { acquistato: true, configured: true, enabled: true, verdict: "degraded" }, "attivo"],
  ["attiva, locale non verificata (Patch)", { acquistato: true, configured: true, enabled: true, verdict: "unverified" }, "attivo"],
  ["attiva, salute non ancora arrivata", { acquistato: true, configured: true, enabled: true, verdict: null }, "attivo"],
  ["attiva ma guasta", { acquistato: true, configured: true, enabled: true, verdict: "fail" }, "guasto"],
];

for (const [nome, ingresso, atteso] of casi) {
  test(`statoOfferta: ${nome} → ${atteso}`, () => {
    assert.equal(statoOfferta(ingresso), atteso);
  });
}

test("ogni stato ha un'etichetta in italiano", () => {
  assert.deepEqual(ETICHETTA_STATO_OFFERTA, {
    non_acquistato: "Non acquistato",
    da_configurare: "Acquistato, da configurare",
    spento: "Spento",
    attivo: "Attivo",
    guasto: "Guasto",
  });
});
