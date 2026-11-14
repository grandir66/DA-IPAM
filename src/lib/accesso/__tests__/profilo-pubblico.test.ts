import { test } from "node:test";
import assert from "node:assert/strict";
import { profiloSenzaSegreti, puoVedereProfilo } from "../profilo-pubblico";

const riga = { id: 1, codice_cliente: "A", ragione_sociale: "Alfa", agent_token_hash: "hash-finto", agent_token_encrypted: "cifrato-finto" };

test("i gettoni dell'agente non escono, resta solo che ci sono", () => {
  const r = profiloSenzaSegreti(riga);
  const testo = JSON.stringify(r);
  assert.ok(!testo.includes("hash-finto") && !testo.includes("cifrato-finto"));
  assert.ok(!Object.keys(r).some((k) => k === "agent_token_hash" || k === "agent_token_encrypted"));
  assert.equal(r.agent_token_configurato, true);
  assert.equal(r.ragione_sociale, "Alfa");
  assert.equal(profiloSenzaSegreti({ id: 2, agent_token_hash: null }).agent_token_configurato, false);
});

test("chi non è admin vede solo i profili a cui appartiene", () => {
  assert.equal(puoVedereProfilo({ role: "viewer", tenants: [{ code: "A" }] }, "A"), true);
  assert.equal(puoVedereProfilo({ role: "viewer", tenants: [{ code: "A" }] }, "B"), false);
  assert.equal(puoVedereProfilo({ role: "viewer" }, "A"), false);
  assert.equal(puoVedereProfilo({ role: "admin", tenants: [] }, "B"), true);
  assert.equal(puoVedereProfilo({ role: "superadmin" }, "B"), true);
});

test("hub.db intero: admin sull'installazione del cliente, solo superadmin sul tecnico", async () => {
  const { puoScaricareHub } = await import("../profilo-pubblico");
  assert.equal(puoScaricareHub("admin", false), true);
  assert.equal(puoScaricareHub("admin", true), false);
  assert.equal(puoScaricareHub("superadmin", true), true);
  assert.equal(puoScaricareHub("viewer", false), false);
  assert.equal(puoScaricareHub(undefined, false), false);
});
