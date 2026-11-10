/**
 * Profili del lanciatore: porte, ritmo, Completo mai come elenco di 65.535 numeri.
 * Run: node --import tsx --test src/lib/scanner/__tests__/profili-giro.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fasiValide, parametriProfilo } from "../profili-giro";

const NMAP = [
  "http\t80/tcp\t0.48",
  "ssh\t22/tcp\t0.18",
  "https\t443/tcp\t0.17",
  "smb\t445/tcp\t0.05",
  "rdp\t3389/tcp\t0.04",
  "dns\t53/udp\t0.9",
  "snmp\t161/udp\t0.4",
  "ntp\t123/udp\t0.2",
].join("\n");

test("Rapido: 100 TCP al massimo, niente UDP, niente --max-rate", () => {
  const p = parametriProfilo("rapido", { testoNmap: NMAP });
  assert.equal(p.udpPorts, "");
  assert.equal(p.tutteLePorteTcp, false);
  assert.equal(p.maxRate, null);
  assert.ok(p.tcpPorts);
  assert.ok((p.tcpPorts.split(",").length) <= 100);
  assert.match(p.nmapArgs, /-p 80,22,443/);
  assert.doesNotMatch(p.nmapArgs, /--max-rate/);
  assert.doesNotMatch(p.nmapArgs, /-p-/);
});

test("Standard: UDP acceso, riconoscimento, 20 UDP dal file", () => {
  const p = parametriProfilo("standard", { testoNmap: NMAP });
  assert.equal(p.udpPorts, "53,161,123");
  assert.match(p.nmapArgs, /-sV/);
  assert.match(p.nmapArgs, /--min-rate 200/);
});

test("Completo: -p- e non un elenco, UDP fino a 100, senza -sV", () => {
  const p = parametriProfilo("completo", { testoNmap: NMAP });
  assert.equal(p.tcpPorts, null);
  assert.equal(p.tutteLePorteTcp, true);
  assert.match(p.nmapArgs, /-p-/);
  assert.doesNotMatch(p.nmapArgs, /-sV/);
  assert.ok(p.udpPorts.split(",").length <= 100);
  assert.ok(!p.nmapArgs.includes("1,2,3"));
});

test("Lento: 300 pacchetti al secondo, niente min-rate", () => {
  const p = parametriProfilo("lento", { testoNmap: NMAP });
  assert.equal(p.maxRate, 300);
  assert.match(p.nmapArgs, /--max-rate 300/);
  assert.doesNotMatch(p.nmapArgs, /--min-rate/);
  assert.ok(p.udpPorts.length > 0);
});

test("Su misura senza UDP: udpPorts vuoto", () => {
  const p = parametriProfilo("su_misura", { testoNmap: NMAP, fasi: ["host", "porte", "sonde"] });
  assert.equal(p.udpPorts, "");
});

test("fasiValide: scarta le sconosciute, vuoto = tutte", () => {
  assert.deepEqual(fasiValide(["udp", "nope", "host"]), ["udp", "host"]);
  assert.deepEqual(fasiValide([]), ["host", "porte", "udp", "sonde"]);
});
