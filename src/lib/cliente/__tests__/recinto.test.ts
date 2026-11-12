/**
 * Recinto dell'utente «Cliente»: con il segno acceso resta in /cliente,
 * le API diverse da /api/auth sono vietate, il resto lo riporta a casa.
 * Senza il segno non cambia niente.
 *
 * Run: node --import tsx --test src/lib/cliente/__tests__/recinto.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { recinto, type EsitoRecinto } from "../recinto";

const PERCORSI = [
  "/cliente",
  "/cliente/reti",
  "/clienteX",
  "/",
  "/settings",
  "/discovery",
  "/api/hosts",
  "/api/auth/session",
  "/api/version",
] as const;

const ATTESI: Record<(typeof PERCORSI)[number], EsitoRecinto> = {
  "/cliente": "passa",
  "/cliente/reti": "passa",
  "/clienteX": "vai_a_cliente",
  "/": "vai_a_cliente",
  "/settings": "vai_a_cliente",
  "/discovery": "vai_a_cliente",
  "/api/hosts": "vietato",
  "/api/auth/session": "passa",
  "/api/version": "vietato",
};

test("vista cliente: ogni percorso ha l'esito deciso", () => {
  for (const percorso of PERCORSI) {
    assert.equal(recinto(true, percorso), ATTESI[percorso], percorso);
  }
});

test("senza vista cliente ogni percorso passa", () => {
  for (const percorso of PERCORSI) {
    assert.equal(recinto(false, percorso), "passa", percorso);
  }
});

// La topologia in sola lettura della vista cliente (Riccardo, 12/11/2026) legge dalle rotte della mappa: si aprono
// solo quelle, solo in GET. Ogni scrittura e ogni altra rotta restano vietate.
test("recinto: il Cliente legge la topologia, e nient'altro", () => {
  for (const p of ["/api/topology/model", "/api/topology/maps", "/api/topology/maps/auto", "/api/topology/maps/12", "/api/topology/links", "/api/topology/ports"]) {
    assert.equal(recinto(true, p, "GET"), "passa", p);
    for (const m of ["POST", "PUT", "PATCH", "DELETE", undefined]) assert.equal(recinto(true, p, m), "vietato", `${m} ${p}`);
  }
  for (const p of ["/api/topology/positions", "/api/topology/maps/12/nodes", "/api/topology/nodes/hidden", "/api/topology/candidati", "/api/topology", "/api/topology/modelX", "/api/hosts"]) {
    assert.equal(recinto(true, p, "GET"), "vietato", p);
  }
});
