/**
 * Scheda Da sistemare: dai gruppi per software ai programmi da aggiornare.
 * Le prove su perApparato sono tolte con la funzione (Task 7 bis).
 *
 * Run: node --import tsx --test src/lib/cliente/__tests__/da-sistemare.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { GruppoRilievi } from "@/lib/rilievi/gruppi";
import type { RollupRilievi } from "@/lib/rilievi/tipi";
import { daGruppi, schedaDaSistemare } from "../schede/da-sistemare";
import { SCHEDE_CLIENTE } from "../registro";

function gravita(critical: number, high: number): RollupRilievi {
  return { Critical: critical, High: high, Medium: 0, Low: 0 };
}

function gruppo(
  sopra: Partial<Pick<GruppoRilievi, "chiave" | "tipo" | "nome" | "host" | "rilievi" | "gravita" | "kev" | "anteprima">>,
): Pick<GruppoRilievi, "chiave" | "tipo" | "nome" | "host" | "rilievi" | "gravita" | "kev" | "anteprima"> {
  return {
    chiave: sopra.chiave ?? "sw:a",
    tipo: sopra.tipo ?? "software",
    nome: sopra.nome ?? "Programma",
    host: sopra.host ?? 1,
    rilievi: sopra.rilievi ?? 1,
    gravita: sopra.gravita ?? gravita(1, 0),
    kev: sopra.kev ?? 0,
    anteprima: sopra.anteprima ?? [],
  };
}

test("daGruppi tiene l'ordine dei programmi e separa da correggere e gli altri", () => {
  const titoli = Array.from({ length: 12 }, (_, i) => `Titolo ${i + 1}`);
  const esito = daGruppi([
    gruppo({ chiave: "sw:chrome", nome: "Google Chrome", host: 3, gravita: gravita(0, 4), kev: 0 }),
    gruppo({ chiave: "sw:kernel", nome: "Kernel Linux", host: 11, gravita: gravita(2, 0), kev: 2 }),
    gruppo({ chiave: "sw:win", nome: "Windows Server 2019", host: 6, gravita: gravita(1, 0), kev: 0 }),
    gruppo({ chiave: "senza", tipo: "senza", nome: "Senza un aggiornamento da fare", host: 12, rilievi: 22, anteprima: titoli }),
    gruppo({ chiave: "edge", tipo: "edge", nome: "Vulnerabilità senza un pacchetto indicato", host: 40, rilievi: 106, anteprima: ["CVE-2025-55315"] }),
  ]);
  assert.deepEqual(
    esito.programmi.map((p) => p.nome),
    ["Google Chrome", "Kernel Linux", "Windows Server 2019"],
  );
  assert.equal(esito.programmi[0]?.gravita, "attenzione");
  assert.equal(esito.programmi[0]?.sfruttato, false);
  assert.equal(esito.programmi[1]?.gravita, "grave");
  assert.equal(esito.programmi[1]?.sfruttato, true);
  assert.equal(esito.totaleProgrammi, 3);
  assert.equal(esito.daCorreggere?.rilievi, 22);
  assert.equal(esito.daCorreggere?.apparati, 12);
  assert.deepEqual(esito.daCorreggere?.titoli, titoli);
  assert.deepEqual(esito.altri, { rilievi: 106, apparati: 40 });
  assert.equal(esito.programmi.some((p) => p.nome.includes("CVE")), false);
});

test("senza gruppi non c'è niente da mostrare", () => {
  const esito = daGruppi([]);
  assert.deepEqual(esito.programmi, []);
  assert.equal(esito.totaleProgrammi, 0);
  assert.equal(esito.daCorreggere, null);
  assert.equal(esito.altri, null);
});

test("un gruppo edge o senza con zero rilievi non compare", () => {
  const esito = daGruppi([
    gruppo({ tipo: "edge", rilievi: 0, host: 4, anteprima: ["CVE-1"] }),
    gruppo({ tipo: "senza", rilievi: 0, host: 2, anteprima: ["Login di fabbrica"] }),
  ]);
  assert.deepEqual(esito.programmi, []);
  assert.equal(esito.daCorreggere, null);
  assert.equal(esito.altri, null);
});

test("la scheda Da sistemare è nel registro", () => {
  assert.equal(schedaDaSistemare.id, "da-sistemare");
  assert.equal(schedaDaSistemare.titolo, "Da sistemare");
  assert.equal(schedaDaSistemare.ordine, 30);
  assert.equal(schedaDaSistemare.icona, "Wrench");
  assert.equal(SCHEDE_CLIENTE.some((s) => s.id === "da-sistemare"), true);
});
