/**
 * Normalize signals → evidence (Task 2) + smoke tipi/pesi (Task 1).
 * Run: node --import tsx --test src/lib/classification/__tests__/normalize.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ENGINE_VERSION,
  CONFLICT_WINDOW,
  MIN_APPLY_CONFIDENCE,
  MAX_EVIDENCE_KEPT,
  HISTORY_CONFIDENCE_DELTA,
  type EvidenceSource,
} from "../types";
import { SOURCE_WEIGHTS } from "../weights";
import { normalizeToEvidence } from "../normalize";

test("ENGINE_VERSION e costanti policy", () => {
  assert.equal(ENGINE_VERSION, "0.1.0");
  assert.equal(CONFLICT_WINDOW, 10);
  assert.equal(MIN_APPLY_CONFIDENCE, 56);
  assert.equal(MAX_EVIDENCE_KEPT, 20);
  assert.equal(HISTORY_CONFIDENCE_DELTA, 5);
});

test("SOURCE_WEIGHTS copre ogni EvidenceSource con pesi 0–1", () => {
  const sources: EvidenceSource[] = [
    "naabu", "nmap", "snmp", "http", "ssh", "smb",
    "mac_oui", "dns", "ttl", "rule",
  ];
  assert.deepEqual(Object.keys(SOURCE_WEIGHTS).sort(), [...sources].sort());
  for (const source of sources) {
    const w = SOURCE_WEIGHTS[source];
    assert.ok(w > 0 && w <= 1, `${source} weight out of range: ${w}`);
  }
  assert.equal(SOURCE_WEIGHTS.snmp, 0.95);
  assert.equal(SOURCE_WEIGHTS.http, 0.9);
  assert.equal(SOURCE_WEIGHTS.smb, 0.75);
  assert.equal(SOURCE_WEIGHTS.ssh, 0.55);
  assert.equal(SOURCE_WEIGHTS.mac_oui, 0.4);
  assert.equal(SOURCE_WEIGHTS.nmap, 0.45);
  assert.equal(SOURCE_WEIGHTS.dns, 0.35);
  assert.equal(SOURCE_WEIGHTS.ttl, 0.25);
  assert.equal(SOURCE_WEIGHTS.naabu, 0.2);
  assert.equal(SOURCE_WEIGHTS.rule, 0.7);
});

test("SNMP sysObjectID produces high-weight snmp evidence voting cascade slug", () => {
  const ev = normalizeToEvidence({
    ip: "192.0.2.1",
    hostname: null,
    vendor: null,
    os_info: null,
    open_ports: [],
    snmp_sysdescr: "Cisco IOS",
    snmp_sysobjectid: "1.3.6.1.4.1.9.1.1234",
    detection: null,
    naabu_ports: null,
    cascade_slug: "switch",
    cascade_method: "oid",
  }, "2026-07-26T00:00:00Z");
  const oid = ev.find((e) => e.attribute === "sysObjectID");
  assert.ok(oid);
  assert.equal(oid!.source, "snmp");
  assert.equal(oid!.votes_for, "switch");
  assert.ok(oid!.weight >= 0.9);
  assert.equal(oid!.observed, true);
});

test("HTTP banner ESXi votes hypervisor; nmap linux votes server_linux", () => {
  const ev = normalizeToEvidence({
    ip: "192.0.2.10",
    hostname: "esx01",
    vendor: null,
    os_info: null,
    open_ports: [22, 443, 902],
    snmp_sysdescr: null,
    snmp_sysobjectid: null,
    detection: {
      ip: "192.0.2.10",
      open_ports: [22, 443, 902],
      matches: [],
      banner_http: "VMware ESXi",
      nmap_os: "Linux 5.x",
      detection_sources: ["banner_http", "nmap_os"],
      generated_at: "2026-07-26T00:00:00Z",
      final_device: "VMware ESXi",
      final_confidence: 0.9,
    },
    naabu_ports: [22, 443, 902],
    cascade_slug: "hypervisor",
    cascade_method: "text",
  }, "2026-07-26T00:00:00Z");
  assert.ok(ev.some((e) => e.source === "http" && e.votes_for === "hypervisor"));
  assert.ok(ev.some((e) => e.source === "nmap" && e.attribute === "os_guess"));
  assert.ok(ev.some((e) => e.source === "naabu" && e.attribute === "tcp_ports"));
});
