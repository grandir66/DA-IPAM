/**
 * Un elenco solo dei MAC virtuali (piano collector modulari, S3; scheda E06 dell'analisi del 20/10).
 * Fino al 21/10 c'erano due elenchi: `physical-device-db.ts` conosceva HSRPv2 e HSRP IPv6, `topology/identity.ts`
 * (l'indice dei nodi della mappa) no, e non leggeva la forma a punti Cisco. Un MAC HSRPv2 visto su due router
 * poteva così fondere due apparati nella mappa.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isVirtualMac, normalizeMac } from "@/lib/devices/mac-virtuali";
import { isVirtualMac as isVirtualMacMappa } from "@/lib/topology/identity";

test("normalizeMac: due punti, trattini, punti Cisco, maiuscole, nudo", () => {
  for (const m of ["00:00:0C:9F:F0:01", "00-00-0c-9f-f0-01", "0000.0c9f.f001", "00000C9FF001"]) {
    assert.equal(normalizeMac(m), "00:00:0c:9f:f0:01", m);
  }
  assert.equal(normalizeMac("00:00:0c:9f:f0"), null);
  assert.equal(normalizeMac(""), null);
  assert.equal(normalizeMac(null), null);
});

test("virtuali: VRRP v4/v6, HSRP v1, HSRPv2, HSRP IPv6, GLBP", () => {
  for (const m of ["00:00:5e:00:01:0a", "00:00:5e:00:02:0a", "00:00:0c:07:ac:01", "00:00:0c:9f:f0:01", "00:05:73:a0:00:01", "00:07:b4:00:01:02"]) {
    assert.equal(isVirtualMac(m), true, m);
  }
});

test("virtuali in ogni forma scritta", () => {
  assert.equal(isVirtualMac("0000.0c9f.f001"), true);
  assert.equal(isVirtualMac("00-07-B4-00-01-02"), true);
  assert.equal(isVirtualMac("00005E000101"), true);
});

test("un MAC fisico, vicino ai prefissi, non è virtuale", () => {
  for (const m of ["00:00:5e:00:03:01", "00:00:0c:07:ad:01", "00:07:b4:01:00:01", "02:00:00:00:00:01", "d4:ca:6d:00:00:01"]) {
    assert.equal(isVirtualMac(m), false, m);
  }
  assert.equal(isVirtualMac(null), false);
  assert.equal(isVirtualMac("non un mac"), false);
});

test("la mappa usa lo stesso elenco (prima non vedeva HSRPv2, GLBP, la forma a punti)", () => {
  for (const m of ["00:00:0c:9f:f0:01", "00:07:b4:00:01:02", "0000.0c9f.f001", "00:05:73:a0:00:01"]) {
    assert.equal(isVirtualMacMappa(m), true, m);
  }
  assert.equal(isVirtualMacMappa("d4:ca:6d:00:00:01"), false);
});
