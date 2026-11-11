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
