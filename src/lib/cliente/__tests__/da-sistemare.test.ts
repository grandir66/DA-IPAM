/**
 * Scheda Da sistemare: dai gruppi per host alle righe della pagina.
 *
 * Run: node --import tsx --test src/lib/cliente/__tests__/da-sistemare.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { GruppoRilievi } from "@/lib/rilievi/gruppi";
import type { RollupRilievi } from "@/lib/rilievi/tipi";
import { perApparato, schedaDaSistemare } from "../schede/da-sistemare";
import { SCHEDE_CLIENTE } from "../registro";

function gravita(critical: number, high: number): RollupRilievi {
  return { Critical: critical, High: high, Medium: 0, Low: 0 };
}

function gruppo(
  sopra: Partial<Pick<GruppoRilievi, "chiave" | "tipo" | "nome" | "dettaglio" | "gravita" | "anteprima">>,
): Pick<GruppoRilievi, "chiave" | "tipo" | "nome" | "dettaglio" | "gravita" | "anteprima"> {
  return {
    chiave: sopra.chiave ?? "host:1",
    tipo: sopra.tipo ?? "host",
    nome: sopra.nome ?? "Apparato",
    dettaglio: sopra.dettaglio ?? null,
    gravita: sopra.gravita ?? gravita(1, 0),
    anteprima: sopra.anteprima ?? ["Titolo"],
  };
}

test("perApparato scarta i gruppi senza host e quelli senza critici né alti", () => {
  const apparati = perApparato(
    [
      gruppo({ chiave: "senza", tipo: "senza", nome: "Senza un host preciso", gravita: gravita(9, 9), anteprima: ["Da scartare"] }),
      gruppo({ chiave: "host:vuoto", nome: "Vuoto", gravita: gravita(0, 0), anteprima: ["Niente"] }),
      gruppo({ chiave: "host:1", nome: "Server", dettaglio: "10.0.0.1 · LAN", gravita: gravita(2, 1), anteprima: ["Aggiornare il kernel"] }),
    ],
    [{ titolo: "Aggiornare il kernel", rimedio: "  Installa gli aggiornamenti  " }],
  );
  assert.equal(apparati.length, 1);
  assert.equal(apparati[0]?.chiave, "host:1");
  assert.equal(apparati[0]?.nome, "Server");
  assert.equal(apparati[0]?.dettaglio, "10.0.0.1 · LAN");
  assert.equal(apparati[0]?.gravi, 2);
  assert.equal(apparati[0]?.alte, 1);
  assert.equal(apparati[0]?.cosa, "Aggiornare il kernel");
  assert.equal(apparati[0]?.rimedio, "Installa gli aggiornamenti");
});

test("il rimedio vuoto o di un altro titolo diventa null", () => {
  const apparati = perApparato(
    [
      gruppo({ chiave: "host:1", nome: "Uno", anteprima: ["Titolo vuoto"] }),
      gruppo({ chiave: "host:2", nome: "Due", anteprima: ["Titolo assente"] }),
      gruppo({ chiave: "host:3", nome: "Tre", anteprima: [] }),
    ],
    [
      { titolo: "Titolo vuoto", rimedio: "   " },
      { titolo: "Titolo vuoto", rimedio: "Non vale: conta la prima riga" },
      { titolo: "Altro", rimedio: "Non è questo" },
    ],
  );
  assert.equal(apparati.find((a) => a.nome === "Uno")?.rimedio, null);
  assert.equal(apparati.find((a) => a.nome === "Due")?.rimedio, null);
  assert.equal(apparati.find((a) => a.nome === "Tre")?.cosa, "Rilievo senza titolo");
  assert.equal(apparati.find((a) => a.nome === "Tre")?.rimedio, null);
});

test("l'ordine è gravi, poi alte, poi il nome", () => {
  const apparati = perApparato(
    [
      gruppo({ chiave: "host:z", nome: "Zeta", gravita: gravita(3, 1) }),
      gruppo({ chiave: "host:a", nome: "Alfa", gravita: gravita(3, 1) }),
      gruppo({ chiave: "host:b", nome: "Beta", gravita: gravita(3, 4) }),
      gruppo({ chiave: "host:g", nome: "Gamma", gravita: gravita(8, 0) }),
    ],
    [],
  );
  assert.deepEqual(apparati.map((a) => a.nome), ["Gamma", "Beta", "Alfa", "Zeta"]);
});

test("la scheda Da sistemare è nel registro", () => {
  assert.equal(schedaDaSistemare.id, "da-sistemare");
  assert.equal(schedaDaSistemare.titolo, "Da sistemare");
  assert.equal(schedaDaSistemare.ordine, 30);
  assert.equal(schedaDaSistemare.icona, "Wrench");
  assert.equal(SCHEDE_CLIENTE.some((s) => s.id === "da-sistemare"), true);
});
