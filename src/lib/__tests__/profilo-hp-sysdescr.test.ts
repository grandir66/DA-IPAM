/**
 * Profilo HP dal sysDescr (70151, 22/10): cinque Comware (5900AF, FF 5700) creati in blocco con il profilo di serie
 * `hp_switch_procurve`; la lettura delle informazioni ne leggeva il sysDescr «HPE Comware Platform Software» senza
 * correggerlo, e con quel profilo non partivano mai comandi né collector Comware.
 *
 * Run: DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test src/lib/__tests__/profilo-hp-sysdescr.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { profiloHpDaSysDescr } from "@/lib/device-product-profiles";

const COMWARE = "HPE Comware Platform Software, Software Version 7.1.045, Release 2432P06\r HPE FF 5700-32XGT-8XG-2QSFP+ Switch\r";
const ARUBA = "Aruba JL357A 2540-48G-PoE+-4SFP+ Switch, revision YC.16.11.0020, ROM YC.16.01.0003";

test("Comware nel sysDescr: un HP ProCurve (o senza profilo, o ArubaOS) diventa Comware", () => {
  assert.equal(profiloHpDaSysDescr({ vendor: "hp", product_profile: "hp_switch_procurve" }, COMWARE), "hp_switch_comware");
  assert.equal(profiloHpDaSysDescr({ vendor: "hp", product_profile: null }, COMWARE), "hp_switch_comware");
  assert.equal(profiloHpDaSysDescr({ vendor: "hp", product_profile: "hp_switch_arubaos" }, "H3C Comware Software, Version 5.20"), "hp_switch_comware");
});

test("ProCurve/Aruba nel sysDescr: un HP registrato Comware torna ProCurve; AOS-CX non si tocca", () => {
  assert.equal(profiloHpDaSysDescr({ vendor: "hp", product_profile: "hp_switch_comware" }, ARUBA), "hp_switch_procurve");
  assert.equal(profiloHpDaSysDescr({ vendor: "hp", product_profile: "hp_switch_comware" }, "ProCurve J9145A Switch 2910al-24G"), "hp_switch_procurve");
  assert.equal(profiloHpDaSysDescr({ vendor: "hp", product_profile: "hp_switch_comware" }, "Aruba JL658A 6300M ArubaOS-CX Virtual.10.11"), null);
});

test("niente da correggere: profilo già giusto, sysDescr vuoto o muto, altro produttore, iLO e stampanti", () => {
  assert.equal(profiloHpDaSysDescr({ vendor: "hp", product_profile: "hp_switch_comware" }, COMWARE), null);
  assert.equal(profiloHpDaSysDescr({ vendor: "hp", product_profile: "hp_switch_procurve" }, ARUBA), null);
  assert.equal(profiloHpDaSysDescr({ vendor: "hp", product_profile: "hp_switch_procurve" }, null), null);
  assert.equal(profiloHpDaSysDescr({ vendor: "hp", product_profile: "hp_switch_procurve" }, "Linux 5.10"), null);
  assert.equal(profiloHpDaSysDescr({ vendor: "mikrotik", product_profile: null }, COMWARE), null);
  assert.equal(profiloHpDaSysDescr({ vendor: "hp", product_profile: "hp_server_ilo" }, COMWARE), null);
  assert.equal(profiloHpDaSysDescr({ vendor: "hp", product_profile: "hp_stampante" }, ARUBA), null);
});
