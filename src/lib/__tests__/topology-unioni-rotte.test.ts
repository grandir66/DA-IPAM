// Le rotte di «Unisci con…» e «Separa…» sul DB del cliente (piano 2026-10-16, Task 3; ADR 0021), attraverso `unioni-server.ts`
// (le rotte ne sono l'involucro: guardia, `readJson`, risposta). L'anteprima (`applica: false`) non scrive; `applica: true` scrive
// le righe con chi e quando, e la mappa le applica; «Separa…» toglie le righe (mai DELETE: `tolto_il`) e scrive le coppie; un
// corpo fuori forma è 400; senza le tabelle 409 `schemaAssente` e `disponibile: false`; una riga da togliere che nel frattempo è
// già tolta è 409 `cambiato` e niente scritto; i candidati per nome e per IP. Il 403 a chi non è admin lo prova
// api-auth-guards.test.ts sul sorgente. Tenant di prova come topologia-t3-freno.test.ts, col NAS di support/nas.ts.
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import type Database from "better-sqlite3";
import { closeHubDb } from "@/lib/db-hub";
import { deleteTenantDatabase, getRigheScelte, getTenantDb, getTopologyModelInput, rileggiSchemaUnioni, withTenant } from "@/lib/db-tenant";
import { buildTopologyModel } from "@/lib/topology/model";
import type { TopologyModelInput } from "@/lib/topology/model-types";
import { FONTI_UNIONI, rispostaCandidati, rispostaSeparazione, rispostaStato, rispostaUnione } from "@/lib/topology/unioni-server";
import { TESTI_UNIONI } from "@/lib/topology/unioni-tipi";
import { nas } from "@/lib/topology/__tests__/support/nas";

const aperti: string[] = [];
after(() => { for (const t of aperti) deleteTenantDatabase(t); closeHubDb(); removeTestHubDb(); });

/** Scrive nel tenant reti, apparati, host e vicini della rete (come `carica` di topology-unioni-db.test.ts). */
function carica(db: Database.Database, rete: TopologyModelInput): void {
  for (const n of rete.networks) db.prepare("INSERT INTO networks (id, cidr, name, gateway) VALUES (?, ?, ?, ?)").run(n.id, n.cidr, n.name, n.gateway);
  for (const d of rete.devices) {
    db.prepare(`INSERT INTO network_devices (id, name, host, device_type, vendor, model, protocol, enabled, host_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(d.id, d.name, d.host, d.device_type, d.vendor, d.model, d.via ?? "ssh", d.enabled, d.host_id);
  }
  for (const h of rete.hosts) {
    db.prepare("INSERT INTO hosts (id, network_id, ip, mac, hostname, classification, status) VALUES (?, ?, ?, ?, ?, ?, ?)").run(h.id, h.network_id, h.ip, h.mac, h.hostname, h.classification, h.status);
  }
  const insVicino = db.prepare(`INSERT INTO device_neighbors (device_id, local_port, remote_device_name, remote_port, protocol, remote_ip, remote_mac, remote_platform, source, first_seen, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '-2 hours'), datetime('now', '-1 hours'))`);
  for (const n of rete.neighbors) {
    insVicino.run(n.device_id, n.local_port, n.remote_device_name, n.remote_port, n.protocol, n.remote_ip, n.remote_mac, n.remote_platform ?? null, n.source);
  }
}

let quanti = 0;
/** Un tenant nuovo col NAS per prova: le righe non si cancellano, ogni prova parte dal suo DB. */
function nuovoTenant(): string {
  const t = `TESTUNIONIROTTE${++quanti}`;
  carica(getTenantDb(t), nas());
  aperti.push(t);
  return t;
}
const righe = (t: string, tabella: "topology_unioni" | "topology_separazioni") =>
  getTenantDb(t).prepare(`SELECT * FROM ${tabella} ORDER BY id`).all() as Array<Record<string, unknown>>;
const modello = (t: string) => buildTopologyModel(withTenant(t, () => getTopologyModelInput(2, Date.parse("2026-10-16T10:00:00Z"))));
const NAS = { membri: ["host:11", "host:12", "host:13"] };

test("anteprima: 200 con `scritto: false` e il nodo che la mappa avrà; nessuna riga scritta", () => {
  const t = nuovoTenant();
  const r = withTenant(t, () => rispostaUnione({ ...NAS, applica: false }, "anna"));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, {
    nodo: "host:11", nome: "QWNAS-7", separazioniTolte: [], scritto: false,
    entrano: [{ id: "host:12", nome: "10.71.2.20", ip: "10.71.2.20", perche: "unito a mano" }, { id: "host:13", nome: "10.71.3.20", ip: "10.71.3.20", perche: "unito a mano" }],
  });
  assert.deepEqual([righe(t, "topology_unioni").length, righe(t, "topology_separazioni").length], [0, 0]);
  const m = modello(t);
  assert.deepEqual(["host:11", "host:12", "host:13"].map((id) => m.nodes.find((n) => n.id === id)?.fusedHostIds), [[], [], []], "senza righe tre nodi");
});

test("`applica: true`: tre righe con chi, il NAS un nodo nella mappa; lo stato da un suo indirizzo dice il nodo unito", () => {
  const t = nuovoTenant();
  const r = withTenant(t, () => rispostaUnione({ ...NAS, applica: true }, "anna"));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, {
    nodo: "host:11", nome: "QWNAS-7", separazioniTolte: [], scritto: true,
    entrano: [{ id: "host:12", nome: "10.71.2.20", ip: "10.71.2.20", perche: "unito a mano" }, { id: "host:13", nome: "10.71.3.20", ip: "10.71.3.20", perche: "unito a mano" }],
  });
  const u = righe(t, "topology_unioni");
  assert.deepEqual(u.map((x) => [x.gruppo, x.membro, x.creato_da, x.tolto_il]), [[1, "host:11", "anna", null], [1, "host:12", "anna", null], [1, "host:13", "anna", null]]);
  assert.ok(u.every((x) => typeof x.creato_il === "string" && x.creato_il !== ""));
  const m = modello(t);
  assert.deepEqual(m.nodes.find((n) => n.id === "host:11")?.fusedHostIds, [12, 13]);
  assert.equal(m.nodes.some((n) => n.id === "host:12" || n.id === "host:13"), false);
  const s = withTenant(t, () => rispostaStato("host:13"));
  assert.equal(s.status, 200, JSON.stringify(s.body));
  const stato = s.body as { nodo: string; disponibile: boolean; membri: Array<{ id: string; aMano: { da: string } | null }> };
  assert.equal(stato.nodo, "host:11");
  assert.equal(stato.disponibile, true);
  assert.deepEqual(stato.membri.map((x) => [x.id, x.aMano?.da ?? null]), [["host:11", "anna"], ["host:12", "anna"], ["host:13", "anna"]]);
  // Di nuovo la stessa unione: già lo stesso oggetto, niente scritto.
  const ancora = withTenant(t, () => rispostaUnione({ ...NAS, applica: true }, "anna"));
  assert.deepEqual([ancora.status, ancora.body], [409, { error: TESTI_UNIONI.giaStesso }]);
  assert.equal(righe(t, "topology_unioni").length, 3);
});

test("«Separa…»: l'anteprima non scrive; con `applica` l'indirizzo torna solo, la riga resta con `tolto_*`, le coppie con chi resta", () => {
  const t = nuovoTenant();
  withTenant(t, () => rispostaUnione({ ...NAS, applica: true }, "anna"));
  const corpo = { nodo: "host:11", membro: "host:13" };
  const atteso = {
    resta: { nodo: "host:11", nome: "QWNAS-7", membri: ["host:11", "host:12"] },
    escono: [{ nodo: "host:13", nome: "10.71.3.20", membri: ["host:13"] }],
  };
  const prova = withTenant(t, () => rispostaSeparazione({ ...corpo, applica: false }, "bruno"));
  assert.deepEqual([prova.status, prova.body], [200, { ...atteso, scritto: false }]);
  assert.equal(righe(t, "topology_unioni").filter((x) => x.tolto_il !== null).length, 0);
  assert.equal(righe(t, "topology_separazioni").length, 0);

  const r = withTenant(t, () => rispostaSeparazione({ ...corpo, applica: true }, "bruno"));
  assert.deepEqual([r.status, r.body], [200, { ...atteso, scritto: true }]);
  const u = righe(t, "topology_unioni");
  assert.equal(u.length, 3, "mai DELETE: la riga è la storia");
  const tolta = u.find((x) => x.membro === "host:13");
  assert.equal(tolta?.tolto_da, "bruno");
  assert.equal(typeof tolta?.tolto_il, "string");
  assert.deepEqual(righe(t, "topology_separazioni").map((x) => [x.membro, x.altro, x.creato_da]), [["host:13", "host:11", "bruno"], ["host:13", "host:12", "bruno"]]);
  const m = modello(t);
  assert.equal(m.canonical["host:13"] ?? "host:13", "host:13");
  assert.deepEqual(m.nodes.find((n) => n.id === "host:11")?.fusedHostIds, [12]);
});

test("400: un campo in più, `applica` mancante, un membro che non è «host:N»/«dev:N», un elenco fuori misura; niente scritto", () => {
  const t = nuovoTenant();
  const casi: Array<[unknown, string]> = [
    [{ ...NAS, applica: true, extra: 1 }, "Campo non previsto: «extra»"],
    [{ ...NAS }, "«applica» deve essere vero o falso"],
    [{ ...NAS, applica: "si" }, "«applica» deve essere vero o falso"],
    [{ membri: ["host:11", "vm:1:2"], applica: false }, "Oggetto non valido: «host:N» o «dev:N»"],
    [{ membri: ["host:11", "seg:1:2"], applica: false }, "Oggetto non valido: «host:N» o «dev:N»"],
    [{ membri: ["host:11", "host:0"], applica: false }, "Oggetto non valido: «host:N» o «dev:N»"],
    [{ membri: ["host:11"], applica: false }, "Servono almeno due oggetti"],
    [{ membri: Array.from({ length: 21 }, (_, i) => `host:${i + 1}`), applica: false }, "Al massimo 20 oggetti alla volta"],
    [{ membri: ["host:11", "host:11"], applica: false }, TESTI_UNIONI.doppio],
    [null, "Corpo della richiesta non valido"],
  ];
  for (const [corpo, errore] of casi) {
    const r = withTenant(t, () => rispostaUnione(corpo, "anna"));
    assert.deepEqual([r.status, r.body], [400, { error: errore }], JSON.stringify(corpo));
  }
  const separa: Array<[unknown, string]> = [
    [{ nodo: "host:11", membro: "host:12", applica: true, extra: 1 }, "Campo non previsto: «extra»"],
    [{ nodo: "host:11", membro: "host:12" }, "«applica» deve essere vero o falso"],
    [{ nodo: "host:11", membro: "dev:5", applica: false }, "Si separa un indirizzo: «host:N»"],
    [{ nodo: "vm:1:2", membro: "host:12", applica: false }, "Oggetto non valido: «host:N» o «dev:N»"],
  ];
  for (const [corpo, errore] of separa) {
    const r = withTenant(t, () => rispostaSeparazione(corpo, "anna"));
    assert.deepEqual([r.status, r.body], [400, { error: errore }], JSON.stringify(corpo));
  }
  for (const o of [null, "", "vm:1:2", "seg:1:2", "host:abc"]) assert.equal(withTenant(t, () => rispostaStato(o)).status, 400, String(o));
  assert.equal(withTenant(t, () => rispostaCandidati(null, "sw")).status, 400);
  assert.equal(withTenant(t, () => rispostaCandidati("host:12", "x".repeat(101))).status, 400);
  assert.deepEqual([righe(t, "topology_unioni").length, righe(t, "topology_separazioni").length], [0, 0]);
});

test("tabelle assenti: le scritture (anche l'anteprima) 409 `schemaAssente`; lo stato dice `disponibile: false`", () => {
  const t = nuovoTenant();
  getTenantDb(t).exec("DROP TABLE topology_unioni; DROP TABLE topology_separazioni;");
  assert.equal(withTenant(t, () => rileggiSchemaUnioni()), false);
  for (const applica of [false, true]) {
    const r = withTenant(t, () => rispostaUnione({ ...NAS, applica }, "anna"));
    assert.deepEqual([r.status, r.body], [409, { error: TESTI_UNIONI.schemaAssente }], `applica ${applica}`);
    const s = withTenant(t, () => rispostaSeparazione({ nodo: "host:11", membro: "host:12", applica }, "anna"));
    assert.deepEqual([s.status, s.body], [409, { error: TESTI_UNIONI.schemaAssente }], `separa, applica ${applica}`);
  }
  const s = withTenant(t, () => rispostaStato("host:13"));
  assert.equal(s.status, 200, JSON.stringify(s.body));
  assert.deepEqual([(s.body as { nodo: string }).nodo, (s.body as { disponibile: boolean }).disponibile], ["host:13", false]);
});

test("una riga da togliere già tolta nel frattempo: 409 `cambiato`, e niente scritto", () => {
  const t = nuovoTenant();
  withTenant(t, () => rispostaUnione({ ...NAS, applica: true }, "anna"));
  // Le righe come le aveva letto chi ha aperto il dialogo; poi un altro separa host:13.
  const vecchie = withTenant(t, () => getRigheScelte());
  withTenant(t, () => rispostaSeparazione({ nodo: "host:11", membro: "host:13", applica: true }, "bruno"));
  const prima = { u: righe(t, "topology_unioni"), s: righe(t, "topology_separazioni") };
  const r = withTenant(t, () => rispostaSeparazione({ nodo: "host:11", membro: "host:13", applica: true }, "carla", { ...FONTI_UNIONI, righe: () => vecchie }));
  assert.deepEqual([r.status, r.body], [409, { error: TESTI_UNIONI.cambiato }]);
  assert.deepEqual({ u: righe(t, "topology_unioni"), s: righe(t, "topology_separazioni") }, prima, "la transazione non ha lasciato niente");
});

test("candidati per nome e per IP, dalla partenza; meno di 2 caratteri niente; una partenza che non c'è 404", () => {
  const t = nuovoTenant();
  const nome = withTenant(t, () => rispostaCandidati("host:12", "sw-gam"));
  assert.deepEqual([nome.status, nome.body], [200, { candidati: [{ id: "dev:3", nome: "SW-GAMMA", tipo: "apparato", indirizzi: ["10.71.3.2"], bloccato: null }], altri: 0 }]);
  const ip = withTenant(t, () => rispostaCandidati("host:12", "10.71.3.20"));
  assert.equal(ip.status, 200);
  assert.deepEqual((ip.body as { candidati: Array<{ id: string }> }).candidati.map((c) => c.id), ["host:13"]);
  for (const q of [null, "", "s"]) assert.deepEqual(withTenant(t, () => rispostaCandidati("host:12", q)).body, { candidati: [], altri: 0 }, String(q));
  const via = withTenant(t, () => rispostaCandidati("host:99", "sw"));
  assert.deepEqual([via.status, via.body], [404, { error: TESTI_UNIONI.nonTrovato("host:99") }]);
});
