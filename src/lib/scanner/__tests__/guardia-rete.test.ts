// La guardia di rete del banco (T3-16) deve fermare ogni uscita che dichiara:
// anche le scorciatoie DNS legate al resolver predefinito e le varianti
// sincrone dei processi esterni. Una guardia con un buco fa passare verde una
// prova che manda query o lancia processi veri.
//
//   DA_INVENT_DATA_DIR=$(mktemp -d "${TMPDIR:-/tmp}/x.XXXXXX") node --import tsx --test src/lib/scanner/__tests__/guardia-rete.test.ts
import { tentativiBloccati, togliGuardiaRete } from "./support/guardia-rete";
import childProcess from "node:child_process";
import dns from "node:dns";
import { test, after } from "node:test";
import assert from "node:assert/strict";

after(() => togliGuardiaRete());

const IP = "192.0.2.1";
const NOP = () => {};

const casi: Array<[string, () => unknown]> = [
  ["dns.reverse", () => dns.reverse(IP, NOP)],
  ["dns.resolve", () => dns.resolve("esempio.invalid", NOP)],
  ["dns.resolve4", () => dns.resolve4("esempio.invalid", NOP)],
  ["dns.resolve6", () => dns.resolve6("esempio.invalid", NOP)],
  ["dns.resolvePtr", () => dns.resolvePtr("esempio.invalid", NOP)],
  ["dns.promises.reverse", () => dns.promises.reverse(IP)],
  ["dns.promises.resolve", () => dns.promises.resolve("esempio.invalid")],
  ["dns.promises.resolve4", () => dns.promises.resolve4("esempio.invalid")],
  ["dns.promises.resolve6", () => dns.promises.resolve6("esempio.invalid")],
  ["dns.promises.resolvePtr", () => dns.promises.resolvePtr("esempio.invalid")],
  ["dns.Resolver.reverse (callback)", () => new dns.Resolver().reverse(IP, NOP)],
  ["dns.Resolver.resolve4 (callback)", () => new dns.Resolver().resolve4("esempio.invalid", NOP)],
  ["child_process.execFileSync", () => childProcess.execFileSync("true")],
  ["child_process.execSync", () => childProcess.execSync("true")],
  ["child_process.spawnSync", () => childProcess.spawnSync("true")],
  ["child_process.fork", () => childProcess.fork("/dev/null")],
];

for (const [nome, chiama] of casi) {
  test(`la guardia ferma ${nome}`, () => {
    tentativiBloccati.length = 0;
    assert.throws(chiama, /guardia di rete/);
    assert.equal(tentativiBloccati.length, 1, nome);
  });
}
