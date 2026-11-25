/**
 * Reti viste dai collector (25/11/2026): sedi separate, solo ARP e DHCP, senza tag contro tag, niente doppioni, si crea
 * solo ciò che manca e senza credenziali.
 *
 * Run: node --import tsx --test src/lib/traffico/__tests__/reti-collector.test.ts
 */
import "@/lib/__tests__/support/data-dir-isolata";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { closeTenantDb, createNetwork, deleteTenantDatabase, withTenant } from "@/lib/db-tenant";
import { closeHubDb } from "@/lib/db-hub";
import { creaCollector, dbTraffico } from "@/lib/traffico/lettura";
import { calcolaVisti, indirizziAscolto, portaReteDaCollector, proposteDaiCollector, puntiAscolto, quadroAscolto, ReteNonVista, unisciProposte, utile, vlanSenzaTag, type RigaIdentita } from "@/lib/traffico/reti-collector";

const T = "RETICOLL2511";
after(() => { closeTenantDb(T); deleteTenantDatabase(T); closeHubDb(); });

const r = (ip: string, vlan: number, o: Partial<RigaIdentita> = {}): RigaIdentita => ({
  collector: "a", mac: `02:00:00:00:00:${ip.split(".")[3].padStart(2, "0").slice(-2)}`, ip, vlan, fonte: "arp", nome: "", prima_vista: "2026-11-24 08:00:00", ultima_vista: "2026-11-25 08:00:00", ...o,
});

test("quali indirizzi contano", () => {
  for (const ip of ["192.168.51.206", "10.0.0.5", "172.16.1.1", "100.64.0.9"]) assert.ok(utile(ip), ip);
  for (const ip of ["169.254.3.4", "255.255.255.253", "0.0.0.0", "8.8.8.8", "192.168.1.255", "192.168.1.0", "::1", "x"]) assert.ok(!utile(ip), ip);
});

test("senza tag: la VLAN dichiarata, poi il tag che conta, altrimenti senza tag", () => {
  const m = (o: Record<number, number>) => new Map(Object.entries(o).map(([k, v]) => [Number(k), v]));
  assert.equal(vlanSenzaTag(m({ 16: 3, 40: 4 }), 7, 16), 16); // dichiarata e vista
  assert.equal(vlanSenzaTag(m({ 40: 4 }), 7, 16), 40); // dichiarata ma mai vista: il tag
  assert.equal(vlanSenzaTag(m({ 230: 1 }), 3, null), 230); // OVH: il router col tag, le VM senza
  assert.equal(vlanSenzaTag(m({ 40: 2 }), 18, null), 0); // due su diciotto: non è la sua VLAN
  assert.equal(vlanSenzaTag(m({ 16: 3, 40: 4 }), 7, null), 0); // due tag alla pari: non si indovina
  assert.equal(vlanSenzaTag(m({}), 10, 5), 0);
});

test("stesso indirizzo da più collector e senza tag: una riga sola; mDNS e traffico non contano", () => {
  const v = calcolaVisti([
    r("192.168.230.31", 0), r("192.168.230.32", 0), r("192.168.230.254", 230), r("192.168.230.31", 230, { collector: "b", ultima_vista: "2026-11-25 09:00:00", nome: "sol" }),
    r("192.168.230.40", 0, { fonte: "mdns" }), r("192.168.4.9", 0), r("192.168.4.9", 0, { fonte: "dhcp" }),
  ], [{ cidr: "192.168.4.0/22", vlan_id: null }]);
  assert.deepEqual(v.map((x) => [x.vid, x.ip, x.cidr, x.censita, x.collector.length, x.protocolli.length]), [
    [0, "192.168.4.9", "192.168.4.0/22", true, 1, 2], [230, "192.168.230.31", "192.168.230.0/24", false, 2, 1],
    [230, "192.168.230.32", "192.168.230.0/24", false, 1, 1], [230, "192.168.230.254", "192.168.230.0/24", false, 1, 1],
  ]);
  assert.deepEqual([v[1].nome, v[1].ultima_vista], ["sol", "2026-11-25 09:00:00"]);
});

test("trunk e collector: la stessa rete sulla stessa VLAN è una riga, su un'altra sono due", () => {
  const base = { gateway_ip: null, fonte: null, maschera: "dedotta" as const, ultimoGiorno: null };
  const u = unisciProposte([{ ...base, vid: 2, cidr: "192.168.2.0/24", ip: 11 }], [
    { ...base, vid: 2, cidr: "192.168.2.0/24", ip: 5, sede: "Dalton", viste: ["Dalton: 5 collector"] }, { ...base, vid: 3, cidr: "192.168.2.0/24", ip: 1, sede: "OVH", viste: ["OVH: x"] },
  ]);
  assert.deepEqual(u.map((x) => [x.vid, x.sede, x.viste]), [[2, undefined, ["sonda trunk", "Dalton: 5 collector"]], [3, "OVH", ["OVH: x"]]]);
});

test("sedi separate, proposte, porta in IPAM e host mancanti", () => {
  withTenant(T, () => {
    const c = (nome: string, sede: string, n: number) => creaCollector({ nome, sede, url: `https://10.9.0.${n}:8477`, gettone: "g", impronta: "AA" });
    const [dalton, ovh] = [c("PX-01", "Dalton", 1), c("PX-OVH", "OVH", 2)];
    const d = dbTraffico();
    const metti = d.prepare("INSERT INTO traffico_identita (collector_id, mac, ip, fonte, vlan, nome, prima_vista, ultima_vista) VALUES (?, ?, ?, 'arp', ?, ?, datetime('now', '-1 day'), datetime('now', ?))");
    metti.run(dalton, "02:00:00:00:01:01", "192.168.51.9", 5, "", "-1 hour");
    for (const [i, ip] of ["192.168.51.206", "192.168.51.213", "192.168.51.254"].entries()) metti.run(ovh, `02:00:00:00:02:0${i}`, ip, 0, i === 0 ? "da-vspc" : "", "-1 hour");
    metti.run(ovh, "02:00:00:00:02:09", "192.168.99.9", 0, "", "-20 days"); // troppo vecchio
    metti.run(ovh, "02:00:00:00:02:08", "169.254.1.9", 0, "", "-1 hour");
    assert.deepEqual(puntiAscolto().map((p) => [p.sede, p.collector]), [["Dalton", ["PX-01"]], ["OVH", ["PX-OVH"]]]);
    assert.deepEqual(quadroAscolto("OVH")!.reti.map((x) => [x.vid, x.cidr, x.ip.length, x.censita]), [[0, "192.168.51.0/24", 3, false]]);
    assert.deepEqual(quadroAscolto("Dalton")!.reti.map((x) => [x.vid, x.cidr, x.ip.length]), [[5, "192.168.51.0/24", 1]]);
    assert.equal(quadroAscolto("Marte"), null);
    assert.deepEqual(proposteDaiCollector().map((p) => [p.sede, p.vid, p.ip]).sort(), [["Dalton", 5, 1], ["OVH", 0, 3]]);
    assert.throws(() => portaReteDaCollector({ sede: "OVH", vid: 7, cidr: "192.168.51.0/24" }), ReteNonVista);
    assert.throws(() => portaReteDaCollector({ sede: "OVH", vid: 0, cidr: "192.168.60.0/24" }), ReteNonVista);

    const e = portaReteDaCollector({ sede: "OVH", vid: 0, cidr: "192.168.51.0/24", nome: "OVH - VM" });
    assert.deepEqual([e.creata, e.host], [true, 3]);
    const host = d.prepare("SELECT ip, mac, hostname, status FROM hosts WHERE network_id = ? ORDER BY ip").all(e.id) as { ip: string; mac: string; hostname: string | null; status: string }[];
    assert.deepEqual(host.map((h) => [h.ip, h.hostname, h.status]), [["192.168.51.206", "da-vspc", "online"], ["192.168.51.213", null, "online"], ["192.168.51.254", null, "online"]]);
    assert.equal((d.prepare("SELECT COUNT(*) AS n FROM network_credentials WHERE network_id = ?").get(e.id) as { n: number }).n, 0);
    assert.deepEqual(proposteDaiCollector(), []);
    // di nuovo: niente doppioni; un host in più entra da solo; quello che c'è non si tocca
    d.prepare("UPDATE hosts SET mac = '02:aa:aa:aa:aa:aa' WHERE ip = '192.168.51.213'").run();
    metti.run(ovh, "02:00:00:00:02:07", "192.168.51.7", 0, "", "-1 hour");
    assert.equal(quadroAscolto("OVH")!.reti[0].mancanti, 1);
    assert.deepEqual(portaReteDaCollector({ sede: "OVH", vid: 0, cidr: "192.168.51.0/24" }), { id: e.id, creata: false, host: 1 });
    assert.deepEqual(portaReteDaCollector({ sede: "OVH", vid: 0, cidr: "192.168.51.0/24" }).host, 0);
    assert.equal((d.prepare("SELECT mac FROM hosts WHERE ip = '192.168.51.213'").get() as { mac: string }).mac, "02:aa:aa:aa:aa:aa");
    // elenco: filtri, pagine, appartenenza (rete senza VLAN in IPAM e indirizzo senza tag: ufficiale)
    const l = indirizziAscolto("OVH", { limit: 2, offset: 1 })!;
    assert.deepEqual([l.totale, l.righe.map((x) => [x.ip, x.appartenenza.tag])], [4, [["192.168.51.206", "ufficiale"], ["192.168.51.213", "ufficiale"]]]);
    assert.deepEqual(indirizziAscolto("OVH", { q: "VSPC" })!.righe.map((x) => x.ip), ["192.168.51.206"]);
    assert.equal(indirizziAscolto("OVH", { vid: 5 })!.totale, 0);
    assert.equal(indirizziAscolto("Dalton", {})!.righe[0].appartenenza.tag, "vlan_non_ipam");
    // una rete che si sovrappone non si crea
    createNetwork({ cidr: "192.168.70.0/23", name: "larga" } as Parameters<typeof createNetwork>[0]);
    metti.run(ovh, "02:00:00:00:02:06", "192.168.71.9", 0, "", "-1 hour");
    assert.throws(() => portaReteDaCollector({ sede: "OVH", vid: 0, cidr: "192.168.71.0/24" }), /sovrappone/);
  });
});
