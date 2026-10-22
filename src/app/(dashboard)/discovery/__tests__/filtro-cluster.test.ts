/**
 * Discovery: una riga per apparato fisico (piano 2026-10-22 accorpamento, Task 5). Gli IP secondari di un cluster
 * non hanno riga propria; la ricerca li trova comunque (sulla riga principale); col filtro «Rete» ogni IP resta nella
 * sua rete; i contatori dicono cosa contano.
 *
 * Run: node --import tsx --test "src/app/(dashboard)/discovery/__tests__/filtro-cluster.test.ts"
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { InfoClusterDiscovery } from "@/lib/devices/cluster-discovery";
import { contatoriDiscovery, vistaRiga } from "../filtro-cluster";

const altro = (host_id: number, ip: string, network_id: number) => ({ host_id, ip, network_id, network_name: `rete-${network_id}`, status: "online" });
const principale: InfoClusterDiscovery = {
  physical_device_id: 1, principale: true, principale_host_id: 10,
  altri: [altro(11, "192.0.2.254", 2), altro(12, "198.51.100.254", 3)],
};
const secondario: InfoClusterDiscovery = { physical_device_id: 1, principale: false, principale_host_id: 10, altri: [] };

const senzaFiltri = { testo: "", reteId: null };
const contiene = (q: string) => (t: string) => t.toLowerCase().includes(q.toLowerCase());
const riga = (id: number, network_id: number, cluster: InfoClusterDiscovery | null | undefined, testoRiga = `host-${id}`) => ({ id, network_id, cluster, testoRiga });

describe("vistaRiga", () => {
  it("host senza cluster: invariato, con e senza filtri", () => {
    assert.deepEqual(vistaRiga(riga(1, 1, null), senzaFiltri, contiene("")), { visibile: true, trovataComeSecondario: null });
    assert.deepEqual(vistaRiga(riga(1, 1, undefined), senzaFiltri, contiene("")), { visibile: true, trovataComeSecondario: null });
    assert.equal(vistaRiga(riga(1, 1, null), { testo: "zzz", reteId: null }, contiene("zzz")).visibile, false);
    assert.equal(vistaRiga(riga(1, 1, null), { testo: "", reteId: "2" }, contiene("")).visibile, false);
  });
  it("la riga principale resta, la secondaria è nascosta", () => {
    assert.deepEqual(vistaRiga(riga(10, 1, principale), senzaFiltri, contiene("")), { visibile: true, trovataComeSecondario: null });
    assert.deepEqual(vistaRiga(riga(11, 2, secondario), senzaFiltri, contiene("")), { visibile: false });
  });
  it("col filtro della sua rete la secondaria compare; col filtro di un'altra no", () => {
    assert.equal(vistaRiga(riga(11, 2, secondario), { testo: "", reteId: "2" }, contiene("")).visibile, true);
    assert.equal(vistaRiga(riga(11, 2, secondario), { testo: "", reteId: "1" }, contiene("")).visibile, false);
  });
  it("la principale non compare nel filtro di una rete che non è la sua", () => {
    assert.equal(vistaRiga(riga(10, 1, principale), { testo: "", reteId: "2" }, contiene("")).visibile, false);
  });
  it("ricerca di un IP secondario: compare la principale con l'IP trovato", () => {
    const q = "198.51.100.254";
    const v = vistaRiga(riga(10, 1, principale, "192.0.2.1 core"), { testo: q, reteId: null }, contiene(q));
    assert.deepEqual(v, { visibile: true, trovataComeSecondario: "198.51.100.254" });
    assert.deepEqual(vistaRiga(riga(12, 3, secondario, "198.51.100.254"), { testo: q, reteId: null }, contiene(q)), { visibile: false });
  });
  it("se la principale corrisponde da sola, niente scritta", () => {
    const v = vistaRiga(riga(10, 1, principale, "192.0.2.1 core"), { testo: "core", reteId: null }, contiene("core"));
    assert.deepEqual(v, { visibile: true, trovataComeSecondario: null });
  });
  it("ricerca che non corrisponde a nessun IP: nascosta", () => {
    assert.equal(vistaRiga(riga(10, 1, principale, "core"), { testo: "nulla", reteId: null }, contiene("nulla")).visibile, false);
  });
  it("cluster ambiguo (cluster null): tutte le righe restano", () => {
    assert.equal(vistaRiga(riga(20, 1, null), senzaFiltri, contiene("")).visibile, true);
    assert.equal(vistaRiga(riga(21, 2, null), senzaFiltri, contiene("")).visibile, true);
  });
});

describe("contatoriDiscovery", () => {
  const host = [
    { id: 10, status: "online", cluster: principale },
    { id: 11, status: "offline", cluster: secondario },
    { id: 12, status: "online", cluster: secondario },
    { id: 30, status: "offline", cluster: null },
    { id: 31, status: "unknown", cluster: null },
  ];
  it("un cluster conta 1; K = IP secondari nascosti nelle righe mostrate; stato = quello della principale", () => {
    const mostrate = [host[0], host[3], host[4]];
    const c = contatoriDiscovery(host, mostrate);
    assert.deepEqual(c, { mostrate: 3, totale: 3, accorpati: 2, online: 1, offline: 1, sconosciuti: 1 });
  });
  it("«di M» è il totale dopo l'accorpamento, senza filtri", () => {
    assert.equal(contatoriDiscovery(host, [host[3]]).totale, 3);
  });
  it("una secondaria mostrata (filtro rete) non conta anche come nascosta", () => {
    const c = contatoriDiscovery(host, [host[0], host[1]]);
    assert.equal(c.accorpati, 1);
  });
  it("principale non mostrata: nessun accorpato", () => {
    assert.equal(contatoriDiscovery(host, [host[1]]).accorpati, 0);
  });
});
