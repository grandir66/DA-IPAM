/**
 * Coverage helpers for naabu+nmap targeting (Task 9 review).
 * Run: node --import tsx --test src/lib/scanner/__tests__/ports-naabu-union.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALWAYS_USEFUL_TCP_PORTS,
  unionTcpPorts,
  parseTcpPortSpec,
  getFullScanTcpPortList,
  tcpPortListToSpec,
  buildTargetedServiceTcpArgs,
  NETWORK_DISCOVERY_QUICK_TCP_PORTS,
} from "../ports";

test("targeted union never shrinks below prior quick list", () => {
  const prior = parseTcpPortSpec(NETWORK_DISCOVERY_QUICK_TCP_PORTS);
  const naabuOpen = [443, 902];
  const targeted = unionTcpPorts(naabuOpen, ALWAYS_USEFUL_TCP_PORTS, prior);
  for (const p of prior) {
    assert.ok(targeted.includes(p), `missing prior port ${p}`);
  }
  assert.ok(targeted.includes(902));
});

test("empty naabu open still keeps prior+always-useful when union applied", () => {
  const prior = parseTcpPortSpec("22,80,445,8006");
  const targeted = unionTcpPorts([], ALWAYS_USEFUL_TCP_PORTS, prior);
  assert.deepEqual(
    targeted,
    unionTcpPorts(ALWAYS_USEFUL_TCP_PORTS, prior)
  );
  assert.ok(targeted.includes(8006));
});

test("getFullScanTcpPortList merges profile with defaults", () => {
  const list = getFullScanTcpPortList("39999");
  assert.ok(list.includes(39999));
  assert.ok(list.includes(22));
  assert.ok(tcpPortListToSpec(list).includes("39999"));
});

test("buildTargetedServiceTcpArgs embeds full union list", () => {
  const ports = unionTcpPorts([902], ALWAYS_USEFUL_TCP_PORTS, [8006]);
  const args = buildTargetedServiceTcpArgs(ports);
  assert.match(args, /-sV/);
  assert.match(args, /8006/);
  assert.match(args, /902/);
});
