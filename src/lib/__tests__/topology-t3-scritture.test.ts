// T3, Task 8 (spec §13.9, piano di T3 «Scelte» 10): le scritture coi valori nuovi nel DB del cliente. «core» e «accesso»
// nel ruolo, «tunnel» nel tipo di un collegamento a mano (colonne senza CHECK: le valida Zod), e la ★ che con la mappa
// nuova accesa non cade più per coppia quando si toglie un collegamento a mano: cade solo quella con le stesse porte.
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { closeHubDb } from "@/lib/db-hub";
import {
  addLinkOverride, deleteLinkOverride, deleteTenantDatabase, getTenantDb, listLinkOverrides, listTopologyLinkPrimaries,
  setTopologyLinkPrimary, setTopologyRole, updateLinkOverride, withTenant,
} from "@/lib/db-tenant";
import { mappaCaviAccesa, scriviMappaCavi } from "@/lib/topology/letture/mappa";

const T = "TESTT3SCRITTURE";
const db = () => getTenantDb(T);
const w = <R>(fn: () => R): R => withTenant(T, fn);

beforeEach(() => {
  db().exec("DELETE FROM topology_link_overrides; DELETE FROM topology_link_primary; DELETE FROM network_devices; DELETE FROM tenant_settings WHERE key LIKE 'topologia.%';");
  db().exec("INSERT INTO network_devices (id, name, host, device_type, vendor, protocol) VALUES (1, 'core 1', '192.0.2.1', 'switch', 'other', 'snmp_v2')");
});
after(() => {
  deleteTenantDatabase(T);
  closeHubDb();
  removeTestHubDb();
});

/** Un collegamento a mano A:ether2 ↔ B:Port 2 fra dev:1 e dev:2. */
const aggiungi = () => w(() => addLinkOverride({ action: "add", a_node: "dev:1", a_port: "ether2", b_node: "dev:2", b_port: "Port 2", medium: null, note: null }, "prova"));
const stella = (node_id: string, other_node: string, node_port: string, other_port: string) =>
  w(() => setTopologyLinkPrimary({ node_id, other_node, node_port, other_port }, "prova"));
const stelle = () => w(() => listTopologyLinkPrimaries()).map((p) => `${p.node_id}>${p.other_node} ${p.node_port}/${p.other_port}`);

test("ruolo nella mappa da T3 (§13.9): si scrivono «core» e «accesso»", () => {
  const ruolo = () => db().prepare("SELECT topology_role FROM network_devices WHERE id = 1").pluck().get();
  assert.deepEqual(w(() => setTopologyRole(1, "core")), { ok: true });
  assert.equal(ruolo(), "core");
  assert.deepEqual(w(() => setTopologyRole(1, "accesso")), { ok: true });
  assert.equal(ruolo(), "accesso");
  assert.equal(w(() => setTopologyRole(99, "core")).ok, false, "un apparato che non c'è");
});

test("tipo «tunnel» di un collegamento a mano: si scrive e si modifica (nessun CHECK nel DB)", () => {
  const id = w(() => addLinkOverride({ action: "add", a_node: "dev:1", a_port: "eoip-1", b_node: "dev:2", b_port: "eoip-1", medium: "tunnel", note: null }, "prova"));
  assert.equal(w(() => listLinkOverrides()).find((o) => o.id === id)?.medium, "tunnel");
  assert.equal(w(() => updateLinkOverride(id, { medium: "cavo" })), "ok");
  assert.equal(w(() => updateLinkOverride(id, { medium: "tunnel" })), "ok");
  assert.equal(w(() => listLinkOverrides()).find((o) => o.id === id)?.medium, "tunnel");
});

// ADR 0010 N-2 superato (§13.9, «Scelte» 10): con la mappa nuova la ★ è per collegamento. Togliere il collegamento a mano
// A:ether2 ↔ B:Port 2 toglie la ★ di quel cavo, in tutti e due i versi; una ★ della stessa coppia su altre porte, o senza
// porte, resta (vale per il migliore della coppia e i dettagli lo dicono, caso 2 del piano). Le porte non sono mai NULL:
// una correzione SENZA porte toglie la ★ senza porte della coppia, che è quella del suo cavo (revisione del Task 8).
test("perCavo: cade solo la ★ con le stesse porte, in tutti e due i versi; le altre della coppia restano", () => {
  const id = aggiungi();
  stella("dev:1", "dev:2", "ether3", "Port 3");
  stella("dev:2", "dev:1", "Port 2", "ether2");
  stella("dev:5", "dev:1", "Port 9", "ether2");
  assert.equal(w(() => deleteLinkOverride(id, { perCavo: true })), true);
  assert.deepEqual(stelle(), ["dev:1>dev:2 ether3/Port 3", "dev:5>dev:1 Port 9/ether2"]);

  const id2 = aggiungi();
  stella("dev:1", "dev:2", "ether2", "Port 2");
  assert.equal(w(() => deleteLinkOverride(id2, { perCavo: true })), true);
  assert.deepEqual(stelle(), ["dev:5>dev:1 Port 9/ether2"], "la ★ di dev:1 con le stesse porte, scritta dall'altro capo");
});

test("perCavo: una ★ della coppia senza porte resta; ripristinare un «ignora» non tocca le ★", () => {
  const id = aggiungi();
  stella("dev:1", "dev:2", "", "");
  assert.equal(w(() => deleteLinkOverride(id, { perCavo: true })), true);
  assert.deepEqual(stelle(), ["dev:1>dev:2 /"]);
  const ign = w(() => addLinkOverride({ action: "ignore", a_node: "dev:1", a_port: "", b_node: "dev:2", b_port: "", medium: null, note: null }, "prova"));
  assert.equal(w(() => deleteLinkOverride(ign, { perCavo: true })), true);
  assert.deepEqual(stelle(), ["dev:1>dev:2 /"]);
  assert.equal(w(() => deleteLinkOverride(ign, { perCavo: true })), false, "una correzione che non c'è più");
});

test("perCavo: una correzione senza porte toglie la ★ senza porte della coppia (è quella del suo cavo: M-3)", () => {
  const id = w(() => addLinkOverride({ action: "add", a_node: "dev:1", a_port: "", b_node: "dev:2", b_port: "", medium: null, note: null }, "prova"));
  stella("dev:2", "dev:1", "", "");
  stella("dev:1", "dev:2", "ether3", "Port 3");
  assert.equal(w(() => deleteLinkOverride(id, { perCavo: true })), true);
  assert.deepEqual(stelle(), ["dev:1>dev:2 ether3/Port 3"], "cade la ★ senza porte (anche scritta dall'altro capo), resta quella su altre porte");
});

test("senza opzioni, come oggi (M-3): ogni ★ della coppia cade, qualunque porta abbia", () => {
  const id = aggiungi();
  stella("dev:1", "dev:2", "ether3", "Port 3");
  stella("dev:2", "dev:1", "", "");
  assert.equal(w(() => deleteLinkOverride(id)), true);
  assert.deepEqual(stelle(), []);
});

test("l'interruttore decide: accesa la mappa nuova, la ★ su altre porte resta; spenta, cade", () => {
  const togli = (id: number) => w(() => deleteLinkOverride(id, { perCavo: mappaCaviAccesa() }));
  w(() => scriviMappaCavi(true, "prova"));
  stella("dev:1", "dev:2", "ether3", "Port 3");
  assert.equal(togli(aggiungi()), true);
  assert.deepEqual(stelle(), ["dev:1>dev:2 ether3/Port 3"], "accesa");
  w(() => scriviMappaCavi(false, "prova"));
  assert.equal(togli(aggiungi()), true);
  assert.deepEqual(stelle(), [], "spenta: come oggi");
});

// La rotta non si esegue nelle prove (requireAdmin legge la sessione, «Scelte» 13 del piano): il lucchetto sul sorgente
// dice che DELETE passa l'interruttore, e la prova qui sopra che cosa fa con quel valore.
test("DELETE /api/topology/links/[id] passa l'interruttore della mappa nuova a deleteLinkOverride", () => {
  const src = readFileSync(join(process.cwd(), "src/app/api/topology/links/[id]/route.ts"), "utf8");
  const del = src.slice(src.search(/export\s+async\s+function\s+DELETE\b/));
  assert.match(del, /deleteLinkOverride\(id, \{ perCavo: mappaCaviAccesa\(\) \}\)/);
  assert.match(src, /import \{ mappaCaviAccesa \} from "@\/lib\/topology\/letture\/mappa";/);
});
