import test from "node:test";
import assert from "node:assert/strict";
import { eGiroCambiamenti, indirizziDelCidr, reteDelProssimoGiro, reteDellaNotte, CONFIG_GIRO_CAMBIAMENTI } from "../giro-notturno";
import { scheduledJobLabel, ETICHETTE_JOB } from "@/lib/scheduled-job-types";

const RETI = [
  { id: 3, cidr: "10.0.3.0/24" }, { id: 1, cidr: "10.0.1.0/24" }, { id: 2, cidr: "10.8.0.0/16" }, { id: 5, cidr: "10.0.5.0/22" },
];
const GIORNO = 86_400_000;
const NOTTE = Date.UTC(2026, 10, 15, 2, 0, 0); // le 03:00 italiane

test("una rete per notte, a rotazione, senza le reti troppo grandi", () => {
  const viste = [0, 1, 2, 3, 4, 5].map((n) => reteDellaNotte(RETI, NOTTE + n * GIORNO).rete!.id);
  assert.deepEqual(new Set(viste), new Set([1, 3, 5]));
  assert.equal(viste.includes(2), false, "la /16 resta fuori");
  assert.equal(viste[0], viste[3], "dopo tre notti si ricomincia");
  assert.notEqual(viste[0], viste[1]);
  assert.equal(reteDellaNotte(RETI, NOTTE).troppoGrandi, 1);
});

test("la stessa notte dà la stessa rete prima e dopo la mezzanotte UTC", () => {
  // le 00:30 e le 03:30 italiane dello stesso giorno: la prima è ancora il giorno prima in UTC
  const a = reteDellaNotte(RETI, Date.UTC(2026, 10, 14, 23, 30, 0)).rete!.id;
  const b = reteDellaNotte(RETI, Date.UTC(2026, 10, 15, 2, 30, 0)).rete!.id;
  assert.equal(a, b);
});

test("senza reti ammesse non parte niente", () => {
  assert.equal(reteDellaNotte([{ id: 1, cidr: "10.0.0.0/8" }, { id: 2, cidr: "storta" }], NOTTE).rete, null);
  assert.equal(indirizziDelCidr("192.168.1.0/24"), 256);
});

test("il giro si riconosce dalla config e ha il suo nome fra i job", () => {
  assert.equal(eGiroCambiamenti(CONFIG_GIRO_CAMBIAMENTI), true);
  assert.equal(eGiroCambiamenti("{}"), false);
  assert.equal(eGiroCambiamenti("non json"), false);
  assert.equal(scheduledJobLabel({ job_type: "nmap_scan", config: CONFIG_GIRO_CAMBIAMENTI }, ETICHETTE_JOB), "Giro notturno delle porte (cambiamenti)");
  assert.equal(scheduledJobLabel({ job_type: "nmap_scan", config: "{}" }, ETICHETTE_JOB), "Nmap Scan");
});

test("di pomeriggio la pagina annuncia la rete del giro di domani alle 03:00", () => {
  const pomeriggio = Date.UTC(2026, 10, 14, 16, 30, 0); // 17:30 italiane del 14/11
  const giro = Date.UTC(2026, 10, 15, 2, 0, 0); // 03:00 italiane del 15/11
  assert.equal(reteDelProssimoGiro(RETI, pomeriggio)!.id, reteDellaNotte(RETI, giro).rete!.id);
  // all'una di notte il prossimo giro è quello di oggi
  assert.equal(reteDelProssimoGiro(RETI, Date.UTC(2026, 10, 15, 0, 0, 0))!.id, reteDellaNotte(RETI, giro).rete!.id);
});
