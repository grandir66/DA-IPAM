process.env.ENCRYPTION_KEY ||= "test-encryption-key-mc-senzaag";

import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { withTenant, getTenantDb, deleteTenantDatabase, upsertHost } from "@/lib/db-tenant";
import { applyMcSchemaMigrations } from "@/lib/integrations/meshcentral/schema";
import { recordRemoteSession } from "@/lib/integrations/meshcentral/remote-session-audit";
import type { MeshNode } from "@/lib/integrations/meshcentral/control-client";
import {
  GRUPPO_SENZA_AGENTE,
  SENZA_AGENTE_SPENTO,
  buildRdpUrl,
  buildVncUrl,
  porteAperte,
  prepareSessioneSenzaAgente,
  protocolliDisponibili,
  type ClientSenzaAgente,
  type SenzaAgenteDeps,
} from "@/lib/integrations/meshcentral/senza-agente";

const T = "TESTMCSENZAAG";
after(() => deleteTenantDatabase(T));

/** «Server MeshCentral» finto: gruppi e nodi in memoria, chiamate registrate. */
let meshes: Array<{ meshId: string; name: string; mtype: number }> = [];
let nodes: MeshNode[] = [];
let chiamate: string[] = [];

function nodoLocale(meshId: string, host: string, name: string): MeshNode {
  return {
    nodeId: `node/mesh/L${nodes.length + 1}`,
    name,
    rname: name,
    meshId,
    ip: null,
    macs: [],
    osdesc: null,
    conn: 0,
    lastConnect: null,
    host,
    agentless: true,
  };
}

const client: ClientSenzaAgente = {
  async listMeshes() {
    chiamate.push("listMeshes");
    return meshes;
  },
  async addLocalMesh(name) {
    chiamate.push(`addLocalMesh:${name}`);
    meshes.push({ meshId: "mesh/mesh/LOC", name, mtype: 3 });
    return "mesh/mesh/LOC";
  },
  async listNodes() {
    chiamate.push("listNodes");
    return nodes;
  },
  async addLocalDevice(meshId, deviceName, hostname, type) {
    chiamate.push(`addLocalDevice:${deviceName}:${hostname}:${type}`);
    nodes.push(nodoLocale(meshId, hostname, deviceName));
  },
  async getRelayCookie(nodeId, tcpport) {
    chiamate.push(`getcookie:${nodeId}:${tcpport}`);
    return "COOK@IE$=";
  },
  close() {},
};

let attivo = true;
const deps: SenzaAgenteDeps = {
  attivo: () => attivo,
  meshAttivo: () => true,
  getMeshCreds: () => ({
    serverUrl: "https://appliance.example:4443/",
    domain: "mesh",
    meshId: "mesh//grp",
    serviceUser: "svc-daipam",
    loginTokenKey: Buffer.alloc(80, 7),
    adminUser: "admin",
    adminPass: "x",
  }),
  mintLoginToken: () => "TOKEN123",
  recordRemoteSession,
  client: () => client,
};

beforeEach(() => {
  meshes = [{ meshId: "mesh/mesh/grp", name: "Domarc Endpoints", mtype: 2 }];
  nodes = [];
  chiamate = [];
  attivo = true;
});

function host(ip: string, openPorts: unknown, osInfo: string | null = null): number {
  const db = getTenantDb(T);
  applyMcSchemaMigrations(db);
  db.prepare("INSERT OR IGNORE INTO networks (id, cidr, name) VALUES (1, '10.0.0.0/24', 'n')").run();
  const h = upsertHost({ network_id: 1, ip });
  db.prepare("UPDATE hosts SET open_ports = ?, os_info = ?, hostname = ? WHERE id = ?").run(
    JSON.stringify(openPorts),
    osInfo,
    `pc-${ip.split(".")[3]}`,
    h!.id,
  );
  return h!.id;
}

test("porte aperte: numeri e oggetti tcp, JSON rotto = nessuna porta", () => {
  assert.deepEqual(porteAperte(JSON.stringify([22, { port: 3389, protocol: "tcp" }, { port: 161, protocol: "udp" }])), [22, 3389]);
  assert.deepEqual(porteAperte("{rotto"), []);
  assert.deepEqual(porteAperte(null), []);
  assert.deepEqual(protocolliDisponibili(JSON.stringify([3389, 5901])), { rdp: true, vnc: true });
  assert.deepEqual(protocolliDisponibili(JSON.stringify([22, 443])), { rdp: false, vnc: false });
  assert.deepEqual(protocolliDisponibili(JSON.stringify([22]), "Windows"), { rdp: true, vnc: false });
});

test("URL: id nudo, token e cookie codificati, origine con la porta", () => {
  assert.equal(
    buildRdpUrl({ serverUrl: "https://a.example:4443/", token: "T@K$=", nodeId: "node/mesh/ABC", port: 3389 }),
    "https://a.example:4443/mstsc.html?login=T%40K%24%3D&node=ABC&port=3389",
  );
  const vnc = new URL(buildVncUrl({ serverUrl: "a.example:4443", cookie: "C@O$=", name: "pc 1" }));
  assert.equal(vnc.pathname, "/novnc/vnc.html");
  assert.equal(vnc.searchParams.get("ws"), "wss://a.example:4443/localrelay.ashx?auth=C@O$=");
  assert.equal(vnc.searchParams.get("name"), "pc 1");
});

test("RDP: primo clic crea gruppo e device, il secondo li riusa; audit senza token", async () => {
  await withTenant(T, async () => {
    const id = host("10.0.0.21", [135, 3389], "Microsoft Windows 11");
    const res = await prepareSessioneSenzaAgente({ hostId: id, protocollo: "rdp", operator: "bob@corp" }, deps);
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.url, "https://appliance.example:4443/mstsc.html?login=TOKEN123&node=L1&port=3389");
    assert.ok(chiamate.includes(`addLocalMesh:${GRUPPO_SENZA_AGENTE}`));
    assert.ok(chiamate.includes("addLocalDevice:pc-21:10.0.0.21:4"), "Windows → tipo 4");

    chiamate = [];
    const di_nuovo = await prepareSessioneSenzaAgente({ hostId: id, protocollo: "rdp", operator: "bob@corp" }, deps);
    assert.equal(di_nuovo.ok, true);
    assert.ok(!chiamate.some((c) => c.startsWith("add")), `niente doppioni: ${chiamate.join(",")}`);

    const row = getTenantDb(T)
      .prepare("SELECT * FROM mc_remote_session ORDER BY id DESC LIMIT 1")
      .get() as Record<string, unknown>;
    assert.equal(row.viewmode, 21);
    assert.equal(row.node_id, null);
    assert.equal(row.status, "minted");
    assert.ok(!JSON.stringify(row).includes("TOKEN123"));
  });
});

test("VNC: cookie di relay sulla porta trovata, tipo Linux", async () => {
  await withTenant(T, async () => {
    const id = host("10.0.0.22", [22, 5901]);
    const res = await prepareSessioneSenzaAgente({ hostId: id, protocollo: "vnc", operator: "bob@corp" }, deps);
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.ok(chiamate.includes("addLocalDevice:pc-22:10.0.0.22:6"));
    assert.ok(chiamate.includes("getcookie:node/mesh/L1:5901"));
    assert.equal(
      new URL(res.url).searchParams.get("ws"),
      "wss://appliance.example:4443/localrelay.ashx?auth=COOK@IE$=",
    );
  });
});

test("porta non trovata dalla scansione: si usa quella standard", async () => {
  await withTenant(T, async () => {
    const id = host("10.0.0.23", [22]);
    const rdp = await prepareSessioneSenzaAgente({ hostId: id, protocollo: "rdp", operator: "x" }, deps);
    assert.equal(rdp.ok, true);
    if (rdp.ok) assert.match(rdp.url, /&port=3389$/);
    const vnc = await prepareSessioneSenzaAgente({ hostId: id, protocollo: "vnc", operator: "x" }, deps);
    assert.equal(vnc.ok, true);
    assert.ok(chiamate.some((c) => c.endsWith(":5900")), chiamate.join(","));
  });
});

test("flag spento: niente chiamate a MeshCentral", async () => {
  await withTenant(T, async () => {
    const id = host("10.0.0.25", [3389]);
    attivo = false;
    const spento = await prepareSessioneSenzaAgente({ hostId: id, protocollo: "vnc", operator: "x" }, deps);
    assert.equal(spento.ok, false);
    if (!spento.ok) {
      assert.equal(spento.status, 409);
      assert.equal(spento.error, SENZA_AGENTE_SPENTO);
    }
    assert.deepEqual(chiamate, []);
  });
});

test("device scritto in ritardo dal server: lo ritrova al tentativo dopo", async () => {
  await withTenant(T, async () => {
    const id = host("10.0.0.26", [3389], "Microsoft Windows 11");
    let letture = 0;
    let inAttesa: MeshNode | null = null;
    const lento: SenzaAgenteDeps = {
      ...deps,
      client: () => ({
        ...client,
        async listNodes() {
          letture++;
          return inAttesa && letture > 2 ? [inAttesa] : [];
        },
        async addLocalDevice(meshId, deviceName, hostname) {
          inAttesa = nodoLocale(meshId, hostname, deviceName);
        },
      }),
    };
    const res = await prepareSessioneSenzaAgente({ hostId: id, protocollo: "rdp", operator: "x" }, lento);
    assert.equal(res.ok, true, res.ok ? "" : res.error);
    assert.equal(letture, 3);
  });
});

test("errore di MeshCentral: 502 e audit 'failed'", async () => {
  await withTenant(T, async () => {
    const id = host("10.0.0.24", [3389]);
    const rotto: SenzaAgenteDeps = {
      ...deps,
      client: () => ({ ...client, addLocalDevice: async () => { throw new Error("addlocaldevice: Permission denied"); } }),
    };
    const res = await prepareSessioneSenzaAgente({ hostId: id, protocollo: "rdp", operator: "x" }, rotto);
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.equal(res.status, 502);
      assert.match(res.error, /Permission denied/);
    }
    const row = getTenantDb(T)
      .prepare("SELECT status FROM mc_remote_session ORDER BY id DESC LIMIT 1")
      .get() as { status: string };
    assert.equal(row.status, "failed");
  });
});
