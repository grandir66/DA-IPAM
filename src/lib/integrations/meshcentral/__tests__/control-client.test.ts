process.env.ENCRYPTION_KEY ||= "test-encryption-key-mc-control";

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  MeshControlClient,
  _setWsConnector,
  isSelfHost,
  isSelfHostResolved,
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

test("listMeshes resolves when the server echoes only 'tag' (no responseid)", async () => {
  // REGRESSIONE (2026-07-17). Comportamento REALE di MeshCentral, verificato con
  // una sonda sul control.ashx di produzione:
  //   nodes  -> {action, responseid, nodes, tag}   (echo di responseid E tag)
  //   meshes -> {action, meshes, tag}              (echo del SOLO tag!)
  // Correlando le risposte solo su responseid, ogni listMeshes() restava appesa
  // fino al timeout di 30s: POST /api/integrations/meshcentral/install-script
  // rispondeva 500 "Verifica MeshID fallita: control.ashx 'meshes' timeout" e
  // nessuno script di installazione agente poteva essere generato dalla UI.
  _setWsConnector(() =>
    makeFake((msg) => {
      if (msg.action === "meshes") {
        assert.equal(
          msg.tag,
          msg.responseid,
          "request() deve inviare lo stesso id in tag E responseid",
        );
        return {
          action: "meshes",
          tag: msg.tag, // <- SOLO tag, esattamente come il server vero
          meshes: [{ _id: "mesh//AAA", name: "Domarc Endpoints" }],
        };
      }
      return null;
    }),
  );
  const c = new MeshControlClient(creds);
  const meshes = await c.listMeshes();
  c.close();
  assert.equal(meshes.length, 1);
  assert.equal(meshes[0].meshId, "mesh//AAA");
  assert.equal(meshes[0].name, "Domarc Endpoints");
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

test("runCommand: l'output torna in {action:'msg', type:'runcommands', result}", async () => {
  // Forma verificata con una sonda sul server reale (2026-07-17): la risposta
  // finale NON ha action:'runcommands' — quello sta nel campo `type`. Un client
  // che filtrasse per action non troverebbe mai l'output. Regge perche' il
  // messaggio porta il responseid della richiesta.
  _setWsConnector(() =>
    makeFake((msg) => {
      if (msg.action !== "runcommands") return null;
      assert.deepEqual(msg.nodeids, ["node//N1"], "nodeids e' un array");
      assert.equal(msg.type, 0, "type 0 = auto-rilevamento piattaforma");
      assert.equal(msg.reply, true, "senza reply:true il server risponde solo 'OK'");
      assert.equal(msg.runAsUser, 0, "default: SYSTEM/root");
      return {
        action: "msg",
        type: "runcommands",
        result: "Linux app-stack 6.8.0\nroot\n",
        responseid: msg.responseid,
        nodeid: "node//N1",
      };
    }),
  );
  const c = new MeshControlClient(creds);
  const out = await c.runCommand("node//N1", "uname -a && whoami");
  c.close();
  assert.equal(out, "Linux app-stack 6.8.0\nroot\n");
});

test("runCommand --powershell usa type 2 (solo Windows)", async () => {
  _setWsConnector(() =>
    makeFake((msg) => {
      if (msg.action !== "runcommands") return null;
      assert.equal(msg.type, 2, "2 = Windows PowerShell");
      return { action: "msg", type: "runcommands", result: "ok", responseid: msg.responseid };
    }),
  );
  const c = new MeshControlClient(creds);
  const out = await c.runCommand("node//N1", "Get-Service", { powershell: true });
  c.close();
  assert.equal(out, "ok");
});

test("runCommand: un errore del server arriva in `result` (non come throw)", async () => {
  // Il server mette li' 'Access denied' / 'Agent not connected' / 'Invalid command
  // type': l'output e l'errore condividono lo stesso campo, quindi il chiamante
  // deve poterlo leggere invece di ricevere una promise risolta vuota.
  _setWsConnector(() =>
    makeFake((msg) =>
      msg.action === "runcommands"
        ? { action: "msg", type: "runcommands", result: "Agent not connected", responseid: msg.responseid }
        : null,
    ),
  );
  const c = new MeshControlClient(creds);
  const out = await c.runCommand("node//N1", "whoami");
  c.close();
  assert.equal(out, "Agent not connected");
});

test("isSelfHost: loopback e localhost sono locali; un IP pubblico no", () => {
  // Il cert self-signed di MeshCentral si accetta SOLO se il server e' questa
  // macchina. Un hostname che risolve altrove non deve spacciarsi per locale:
  // isSelfHost non fa DNS, confronta con le interfacce locali.
  assert.equal(isSelfHost("wss://127.0.0.1:4443/control.ashx"), true);
  assert.equal(isSelfHost("https://localhost:4443/"), true);
  assert.equal(isSelfHost("wss://[::1]:4443/"), true);
  assert.equal(isSelfHost("https://8.8.8.8:4443/"), false);
  assert.equal(isSelfHost("https://mesh.altro-cliente.it/"), false);
  assert.equal(isSelfHost("non-un-url"), false);
});

test("isSelfHostResolved: un FQDN che risolve a un IP locale e' self", async () => {
  // Il caso reale (2026-07-20): l'appliance si installa col proprio nome DNS
  // (da-ipam.domarc.it), che risolve a un IP di una sua interfaccia. isSelfHost
  // sincrono non lo vede (confronto stringa); isSelfHostResolved lo risolve.
  // resolver iniettato: nessun DNS reale nella suite. 127.0.0.1 e' sempre
  // un'interfaccia locale (lo), quindi il match e' stabile su ogni macchina.
  const toLoopback = async () => [{ address: "127.0.0.1" }];
  assert.equal(await isSelfHostResolved("https://appliance.example.it:4443/", toLoopback), true);
});

test("isSelfHostResolved: un FQDN che risolve altrove NON e' self", async () => {
  const toPublic = async () => [{ address: "8.8.8.8" }];
  assert.equal(await isSelfHostResolved("https://mesh.altro-cliente.it:4443/", toPublic), false);
});

test("isSelfHostResolved: se il DNS fallisce restiamo prudenti (non self)", async () => {
  const boom = async () => { throw new Error("ENOTFOUND"); };
  assert.equal(await isSelfHostResolved("https://sconosciuto.example/", boom), false);
});

test("isSelfHostResolved: loopback/IP locale non chiamano nemmeno il resolver", async () => {
  let called = false;
  const spy = async () => { called = true; return []; };
  assert.equal(await isSelfHostResolved("wss://127.0.0.1:4443/control.ashx", spy), true);
  assert.equal(called, false, "loopback risolto in sincrono, senza DNS");
});
