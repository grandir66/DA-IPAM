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
import { altriIpCsv, contatoriDiscovery, vistaRigaConCriteri } from "../filtro-cluster";

const altro = (host_id: number, ip: string, network_id: number) => ({ host_id, ip, network_id, network_name: `rete-${network_id}`, status: "online" });
const principale: InfoClusterDiscovery = {
  physical_device_id: 1, principale: true, principale_host_id: 10,
  altri: [altro(11, "192.0.2.254", 2), altro(12, "198.51.100.254", 3)],
};
const secondario: InfoClusterDiscovery = { physical_device_id: 1, principale: false, principale_host_id: 10, altri: [] };


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

/**
 * Revisione finale (22/10): stato, classificazione e vulnerabilità si applicavano riga per riga PRIMA di nascondere i
 * secondari, così un problema solo su un IP secondario spariva dalla lista. Regola: la riga del cluster corrisponde a
 * un filtro se lo soddisfa la principale O uno qualsiasi dei membri, e dice quale membro.
 */
describe("vistaRigaConCriteri (filtri sugli attributi)", () => {
  type H = { id: number; network_id: number; status: string; critiche: number; nome: string; mac: string; ip: string };
  const host: Record<number, H> = {
    10: { id: 10, network_id: 1, status: "offline", critiche: 0, nome: "core", mac: "aa:aa", ip: "192.0.2.1" },
    11: { id: 11, network_id: 2, status: "online", critiche: 3, nome: "core-wan", mac: "bb:bb", ip: "192.0.2.254" },
    12: { id: 12, network_id: 3, status: "offline", critiche: 0, nome: "mgmt-x", mac: "cc:cc", ip: "198.51.100.254" },
  };
  const critiche = (id: number) => host[id].critiche > 0;
  const online = (id: number) => host[id].status === "online";
  const testo = (q: string) => (id: number) => [host[id].ip, host[id].nome, host[id].mac].join(" ").includes(q);
  const r10 = { id: 10, network_id: 1, cluster: principale };

  it("CVE critiche solo sul secondario: la principale compare e dice quale IP", () => {
    assert.deepEqual(vistaRigaConCriteri(r10, null, [critiche]), { visibile: true, corrispondeSecondario: ["192.0.2.254"] });
  });
  it("filtro online con principale offline e secondario online: compare col suggerimento", () => {
    assert.deepEqual(vistaRigaConCriteri(r10, null, [online]), { visibile: true, corrispondeSecondario: ["192.0.2.254"] });
  });
  it("la principale soddisfa da sola: niente suggerimento", () => {
    const offline = (id: number) => host[id].status === "offline";
    assert.deepEqual(vistaRigaConCriteri(r10, null, [offline]), { visibile: true, corrispondeSecondario: [] });
  });
  it("nessun membro soddisfa: nascosta", () => {
    assert.deepEqual(vistaRigaConCriteri(r10, null, [() => false]), { visibile: false });
  });
  it("il secondario resta nascosto senza filtro rete anche se corrisponde", () => {
    assert.deepEqual(vistaRigaConCriteri({ id: 11, network_id: 2, cluster: secondario }, null, [critiche]), { visibile: false });
  });
  it("ricerca sul nome e sul MAC del secondario (non solo l'IP)", () => {
    assert.deepEqual(vistaRigaConCriteri(r10, null, [testo("mgmt-x")]), { visibile: true, corrispondeSecondario: ["198.51.100.254"] });
    assert.deepEqual(vistaRigaConCriteri(r10, null, [testo("cc:cc")]), { visibile: true, corrispondeSecondario: ["198.51.100.254"] });
  });
  it("ogni filtro può essere soddisfatto da un membro diverso: si dicono tutti, senza doppioni", () => {
    const v = vistaRigaConCriteri(r10, null, [online, critiche, testo("mgmt-x")]);
    assert.deepEqual(v, { visibile: true, corrispondeSecondario: ["192.0.2.254", "198.51.100.254"] });
  });
  it("host senza cluster o cluster ambiguo (null): invariato, decide solo la riga", () => {
    assert.deepEqual(vistaRigaConCriteri({ id: 30, network_id: 1, cluster: null }, null, []), { visibile: true, corrispondeSecondario: [] });
    assert.deepEqual(vistaRigaConCriteri({ id: 30, network_id: 1, cluster: undefined }, null, [() => false]), { visibile: false });
    assert.deepEqual(vistaRigaConCriteri({ id: 30, network_id: 1, cluster: null }, "2", []), { visibile: false });
  });
  it("senza filtri: la principale resta, la secondaria è nascosta", () => {
    assert.deepEqual(vistaRigaConCriteri(r10, null, []), { visibile: true, corrispondeSecondario: [] });
    assert.deepEqual(vistaRigaConCriteri({ id: 11, network_id: 2, cluster: secondario }, null, []), { visibile: false });
  });
  it("col filtro rete ogni IP è una riga a sé: i membri non contano", () => {
    assert.deepEqual(vistaRigaConCriteri({ id: 11, network_id: 2, cluster: secondario }, "1", []), { visibile: false });
    assert.deepEqual(vistaRigaConCriteri(r10, "1", [critiche]), { visibile: false });
    assert.deepEqual(vistaRigaConCriteri({ id: 11, network_id: 2, cluster: secondario }, "2", [critiche]), { visibile: true, corrispondeSecondario: [] });
  });
});

describe("altriIpCsv", () => {
  it("elenca ip · rete separati da punto e virgola", () => {
    assert.equal(altriIpCsv(principale), "192.0.2.254 · rete-2; 198.51.100.254 · rete-3");
  });
  it("vuoto per il secondario, per l'host solo e per il cluster ambiguo", () => {
    assert.equal(altriIpCsv(secondario), "");
    assert.equal(altriIpCsv(null), "");
    assert.equal(altriIpCsv(undefined), "");
  });
});
