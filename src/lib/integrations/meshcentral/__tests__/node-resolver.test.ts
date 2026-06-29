import { test, after } from "node:test";
import assert from "node:assert/strict";
import { withTenant, deleteTenantDatabase, getTenantDb } from "@/lib/db-tenant";
import { resolveNodeToHostId } from "@/lib/integrations/meshcentral/node-resolver";
import type { MeshNode } from "@/lib/integrations/meshcentral/control-client";

const T = "TESTMCRESOLVE";
after(() => deleteTenantDatabase(T));

function mkNode(over: Partial<MeshNode> = {}): MeshNode {
  return {
    nodeId: "node//abc",
    name: "PC-01",
    rname: "PC-01",
    meshId: "mesh//m1",
    ip: null,
    macs: [],
    osdesc: "Windows 11",
    conn: 1,
    lastConnect: null,
    ...over,
  };
}

function seedHost(o: { ip: string; mac: string | null; hostname?: string | null }): number {
  const r = getTenantDb(T)
    .prepare(
      "INSERT INTO hosts (network_id, ip, mac, hostname, classification, notes, status, known_host, ip_assignment) VALUES (1, ?, ?, ?, 'workstation', '', 'online', 1, 'static')"
    )
    .run(o.ip, o.mac, o.hostname ?? null);
  return Number(r.lastInsertRowid);
}

function ensureNet(): void {
  getTenantDb(T).prepare("INSERT OR IGNORE INTO networks (id, cidr, name) VALUES (1, '10.0.0.0/24', 'net')").run();
}

test("match by MAC (first mac in list)", () => {
  withTenant(T, () => {
    ensureNet();
    const hid = seedHost({ ip: "10.0.0.5", mac: "aa:bb:cc:dd:ee:01" });
    const node = mkNode({ ip: "10.0.0.5", macs: ["aa:bb:cc:dd:ee:01"] });
    const res = resolveNodeToHostId(node);
    assert.equal(res.hostId, hid);
    assert.equal(res.matchStatus, "matched");
    assert.equal(res.mac, "aa:bb:cc:dd:ee:01");
  });
});

test("MAC collision disambiguated by preferIp (node.ip)", () => {
  withTenant(T, () => {
    ensureNet();
    seedHost({ ip: "10.0.0.20", mac: "aa:bb:cc:dd:ee:20" });
    const want = seedHost({ ip: "10.0.0.21", mac: "aa:bb:cc:dd:ee:20" });
    const node = mkNode({ ip: "10.0.0.21", macs: ["aa:bb:cc:dd:ee:20"] });
    const res = resolveNodeToHostId(node);
    assert.equal(res.hostId, want);
    assert.equal(res.matchStatus, "matched");
  });
});

test("virtual MAC (VRRP 00:00:5e:00:01:xx) is skipped, falls through to unmatched", () => {
  withTenant(T, () => {
    ensureNet();
    const node = mkNode({ ip: "10.0.0.30", macs: ["00:00:5e:00:01:09"] });
    const res = resolveNodeToHostId(node);
    // no host with that IP seeded, virtual MAC not used as anchor → unmatched
    assert.equal(res.hostId, null);
    assert.equal(res.matchStatus, "unmatched");
  });
});

test("virtual MAC (HSRP 00:00:0c:07:ac:xx) is skipped, real MAC in list wins", () => {
  withTenant(T, () => {
    ensureNet();
    const hid = seedHost({ ip: "10.0.0.31", mac: "aa:bb:cc:dd:ee:11" });
    const node = mkNode({ ip: "10.0.0.31", macs: ["00:00:0c:07:ac:01", "aa:bb:cc:dd:ee:11"] });
    const res = resolveNodeToHostId(node);
    assert.equal(res.hostId, hid);
    assert.equal(res.mac, "aa:bb:cc:dd:ee:11");
  });
});

test("zero MAC (00:00:00:00:00:00) is skipped", () => {
  withTenant(T, () => {
    ensureNet();
    const node = mkNode({ ip: "10.0.0.32", macs: ["00:00:00:00:00:00"] });
    // no host with that IP, zero MAC skipped → unmatched
    const res = resolveNodeToHostId(node);
    assert.equal(res.hostId, null);
    assert.equal(res.matchStatus, "unmatched");
  });
});

test("multi-NIC: iterates all macs, matches on non-first mac", () => {
  withTenant(T, () => {
    ensureNet();
    const hid = seedHost({ ip: "10.0.0.40", mac: "aa:bb:cc:dd:ee:40" });
    const node = mkNode({ ip: "10.0.0.40", macs: ["ff:ff:ff:ff:ff:00", "aa:bb:cc:dd:ee:40"] });
    // first mac doesn't match any host, second does
    const res = resolveNodeToHostId(node);
    assert.equal(res.hostId, hid);
    assert.equal(res.mac, "aa:bb:cc:dd:ee:40");
    assert.equal(res.matchStatus, "matched");
  });
});

test("no MAC anchor and no IP -> unmatched", () => {
  withTenant(T, () => {
    ensureNet();
    const node = mkNode({ ip: null, macs: [] });
    const res = resolveNodeToHostId(node);
    assert.equal(res.hostId, null);
    assert.equal(res.matchStatus, "unmatched");
  });
});

test("IP fallback when no MAC matches", () => {
  withTenant(T, () => {
    ensureNet();
    const hid = seedHost({ ip: "10.0.0.50", mac: null });
    const node = mkNode({ ip: "10.0.0.50", macs: [] });
    const res = resolveNodeToHostId(node);
    assert.equal(res.hostId, hid);
    assert.equal(res.matchStatus, "matched");
    assert.equal(res.ip, "10.0.0.50");
  });
});

test("hostname fallback (case-insensitive) via node.rname", () => {
  withTenant(T, () => {
    ensureNet();
    const hid = seedHost({ ip: "10.0.0.60", mac: null, hostname: "SERVER-PROD" });
    const node = mkNode({ ip: null, macs: [], rname: "server-prod" });
    const res = resolveNodeToHostId(node);
    assert.equal(res.hostId, hid);
    assert.equal(res.matchStatus, "matched");
  });
});

test("no anchor at all -> unmatched with hostId null", () => {
  withTenant(T, () => {
    ensureNet();
    // virtual MAC only, no IP, no hostname match
    const node = mkNode({ ip: null, macs: ["00:00:5e:00:01:01"], rname: "ghost" });
    const res = resolveNodeToHostId(node);
    assert.equal(res.hostId, null);
    assert.equal(res.matchStatus, "unmatched");
  });
});

test("node.name (display nickname) is NOT used as a hostname anchor", () => {
  withTenant(T, () => {
    ensureNet();
    // A host whose hostname equals the node's DISPLAY name must NOT match:
    // only node.rname (the real computer name) is a valid hostname anchor.
    seedHost({ ip: "10.0.0.70", mac: null, hostname: "My laptop" });
    const node = mkNode({ ip: null, macs: [], rname: "", name: "My laptop" });
    const res = resolveNodeToHostId(node);
    assert.equal(res.hostId, null, "display name must not match a host hostname");
    assert.equal(res.matchStatus, "unmatched");
  });
});
