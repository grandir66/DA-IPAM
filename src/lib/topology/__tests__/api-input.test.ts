import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLinkOverrideBody, parseSiteTopologyBody, parseDeviceLocationBody, parseStaleDaysBody } from "@/lib/topology/api-input";

test("correzione: nodi nella forma dev:N / host:N, azione nota, porte facoltative", () => {
  assert.deepEqual(parseLinkOverrideBody({ action: "add", a_node: "dev:1", b_node: "host:2" }), {
    ok: true, data: { action: "add", a_node: "dev:1", a_port: "", b_node: "host:2", b_port: "", medium: null, note: null },
  });
  assert.equal(parseLinkOverrideBody({ action: "add", a_node: "dev:1", b_node: "dev:1" }).ok, false, "un nodo con se stesso");
  assert.equal(parseLinkOverrideBody({ action: "sposta", a_node: "dev:1", b_node: "dev:2" }).ok, false);
  assert.equal(parseLinkOverrideBody({ action: "add", a_node: "ext:x", b_node: "dev:2" }).ok, false);
});

test("sede: testa e subnet facoltative, interi positivi", () => {
  assert.deepEqual(parseSiteTopologyBody({ head_device_id: null, network_ids: [1, 2] }), { ok: true, data: { headDeviceId: null, networkIds: [1, 2] } });
  assert.deepEqual(parseSiteTopologyBody({}), { ok: true, data: {} });
  assert.equal(parseSiteTopologyBody({ network_ids: [-1] }).ok, false);
});

test("sede dell'apparato e soglia", () => {
  assert.deepEqual(parseDeviceLocationBody({ location_id: null }), { ok: true, data: { locationId: null } });
  assert.equal(parseDeviceLocationBody({}).ok, false);
  assert.deepEqual(parseStaleDaysBody({ staleDays: 3 }), { ok: true, data: 3 });
  assert.equal(parseStaleDaysBody({ staleDays: 0 }).ok, false);
});

test("i rifiuti parlano italiano: nessun messaggio predefinito di Zod arriva all'admin", () => {
  const rifiuti = [
    parseLinkOverrideBody(null),
    parseLinkOverrideBody({ action: "sposta", a_node: "dev:1", b_node: "dev:2" }),
    parseLinkOverrideBody({ action: "add", a_node: 5, b_node: "dev:2" }),
    parseLinkOverrideBody({ action: "add", a_node: "dev:1", b_node: "dev:2", a_port: "x".repeat(101) }),
    parseLinkOverrideBody({ action: "add", a_node: "dev:1", b_node: "dev:2", note: "x".repeat(501) }),
    parseSiteTopologyBody(null),
    parseSiteTopologyBody({ head_device_id: "3" }),
    parseSiteTopologyBody({ network_ids: [-1] }),
    parseSiteTopologyBody({ network_ids: "1,2" }),
    parseDeviceLocationBody(null),
    parseDeviceLocationBody({}),
    parseDeviceLocationBody({ location_id: 1.5 }),
  ];
  for (const r of rifiuti) {
    assert.equal(r.ok, false);
    if (r.ok) continue;
    assert.doesNotMatch(r.error, /Invalid|expected|Too (small|big)|received/, r.error);
  }
});

test("mappe: nome 1-80 caratteri, nodi dev:N/host:N, al massimo 2000 per colpo", async () => {
  const m = await import("@/lib/topology/api-input");
  assert.deepEqual(m.parseMapCreateBody({ name: "  Sede  ", roots: ["dev:1"], nodes: ["dev:1", "host:2"] }), {
    ok: true, data: { name: "Sede", roots: ["dev:1"], nodes: ["dev:1", "host:2"] },
  });
  assert.deepEqual(m.parseMapCreateBody({ name: "x" }), { ok: true, data: { name: "x", roots: [], nodes: [] } });
  for (const bad of [{ name: "" }, { name: "   " }, { name: "a".repeat(81) }, { name: "x", nodes: ["ext:1"] }, { name: "x", roots: ["dev:x"] },
    { name: "x", nodes: Array.from({ length: 2001 }, (_, i) => `dev:${i + 1}`) }]) {
    const r = m.parseMapCreateBody(bad);
    assert.equal(r.ok, false);
    if (!r.ok) assert.doesNotMatch(r.error, /Invalid|expected/i);
  }
  assert.equal(m.parseMapPatchBody({}).ok, false, "una modifica vuota");
  assert.deepEqual(m.parseMapPatchBody({ name: "Nuovo" }), { ok: true, data: { name: "Nuovo" } });
  assert.deepEqual(m.parseMapNodesBody({ add: ["dev:3"] }), { ok: true, data: { add: ["dev:3"], remove: [] } });
  assert.equal(m.parseMapNodesBody({ add: ["x"] }).ok, false);
  assert.deepEqual(m.parseAutoHeadBody({ head_node: null }), { ok: true, data: { headNode: null } });
  assert.equal(m.parseAutoHeadBody({ head_node: "foo" }).ok, false);
});

test("ritocchi e nascondi: vista auto o mappa:N; hidden solo dev:N", async () => {
  const m = await import("@/lib/topology/api-input");
  assert.deepEqual(m.parsePositionsBody({ view: "mappa:4", orientation: "tb", tweaks: [{ nodeId: "dev:1", x: 1.5, y: -2, sig: "abc" }] }), {
    ok: true, data: { view: "mappa:4", clear: false, tweaks: [{ nodeId: "dev:1", x: 1.5, y: -2, sig: "abc" }], rename: [], orientation: "tb" },
  });
  assert.deepEqual(m.parsePositionsBody({ view: "auto", clear: true }), { ok: true, data: { view: "auto", clear: true, tweaks: [], rename: [], orientation: null } });
  assert.deepEqual(m.parsePositionsBody({ view: "mappa:4", rename: [{ from: "host:7", to: "dev:3" }] }), {
    ok: true, data: { view: "mappa:4", clear: false, tweaks: [], rename: [{ from: "host:7", to: "dev:3" }], orientation: null },
  });
  assert.equal(m.parsePositionsBody({ view: "mappa:4", rename: [{ from: "host:7", to: "host:7" }] }).ok, false, "rinomina su se stesso");
  assert.equal(m.parsePositionsBody({ view: "mappa:4", rename: [{ from: "x", to: "dev:3" }] }).ok, false);
  assert.equal(m.parsePositionsBody({ view: "default", tweaks: [] }).ok, false);
  assert.equal(m.parsePositionsBody({ view: "auto" }).ok, false, "né ritocchi né riordino");
  assert.equal(m.parsePositionsBody({ view: "auto", tweaks: [{ nodeId: "dev:1", x: "a", y: 0, sig: "" }] }).ok, false);
  assert.deepEqual(m.parseHiddenBody({ node_id: "dev:7", hidden: true }), { ok: true, data: { deviceId: 7, hidden: true } });
  assert.equal(m.parseHiddenBody({ node_id: "host:7", hidden: true }).ok, false);
  assert.equal(m.parseHiddenBody({ node_id: "dev:7" }).ok, false);
});

// ─── Fase 2b (Task 9): tipo del collegamento, modifica, principale, porte note ───

test("collegamento a mano col tipo; il tipo non vale per «ignora»", async () => {
  const m = await import("@/lib/topology/api-input");
  assert.deepEqual(
    m.parseLinkOverrideBody({ action: "add", a_node: "host:3", a_port: "net0", b_node: "dev:2", b_port: "Port 5", medium: "fibra", note: "armadio 2" }),
    { ok: true, data: { action: "add", a_node: "host:3", a_port: "net0", b_node: "dev:2", b_port: "Port 5", medium: "fibra", note: "armadio 2" } },
  );
  assert.equal(m.parseLinkOverrideBody({ action: "add", a_node: "dev:1", b_node: "dev:2", medium: null }).ok, true);
  for (const bad of [
    { action: "add", a_node: "dev:1", b_node: "dev:2", medium: "rame" },
    { action: "ignore", a_node: "dev:1", b_node: "dev:2", medium: "cavo" },
    { action: "add", a_node: "vm:x:1", b_node: "dev:2" },
    { action: "add", a_node: "dev:1:2:3", b_node: "dev:2" },
  ]) {
    const r = m.parseLinkOverrideBody(bad);
    assert.equal(r.ok, false, JSON.stringify(bad));
    if (!r.ok) assert.doesNotMatch(r.error, /Invalid|expected|received/);
  }
  const ign = m.parseLinkOverrideBody({ action: "ignore", a_node: "dev:1", b_node: "dev:2", medium: "cavo" });
  // Da T3 il tipo può essere anche «tunnel» (le rotte lo accettano): il messaggio elenca tutti i tipi che la rotta accetta.
  assert.deepEqual(ign, { ok: false, error: "Il tipo (cavo, fibra, wireless o tunnel) si indica solo per un collegamento aggiunto a mano" });
});

// Revisione finale I-1: il modello non ha nodi `vm:` nei collegamenti, quindi un collegamento a mano o un
// principale verso una VM non censita si salverebbe senza mai comparire (ripiego muto). Si rifiuta in parole.
test("I-1: collegamenti e principale rifiutano una VM non censita (vm:N:M), con il motivo in italiano", async () => {
  const m = await import("@/lib/topology/api-input");
  const atteso = { ok: false, error: m.VM_NON_COLLEGABILE };
  assert.match(m.VM_NON_COLLEGABILE, /VM non censita/);
  for (const action of ["add", "ignore"]) {
    assert.deepEqual(m.parseLinkOverrideBody({ action, a_node: "vm:3:100", a_port: "net0", b_node: "dev:2", b_port: "Port 5" }), atteso, action);
    assert.deepEqual(m.parseLinkOverrideBody({ action, a_node: "dev:2", b_node: "vm:3:100" }), atteso, action);
  }
  assert.deepEqual(m.parsePrimaryBody({ node_id: "vm:3:100", other_node: "host:9" }), atteso);
  assert.deepEqual(m.parsePrimaryBody({ node_id: "dev:5", other_node: "vm:3:100" }), atteso);
  // Le mappe continuano ad accettare le VM (test più sotto); togliere una scelta resta possibile per qualunque nodo.
  assert.deepEqual(m.parsePrimaryDeleteBody({ node_id: "vm:3:100" }), { ok: true, data: { node_id: "vm:3:100" } });
});

test("modifica di un collegamento a mano: solo i campi presenti; almeno uno", async () => {
  const m = await import("@/lib/topology/api-input");
  assert.deepEqual(m.parseLinkPatchBody({ a_port: "Port 7" }), { ok: true, data: { a_port: "Port 7" } });
  assert.deepEqual(m.parseLinkPatchBody({ medium: null, note: null }), { ok: true, data: { medium: null, note: null } });
  assert.deepEqual(m.parseLinkPatchBody({ b_port: "", medium: "wireless" }), { ok: true, data: { b_port: "", medium: "wireless" } });
  assert.deepEqual(m.parseLinkPatchBody({}), { ok: false, error: "Niente da modificare: servono le porte, il tipo o la nota" });
  for (const bad of [null, { medium: "rame" }, { a_port: 5 }, { a_port: "x".repeat(101) }, { note: "x".repeat(501) }]) {
    const r = m.parseLinkPatchBody(bad);
    assert.equal(r.ok, false, JSON.stringify(bad));
    if (!r.ok) assert.doesNotMatch(r.error, /Invalid|expected|received/);
  }
});

test("principale scelto a mano: due nodi diversi, porte facoltative; per toglierlo basta il nodo", async () => {
  const m = await import("@/lib/topology/api-input");
  assert.deepEqual(m.parsePrimaryBody({ node_id: "dev:5", other_node: "dev:2", node_port: "eno1", other_port: "Port 17" }), {
    ok: true, data: { node_id: "dev:5", other_node: "dev:2", node_port: "eno1", other_port: "Port 17" },
  });
  assert.deepEqual(m.parsePrimaryBody({ node_id: "host:3", other_node: "host:9" }), {
    ok: true, data: { node_id: "host:3", other_node: "host:9", node_port: "", other_port: "" },
  });
  assert.deepEqual(m.parsePrimaryBody({ node_id: "dev:5", other_node: "dev:5" }), { ok: false, error: "Un collegamento unisce due nodi diversi" });
  for (const bad of [null, {}, { node_id: "dev:5" }, { node_id: "ext:1", other_node: "dev:2" }, { node_id: "dev:5", other_node: "dev:2", node_port: 3 }]) {
    const r = m.parsePrimaryBody(bad);
    assert.equal(r.ok, false, JSON.stringify(bad));
    if (!r.ok) assert.doesNotMatch(r.error, /Invalid|expected|received/);
  }
  assert.deepEqual(m.parsePrimaryDeleteBody({ node_id: "dev:5" }), { ok: true, data: { node_id: "dev:5" } });
  assert.equal(m.parsePrimaryDeleteBody({}).ok, false);
  assert.equal(m.parsePrimaryDeleteBody(null).ok, false);
});

test("porte note: il nodo nella query, nella forma dev:N, host:N o vm:N:M", async () => {
  const m = await import("@/lib/topology/api-input");
  assert.deepEqual(m.parsePortsQuery("dev:4"), { ok: true, data: "dev:4" });
  assert.deepEqual(m.parsePortsQuery("vm:3:100"), { ok: true, data: "vm:3:100" });
  assert.deepEqual(m.parsePortsQuery(null), { ok: false, error: "Manca il nodo: ?node=dev:N" });
  assert.equal(m.parsePortsQuery("dev:x").ok, false);
});

test("mappe, radici e ritocchi accettano anche le VM (vm:<apparato>:<vmid>)", async () => {
  const m = await import("@/lib/topology/api-input");
  assert.equal(m.parseMapCreateBody({ name: "x", nodes: ["vm:3:100"], roots: ["vm:3:100"] }).ok, true);
  assert.deepEqual(m.parseMapNodesBody({ add: ["vm:3:100"] }), { ok: true, data: { add: ["vm:3:100"], remove: [] } });
  assert.equal(m.parsePositionsBody({ view: "mappa:1", orientation: "lr", tweaks: [{ nodeId: "vm:3:100", x: 0, y: 0, sig: "s" }] }).ok, true);
  assert.equal(m.parseMapNodesBody({ add: ["vm:3"] }).ok, true, "la regex del piano ammette anche vm:N");
  assert.equal(m.parseMapNodesBody({ add: ["vm:a:1"] }).ok, false);
});

// ─── Orientamento (spec §12.2, piano 2026-10-14-topologia-verticale-stampa, Task 1) ───

test("orientamento della mappa: «lr» o «tb», da solo; il resto rifiutato in italiano", async () => {
  const m = await import("@/lib/topology/api-input");
  assert.deepEqual(m.parseMapOrientationBody({ orientation: "lr" }), { ok: true, data: { orientation: "lr" } });
  assert.deepEqual(m.parseMapOrientationBody({ orientation: "tb" }), { ok: true, data: { orientation: "tb" } });
  const msg = "Orientamento non valido: si sceglie fra verticale e orizzontale";
  for (const bad of [{ orientation: "verticale" }, { orientation: null }, { orientation: 1 }, {}]) {
    assert.deepEqual(m.parseMapOrientationBody(bad), { ok: false, error: msg }, JSON.stringify(bad));
  }
  assert.deepEqual(m.parseMapOrientationBody(null), { ok: false, error: "Corpo della richiesta non valido" });
  assert.deepEqual(m.parseMapOrientationBody({ orientation: "lr", name: "X" }), {
    ok: false, error: "L'orientamento si cambia da solo, senza altri campi",
  });
  assert.equal(m.asksOrientation({ orientation: "lr" }), true);
  assert.equal(m.asksOrientation({ orientation: undefined }), true, "la chiave c'è: decide il parser");
  assert.equal(m.asksOrientation({ head_node: "dev:1" }), false);
  assert.equal(m.asksOrientation(null), false);
  assert.equal(m.asksOrientation("lr"), false);
});

test("ritocchi con l'orientamento: obbligatorio per salvarli, facoltativo per «Riordina» e per le rinomine", async () => {
  const m = await import("@/lib/topology/api-input");
  const tw = [{ nodeId: "dev:1", x: 1, y: 2, sig: "s" }];
  assert.deepEqual(m.parsePositionsBody({ view: "auto", orientation: "lr", tweaks: tw }), {
    ok: true, data: { view: "auto", clear: false, tweaks: tw, rename: [], orientation: "lr" },
  });
  assert.deepEqual(m.parsePositionsBody({ view: "auto", tweaks: tw }), {
    ok: false, error: "Manca l'orientamento dei ritocchi: si sceglie fra verticale e orizzontale",
  });
  assert.deepEqual(m.parsePositionsBody({ view: "auto", orientation: "verticale", tweaks: tw }), {
    ok: false, error: "Orientamento non valido: si sceglie fra verticale e orizzontale",
  });
  assert.deepEqual(m.parsePositionsBody({ view: "auto", tweaks: [] }), {
    ok: true, data: { view: "auto", clear: false, tweaks: [], rename: [], orientation: null },
  }, "niente da salvare: l'orientamento non serve");
  assert.deepEqual(m.parsePositionsBody({ view: "mappa:2", clear: true, orientation: "tb" }), {
    ok: true, data: { view: "mappa:2", clear: true, tweaks: [], rename: [], orientation: "tb" },
  });
});

test("ruolo nella mappa (T1b, T3): solo gli apparati; «», «rete», «attaccato» e da T3 «core» e «accesso»", async () => {
  const m = await import("@/lib/topology/api-input");
  assert.deepEqual(m.parseNodeRoleBody({ node_id: "dev:7", role: "rete" }), { ok: true, data: { deviceId: 7, role: "rete" } });
  assert.deepEqual(m.parseNodeRoleBody({ node_id: "dev:7", role: "" }), { ok: true, data: { deviceId: 7, role: "" } });
  assert.deepEqual(m.parseNodeRoleBody({ node_id: "host:7", role: "rete" }),
    { ok: false, error: "Il ruolo nella mappa si sceglie solo per un apparato: un host prima si promuove ad apparato" });
  // Fino a T2 qui si provava il rifiuto di «core»: la rotta non li accettava ancora. Da T3 (§13.9) «core» e «accesso» si
  // scrivono: li legge il modello per cavo, quello di T1 li legge «rete» (ruoloLetto, provato in node-index.test.ts).
  for (const role of ["core", "accesso"] as const) {
    assert.deepEqual(m.parseNodeRoleBody({ node_id: "dev:7", role }), { ok: true, data: { deviceId: 7, role } }, role);
  }
  assert.deepEqual(m.parseNodeRoleBody({ node_id: "dev:7", role: "boh" }),
    { ok: false, error: "Ruolo non valido: «» (decide il sistema), «rete», «attaccato», «core» o «accesso»" });
  assert.equal(m.parseNodeRoleBody({ node_id: "dev:7" }).ok, false);
});

// ─── T3, Task 8 (spec §13.7.3 «Nelle rotte», §13.9): l'id del segmento, il tipo «tunnel» ───

// Gli id che il modello per cavo dà ai segmenti (cavi/collegamenti.ts): l'indice della porta, oppure «n-» e il nome codificato.
const SEGMENTI = ["seg:114:15", "seg:1:n-ether8", `seg:7:n-${encodeURIComponent("gi1/0/1 (x)")}`];

test("T3: l'id di un segmento passa le rotte delle mappe passo passo, dei ritocchi, delle porte e della ★", async () => {
  const m = await import("@/lib/topology/api-input");
  for (const id of SEGMENTI) {
    assert.deepEqual(m.parseMapNodesBody({ add: [id], remove: [id] }), { ok: true, data: { add: [id], remove: [id] } }, id);
    assert.deepEqual(m.parseMapCreateBody({ name: "x", roots: [id], nodes: [id] }), { ok: true, data: { name: "x", roots: [id], nodes: [id] } }, id);
    assert.deepEqual(m.parseMapPatchBody({ roots: [id] }), { ok: true, data: { roots: [id] } }, id);
    assert.equal(m.parsePositionsBody({ view: "mappa:1", orientation: "lr", tweaks: [{ nodeId: id, x: 0, y: 0, sig: "s" }] }).ok, true, id);
    assert.deepEqual(m.parsePositionsBody({ view: "mappa:1", rename: [{ from: id, to: "seg:114:16" }] }), {
      ok: true, data: { view: "mappa:1", clear: false, tweaks: [], rename: [{ from: id, to: "seg:114:16" }], orientation: null },
    }, id);
    assert.deepEqual(m.parsePortsQuery(id), { ok: true, data: id }, id);
    // La ★ di un membro verso il suo segmento, e quella del segmento verso il membro che lo porta (§13.7.3, «Nell'albero»).
    assert.deepEqual(m.parsePrimaryBody({ node_id: "dev:114", other_node: id, node_port: "Port 15", other_port: "" }), {
      ok: true, data: { node_id: "dev:114", other_node: id, node_port: "Port 15", other_port: "" },
    }, id);
    assert.equal(m.parsePrimaryBody({ node_id: id, other_node: "dev:114" }).ok, true, id);
    assert.deepEqual(m.parsePrimaryDeleteBody({ node_id: id }), { ok: true, data: { node_id: id } }, id);
  }
});

test("T3: id di segmento sbagliati rifiutati in italiano; il limite di 120 caratteri vale per ogni nodo", async () => {
  const m = await import("@/lib/topology/api-input");
  const lungo = (n: number) => `seg:${"1".repeat(25)}:n-${"a".repeat(n)}`;
  assert.equal(lungo(89).length, 121);
  assert.deepEqual(m.parsePortsQuery(lungo(88)), { ok: true, data: lungo(88) }, "120 caratteri: passa");
  for (const bad of ["seg:1", "seg:x:1", "seg:1:n-a|b", "seg:1:n-", "seg::1", "seg:1:n-a:b", "seg:1:2:3", "seg:1:n-a b", lungo(89)]) {
    for (const r of [m.parsePortsQuery(bad), m.parseMapNodesBody({ add: [bad] }), m.parsePrimaryDeleteBody({ node_id: bad }),
      m.parsePrimaryBody({ node_id: "dev:1", other_node: bad }), m.parseLinkOverrideBody({ action: "ignore", a_node: "dev:1", b_node: bad })]) {
      assert.deepEqual(r, { ok: false, error: "Nodo non valido" }, bad);
    }
  }
});

test("T3: «Ignora» un'appartenenza a un segmento sì, «Collega a…» un segmento no (§13.7.3)", async () => {
  const m = await import("@/lib/topology/api-input");
  assert.deepEqual(m.parseLinkOverrideBody({ action: "ignore", a_node: "dev:114", a_port: "Port 15", b_node: "seg:114:15" }), {
    ok: true, data: { action: "ignore", a_node: "dev:114", a_port: "Port 15", b_node: "seg:114:15", b_port: "", medium: null, note: null },
  });
  assert.match(m.SEGMENTO_NON_COLLEGABILE, /segmento non si collega a mano/);
  const atteso = { ok: false, error: m.SEGMENTO_NON_COLLEGABILE };
  assert.deepEqual(m.parseLinkOverrideBody({ action: "add", a_node: "dev:114", a_port: "Port 15", b_node: "seg:114:15" }), atteso);
  assert.deepEqual(m.parseLinkOverrideBody({ action: "add", a_node: "seg:1:n-ether8", b_node: "dev:2", medium: "cavo" }), atteso);
  // Una VM non censita resta rifiutata col suo motivo, anche verso un segmento.
  assert.deepEqual(m.parseLinkOverrideBody({ action: "add", a_node: "vm:3:100", b_node: "seg:1:5" }), { ok: false, error: m.VM_NON_COLLEGABILE });
});

test("T3: un segmento non è una testa e non si nasconde", async () => {
  const m = await import("@/lib/topology/api-input");
  assert.equal(m.parseAutoHeadBody({ head_node: "seg:114:15" }).ok, false);
  assert.equal(m.parseHiddenBody({ node_id: "seg:114:15", hidden: true }).ok, false);
});

test("T3: il tipo «tunnel» in creazione e in modifica (§13.9); il rifiuto lo nomina", async () => {
  const m = await import("@/lib/topology/api-input");
  assert.deepEqual(m.parseLinkOverrideBody({ action: "add", a_node: "dev:1", a_port: "eoip-1", b_node: "dev:2", b_port: "eoip-1", medium: "tunnel" }), {
    ok: true, data: { action: "add", a_node: "dev:1", a_port: "eoip-1", b_node: "dev:2", b_port: "eoip-1", medium: "tunnel", note: null },
  });
  assert.deepEqual(m.parseLinkPatchBody({ medium: "tunnel" }), { ok: true, data: { medium: "tunnel" } });
  assert.deepEqual(m.parseLinkPatchBody({ medium: "rame" }), { ok: false, error: "Tipo non valido: «cavo», «fibra», «wireless» o «tunnel»" });
});
