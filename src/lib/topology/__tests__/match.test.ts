import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeName, resolveRemote } from "@/lib/topology/match";

test("normalizeName abbassa e toglie dominio/spazi", () => {
  assert.equal(normalizeName("MK-D1-RTR.dts.local "), "mk-d1-rtr");
});

test("resolveRemote preferisce il match per IP", () => {
  const index = { byName: new Map([["sw1", "dev:1"]]), byIp: new Map([["172.17.0.5", "host:9"]]) };
  assert.equal(resolveRemote({ name: "sw1", ip: "172.17.0.5" }, index), "host:9");
});

test("resolveRemote ripiega sul nome normalizzato", () => {
  const index = { byName: new Map([["sw1", "dev:1"]]), byIp: new Map<string, string>() };
  assert.equal(resolveRemote({ name: "SW1.dts.local", ip: null }, index), "dev:1");
});

test("resolveRemote ritorna null se non risolvibile", () => {
  assert.equal(
    resolveRemote({ name: "ignoto", ip: null }, { byName: new Map<string, string>(), byIp: new Map<string, string>() }),
    null,
  );
});
