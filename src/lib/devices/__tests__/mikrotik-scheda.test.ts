/**
 * Risorse e hardware MikroTik dalle uscite vere del router (fixture anonimizzate).
 * Incidente: il Manager trattava MiB e GiB come lo stesso numero; qui si converte davvero.
 *
 * Run: node --import tsx --test src/lib/devices/__tests__/mikrotik-scheda.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { byteRouterOs, parseRisorse, parseRouterboard } from "../mikrotik-scheda";
import { parseMikrotikArp } from "../router-client";

const fx = (n: string) => readFileSync(join(__dirname, "fixtures", n), "utf8");

describe("byteRouterOs", () => {
  it("converte davvero KiB/MiB/GiB", () => {
    assert.equal(byteRouterOs("1.0GiB"), 1073741824);
    assert.equal(byteRouterOs("1024.0MiB"), 1073741824);
    assert.equal(byteRouterOs("47.0KiB"), 48128);
    assert.equal(byteRouterOs("4096"), 4096);
  });
  it("illeggibile -> null", () => {
    assert.equal(byteRouterOs("x"), null);
    assert.equal(byteRouterOs(""), null);
    assert.equal(byteRouterOs(null), null);
  });
});

describe("parseRisorse", () => {
  const r = parseRisorse(fx("mikrotik-resource.txt"));
  it("campi dalla fixture vera", () => {
    assert.equal(r.uptime, "2w20m57s");
    assert.equal(r.uptime_s, 2 * 604800 + 20 * 60 + 57);
    assert.equal(r.versione, "7.24.5 (stable)");
    assert.equal(r.build, "2026-09-29 14:21:27");
    assert.equal(r.cpu, "ARM64");
    assert.equal(r.cpu_core, 4);
    assert.equal(r.cpu_mhz, 1700);
    assert.equal(r.cpu_carico, 1);
    assert.equal(r.memoria_totale_b, 4096 * 1048576);
    assert.equal(r.memoria_libera_b, Math.round(3729.3 * 1048576));
    assert.equal(r.disco_totale_b, 128 * 1048576);
    assert.equal(r.disco_libero_b, Math.round(83.4 * 1048576));
    assert.equal(r.architettura, "arm64");
    assert.equal(r.board, "CCR2004-1G-12S+2XS");
    assert.equal(r.piattaforma, "MikroTik");
  });
  it("uscita vuota -> tutto null", () => {
    const v = parseRisorse("");
    assert.ok(Object.values(v).every((x) => x === null));
  });
});

describe("parseRouterboard", () => {
  it("fixture vera", () => {
    const h = parseRouterboard(fx("mikrotik-routerboard.txt"));
    assert.equal(h.routerboard, true);
    assert.equal(h.modello, "CCR2004-1G-12S+2XS");
    assert.equal(h.seriale, "A0A0A0A0A0A0");
    assert.equal(h.firmware_tipo, "al64");
    assert.equal(h.firmware_corrente, "7.10.2");
    assert.equal(h.firmware_aggiornabile, "7.24.5");
    assert.equal(h.revisione, null);
  });
  it("CHR: routerboard no -> campi null", () => {
    const h = parseRouterboard("routerboard: no\n");
    assert.equal(h.routerboard, false);
    assert.equal(h.modello, null);
    assert.equal(h.seriale, null);
    assert.equal(h.firmware_corrente, null);
    assert.equal(h.firmware_aggiornabile, null);
  });
});

describe("parseMikrotikArp (stato e dinamico)", () => {
  const arp = parseMikrotikArp(fx("mikrotik-arp-terse.txt"));
  it("status= e flag D dalla fixture vera", () => {
    assert.deepEqual(arp[0], { ip: "10.20.1.178", mac: "02:00:A0:10:00:01", interface_name: "VL_4_ZONA01", status: "permanent", dynamic: false });
    assert.deepEqual(arp[1], { ip: "10.20.2.45", mac: "02:00:A0:10:00:02", interface_name: "VL_40_ZONA02", status: "incomplete", dynamic: true });
    assert.equal(arp[2].status, "reachable");
    assert.equal(arp[2].dynamic, true, "DC: dinamica e connessa");
  });
  it("le righe senza MAC (incomplete/failed) non entrano, come prima", () => {
    assert.ok(arp.every((e) => e.mac !== ""));
    assert.equal(arp.find((e) => e.ip === "10.20.1.35"), undefined);
  });
  it("ogni stato presente nella fixture è uno dei sei di RouterOS", () => {
    const stati = new Set(arp.map((e) => e.status));
    for (const s of stati) assert.ok(["reachable", "stale", "delay", "failed", "incomplete", "permanent"].includes(String(s)), String(s));
  });
});
