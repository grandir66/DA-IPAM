/**
 * Regole pure della scansione automatica dei device scelti (piano 2026-10-22, Task 2): forma della config, frequenze,
 * idoneità («credenziale provata», definizione unica di `senzaCredenzialeProvata`) e letture valide per tipo.
 *
 * Run: node --import tsx --test src/lib/apparati-scelti/__tests__/regole.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ConfigApparatiScelti,
  MAX_APPARATI,
  TESTO_MOTIVO,
  etichettaFrequenza,
  frequenzaDaJob,
  intervalloDaFrequenza,
  leggiConfig,
  lettureValide,
  prossimaEsecuzione,
  valutaApparato,
  type StatoApparato,
} from "@/lib/apparati-scelti/regole";

const SWITCH: StatoApparato["tipo"] = { device_type: "switch", vendor: "hp", protocol: "snmp_v2", usa_arp: false, vlan_switch: true };

function stato(p: Partial<StatoApparato> = {}): StatoApparato {
  return {
    host_id: 10,
    device_id: 5,
    enabled: true,
    credenziali_memorizzate: 2,
    validate_sul_host: 1,
    binding_riusciti: 0,
    leggibile: true,
    tipo: SWITCH,
    ...p,
  };
}

const CONFIG_OK = { nome: "Apparati scelti", device_ids: [1, 2, 3], cosa: { info: true, porte_mac: false, vlan: false } };

// ── Idoneità ─────────────────────────────────────────────────────────────

test("apparato gestito con credenziale provata: incluso", () => {
  assert.deepEqual(valutaApparato(stato()), { incluso: true });
});

test("host senza device_id: NON_APPARATO", () => {
  assert.deepEqual(valutaApparato(stato({ device_id: null })), { incluso: false, motivo: "NON_APPARATO" });
});

test("id che il DB non ha trovato (né host né apparato): TOLTO", () => {
  assert.deepEqual(valutaApparato(stato({ host_id: null, device_id: null })), { incluso: false, motivo: "TOLTO" });
});

test("apparato disattivato: DISATTIVATO", () => {
  assert.deepEqual(valutaApparato(stato({ enabled: false })), { incluso: false, motivo: "DISATTIVATO" });
});

test("lettura non esistente per il tipo: NON_LEGGIBILE", () => {
  assert.deepEqual(valutaApparato(stato({ leggibile: false })), { incluso: false, motivo: "NON_LEGGIBILE" });
});

test("nessuna credenziale memorizzata: SENZA_CREDENZIALE", () => {
  assert.deepEqual(valutaApparato(stato({ credenziali_memorizzate: 0, validate_sul_host: 0 })), { incluso: false, motivo: "SENZA_CREDENZIALE" });
});

test("credenziale memorizzata ma validated = 0 sull'host: CREDENZIALE_NON_PROVATA", () => {
  assert.deepEqual(valutaApparato(stato({ validate_sul_host: 0, binding_riusciti: 3 })), { incluso: false, motivo: "CREDENZIALE_NON_PROVATA" },
    "con l'host vale l'host: i binding riusciti non contano (regola unica)");
});

test("apparato senza host con un binding success: incluso", () => {
  assert.deepEqual(valutaApparato(stato({ host_id: null, validate_sul_host: null, binding_riusciti: 1 })), { incluso: true });
});

test("apparato senza host senza binding riusciti: CREDENZIALE_NON_PROVATA", () => {
  assert.deepEqual(valutaApparato(stato({ host_id: null, validate_sul_host: null, binding_riusciti: 0 })), { incluso: false, motivo: "CREDENZIALE_NON_PROVATA" });
});

test("ordine dei motivi: NON_APPARATO, TOLTO, DISATTIVATO, NON_LEGGIBILE, SENZA_CREDENZIALE, CREDENZIALE_NON_PROVATA", () => {
  const tutto = { enabled: false, leggibile: false, credenziali_memorizzate: 0, validate_sul_host: 0 };
  const m = (s: StatoApparato): string => { const v = valutaApparato(s); return v.incluso ? "incluso" : v.motivo; };
  assert.equal(m(stato({ ...tutto, device_id: null })), "NON_APPARATO");
  assert.equal(m(stato({ ...tutto, host_id: null, device_id: null })), "TOLTO");
  assert.equal(m(stato(tutto)), "DISATTIVATO");
  assert.equal(m(stato({ ...tutto, enabled: true })), "NON_LEGGIBILE");
  assert.equal(m(stato({ ...tutto, enabled: true, leggibile: true })), "SENZA_CREDENZIALE");
  assert.equal(m(stato({ ...tutto, enabled: true, leggibile: true, credenziali_memorizzate: 1 })), "CREDENZIALE_NON_PROVATA");
});

test("ogni motivo ha il suo testo", () => {
  for (const k of ["NON_APPARATO", "TOLTO", "SENZA_CREDENZIALE", "CREDENZIALE_NON_PROVATA", "DISATTIVATO", "NON_LEGGIBILE"] as const) {
    assert.ok(TESTO_MOTIVO[k] && TESTO_MOTIVO[k].length > 3, k);
  }
  assert.equal(TESTO_MOTIVO.NON_APPARATO, "non è un apparato");
  assert.equal(TESTO_MOTIVO.SENZA_CREDENZIALE, "nessuna credenziale memorizzata");
  assert.equal(TESTO_MOTIVO.CREDENZIALE_NON_PROVATA, "credenziale non provata");
});

// ── Letture valide ───────────────────────────────────────────────────────

test("switch SNMP: tutte e tre le letture", () => {
  assert.deepEqual(lettureValide(SWITCH), ["info", "porte_mac", "vlan"]);
});

test("hypervisor: solo le informazioni", () => {
  assert.deepEqual(lettureValide({ device_type: "hypervisor", vendor: "proxmox", protocol: "api", usa_arp: false, vlan_switch: false }), ["info"]);
});

test("router MikroTik via SSH con ARP: tutte e tre (VLAN dalla scheda MikroTik)", () => {
  assert.deepEqual(lettureValide({ device_type: "router", vendor: "mikrotik", protocol: "ssh", usa_arp: true, vlan_switch: false }), ["info", "porte_mac", "vlan"]);
});

test("router non MikroTik con ARP: informazioni e porte, niente VLAN", () => {
  assert.deepEqual(lettureValide({ device_type: "router", vendor: "cisco", protocol: "ssh", usa_arp: true, vlan_switch: false }), ["info", "porte_mac"]);
});

test("MikroTik via API (non SSH): niente VLAN", () => {
  assert.deepEqual(lettureValide({ device_type: "router", vendor: "mikrotik", protocol: "api", usa_arp: true, vlan_switch: false }), ["info", "porte_mac"]);
});

test("switch senza SNMP: informazioni e porte, niente VLAN", () => {
  assert.deepEqual(lettureValide({ ...SWITCH, protocol: "ssh", vlan_switch: false }), ["info", "porte_mac"]);
});

// ── Config ───────────────────────────────────────────────────────────────

test("config valida: accettata", () => {
  assert.equal(ConfigApparatiScelti.safeParse(CONFIG_OK).success, true);
  assert.equal(ConfigApparatiScelti.safeParse({ ...CONFIG_OK, ora: "02:00" }).success, true);
  assert.equal(ConfigApparatiScelti.safeParse({ ...CONFIG_OK, device_ids: Array.from({ length: MAX_APPARATI }, (_, i) => i + 1) }).success, true);
});

test("config con 51 id: rifiutata", () => {
  assert.equal(MAX_APPARATI, 50);
  assert.equal(ConfigApparatiScelti.safeParse({ ...CONFIG_OK, device_ids: Array.from({ length: 51 }, (_, i) => i + 1) }).success, false);
});

test("config con id doppi: rifiutata", () => {
  assert.equal(ConfigApparatiScelti.safeParse({ ...CONFIG_OK, device_ids: [1, 2, 2] }).success, false);
});

test("config senza apparati, con id non interi o non positivi: rifiutata", () => {
  assert.equal(ConfigApparatiScelti.safeParse({ ...CONFIG_OK, device_ids: [] }).success, false);
  assert.equal(ConfigApparatiScelti.safeParse({ ...CONFIG_OK, device_ids: [1.5] }).success, false);
  assert.equal(ConfigApparatiScelti.safeParse({ ...CONFIG_OK, device_ids: [0] }).success, false);
});

test("config senza nessuna lettura: rifiutata", () => {
  assert.equal(ConfigApparatiScelti.safeParse({ ...CONFIG_OK, cosa: { info: false, porte_mac: false, vlan: false } }).success, false);
});

test("config con ora «24:00» o «2:00»: rifiutata", () => {
  assert.equal(ConfigApparatiScelti.safeParse({ ...CONFIG_OK, ora: "24:00" }).success, false);
  assert.equal(ConfigApparatiScelti.safeParse({ ...CONFIG_OK, ora: "2:00" }).success, false);
  assert.equal(ConfigApparatiScelti.safeParse({ ...CONFIG_OK, ora: "23:60" }).success, false);
});

test("config col nome vuoto o oltre 80 caratteri: rifiutata", () => {
  assert.equal(ConfigApparatiScelti.safeParse({ ...CONFIG_OK, nome: "" }).success, false);
  assert.equal(ConfigApparatiScelti.safeParse({ ...CONFIG_OK, nome: "x".repeat(81) }).success, false);
  assert.equal(ConfigApparatiScelti.safeParse({ ...CONFIG_OK, nome: "x".repeat(80) }).success, true);
});

test("leggiConfig: JSON rotto, null o forma sbagliata → null; buono → oggetto", () => {
  assert.equal(leggiConfig(null), null);
  assert.equal(leggiConfig("{rotto"), null);
  assert.equal(leggiConfig("{}"), null);
  assert.deepEqual(leggiConfig(JSON.stringify(CONFIG_OK)), CONFIG_OK);
});

// ── Frequenze ────────────────────────────────────────────────────────────

test("intervalloDaFrequenza e frequenzaDaJob vanno e tornano", () => {
  assert.equal(intervalloDaFrequenza({ tipo: "ora" }), 60);
  assert.equal(intervalloDaFrequenza({ tipo: "4ore" }), 240);
  assert.equal(intervalloDaFrequenza({ tipo: "giorno", ora: "02:00" }), 1440);
  assert.deepEqual(frequenzaDaJob(60, {}), { tipo: "ora" });
  assert.deepEqual(frequenzaDaJob(240, {}), { tipo: "4ore" });
  assert.deepEqual(frequenzaDaJob(1440, { ora: "02:00" }), { tipo: "giorno", ora: "02:00" });
});

test("frequenzaDaJob: forma non prevista → null", () => {
  assert.equal(frequenzaDaJob(1440, {}), null, "giornaliero senza ora");
  assert.equal(frequenzaDaJob(1440, { ora: "25:00" }), null);
  assert.equal(frequenzaDaJob(30, {}), null);
  assert.equal(frequenzaDaJob(120, {}), null);
});

test("etichettaFrequenza", () => {
  assert.equal(etichettaFrequenza({ tipo: "ora" }), "ogni ora");
  assert.equal(etichettaFrequenza({ tipo: "4ore" }), "ogni 4 ore");
  assert.equal(etichettaFrequenza({ tipo: "giorno", ora: "02:00" }), "ogni giorno alle 02:00");
});

test("prossimaEsecuzione: ogni ora → l'ora piena dopo", () => {
  const p = prossimaEsecuzione({ tipo: "ora" }, new Date(2026, 9, 22, 9, 40));
  assert.equal(p.getTime(), new Date(2026, 9, 22, 10, 0).getTime());
});

test("prossimaEsecuzione: ogni 4 ore alle 09:40 → 12:00 (ore divisibili per 4, come node-cron)", () => {
  assert.equal(prossimaEsecuzione({ tipo: "4ore" }, new Date(2026, 9, 22, 9, 40)).getTime(), new Date(2026, 9, 22, 12, 0).getTime());
  assert.equal(prossimaEsecuzione({ tipo: "4ore" }, new Date(2026, 9, 22, 22, 10)).getTime(), new Date(2026, 9, 23, 0, 0).getTime());
  assert.equal(prossimaEsecuzione({ tipo: "4ore" }, new Date(2026, 9, 22, 12, 0)).getTime(), new Date(2026, 9, 22, 16, 0).getTime(), "sull'ora esatta: la prossima");
});

test("prossimaEsecuzione: ogni giorno alle 02:00, alle 09:40 → domani 02:00; alle 01:00 → oggi 02:00", () => {
  assert.equal(prossimaEsecuzione({ tipo: "giorno", ora: "02:00" }, new Date(2026, 9, 22, 9, 40)).getTime(), new Date(2026, 9, 23, 2, 0).getTime());
  assert.equal(prossimaEsecuzione({ tipo: "giorno", ora: "02:30" }, new Date(2026, 9, 22, 1, 0)).getTime(), new Date(2026, 9, 22, 2, 30).getTime());
});
