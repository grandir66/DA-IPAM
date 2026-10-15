import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeName, resolveRemote } from "@/lib/topology/match";

test("normalizeName abbassa e toglie dominio/spazi", () => {
  assert.equal(normalizeName("RTR-1.cliente-a.local "), "rtr-1");
});

test("resolveRemote preferisce il match per IP", () => {
  const index = { byName: new Map([["sw1", "dev:1"]]), byIp: new Map([["10.1.0.5", "host:9"]]) };
  assert.equal(resolveRemote({ name: "sw1", ip: "10.1.0.5" }, index), "host:9");
});

test("resolveRemote ripiega sul nome normalizzato", () => {
  const index = { byName: new Map([["sw1", "dev:1"]]), byIp: new Map<string, string>() };
  assert.equal(resolveRemote({ name: "SW1.cliente-a.local", ip: null }, index), "dev:1");
});

test("resolveRemote ritorna null se non risolvibile", () => {
  assert.equal(
    resolveRemote({ name: "ignoto", ip: null }, { byName: new Map<string, string>(), byIp: new Map<string, string>() }),
    null,
  );
});
