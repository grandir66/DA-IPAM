import { test } from "node:test";
import assert from "node:assert/strict";
import { expandIpEntries, ipInCidr, isCidr } from "../ip-range";

test("recognises a CIDR from a plain address", () => {
  assert.equal(isCidr("95.230.196.128/28"), true);
  assert.equal(isCidr("51.89.15.26"), false);
  assert.equal(isCidr("non-un-ip"), false);
});

test("membership works on a non byte-aligned prefix", () => {
  // 95.230.196.128/28 copre .128–.143
  assert.equal(ipInCidr("95.230.196.132", "95.230.196.128/28"), true);
  assert.equal(ipInCidr("95.230.196.143", "95.230.196.128/28"), true);
  assert.equal(ipInCidr("95.230.196.144", "95.230.196.128/28"), false);
  assert.equal(ipInCidr("95.230.196.127", "95.230.196.128/28"), false);
});

test("membership handles /32 and /24", () => {
  assert.equal(ipInCidr("10.0.0.5", "10.0.0.5/32"), true);
  assert.equal(ipInCidr("10.0.0.6", "10.0.0.5/32"), false);
  assert.equal(ipInCidr("10.0.0.200", "10.0.0.0/24"), true);
  assert.equal(ipInCidr("10.0.1.1", "10.0.0.0/24"), false);
});

test("rubbish never matches instead of throwing", () => {
  assert.equal(ipInCidr("boh", "10.0.0.0/24"), false);
  assert.equal(ipInCidr("10.0.0.1", "10.0.0.0/99"), false);
  assert.equal(ipInCidr(null, "10.0.0.0/24"), false);
});

test("expands a CIDR to explicit addresses, because the field is a keyword", () => {
  // I campi IP dell'indice sono mappati keyword: un term con CIDR da' zero
  // risultati, quindi la rete va espansa in indirizzi.
  const out = expandIpEntries(["95.230.196.128/28"]);
  assert.equal(out.length, 16);
  assert.ok(out.includes("95.230.196.128"));
  assert.ok(out.includes("95.230.196.143"));
  assert.ok(!out.includes("95.230.196.144"));
});

test("plain addresses pass through untouched and duplicates collapse", () => {
  const out = expandIpEntries(["10.0.0.1", "10.0.0.1", "10.0.0.0/30"]);
  assert.deepEqual(out.sort(), ["10.0.0.0", "10.0.0.1", "10.0.0.2", "10.0.0.3"]);
});

test("a range too wide is dropped rather than generating thousands of terms", () => {
  const out = expandIpEntries(["10.0.0.0/8"]);
  assert.deepEqual(out, []);
});

test("a CIDR written from a host address is normalised to its network", () => {
  // Caso reale: "51.89.15.25/29" non e' allineato al confine di rete. La /29
  // che lo contiene va da .24 a .31, ed e' quella che deve valere — altrimenti
  // gli indirizzi .26/.28/.29 realmente osservati resterebbero fuori.
  for (const ip of ["51.89.15.24", "51.89.15.25", "51.89.15.26", "51.89.15.28", "51.89.15.31"]) {
    assert.equal(ipInCidr(ip, "51.89.15.25/29"), true, ip);
  }
  assert.equal(ipInCidr("51.89.15.32", "51.89.15.25/29"), false);
  assert.equal(ipInCidr("51.89.15.23", "51.89.15.25/29"), false);

  const expanded = expandIpEntries(["51.89.15.25/29"]);
  assert.equal(expanded.length, 8);
  assert.ok(expanded.includes("51.89.15.26"));
});
