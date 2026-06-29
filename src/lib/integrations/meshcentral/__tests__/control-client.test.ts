process.env.ENCRYPTION_KEY ||= "test-encryption-key-mc-control";

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  MeshControlClient,
  _setWsConnector,
  type McWsSocket,
} from "@/lib/integrations/meshcentral/control-client";
import type { MeshCreds } from "@/lib/integrations/meshcentral/config";

const creds: MeshCreds = {
  serverUrl: "https://mesh.example.it",
  domain: "",
  meshId: "mesh//AAA",
  serviceUser: "svc-daipam",
  loginTokenKey: Buffer.alloc(80, 1),
  adminUser: "admin",
  adminPass: "pw",
};

/** Fake socket: opens immediately, answers requests by action. */
function makeFake(
  responder: (msg: Record<string, unknown>) => Record<string, unknown> | null,
) {
  const sock: McWsSocket & { _emit(d: string): void } = (() => {
    let onMsg: (d: string) => void = () => {};
    let onOpen: () => void = () => {};
    return {
      onMessage(cb) {
        onMsg = cb;
      },
      onOpen(cb) {
        onOpen = cb;
        queueMicrotask(() => onOpen());
      },
      onClose() {},
      onError() {},
      send(data: string) {
        const msg = JSON.parse(data) as Record<string, unknown>;
        const reply = responder(msg);
        if (reply) queueMicrotask(() => onMsg(JSON.stringify(reply)));
      },
      close() {},
      _emit(d: string) {
        onMsg(d);
      },
    };
  })();
  return sock;
}

afterEach(() => _setWsConnector(null));

test("listNodes maps the meshes-keyed nodes payload to MeshNode[]", async () => {
  _setWsConnector((url, headers) => {
    assert.ok(
      url.startsWith("wss://mesh.example.it/control.ashx"),
      "wss control.ashx",
    );
    // Assert exact x-meshauth format: Base64(user),Base64(pass)
    const parts = (headers["x-meshauth"] ?? "").split(",");
    assert.equal(parts.length, 2, "x-meshauth must have two comma-separated parts");
    assert.equal(Buffer.from(parts[0], "base64").toString(), creds.adminUser, "part[0] decodes to adminUser");
    assert.equal(Buffer.from(parts[1], "base64").toString(), creds.adminPass, "part[1] decodes to adminPass");
    return makeFake((msg) => {
      if (msg.action === "nodes") {
        return {
          action: "nodes",
          responseid: msg.responseid,
          nodes: {
            "mesh//AAA": [
              {
                _id: "node//N1",
                name: "PC-01",
                rname: "PC-01.local",
                meshid: "mesh//AAA",
                ip: "10.0.0.5",
                mac: "aa:bb:cc:dd:ee:ff",
                osdesc: "Windows 11",
                conn: 1,
                lastconnect: 1719400000000,
              },
            ],
          },
        };
      }
      return null;
    });
  });
  const c = new MeshControlClient(creds);
  const nodes = await c.listNodes();
  c.close();
  assert.equal(nodes.length, 1);
  const n = nodes[0];
  assert.equal(n.nodeId, "node//N1");
  assert.equal(n.name, "PC-01");
  assert.equal(n.meshId, "mesh//AAA");
  assert.equal(n.ip, "10.0.0.5");
  assert.deepEqual(n.macs, ["aa:bb:cc:dd:ee:ff"]);
  assert.equal(n.conn, 1);
  assert.equal(n.osdesc, "Windows 11");
  assert.equal(typeof n.lastConnect, "string");
});

test("listNodes returns [] when nodes payload empty", async () => {
  _setWsConnector(() =>
    makeFake((msg) =>
      msg.action === "nodes"
        ? { action: "nodes", responseid: msg.responseid, nodes: {} }
        : null,
    ),
  );
  const c = new MeshControlClient(creds);
  assert.deepEqual(await c.listNodes(), []);
  c.close();
});

test("addMesh returns the meshid from createmesh response", async () => {
  _setWsConnector(() =>
    makeFake((msg) =>
      msg.action === "createmesh"
        ? {
            action: "createmesh",
            responseid: msg.responseid,
            result: "ok",
            meshid: "mesh//NEW",
          }
        : null,
    ),
  );
  const c = new MeshControlClient(creds);
  const id = await c.addMesh("Endpoints");
  c.close();
  assert.equal(id, "mesh//NEW");
});

test("listMeshes maps meshes response", async () => {
  _setWsConnector(() =>
    makeFake((msg) =>
      msg.action === "meshes"
        ? {
            action: "meshes",
            responseid: msg.responseid,
            meshes: [{ _id: "mesh//AAA", name: "Endpoints" }],
          }
        : null,
    ),
  );
  const c = new MeshControlClient(creds);
  const ms = await c.listMeshes();
  c.close();
  assert.deepEqual(ms, [{ meshId: "mesh//AAA", name: "Endpoints" }]);
});

test("close() tears down the client without errors", () => {
  _setWsConnector(() =>
    makeFake(() => null),
  );
  const c = new MeshControlClient(creds);
  // close before connect — should not throw
  assert.doesNotThrow(() => c.close());
});

test("server sending {action:'close', cause:'noauth'} rejects immediately", async () => {
  _setWsConnector(() => {
    // Fake socket that opens, then immediately sends an auth-close message
    let onMsg: (d: string) => void = () => {};
    let onOpen: () => void = () => {};
    const sock: McWsSocket = {
      onMessage(cb) { onMsg = cb; },
      onOpen(cb) {
        onOpen = cb;
        queueMicrotask(() => {
          onOpen();
          // After open, server sends noauth close
          queueMicrotask(() =>
            onMsg(JSON.stringify({ action: "close", cause: "noauth", msg: "Not authenticated" }))
          );
        });
      },
      onClose() {},
      onError() {},
      send() {},
      close() {},
    };
    return sock;
  });

  const c = new MeshControlClient(creds);
  await assert.rejects(
    () => c.listNodes(),
    (err: Error) => {
      assert.ok(err.message.includes("noauth") || err.message.includes("Not authenticated"), "error must mention auth failure");
      return true;
    },
  );
  c.close();
});

test("close() rejects in-flight requests instead of leaking them", async () => {
  // Responder never replies → the request stays pending until close().
  _setWsConnector(() => makeFake(() => null));
  const c = new MeshControlClient(creds);
  const inflight = c.listNodes();
  // Let connect open + the request register in the pending map before closing.
  await new Promise((r) => setImmediate(r));
  c.close();
  await assert.rejects(
    inflight,
    (err: Error) => {
      assert.ok(err.message.includes("client closed"), "in-flight request rejects with client-closed");
      return true;
    },
  );
});
