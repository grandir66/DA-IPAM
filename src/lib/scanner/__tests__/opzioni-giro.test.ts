/**
 * Parse dei knob per-giro: range, IPv4, porte, tecniche da auditor.
 * Run: node --import tsx --test src/lib/scanner/__tests__/opzioni-giro.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ErroreLancio,
  ipPerRete,
  leggiPorteGiro,
  parseBersagliTesto,
  rifiutaTecnicheAuditor,
} from "../opzioni-giro";

test("targets: IPv4 e CIDR ≥ /16; più largo o IPv6 no", () => {
  assert.deepEqual(parseBersagliTesto("10.0.0.5, 10.0.1.0/24", "targets"), ["10.0.0.5", "10.0.1.0/24"]);
  assert.throws(() => parseBersagliTesto("10.0.0.0/8", "targets"), ErroreLancio);
  assert.throws(() => parseBersagliTesto("2001:db8::1", "targets"), ErroreLancio);
});

test("tcp_ports: preset, elenco, all senza conferma, tetto", () => {
  assert.equal(leggiPorteGiro("top100", "tcp_ports", false)?.preset, "top100");
  assert.equal(leggiPorteGiro("22,80,8000-8002", "tcp_ports", false)?.elenco, "22,80,8000,8001,8002");
  assert.throws(() => leggiPorteGiro("all", "tcp_ports", false), ErroreLancio);
  assert.equal(leggiPorteGiro("all", "tcp_ports", true)?.tutte, true);
  assert.throws(() => leggiPorteGiro("1-5000", "tcp_ports", false), ErroreLancio);
  assert.equal(leggiPorteGiro("22,80,9100,515", "tcp_ports", false)?.elenco, "22,80");
});

test("esclusioni togliere gli IP dal prefisso auto", () => {
  const ips = ipPerRete({
    cidr: "10.9.0.0/30",
    auto: true,
    bersagli: [],
    esclusioni: ["10.9.0.1"],
  });
  assert.ok(!ips.includes("10.9.0.1"));
  assert.ok(ips.includes("10.9.0.2"));
});

test("tecniche da auditor rifiutate; L2 senza conferma prima", () => {
  assert.throws(
    () => rifiutaTecnicheAuditor({ protocollo: "direct", srcPort: [], l2Active: true }),
    (e: unknown) => e instanceof ErroreLancio && /conferma/.test(e.message),
  );
  assert.throws(
    () => rifiutaTecnicheAuditor({ protocollo: "icmp_echo", srcPort: [], l2Active: true, confermaL2: true }),
    (e: unknown) => e instanceof ErroreLancio && /auditor/.test(e.message),
  );
  rifiutaTecnicheAuditor({ protocollo: "direct", srcPort: [] });
});
