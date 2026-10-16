// T3.7 e R7 (spec topologia §13.11.4; piano di T3, «Vincoli globali» e Casi 3): la mappa che la rotta del modello dà, sul DB.
// Prima parte (Task 6): con l'interruttore `topologia.mappa.cavi` assente, rovinato o spento la rotta calcola il modello di T1
// com'era, bit per bit, e non legge niente di T3 (nessuna chiamata a `getIngressoCavi`: la spia lo conta, e la tabella dei fatti
// rovinata non si sente); acceso dà la mappa per cavo. Se il calcolo nuovo cade (il modello per cavo o la sua lettura), la mappa
// di prima con l'errore detto nel journal e a schermo: mai una pagina bianca, mai un ripiego muto (Caso 3, lezione 6). I dati
// sono la famiglia 1 delle reti-campione scritta con le funzioni di db-tenant, come in topologia-t2-freno.test.ts.
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { test, after, mock } from "node:test";
import assert from "node:assert/strict";
import type Database from "better-sqlite3";
import { closeHubDb } from "@/lib/db-hub";
import {
  deleteTenantDatabase, getTenantDb, getTopologyModelInput, rileggiSchemaCavi, scriviFattiTopologia, setTenantSetting, upsertNeighbors, withTenant,
} from "@/lib/db-tenant";
import { buildTopologyModel } from "@/lib/topology/model";
import { CHIAVE_MAPPA_CAVI, scriviMappaCavi } from "@/lib/topology/letture/mappa";
import {
  CANDIDATI_SOLO_ACCESA, FONTI_DELLA_MAPPA, MAPPA_NON_CALCOLATA, candidatiDellaMappa, modelloDellaMappa, type FontiDellaMappa,
} from "@/lib/topology/mappa-server";
import type { TopologyModelInput } from "@/lib/topology/model-types";
import { soloMikrotik } from "@/lib/topology/__tests__/support/reti-campione";
import { serializza } from "@/lib/topology/__tests__/support/impronta";

const T = "TESTT3FRENO";
getTenantDb(T);
after(() => { deleteTenantDatabase(T); closeHubDb(); removeTestHubDb(); });

/** Un solo «adesso» per tutta la prova. */
const ORA = Date.now();
const sql = (ms: number): string => new Date(ORA + ms).toISOString().slice(0, 19).replace("T", " ");

/** Scrive nel tenant la rete: apparati, reti, host, porte, vicini (un'ora fa), e i fatti di porta dei MikroTik (T2). */
function carica(db: Database.Database, rete: TopologyModelInput): void {
  for (const n of rete.networks) db.prepare("INSERT INTO networks (id, cidr, name, gateway) VALUES (?, ?, ?, ?)").run(n.id, n.cidr, n.name, n.gateway);
  for (const d of rete.devices) {
    db.prepare(`INSERT INTO network_devices (id, name, host, device_type, vendor, model, protocol, enabled, controller_mac, uplink_mac, uplink_remote_port, uplink_type, uplink_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(d.id, d.name, d.host, d.device_type, d.vendor, d.model, d.via ?? "ssh", d.enabled, d.controller_mac, d.uplink_mac,
      d.uplink_remote_port, d.uplink_type, d.uplink_seen_at);
  }
  for (const h of rete.hosts) {
    db.prepare("INSERT INTO hosts (id, network_id, ip, mac, hostname, classification, status) VALUES (?, ?, ?, ?, ?, ?, ?)").run(h.id, h.network_id, h.ip, h.mac, h.hostname, h.classification, h.status);
  }
  // I MAC noti della rete-campione (`knownMacs`) sul DB: l'host con quel MAC è l'host dell'apparato (host:81 è un altro indirizzo
  // della testa, e il modello lo fonde in lei).
  for (const k of rete.knownMacs) db.prepare("UPDATE network_devices SET host_id = (SELECT id FROM hosts WHERE mac = ?) WHERE id = ? AND host_id IS NULL").run(k.mac, k.device_id);
  for (const p of rete.ports ?? []) {
    db.prepare("INSERT INTO switch_ports (device_id, port_index, port_name, status, speed, stp_state) VALUES (?, ?, ?, ?, ?, ?)").run(p.device_id, p.port_index, p.port_name, p.status, p.speed, p.stp_state);
  }
  const insVicino = db.prepare(`INSERT INTO device_neighbors (device_id, local_port, remote_device_name, remote_port, protocol, remote_ip, remote_mac, remote_platform, source, first_seen, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const n of rete.neighbors) {
    insVicino.run(n.device_id, n.local_port, n.remote_device_name, n.remote_port, n.protocol, n.remote_ip, n.remote_mac, n.remote_platform ?? null, n.source, sql(-7_200_000), sql(-3_600_000));
  }
}

const rete = soloMikrotik();
carica(getTenantDb(T), rete);
withTenant(T, () => {
  rileggiSchemaCavi();
  // Una riga di una fonte nuova e i fatti di porta: con la mappa accesa il modello per cavo li legge, con la mappa spenta nessuno.
  upsertNeighbors(21, [{ localPort: "sfp-sfpplus1,bridge", remoteDevice: "AGG-CRS", remotePort: "BR_AGG/sfp-sfpplus2", protocol: "lldp", remotePlatform: "MikroTik", remoteCaps: "bridge" }], "ssh");
  for (const d of rete.devices.filter((x) => x.vendor === "mikrotik")) {
    const porte = (rete.ports ?? []).filter((p) => p.device_id === d.id);
    scriviFattiTopologia(d.id, "device", {
      porte: porte.map((p) => ({ port_key: `i:${p.port_index}`, port_name: p.port_name, port_index: p.port_index, if_kind: "physical", running: 1, stp_state: "forwarding", stp_role: "designated" })),
      bridge: [], macs: [],
    });
  }
});

const oggi = () => withTenant(T, () => buildTopologyModel(getTopologyModelInput(2, ORA)));
const cancellaInterruttore = () => getTenantDb(T).prepare("DELETE FROM tenant_settings WHERE key = ?").run(CHIAVE_MAPPA_CAVI);
/** Le fonti della rotta, con la spia sulla lettura di T3. */
const letture = { cavi: 0 };
const conSpia: FontiDellaMappa = { ...FONTI_DELLA_MAPPA, ingressoCavi: (s, n) => { letture.cavi++; return FONTI_DELLA_MAPPA.ingressoCavi(s, n); } };

function spenta(caso: string): void {
  letture.cavi = 0;
  const r = withTenant(T, () => modelloDellaMappa(2, ORA, conSpia));
  assert.deepEqual([r.mappa, r.errore, r.nowMs], ["oggi", null, ORA], caso);
  assert.equal(r.model.cavi, undefined, `${caso}: la pagina usa \`cavi\` come segno della mappa accesa`);
  assert.equal(serializza(r.model), serializza(oggi()), `${caso}: il modello di T1, bit per bit`);
  assert.equal(letture.cavi, 0, `${caso}: a interruttore spento non si legge niente di T3`);
  // Le fonti vere, quelle della rotta: lo stesso modello.
  assert.equal(serializza(withTenant(T, () => modelloDellaMappa(2, ORA)).model), serializza(oggi()), caso);
}

test("T3.7: interruttore assente, rovinato o spento — la mappa di T1 bit per bit, senza leggere niente di T3", () => {
  cancellaInterruttore();
  spenta("assente");
  withTenant(T, () => setTenantSetting(CHIAVE_MAPPA_CAVI, "{acceso: true"));
  spenta("JSON rovinato");
  withTenant(T, () => setTenantSetting(CHIAVE_MAPPA_CAVI, JSON.stringify({ acceso: "true", da: "prova", il: sql(0) })));
  spenta("«acceso» non è true");
  withTenant(T, () => scriviMappaCavi(false, "prova"));
  spenta("spento");
});

test("T3.7: acceso — la mappa per cavo: `cavi` c'è, ogni linea ha il suo cavo, i nodi di oggi ci sono tutti; il modello di T1 non si muove", () => {
  const prima = serializza(oggi());
  withTenant(T, () => scriviMappaCavi(true, "prova"));
  try {
    letture.cavi = 0;
    const r = withTenant(T, () => modelloDellaMappa(2, ORA, conSpia));
    assert.deepEqual([r.mappa, r.errore, letture.cavi], ["cavi", null, 1]);
    assert.ok(r.model.cavi, "c'è `cavi`");
    assert.ok(r.model.links.length > 0 && r.model.links.every((l) => l.cavo !== undefined), "ogni linea ha `cavo`");
    const ids = new Set(r.model.nodes.map((n) => n.id));
    assert.ok(oggi().nodes.every((n) => ids.has(n.id)), "i nodi del modello di oggi ci sono tutti");
    assert.equal(r.model.cavi.testa, "dev:3");
    assert.equal(serializza(oggi()), prima, "calcolare la mappa nuova non scrive niente che T1 legga (R7)");
  } finally {
    withTenant(T, () => scriviMappaCavi(false, "prova"));
  }
});

test("Caso 3: acceso e il modello per cavo cade — la mappa di prima, «mappaErrore», una riga nel journal", () => {
  withTenant(T, () => scriviMappaCavi(true, "prova"));
  const errore = mock.method(console, "error", () => undefined);
  try {
    const rotto: FontiDellaMappa = { ...FONTI_DELLA_MAPPA, ingressoCavi: (s, n) => ({ ...FONTI_DELLA_MAPPA.ingressoCavi(s, n), fattiPorta: undefined as never }) };
    const r = withTenant(T, () => modelloDellaMappa(2, ORA, rotto));
    assert.deepEqual([r.mappa, r.errore], ["oggi", MAPPA_NON_CALCOLATA]);
    assert.equal(serializza(r.model), serializza(oggi()), "la mappa di prima, com'era");
    assert.equal(errore.mock.callCount(), 1);
    assert.match(String(errore.mock.calls[0].arguments[0]), /^\[topology\] mappa nuova non calcolata/);
  } finally {
    errore.mock.restore();
    withTenant(T, () => scriviMappaCavi(false, "prova"));
  }
});

test("Caso 3 sul DB: con la tabella dei fatti di T2 rovinata, spento non se ne accorge; acceso dà la mappa di prima con l'errore", () => {
  const db = getTenantDb(T);
  const errore = mock.method(console, "error", () => undefined);
  db.exec("ALTER TABLE topology_port_facts RENAME TO topology_port_facts_via");
  try {
    withTenant(T, () => scriviMappaCavi(false, "prova"));
    const spento = withTenant(T, () => modelloDellaMappa(2, ORA));
    assert.deepEqual([spento.mappa, spento.errore, errore.mock.callCount()], ["oggi", null, 0], "spento non legge la tabella di T2");
    withTenant(T, () => scriviMappaCavi(true, "prova"));
    const acceso = withTenant(T, () => modelloDellaMappa(2, ORA));
    assert.deepEqual([acceso.mappa, acceso.errore], ["oggi", MAPPA_NON_CALCOLATA]);
    assert.equal(serializza(acceso.model), serializza(oggi()));
    assert.equal(errore.mock.callCount(), 1);
    assert.match(String(errore.mock.calls[0].arguments[0]), /^\[topology\] mappa nuova non calcolata/);
  } finally {
    db.exec("ALTER TABLE topology_port_facts_via RENAME TO topology_port_facts");
    errore.mock.restore();
    withTenant(T, () => scriviMappaCavi(false, "prova"));
  }
});

test("«Candidati per porta» (§13.4.6, Scelte 11): solo con la mappa nuova accesa; accesa, le porte della testa con le prove", () => {
  cancellaInterruttore();
  letture.cavi = 0;
  assert.deepEqual(withTenant(T, () => candidatiDellaMappa(2, "dev:3", ORA, conSpia)), { ok: false, status: 409, error: CANDIDATI_SOLO_ACCESA });
  assert.equal(letture.cavi, 0, "spenta non si calcola niente");
  withTenant(T, () => scriviMappaCavi(true, "prova"));
  try {
    const r = withTenant(T, () => candidatiDellaMappa(2, "dev:3", ORA));
    assert.ok(r.ok);
    assert.ok(r.righe.length > 0 && r.altri === 0);
    const fascio = r.righe.find((x) => x.porta === "sfp28-1");
    assert.equal(fascio?.scelto?.verso, "AGG-CRS", JSON.stringify(fascio));
    // Un id fuso (host:81 è un altro indirizzo della testa) vale per il suo oggetto.
    assert.deepEqual(withTenant(T, () => candidatiDellaMappa(2, "host:81", ORA)), r);
  } finally {
    withTenant(T, () => scriviMappaCavi(false, "prova"));
  }
});
