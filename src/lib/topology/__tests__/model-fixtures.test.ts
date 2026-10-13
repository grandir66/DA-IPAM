// Il modello sulle fixture anonime di Domarc e di un cliente (estratte il 2026-10-13 dalle
// copie dei DB, Task 9): il modello nuovo non perde niente rispetto alla mappa
// vecchia, ed è stabile. I numeri fissati sotto sono quelli misurati alla prima
// estrazione: se cambiano, si legge il perché prima di riscriverli.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildTopologyModel } from "@/lib/topology/model";
import { buildTopologyGraph } from "@/lib/topology/graph";
import type { TopologyModelInput } from "@/lib/topology/model-types";

function carica(nome: string): TopologyModelInput {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", nome), "utf8")) as TopologyModelInput;
}

function vecchiaMappa(i: TopologyModelInput) {
  const g = buildTopologyGraph({
    devices: i.devices.map((d) => ({ id: d.id, name: d.name, device_type: d.device_type, model: d.model, host: d.host, enabled: d.enabled })),
    hosts: i.hosts.map((h) => ({ id: h.id, ip: h.ip, hostname: h.hostname, custom_name: h.custom_name, classification: h.classification ?? "unknown", status: h.status, last_response_time_ms: null, last_seen: null, model: null, network_id: h.network_id })),
    neighbors: i.neighbors.map((n) => ({ device_id: n.device_id, local_port: n.local_port, remote_device_name: n.remote_device_name, remote_port: n.remote_port, protocol: n.protocol, remote_ip: n.remote_ip })),
    statusByNode: new Map(),
  });
  return {
    deviceLinks: g.edges.filter((e) => e.source.startsWith("dev:") && e.target.startsWith("dev:")).length,
    external: g.nodes.filter((n) => n.kind === "external").length,
  };
}

for (const nome of ["topologia-domarc.json", "topologia-cliente-a.json"]) {
  test(`${nome}: il modello nuovo non perde collegamenti fra apparati`, () => {
    const i = carica(nome);
    const m = buildTopologyModel(i);
    const v = vecchiaMappa(i);
    // Se fallisce, non si abbassa: un collegamento perso viene quasi sempre da una
    // chiave che il modello nuovo giudica contesa (MAC o nome) e la mappa vecchia
    // assegnava all'ultimo arrivato. Si legge quale, e lo si scrive.
    assert.ok(m.counts.deviceLinks >= v.deviceLinks, `nuovo ${m.counts.deviceLinks} < vecchio ${v.deviceLinks}`);
  });

  test(`${nome}: stessi dati, stesso modello`, () => {
    const i = carica(nome);
    assert.equal(JSON.stringify(buildTopologyModel(i)), JSON.stringify(buildTopologyModel(carica(nome))));
  });
}

test("Domarc: i doppi apparato/host si fondono (spec §2: almeno i 5 Proxmox)", () => {
  assert.ok(buildTopologyModel(carica("topologia-domarc.json")).counts.fusedHosts >= 5);
});

// Numeri misurati alla prima estrazione (Task 9, Step 7): si riscrivono solo sapendo perché cambiano.
const MISURATI: Record<string, Partial<Record<string, number>>> = {
  "topologia-domarc.json": { deviceLinks: 20, attachedLinks: 19, unmatchedNeighbors: 12, isolatedDevices: 22, fusedHosts: 58, promoteProposals: 14, suspiciousTypes: 17 },
  "topologia-cliente-a.json": { deviceLinks: 78, attachedLinks: 59, unmatchedNeighbors: 16, isolatedDevices: 10, fusedHosts: 77, promoteProposals: 14, suspiciousTypes: 7 },
};
for (const [nome, attesi] of Object.entries(MISURATI)) {
  test(`${nome}: conteggi misurati`, () => {
    const c = buildTopologyModel(carica(nome)).counts as unknown as Record<string, number>;
    for (const [k, v] of Object.entries(attesi)) assert.equal(c[k], v, k);
  });
}
