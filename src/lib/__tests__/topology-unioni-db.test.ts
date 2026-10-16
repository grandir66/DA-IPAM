// Unioni e separazioni a mano sul DB del cliente (piano 2026-10-16, Task 2; ADR 0021): le righe attive (`tolto_il IS NULL`)
// entrano nell'ingresso del modello SOLO se ci sono (senza righe le chiavi `unioni`/`separazioni` non esistono: l'ordine delle
// chiavi e le impronte di oggi restano, «Scelte» 8); togliere non cancella mai (la riga è la storia: chi e quando); un piano si
// scrive in una transazione sola, e se una riga da togliere non è più attiva non si scrive niente (`UnioniCambiate`). I tenant
// di prova come in topologia-t3-freno.test.ts: uno per prova, la famiglia 1 delle reti-campione scritta riga per riga.
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { closeHubDb } from "@/lib/db-hub";
import {
  UnioniCambiate, deleteTenantDatabase, getIngressoNodi, getRigheScelte, getTenantDb, getTopologyModelInput, migrateTopologyUnioni, rileggiSchemaUnioni,
  schemaUnioniPresente, scriviPianoUnioni, withTenant,
} from "@/lib/db-tenant";
import type { TopologyModelInput } from "@/lib/topology/model-types";
import { TESTI_UNIONI, type PianoUnioni } from "@/lib/topology/unioni-tipi";
import { soloMikrotik } from "@/lib/topology/__tests__/support/reti-campione";
import { serializza } from "@/lib/topology/__tests__/support/impronta";

const aperti: string[] = [];
after(() => { for (const t of aperti) deleteTenantDatabase(t); closeHubDb(); removeTestHubDb(); });

let quanti = 0;
/** Un tenant nuovo per prova: le righe non si cancellano, quindi ogni prova parte dal suo DB. */
function nuovoTenant(): string {
  const t = `TESTUNIONIDB${++quanti}`;
  getTenantDb(t);
  aperti.push(t);
  return t;
}

/** Un solo «adesso» per tutta la prova. */
const ORA = Date.parse("2026-10-16T10:00:00Z");
const piano = (p: Partial<PianoUnioni>): PianoUnioni => ({ togliUnioni: [], togliSeparazioni: [], aggiungiUnioni: [], aggiungiSeparazioni: [], ...p });
const ingresso = (t: string): TopologyModelInput => withTenant(t, () => getTopologyModelInput(2, ORA));
const scrivi = (t: string, p: Partial<PianoUnioni>, da = "anna", adesso?: string): void => withTenant(t, () => scriviPianoUnioni(piano(p), da, adesso));
const righe = (t: string, tabella: "topology_unioni" | "topology_separazioni") =>
  getTenantDb(t).prepare(`SELECT * FROM ${tabella} ORDER BY id`).all() as Array<Record<string, unknown>>;
const idDi = (t: string, tabella: "topology_unioni" | "topology_separazioni", membro: string): number =>
  (getTenantDb(t).prepare(`SELECT id FROM ${tabella} WHERE membro = ? AND tolto_il IS NULL`).get(membro) as { id: number }).id;
/** L'ingresso senza le due chiavi nuove: il resto deve restare quello di prima. */
const senzaScelte = (i: TopologyModelInput): Omit<TopologyModelInput, "unioni" | "separazioni"> => {
  const resto: Partial<TopologyModelInput> = { ...i };
  delete resto.unioni;
  delete resto.separazioni;
  return resto as Omit<TopologyModelInput, "unioni" | "separazioni">;
};

/** Scrive nel tenant la rete (apparati, reti, host, porte, vicini), come `carica` di topologia-t3-freno.test.ts senza i fatti di T2. */
function carica(db: Database.Database, rete: TopologyModelInput): void {
  for (const n of rete.networks) db.prepare("INSERT INTO networks (id, cidr, name, gateway) VALUES (?, ?, ?, ?)").run(n.id, n.cidr, n.name, n.gateway);
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
  for (const k of rete.knownMacs) db.prepare("UPDATE network_devices SET host_id = (SELECT id FROM hosts WHERE mac = ?) WHERE id = ? AND host_id IS NULL").run(k.mac, k.device_id);
  for (const p of rete.ports ?? []) {
    db.prepare("INSERT INTO switch_ports (device_id, port_index, port_name, status, speed, stp_state) VALUES (?, ?, ?, ?, ?, ?)").run(p.device_id, p.port_index, p.port_name, p.status, p.speed, p.stp_state);
  }
  const insVicino = db.prepare(`INSERT INTO device_neighbors (device_id, local_port, remote_device_name, remote_port, protocol, remote_ip, remote_mac, remote_platform, source, first_seen, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '-2 hours'), datetime('now', '-1 hours'))`);
  for (const n of rete.neighbors) {
    insVicino.run(n.device_id, n.local_port, n.remote_device_name, n.remote_port, n.protocol, n.remote_ip, n.remote_mac, n.remote_platform ?? null, n.source);
  }
}

test("senza righe: l'ingresso del modello e quello dei nodi NON hanno `unioni` né `separazioni`; l'ultima chiave resta `staleDays`", () => {
  const t = nuovoTenant();
  assert.equal(withTenant(t, () => schemaUnioniPresente()), true);
  const input = ingresso(t);
  assert.deepEqual(["unioni" in input, "separazioni" in input], [false, false]);
  assert.deepEqual(Object.keys(input).slice(-1), ["staleDays"]);
  assert.deepEqual(Object.keys(withTenant(t, () => getIngressoNodi())), ["devices", "hosts", "knownMacs", "neighbors"]);
  assert.deepEqual(withTenant(t, () => getRigheScelte()), { unioni: [], separazioni: [] });
});

test("con righe: le chiavi ci sono, in fondo e ciascuna solo se ha righe, ordinate, senza le tolte; il resto dell'ingresso non si muove", () => {
  const t = nuovoTenant();
  const prima = ingresso(t);
  // Solo una separazione: c'è `separazioni`, non `unioni`.
  scrivi(t, { aggiungiSeparazioni: [{ membro: "host:30", altro: "dev:3" }] }, "anna", "2026-10-16 08:00:00");
  const soloSep = ingresso(t);
  assert.deepEqual(Object.keys(soloSep).slice(-2), ["staleDays", "separazioni"]);
  assert.equal("unioni" in soloSep, false);

  scrivi(t, {
    aggiungiUnioni: [{ gruppo: "nuovo", membro: "host:12" }, { gruppo: "nuovo", membro: "host:11" }],
    aggiungiSeparazioni: [{ membro: "host:20", altro: "host:9" }, { membro: "host:20", altro: "dev:3" }],
  }, "anna", "2026-10-16 08:30:00");
  scrivi(t, { aggiungiUnioni: [{ gruppo: "nuovo", membro: "host:2" }, { gruppo: "nuovo", membro: "dev:4" }] }, "bruno", "2026-10-16 09:00:00");
  scrivi(t, { togliUnioni: [idDi(t, "topology_unioni", "host:2")] }, "bruno", "2026-10-16 09:30:00");

  const input = ingresso(t);
  assert.deepEqual(Object.keys(input).slice(-3), ["staleDays", "unioni", "separazioni"]);
  assert.deepEqual(input.unioni, [{ gruppo: 1, membro: "host:11" }, { gruppo: 1, membro: "host:12" }, { gruppo: 2, membro: "dev:4" }], "per gruppo e membro, senza la tolta");
  assert.deepEqual(input.separazioni, [{ membro: "host:20", altro: "dev:3" }, { membro: "host:20", altro: "host:9" }, { membro: "host:30", altro: "dev:3" }]);
  assert.equal(serializza(senzaScelte(input)), serializza(prima), "il resto dell'ingresso è quello di prima");

  // Le righe attive per le rotte: con chi e quando, nello stesso ordine.
  const r = withTenant(t, () => getRigheScelte());
  assert.deepEqual(r.unioni.map(({ gruppo, membro, creato_da, creato_il }) => [gruppo, membro, creato_da, creato_il]), [
    [1, "host:11", "anna", "2026-10-16 08:30:00"], [1, "host:12", "anna", "2026-10-16 08:30:00"], [2, "dev:4", "bruno", "2026-10-16 09:00:00"],
  ]);
  assert.deepEqual(r.separazioni.map(({ membro, altro, creato_da }) => [membro, altro, creato_da]), [
    ["host:20", "dev:3", "anna"], ["host:20", "host:9", "anna"], ["host:30", "dev:3", "anna"],
  ]);
  assert.ok(r.unioni.every((x) => Number.isInteger(x.id)) && r.separazioni.every((x) => Number.isInteger(x.id)));
  assert.deepEqual(Object.keys(r.unioni[0]).sort(), ["creato_da", "creato_il", "gruppo", "id", "membro"], "niente colonne della storia nelle righe attive");

  // L'ingresso dei nodi porta le stesse righe.
  const nodi = withTenant(t, () => getIngressoNodi());
  assert.deepEqual([nodi.unioni, nodi.separazioni], [input.unioni, input.separazioni]);
});

test("togliere non cancella: la riga resta con chi e quando l'ha tolta; tolte tutte, l'ingresso è di nuovo quello di prima, bit per bit", () => {
  const t = nuovoTenant();
  const prima = ingresso(t);
  scrivi(t, { aggiungiUnioni: [{ gruppo: "nuovo", membro: "host:11" }, { gruppo: "nuovo", membro: "host:12" }], aggiungiSeparazioni: [{ membro: "host:13", altro: "dev:5" }] }, "anna", "2026-10-16 08:00:00");
  const ids = { u: righe(t, "topology_unioni").map((x) => Number(x.id)), s: righe(t, "topology_separazioni").map((x) => Number(x.id)) };
  scrivi(t, { togliUnioni: ids.u, togliSeparazioni: ids.s }, "bruno", "2026-10-16 09:00:00");
  assert.deepEqual(righe(t, "topology_unioni").map((x) => [x.membro, x.creato_da, x.creato_il, x.tolto_da, x.tolto_il]), [
    ["host:11", "anna", "2026-10-16 08:00:00", "bruno", "2026-10-16 09:00:00"],
    ["host:12", "anna", "2026-10-16 08:00:00", "bruno", "2026-10-16 09:00:00"],
  ]);
  assert.deepEqual(righe(t, "topology_separazioni").map((x) => [x.membro, x.altro, x.tolto_da, x.tolto_il]), [["host:13", "dev:5", "bruno", "2026-10-16 09:00:00"]]);
  assert.deepEqual(withTenant(t, () => getRigheScelte()), { unioni: [], separazioni: [] });
  assert.equal(serializza(ingresso(t)), serializza(prima), "«Separa…» di ogni membro: la mappa di prima");
});

test("gruppo nuovo: MAX(gruppo) + 1 una volta per tutto il piano, contando anche le righe tolte (un numero non torna)", () => {
  const t = nuovoTenant();
  scrivi(t, { aggiungiUnioni: [{ gruppo: "nuovo", membro: "host:1" }, { gruppo: "nuovo", membro: "host:2" }] });
  scrivi(t, { aggiungiUnioni: [{ gruppo: 7, membro: "host:3" }, { gruppo: 7, membro: "host:4" }] });
  scrivi(t, { togliUnioni: [idDi(t, "topology_unioni", "host:3"), idDi(t, "topology_unioni", "host:4")] });
  scrivi(t, { aggiungiUnioni: [{ gruppo: "nuovo", membro: "host:5" }, { gruppo: 1, membro: "host:6" }, { gruppo: "nuovo", membro: "host:7" }] });
  assert.deepEqual(withTenant(t, () => getRigheScelte()).unioni.map((x) => [x.gruppo, x.membro]), [
    [1, "host:1"], [1, "host:2"], [1, "host:6"], [8, "host:5"], [8, "host:7"],
  ]);
  // Senza nessuna riga il primo gruppo è 1.
  const v = nuovoTenant();
  scrivi(v, { aggiungiUnioni: [{ gruppo: "nuovo", membro: "dev:1" }, { gruppo: "nuovo", membro: "host:9" }] });
  assert.deepEqual(withTenant(v, () => getRigheScelte()).unioni.map((x) => x.gruppo), [1, 1]);
});

test("gli indici unici: un membro attivo in un gruppo solo, una coppia attiva una volta; il piano rifiutato non scrive niente; una riga tolta non occupa il posto", () => {
  const t = nuovoTenant();
  scrivi(t, { aggiungiUnioni: [{ gruppo: "nuovo", membro: "host:1" }, { gruppo: "nuovo", membro: "host:2" }], aggiungiSeparazioni: [{ membro: "host:3", altro: "dev:1" }] });
  const u = righe(t, "topology_unioni"), s = righe(t, "topology_separazioni");
  assert.throws(() => scrivi(t, { togliUnioni: [idDi(t, "topology_unioni", "host:2")], aggiungiUnioni: [{ gruppo: 5, membro: "host:1" }] }), /UNIQUE/);
  assert.throws(() => scrivi(t, { aggiungiSeparazioni: [{ membro: "host:3", altro: "dev:1" }] }), /UNIQUE/);
  assert.deepEqual([righe(t, "topology_unioni"), righe(t, "topology_separazioni")], [u, s], "niente tolto, niente aggiunto");
  // Togliere e rimettere nello stesso piano: si toglie prima di aggiungere, e la riga tolta resta accanto alla nuova.
  scrivi(t, { togliUnioni: [idDi(t, "topology_unioni", "host:1")], aggiungiUnioni: [{ gruppo: 5, membro: "host:1" }] });
  scrivi(t, { togliSeparazioni: [idDi(t, "topology_separazioni", "host:3")], aggiungiSeparazioni: [{ membro: "host:3", altro: "dev:1" }] });
  assert.deepEqual(righe(t, "topology_unioni").map((x) => [x.gruppo, x.membro, x.tolto_il === null]), [[1, "host:1", false], [1, "host:2", true], [5, "host:1", true]]);
  assert.deepEqual(righe(t, "topology_separazioni").map((x) => [x.membro, x.altro, x.tolto_il === null]), [["host:3", "dev:1", false], ["host:3", "dev:1", true]]);
});

test("una riga da togliere già tolta, o che non c'è: UnioniCambiate, e niente del piano è scritto", () => {
  const t = nuovoTenant();
  scrivi(t, { aggiungiUnioni: [{ gruppo: "nuovo", membro: "host:1" }, { gruppo: "nuovo", membro: "host:2" }], aggiungiSeparazioni: [{ membro: "host:3", altro: "dev:1" }] });
  const tolta = idDi(t, "topology_unioni", "host:2");
  scrivi(t, { togliUnioni: [tolta] }, "bruno");
  const prima = [righe(t, "topology_unioni"), righe(t, "topology_separazioni")];
  const cambiate = (e: unknown): boolean => e instanceof UnioniCambiate && e.message === TESTI_UNIONI.cambiato;
  // La riga attiva prima della tolta: il suo UPDATE è già fatto quando la tolta fa saltare il piano, e va annullato.
  assert.throws(() => scrivi(t, {
    togliUnioni: [idDi(t, "topology_unioni", "host:1"), tolta], togliSeparazioni: [idDi(t, "topology_separazioni", "host:3")],
    aggiungiUnioni: [{ gruppo: "nuovo", membro: "host:9" }, { gruppo: "nuovo", membro: "host:8" }],
  }, "carla"), cambiate);
  assert.throws(() => scrivi(t, { togliUnioni: [9999] }, "carla"), cambiate, "un id che non c'è");
  assert.throws(() => scrivi(t, { togliSeparazioni: [idDi(t, "topology_separazioni", "host:3"), 9999], aggiungiSeparazioni: [{ membro: "host:4", altro: "dev:1" }] }, "carla"), cambiate);
  assert.deepEqual([righe(t, "topology_unioni"), righe(t, "topology_separazioni")], prima, "tutto annullato");
});

test("un membro che non è «host:N» o «dev:N» (in una separazione `membro` solo «host:N»), o un gruppo che non è un intero positivo, non si scrive, e il piano non lascia niente", () => {
  const t = nuovoTenant();
  scrivi(t, { aggiungiUnioni: [{ gruppo: "nuovo", membro: "host:1" }, { gruppo: "nuovo", membro: "host:2" }] });
  const prima = [righe(t, "topology_unioni"), righe(t, "topology_separazioni")];
  for (const p of [
    { aggiungiUnioni: [{ gruppo: "nuovo" as const, membro: "host:3" }, { gruppo: "nuovo" as const, membro: "vm:3" }] },
    { aggiungiUnioni: [{ gruppo: 1, membro: "host:0" }] },
    { aggiungiUnioni: [{ gruppo: 1, membro: "host:12345678901" }] },
    { aggiungiUnioni: [{ gruppo: 1, membro: " host:3" }] },
    { togliUnioni: [idDi(t, "topology_unioni", "host:1")], aggiungiSeparazioni: [{ membro: "dev:3", altro: "host:1" }] },
    { aggiungiSeparazioni: [{ membro: "host:3", altro: "seg:1" }] },
    // I gruppi negativi sono quelli in memoria della misura sulle copie: nel DB mai.
    { aggiungiUnioni: [{ gruppo: -1, membro: "host:3" }, { gruppo: -1, membro: "host:4" }] },
    { aggiungiUnioni: [{ gruppo: 0, membro: "host:3" }] },
    { aggiungiUnioni: [{ gruppo: 1.5, membro: "host:3" }] },
  ]) {
    assert.throws(() => scrivi(t, p), /non valido/, JSON.stringify(p));
  }
  assert.deepEqual([righe(t, "topology_unioni"), righe(t, "topology_separazioni")], prima);
});

test("senza «adesso» si scrive l'ora UTC del DB, nella forma di datetime('now')", () => {
  const t = nuovoTenant();
  scrivi(t, { aggiungiUnioni: [{ gruppo: "nuovo", membro: "host:1" }, { gruppo: "nuovo", membro: "host:2" }] });
  const ora = (getTenantDb(t).prepare("SELECT datetime('now') AS o").get() as { o: string }).o;
  const [r] = withTenant(t, () => getRigheScelte()).unioni;
  assert.match(r.creato_il, /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
  assert.ok(Math.abs(Date.parse(`${r.creato_il}Z`) - Date.parse(`${ora}Z`)) < 60_000, `${r.creato_il} ~ ${ora}`);
});

test("tabelle tolte (o un indice): schema assente, righe vuote, nessuna chiave nell'ingresso — la mappa di oggi", () => {
  const t = nuovoTenant();
  const prima = ingresso(t);
  scrivi(t, { aggiungiUnioni: [{ gruppo: "nuovo", membro: "host:11" }, { gruppo: "nuovo", membro: "host:12" }], aggiungiSeparazioni: [{ membro: "host:13", altro: "dev:5" }] });
  assert.ok("unioni" in ingresso(t));
  const db = getTenantDb(t);
  db.exec("DROP TABLE topology_unioni; DROP TABLE topology_separazioni");
  assert.equal(withTenant(t, () => rileggiSchemaUnioni()), false);
  assert.equal(withTenant(t, () => schemaUnioniPresente()), false);
  assert.deepEqual(withTenant(t, () => getRigheScelte()), { unioni: [], separazioni: [] });
  assert.equal(serializza(ingresso(t)), serializza(prima));
  assert.deepEqual(Object.keys(withTenant(t, () => getIngressoNodi())), ["devices", "hosts", "knownMacs", "neighbors"]);
  // Rimesse dalla migrazione: di nuovo presenti. Senza l'indice unico dei membri lo schema non c'è (è la regola «un membro
  // attivo in un gruppo solo»).
  migrateTopologyUnioni(db);
  assert.equal(withTenant(t, () => rileggiSchemaUnioni()), true);
  db.exec("DROP INDEX idx_topology_unioni_membro_attivo");
  assert.equal(withTenant(t, () => rileggiSchemaUnioni()), false);
});

test("getIngressoNodi: gli stessi quattro campi di getTopologyModelInput, testo per testo, sulla famiglia 1", () => {
  const t = nuovoTenant();
  carica(getTenantDb(t), soloMikrotik());
  const quattro = (i: Pick<TopologyModelInput, "devices" | "hosts" | "knownMacs" | "neighbors">): string =>
    serializza({ devices: i.devices, hosts: i.hosts, knownMacs: i.knownMacs, neighbors: i.neighbors });
  const input = ingresso(t);
  assert.ok([input.devices, input.hosts, input.knownMacs, input.neighbors].every((x) => x.length > 0), "non è un confronto di elenchi vuoti");
  const nodi = withTenant(t, () => getIngressoNodi());
  assert.equal(quattro(nodi), quattro(input));
  assert.equal(serializza(nodi), quattro(input), "nello stesso ordine, e senza altro");
});

// Vincolo del piano («Dato»): togliere è `tolto_da`/`tolto_il`, mai un DELETE. Chi scriverà le rotte non deve poterlo
// dimenticare: nessun file di codice lo contiene (la prova legge i file, come no-dynamic-db-tenant-import.test.ts).
test("mai DELETE sulle due tabelle: nessun file sotto src/ o scripts/ lo scrive", () => {
  const VIETATO = /DELETE\s+FROM\s+["`]?topology_(unioni|separazioni)\b/i;
  const trovati: string[] = [];
  const visita = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== "node_modules") visita(p); continue; }
      if (/\.(ts|tsx|js|mjs|cjs|sql)$/.test(e.name) && VIETATO.test(fs.readFileSync(p, "utf8"))) trovati.push(path.relative(process.cwd(), p));
    }
  };
  for (const d of ["src", "scripts"]) visita(path.join(process.cwd(), d));
  assert.deepEqual(trovati, []);
});
