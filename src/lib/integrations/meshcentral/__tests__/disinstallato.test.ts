// SEC-18 (T3-28): dopo «Disinstalla» MeshCentral non deve comandare più niente.
//
// Prima: la disinstallazione spegne solo il flag in hub (tenant_features) e di
// default tiene tabelle e dati; mc_config resta salvata. Comandi remoti,
// sessioni remote, associazioni e sincronizzazione guardavano solo se le
// credenziali c'erano, quindi continuavano a funzionare a modulo spento.
// Adesso ogni azione passa da meshAttivo(), che legge solo il flag.
//
// La disattivazione qui è quella vera di /api/features/[key]/uninstall senza
// «Elimina anche i dati storici»: setFeatureDisabled + invalidateFeatureCache
// (la prova in fondo controlla che la rotta faccia ancora così).
//
// Hub isolato importato per primo (il perché sta in support/hub-isolato); i
// tenant stanno in DA_INVENT_DATA_DIR: lanciare con una cartella di prova.
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { test, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { closeHubDb } from "@/lib/db-hub";
import { withTenant, getTenantDb, deleteTenantDatabase, upsertHost } from "@/lib/db-tenant";
import { setFeatureDisabled, invalidateFeatureCache } from "@/lib/patch/feature";
import { saveMeshConfig, getMeshCreds } from "@/lib/integrations/meshcentral/config";
import {
  installMeshFeature,
  meshAttivo,
  MESH_DISATTIVATO,
} from "@/lib/integrations/meshcentral/feature";
import { runRemoteCommand, type RunCommandDeps } from "@/lib/integrations/meshcentral/run-command";
import { prepareRemoteSession, type RemoteSessionDeps } from "@/lib/integrations/meshcentral/remote-session";
import { recordRemoteSession } from "@/lib/integrations/meshcentral/remote-session-audit";
import { syncMeshForTenant, _setControlClientFactory } from "@/lib/integrations/meshcentral/mesh-sync";
import type { MeshNode } from "@/lib/integrations/meshcentral/control-client";
import { statiPresenza } from "@/app/api/integrations/meshcentral/host-status/route";
import { runJob } from "@/lib/cron/jobs";
import { UNINSTALL_COPY } from "@/lib/modules/uninstall-copy";

const T = "TESTMESHSPENTO";

// Chiamate arrivate al «server MeshCentral» finto.
let chiamate: string[] = [];

/** Modulo installato, configurazione salvata, un host con il suo nodo collegato e acceso. */
function preparaTenant(): number {
  installMeshFeature();
  saveMeshConfig({
    serverUrl: "https://mesh.example",
    domain: "",
    meshId: "mesh//AAA",
    serviceUser: "svc-daipam",
    loginTokenKey: "aa".repeat(80),
    adminUser: "admin",
    adminPass: "pw",
  });
  const db = getTenantDb(T);
  const net = db.prepare("INSERT INTO networks (name, cidr) VALUES ('n', '10.9.9.0/24')").run();
  const host = upsertHost({ network_id: Number(net.lastInsertRowid), ip: "10.9.9.5" });
  db.prepare(
    "INSERT INTO mc_node (node_id, host_id, mesh_id, conn, match_status) VALUES ('node//N1', ?, 'mesh//AAA', 1, 'matched')",
  ).run(host!.id);
  return host!.id;
}

/** Come /api/features/meshcentral/uninstall senza «Elimina anche i dati storici». */
function disinstalla(): void {
  setFeatureDisabled(T, "meshcentral");
  invalidateFeatureCache(T, "meshcentral");
}

const commandDeps: RunCommandDeps = {
  meshAttivo: () => meshAttivo(),
  getMeshCreds: () => getMeshCreds(),
  creaClient: () => ({
    runCommand: async (nodeId: string) => {
      chiamate.push(`comando ${nodeId}`);
      return "ok";
    },
    close() {},
  }),
};

const sessionDeps: RemoteSessionDeps = {
  meshAttivo: () => meshAttivo(),
  getMeshCreds: () => getMeshCreds(),
  mintLoginToken: () => {
    chiamate.push("token");
    return "TOKEN";
  },
  buildRemoteSessionUrl: (o) => `${o.serverUrl}?login=${o.token}&node=${o.nodeId}`,
  recordRemoteSession,
};

function nodo(): MeshNode {
  return {
    nodeId: "node//N1",
    name: "PC-01",
    rname: "PC-01.local",
    meshId: "mesh//AAA",
    ip: "10.9.9.5",
    macs: ["aa:bb:cc:dd:ee:ff"],
    osdesc: "Windows 11",
    conn: 1,
    lastConnect: "2026-06-29T10:00:00.000Z",
    host: null,
    agentless: false,
  };
}

beforeEach(() => {
  deleteTenantDatabase(T);
  chiamate = [];
  _setControlClientFactory(() => ({
    listNodes: async () => {
      chiamate.push("listNodes");
      return [nodo()];
    },
    close() {},
  }));
});

afterEach(() => _setControlClientFactory(null));

after(() => {
  deleteTenantDatabase(T);
  closeHubDb();
  removeTestHubDb();
});

test("controllo: con il modulo attivo comando e sessione arrivano al server finto", async () => {
  await withTenant(T, async () => {
    const hostId = preparaTenant();
    assert.equal(meshAttivo(), true);

    const cmd = await runRemoteCommand({ hostId, command: "hostname", operator: "op@prova" }, commandDeps);
    assert.equal(cmd.ok, true);
    const sess = prepareRemoteSession({ hostId, viewmode: 11, operator: "op@prova" }, sessionDeps);
    assert.equal(sess.ok, true);
    assert.deepEqual(chiamate, ["comando node//N1", "token"]);
  });
});

test("modulo disinstallato con i dati tenuti: il comando remoto risponde 409 e il server non viene chiamato", async () => {
  await withTenant(T, async () => {
    const hostId = preparaTenant();
    disinstalla();
    assert.ok(getMeshCreds(), "la configurazione resta salvata: è il caso del difetto");

    const res = await runRemoteCommand({ hostId, command: "hostname", operator: "op@prova" }, commandDeps);
    assert.deepEqual(res, { ok: false, status: 409, error: MESH_DISATTIVATO });
    assert.deepEqual(chiamate, []);
    const log = getTenantDb(T).prepare("SELECT COUNT(*) AS n FROM mc_command_log").get() as { n: number };
    assert.equal(log.n, 0, "nessun tentativo partito, niente da registrare");
  });
});

test("modulo disinstallato: la sessione remota risponde 409 e nessun token viene generato", async () => {
  await withTenant(T, async () => {
    const hostId = preparaTenant();
    disinstalla();

    const res = prepareRemoteSession({ hostId, viewmode: 11, operator: "op@prova" }, sessionDeps);
    assert.deepEqual(res, { ok: false, status: 409, error: MESH_DISATTIVATO });
    assert.deepEqual(chiamate, []);
  });
});

test("modulo disinstallato: la sincronizzazione chiamata a mano si rifiuta senza contattare il server", async () => {
  await withTenant(T, async () => {
    preparaTenant();
    disinstalla();
    await assert.rejects(syncMeshForTenant(), new RegExp(MESH_DISATTIVATO));
    assert.deepEqual(chiamate, []);
  });
});

test("job meshcentral_sync: con il modulo disinstallato non gira (e non conta come guasto); riattivato, gira", async () => {
  await withTenant(T, async () => {
    preparaTenant();
    const id = Number(
      getTenantDb(T)
        .prepare("INSERT INTO scheduled_jobs (network_id, job_type, interval_minutes, enabled) VALUES (NULL, 'meshcentral_sync', 15, 1)")
        .run().lastInsertRowid,
    );
    disinstalla();
    await runJob(id);
    assert.deepEqual(chiamate, []);

    installMeshFeature();
    await runJob(id);
    assert.deepEqual(chiamate, ["listNodes"]);
  });
});

test("presenza agenti: a modulo spento l'icona Mesh non compare, le altre sì", () => {
  const caps = {
    glpi: { present: true },
    choco: { present: false },
    mesh: { present: true, nodeId: "node//N1", conn: 1 },
    wazuh: { present: false },
  };
  const spento = statiPresenza([7, 8], new Map([[7, structuredClone(caps)]]), false);
  assert.equal(spento["7"]?.mesh.present, false);
  assert.equal(spento["7"]?.glpi.present, true);
  assert.equal(spento["8"], null);

  const soloMesh = { ...structuredClone(caps), glpi: { present: false } };
  assert.equal(statiPresenza([7], new Map([[7, soloMesh]]), false)["7"], null);
  assert.equal(statiPresenza([7], new Map([[7, structuredClone(caps)]]), true)["7"]?.mesh.present, true);
});

// ── Invariante: ogni rotta che usa MeshCentral passa dalla guardia del modulo ──

const API = join(process.cwd(), "src", "app", "api");

/** Rotte d'azione: devono chiamare la guardia (o, per la presenza, meshAttivo). */
const AZIONI: Record<string, string> = {
  "integrations/meshcentral/host/[hostId]/run-command/route.ts": "guardiaMesh(",
  "integrations/meshcentral/host/[hostId]/remote-session/route.ts": "guardiaMesh(",
  "integrations/meshcentral/host/[hostId]/senza-agente/route.ts": "guardiaMesh(",
  "integrations/meshcentral/bind/route.ts": "guardiaMesh(",
  "integrations/meshcentral/nodes/route.ts": "guardiaMesh(",
  "integrations/meshcentral/install-script/route.ts": "guardiaMesh(",
  "integrations/meshcentral/host-status/route.ts": "meshAttivo(",
  "patch/install-meshagent/route.ts": "guardiaMesh(",
  "patch/install-meshagent-choco/route.ts": "guardiaMesh(",
  "patch/install-linux-ssh/route.ts": "guardiaMesh(",
};

/** Rotte che usano MeshCentral senza comandare: col motivo. */
const LIBERE: Record<string, string> = {
  "features/[key]/install/route.ts": "è la via per riattivare il modulo",
  "integrations/meshcentral/install/route.ts": "installa il server sull'appliance: è la via per attivare il modulo",
  "integrations/meshcentral/config/route.ts": "la configurazione resta modificabile anche a modulo spento",
  "integrations/meshcentral/host/[hostId]/route.ts": "legge la copia locale dei nodi; i pulsanti della scheda chiamano rotte d'azione",
};

function rotte(dir: string): string[] {
  const out: string[] = [];
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) {
      if (nome !== "__tests__") out.push(...rotte(p));
    } else if (nome === "route.ts") {
      out.push(p);
    }
  }
  return out;
}

test("invariante: ogni rotta che usa MeshCentral è un'azione con la guardia o è dichiarata libera", () => {
  const usano = rotte(API)
    .map((p) => ({ rel: relative(API, p), src: readFileSync(p, "utf8") }))
    .filter((r) => /@\/lib\/integrations\/meshcentral\/|executeMeshAgent/.test(r.src));

  const nonDichiarate = usano.filter((r) => !(r.rel in AZIONI) && !(r.rel in LIBERE)).map((r) => r.rel);
  assert.deepEqual(nonDichiarate, [], "rotta nuova che usa MeshCentral: va in AZIONI (con la guardia) o in LIBERE (col motivo)");

  const senzaGuardia = usano.filter((r) => r.rel in AZIONI && !r.src.includes(AZIONI[r.rel])).map((r) => r.rel);
  assert.deepEqual(senzaGuardia, [], "rotta d'azione senza la guardia del modulo");

  const trovate = new Set(usano.map((r) => r.rel));
  const sparite = [...Object.keys(AZIONI), ...Object.keys(LIBERE)].filter((k) => !trovate.has(k));
  assert.deepEqual(sparite, [], "voce che non corrisponde più a una rotta che usa MeshCentral");
});

test("la disattivazione provata qui è ancora quella della rotta di disinstallazione", () => {
  const src = readFileSync(join(API, "features", "[key]", "uninstall", "route.ts"), "utf8");
  assert.ok(src.includes("setFeatureDisabled(tenantCode, key)"));
  assert.ok(src.includes("const dataDropped = dropData"), "senza la casella i dati restano");
});

test("la conferma di «Disinstalla» promette ciò che le prove sopra dimostrano", () => {
  const effetto = UNINSTALL_COPY.meshcentral.effetto;
  for (const parola of ["comandi", "sessioni remote", "sincronizzazioni"]) {
    assert.ok(effetto.includes(parola), `la conferma deve dire che si fermano anche le ${parola}`);
  }
});
