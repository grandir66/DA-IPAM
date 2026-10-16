// T3.7 e R7 (spec topologia §13.11.4; piano di T3, «Vincoli globali» e Casi 3): la mappa che la rotta del modello dà, sul DB.
// Prima parte (Task 6): con l'interruttore `topologia.mappa.cavi` assente, rovinato o spento la rotta calcola il modello di T1
// com'era, bit per bit, e non legge niente di T3 (nessuna chiamata a `getIngressoCavi`: la spia lo conta, e la tabella dei fatti
// rovinata non si sente); acceso dà la mappa per cavo. Se il calcolo nuovo cade (il modello per cavo o la sua lettura), la mappa
// di prima con l'errore detto nel journal e a schermo: mai una pagina bianca, mai un ripiego muto (Caso 3, lezione 6). I dati
// sono la famiglia 1 delle reti-campione scritta con le funzioni di db-tenant, come in topologia-t2-freno.test.ts.
// Seconda parte (Task 12): lo stesso freno su OGNI rete di prova (le cinque famiglie, la rete in quattro letture, le due fixture
// anonime) — spento è T1 bit per bit (modello, albero, linee, impronte) e non legge niente di T3; acceso e poi spento non lascia
// niente indietro; con lo schema assente la rotta non accende, e un valore scritto a mano nel DB dà comunque una mappa.
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { test, after, mock } from "node:test";
import assert from "node:assert/strict";
import type Database from "better-sqlite3";
import { closeHubDb } from "@/lib/db-hub";
import {
  deleteTenantDatabase, getTenantDb, getTopologyModelInput, rileggiSchemaCavi, schemaCaviPresente, scriviFattiTopologia, setTenantSetting, upsertNeighbors, withTenant,
} from "@/lib/db-tenant";
import { buildTopologyModel } from "@/lib/topology/model";
import { CHIAVE_MAPPA_CAVI, scriviMappaCavi } from "@/lib/topology/letture/mappa";
import {
  CANDIDATI_SOLO_ACCESA, FONTI_DELLA_MAPPA, MAPPA_NON_CALCOLATA, OGGETTO_NON_NELLA_MAPPA, candidatiDellaMappa, modelloDellaMappa, type FontiDellaMappa,
} from "@/lib/topology/mappa-server";
import type { TopologyModelInput } from "@/lib/topology/model-types";
import { soloMikrotik } from "@/lib/topology/__tests__/support/reti-campione";
import { impronta, improntaT1, serializza } from "@/lib/topology/__tests__/support/impronta";
import { RETI_T1 } from "@/lib/topology/__tests__/support/famiglie-cavi";
import { decidiCorpoMappa } from "@/lib/topology/letture/corpo";
import { computeMapView } from "@/lib/topology/map-compute";
import { padriDi } from "@/lib/topology/misura";
import { autoVisible, buildTree, proposeHead } from "@/lib/topology/tree";

const T = "TESTT3FRENO";
getTenantDb(T);
after(() => { deleteTenantDatabase(T); closeHubDb(); removeTestHubDb(); });

/** Un solo «adesso» per tutta la prova. */
const ORA = Date.now();
const sql = (ms: number): string => new Date(ORA + ms).toISOString().slice(0, 19).replace("T", " ");

/** Scrive nel tenant la rete: apparati, reti, host, porte, vicini (un'ora fa), e i fatti di porta dei MikroTik (T2). */
function carica(db: Database.Database, rete: TopologyModelInput): void {
  for (const n of rete.networks) db.prepare("INSERT INTO networks (id, cidr, name, gateway) VALUES (?, ?, ?, ?)").run(n.id, n.cidr, n.name, n.gateway);
  // Le reti-campione che non dichiarano la rete dei loro host (famiglia 2): una rete segnaposto, per la chiave esterna.
  for (const id of new Set(rete.hosts.map((h) => h.network_id))) {
    if (!rete.networks.some((n) => n.id === id)) db.prepare("INSERT INTO networks (id, cidr, name, gateway) VALUES (?, ?, ?, NULL)").run(id, `10.250.${id}.0/24`, `rete-${id}`);
  }
  for (const d of rete.devices) {
    db.prepare(`INSERT INTO network_devices (id, name, host, device_type, vendor, model, protocol, enabled, controller_mac, uplink_mac, uplink_remote_port, uplink_type, uplink_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(d.id, d.name, d.host, d.device_type, d.vendor === "aruba" ? "hp" : d.vendor, d.model, d.via ?? "ssh", d.enabled, d.controller_mac, d.uplink_mac,
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
  for (const u of rete.uplinkPorts) db.prepare("UPDATE switch_ports SET is_uplink = 1 WHERE device_id = ? AND port_index = ?").run(u.device_id, u.port_index);
  for (const m of rete.macPorts) db.prepare("INSERT INTO mac_port_entries (device_id, mac, port_name, timestamp) VALUES (?, ?, ?, ?)").run(m.device_id, m.mac, m.port_name, sql(-3_600_000));
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
    const riga = String(errore.mock.calls[0].arguments[0]);
    assert.match(riga, /^\[topology\] mappa nuova non calcolata/);
    // Revisione del Task 6: dove è caduto, i primi punti della pila (solo file:riga:colonna), su una riga sola del journal.
    assert.match(riga, /\(in [^()]*\.ts:\d+:\d+/, riga);
    assert.ok(!riga.includes("\n"), "una riga sola");
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
    // Un id scritto bene di un oggetto che non c'è più: 404, non un elenco vuoto che sembra «nessuna prova» (revisione del Task 6).
    assert.deepEqual(withTenant(T, () => candidatiDellaMappa(2, "dev:404", ORA)), { ok: false, status: 404, error: OGGETTO_NON_NELLA_MAPPA });
    assert.equal(OGGETTO_NON_NELLA_MAPPA, "Oggetto non più nella mappa");
  } finally {
    withTenant(T, () => scriviMappaCavi(false, "prova"));
  }
});

// ─── Seconda parte (Task 12): il freno su OGNI rete di prova ───────────────────────────────────────────────────────────────────

/** Lo stato della pagina da un modello: albero della mappa automatica, linee, impronta. Con `cavi` la pagina userebbe la strada nuova. */
function paginaDi(model: ReturnType<typeof oggi>) {
  const testa = proposeHead(model);
  const rif = buildTree(model, autoVisible(model), testa ? [testa] : []);
  const v = computeMapView(model, { auto: true, members: [], roots: [], head: null, tweaks: [], expanded: new Set(), orientation: "lr" });
  return { rif, v };
}

/** Una rete di prova su un tenant suo, il tempo di una prova. */
function conRete<T>(nome: string, rete: TopologyModelInput, prova: (tenant: string) => T): T {
  const tenant = `TESTT3FRENO${nome.replace(/[^A-Z0-9]/gi, "").toUpperCase().slice(0, 18)}${Math.floor(Math.random() * 1e6)}`;
  carica(getTenantDb(tenant), rete);
  withTenant(tenant, () => rileggiSchemaCavi());
  try {
    return prova(tenant);
  } finally {
    deleteTenantDatabase(tenant);
  }
}

for (const [nome, crea] of RETI_T1) {
  test(`T3.7 · ${nome}: spento è T1 bit per bit — modello, albero della pagina, linee, impronte — e non legge niente di T3; acceso e poi spento non lascia niente indietro`, () => {
    conRete(nome, crea(), (tenant) => {
      const oggiQui = () => withTenant(tenant, () => buildTopologyModel(getTopologyModelInput(2, ORA)));
      let letto = 0;
      const spia: FontiDellaMappa = { ...FONTI_DELLA_MAPPA, ingressoCavi: (st, n) => { letto++; return FONTI_DELLA_MAPPA.ingressoCavi(st, n); } };
      const prima = oggiQui();
      const spenta = withTenant(tenant, () => modelloDellaMappa(2, ORA, spia));
      assert.deepEqual([spenta.mappa, spenta.errore, letto], ["oggi", null, 0], "spento: la mappa di prima, senza leggere T3");
      assert.equal(spenta.model.cavi, undefined);
      assert.equal(serializza(spenta.model), serializza(prima), "il modello di T1, bit per bit");
      assert.equal(impronta(spenta.model), impronta(prima));
      // L'albero e le linee della pagina sono quelli di T1: `computeMapView` senza `cavi` è `buildTree` di T1.
      const { rif, v } = paginaDi(spenta.model);
      assert.deepEqual(padriDi(v.tree), padriDi(rif), "i padri");
      assert.deepEqual([...v.tree.via].map(([n, l]) => [n, l.id]), [...rif.via].map(([n, l]) => [n, l.id]), "le linee scelte");
      assert.deepEqual(v.tree.roots, rif.roots, "le radici");
      assert.equal(serializza(v.tree.links.map((l) => ({ ...l, redundant: undefined, primary: undefined }))), serializza(rif.links.map((l) => ({ ...l, redundant: undefined, primary: undefined }))));
      // L'impronta di T1 calcolata sull'ingresso del DB: quella che `cavi-ombra.test.ts` fissa per le reti in memoria.
      const input = withTenant(tenant, () => getTopologyModelInput(2, ORA));
      assert.equal(improntaT1(input).modello, impronta(prima));

      // Acceso: la mappa per cavo, e il modello di T1 che la pagina non usa non si muove; poi spento: di nuovo uguale.
      withTenant(tenant, () => scriviMappaCavi(true, "prova"));
      const accesa = withTenant(tenant, () => modelloDellaMappa(2, ORA, spia));
      assert.deepEqual([accesa.mappa, accesa.errore, letto], ["cavi", null, 1]);
      assert.equal(serializza(oggiQui()), serializza(prima), "calcolare la mappa nuova non scrive niente che T1 legga (R7)");
      withTenant(tenant, () => scriviMappaCavi(false, "prova"));
      letto = 0;
      const dopo = withTenant(tenant, () => modelloDellaMappa(2, ORA, spia));
      assert.deepEqual([dopo.mappa, dopo.errore, letto], ["oggi", null, 0]);
      assert.equal(serializza(dopo.model), serializza(prima), "acceso e poi spento: di nuovo T1 bit per bit");
    });
  });
}

test("T3.7 · lo schema delle letture assente: la rotta non accende; un valore scritto a mano nel DB dà comunque una mappa (elenchi vuoti, `cavi` presente, nessuna eccezione)", () => {
  conRete("schema", soloMikrotik(), (tenant) => {
    const d = getTenantDb(tenant);
    d.exec("ALTER TABLE device_neighbors DROP COLUMN remote_caps");
    try {
      withTenant(tenant, () => rileggiSchemaCavi());
      assert.equal(withTenant(tenant, () => schemaCaviPresente()), false);
      // La rotta (PUT /api/topology/settings/mappa) decide il corpo con `decidiCorpoMappa`: accendere chiede lo schema (409); spegnere no.
      const accendi = withTenant(tenant, () => decidiCorpoMappa({ acceso: true }, { schemaPresente: schemaCaviPresente }));
      assert.deepEqual([accendi.ok, accendi.ok ? null : accendi.status], [false, 409]);
      assert.equal(withTenant(tenant, () => decidiCorpoMappa({ acceso: false }, { schemaPresente: schemaCaviPresente })).ok, true, "spegnere si può sempre");
      // Un valore scritto a mano (nessun codice lo accende da solo, ma il DB può averlo): la mappa c'è, dalle sole righe di oggi.
      withTenant(tenant, () => scriviMappaCavi(true, "a mano"));
      const errore = mock.method(console, "error", () => undefined);
      try {
        const r = withTenant(tenant, () => modelloDellaMappa(2, ORA));
        assert.deepEqual([r.mappa, r.errore, errore.mock.callCount()], ["cavi", null, 0], "nessuna eccezione, nessuna riga nel journal");
        assert.ok(r.model.cavi, "`cavi` c'è");
        const ing = withTenant(tenant, () => FONTI_DELLA_MAPPA.ingressoCavi(2, ORA));
        assert.deepEqual([ing.schema, ing.fattiPorta.length, ing.fattiBridge.length, ing.macApparati.length, ing.uplink.length], [false, 0, 0, 0, 0], "elenchi vuoti");
        assert.ok(r.model.links.length > 0, "i collegamenti si calcolano dalle righe di oggi");
      } finally {
        errore.mock.restore();
      }
    } finally {
      d.exec("ALTER TABLE device_neighbors ADD COLUMN remote_caps TEXT");
      withTenant(tenant, () => rileggiSchemaCavi());
    }
  });
});

// ─── Caso 5 del piano (M5), sulla rete-campione del freno e dalla rotta ─────────────────────────────────────────────────────

test("Caso 5 · un fatto di porta vecchio (`running = 0` di una fonte non più letta) accanto a un vicino LLDP di oggi sulla stessa porta: il cavo non è «giù»; un fatto dentro la soglia sì", () => {
  const giorniFa = (n: number) => new Date(ORA - n * 86_400_000);
  const fatti = { porte: [{ port_key: "i:1", port_name: "sfp-sfpplus1", port_index: 1, if_kind: "physical", running: 0 }], bridge: [], macs: [] };
  const statoDelCavo = (): string | null | undefined => {
    withTenant(T, () => scriviMappaCavi(true, "prova"));
    try {
      const r = withTenant(T, () => modelloDellaMappa(2, ORA));
      assert.equal(r.mappa, "cavi");
      const l = r.model.links.find((x) => [x.a, x.b].sort().join() === "dev:11,dev:21");
      return l?.cavo?.stato;
    } finally {
      withTenant(T, () => scriviMappaCavi(false, "prova"));
    }
  };
  try {
    withTenant(T, () => scriviFattiTopologia(21, "device", fatti, giorniFa(3)));
    assert.equal(statoDelCavo(), "inoltra", "tre giorni con la soglia a due: il fatto non entra, e il cavo visto oggi non è «giù»");
    withTenant(T, () => scriviFattiTopologia(21, "device", fatti, giorniFa(1)));
    assert.equal(statoDelCavo(), "giu", "un giorno: dentro la soglia, il fatto dice «giù»");
  } finally {
    withTenant(T, () => scriviFattiTopologia(21, "device", { porte: [{ port_key: "i:1", port_name: "sfp-sfpplus1", port_index: 1, if_kind: "physical", running: 1, stp_state: "forwarding", stp_role: "designated" }], bridge: [], macs: [] }));
  }
});
