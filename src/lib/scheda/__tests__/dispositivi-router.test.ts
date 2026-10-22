/**
 * Dispositivi visti dal router MikroTik (21/10): ARP, lease DHCP, vicini e host IPAM uniti per IP con le precedenze
 * del Manager (censimento §1.11): MAC DHCP > ARP > LLDP, nome DHCP > LLDP > DNS, ARP «failed» scartato se nessun'altra
 * fonte conferma l'IP, MAC non di 12 cifre scartato, ordine per IP numerico.
 *
 * Incidente evitato: il Manager mostrava il MAC di un'altra fonte come se fosse quello del lease e metteva 10.0.0.10
 * prima di 10.0.0.9 (ordine alfabetico).
 *
 * Run: DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test src/lib/scheda/__tests__/dispositivi-router.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  contaDispositivi, filtraDispositivi, paginaDispositivi, PER_PAGINA, unisciDispositivi,
  type IngressoDispositivi,
} from "../dispositivi-router";

const vuoto: IngressoDispositivi = { arp: [], lease: [], vicini: [], host: [] };
const arp = (ip: string, mac: string, extra: Partial<IngressoDispositivi["arp"][number]> = {}) =>
  ({ ip, mac, interface_name: "vlan10", status: "reachable", timestamp: "2026-10-21 09:40:00", ...extra });
const lease = (ip: string, mac: string, extra: Partial<IngressoDispositivi["lease"][number]> = {}) =>
  ({ ip_address: ip, mac_address: mac, hostname: null, dynamic_lease: 1, description: null, last_seen: "2026-10-21 09:40:00", ...extra });
const vicino = (ip: string, mac: string | null, nome: string, extra: Partial<IngressoDispositivi["vicini"][number]> = {}) =>
  ({ remote_ip: ip, remote_mac: mac, remote_device_name: nome, local_port: "ether5", timestamp: "2026-10-21 09:40:00", ...extra });
const host = (ip: string, nome: string | null, extra: Partial<IngressoDispositivi["host"][number]> = {}) =>
  ({ id: 7, ip, nome_dns: nome, status: "online", ...extra });
const nessuno = () => null;
const unisci = (i: Partial<IngressoDispositivi>) => unisciDispositivi({ ...vuoto, ...i }, nessuno);

describe("unisciDispositivi: MAC", () => {
  it("il MAC del lease vince su quello dell'ARP, e l'ARP diverso si segnala", () => {
    const [r] = unisci({ arp: [arp("10.0.0.5", "3c:52:82:7a:1b:05")], lease: [lease("10.0.0.5", "3C-52-82-7A-1B-04")] });
    assert.equal(r.mac, "3C:52:82:7A:1B:04");
    assert.equal(r.macArpDiverso, "3C:52:82:7A:1B:05");
  });
  it("stesso MAC scritto in modo diverso: nessuna discordanza", () => {
    const [r] = unisci({ arp: [arp("10.0.0.5", "3c:52:82:7a:1b:04")], lease: [lease("10.0.0.5", "3C-52-82-7A-1B-04")] });
    assert.equal(r.macArpDiverso, null);
  });
  it("senza lease vince l'ARP, poi il vicino", () => {
    assert.equal(unisci({ arp: [arp("10.0.0.5", "aa:bb:cc:00:00:01")], vicini: [vicino("10.0.0.5", "AA:BB:CC:00:00:02", "sw")] })[0].mac, "AA:BB:CC:00:00:01");
    assert.equal(unisci({ vicini: [vicino("10.0.0.5", "AA:BB:CC:00:00:02", "sw")] })[0].mac, "AA:BB:CC:00:00:02");
  });
  it("un MAC di 11 cifre esadecimali si scarta (la riga resta, senza MAC)", () => {
    const r = unisci({ arp: [arp("10.0.0.5", "AA:BB:CC:00:00:0")] });
    assert.equal(r.length, 1);
    assert.equal(r[0].mac, null);
  });
  it("un MAC del lease non valido cede all'ARP", () => {
    const [r] = unisci({ arp: [arp("10.0.0.5", "AA:BB:CC:00:00:01")], lease: [lease("10.0.0.5", "AA:BB")] });
    assert.equal(r.mac, "AA:BB:CC:00:00:01");
    assert.equal(r.macArpDiverso, null);
  });
});

describe("unisciDispositivi: nome", () => {
  it("DHCP > LLDP > DNS, con la fonte", () => {
    const base = { arp: [arp("10.0.0.5", "AA:BB:CC:00:00:01")], host: [host("10.0.0.5", "dns-nome")] };
    const tutte = unisci({ ...base, lease: [lease("10.0.0.5", "AA:BB:CC:00:00:01", { hostname: "dhcp-nome" })], vicini: [vicino("10.0.0.5", null, "lldp-nome")] })[0];
    assert.deepEqual([tutte.nome, tutte.fonteNome], ["dhcp-nome", "dhcp"]);
    const lldp = unisci({ ...base, vicini: [vicino("10.0.0.5", null, "lldp-nome")] })[0];
    assert.deepEqual([lldp.nome, lldp.fonteNome], ["lldp-nome", "lldp"]);
    const dns = unisci(base)[0];
    assert.deepEqual([dns.nome, dns.fonteNome], ["dns-nome", "dns"]);
    const niente = unisci({ arp: base.arp })[0];
    assert.deepEqual([niente.nome, niente.fonteNome], [null, null]);
  });
  it("un hostname del lease vuoto o di soli spazi cede il passo", () => {
    const [r] = unisci({ lease: [lease("10.0.0.5", "AA:BB:CC:00:00:01", { hostname: "  " })], host: [host("10.0.0.5", "dns-nome")] });
    assert.equal(r.nome, "dns-nome");
  });
});

describe("unisciDispositivi: ARP failed", () => {
  it("solo ARP failed: la riga si scarta", () => {
    assert.deepEqual(unisci({ arp: [arp("10.0.0.5", "AA:BB:CC:00:00:01", { status: "failed" })] }), []);
    assert.deepEqual(unisci({ arp: [arp("10.0.0.5", "AA:BB:CC:00:00:01", { status: "FAILED" })], host: [host("10.0.0.5", "x", { status: "offline" })] }), []);
  });
  it("con un lease, un vicino o un host IPAM online la riga resta", () => {
    const f = arp("10.0.0.5", "AA:BB:CC:00:00:01", { status: "failed" });
    assert.equal(unisci({ arp: [f], lease: [lease("10.0.0.5", "AA:BB:CC:00:00:01")] }).length, 1);
    assert.equal(unisci({ arp: [f], vicini: [vicino("10.0.0.5", null, "sw")] }).length, 1);
    assert.equal(unisci({ arp: [f], host: [host("10.0.0.5", "x")] }).length, 1);
  });
});

describe("unisciDispositivi: chiave e ordine", () => {
  it("scarta gli IP non IPv4 ben formati", () => {
    const ip = ["fe80::1", "10.0.0", "10.0.0.256", "10.0.0.1.5", "", "a.b.c.d"];
    assert.deepEqual(unisci({ arp: ip.map((x, k) => arp(x, `AA:BB:CC:00:00:0${k}`)) }), []);
    assert.deepEqual(unisci({ arp: [arp(null as unknown as string, "AA:BB:CC:00:00:01")] }), []);
  });
  it("ordina per IP numerico: 10.0.0.9 prima di 10.0.0.10", () => {
    const r = unisci({ arp: ["10.0.0.10", "10.0.0.9", "9.255.0.1", "10.0.0.100"].map((ip) => arp(ip, "AA:BB:CC:00:00:01")) });
    assert.deepEqual(r.map((x) => x.ip), ["9.255.0.1", "10.0.0.9", "10.0.0.10", "10.0.0.100"]);
  });
  it("un host IPAM da solo non crea la riga: lo dice il router", () => {
    assert.deepEqual(unisci({ host: [host("10.0.0.5", "x")] }), []);
  });
});

describe("unisciDispositivi: produttore, tipo, interfaccia, visto", () => {
  it("MAC amministrato localmente (seconda cifra 2, 6, A, E): «MAC privato», senza interrogare l'OUI", () => {
    const chiamate: string[] = [];
    const r = unisciDispositivi({ ...vuoto, arp: ["9A:1F:22:4C:7D:E0", "62:3B:9F:11:08:C2", "02:37:25:E8:49:C3", "EE:00:00:00:00:01", "DC:2C:6E:11:22:33"].map((m, k) => arp(`10.0.0.${k + 1}`, m)) },
      (m) => { chiamate.push(m); return "Fabbricante"; });
    assert.deepEqual(r.map((x) => x.produttore), ["MAC privato", "MAC privato", "MAC privato", "MAC privato", "Fabbricante"]);
    assert.deepEqual(chiamate, ["DC:2C:6E:11:22:33"]);
  });
  it("senza MAC niente produttore", () => assert.equal(unisci({ vicini: [vicino("10.0.0.5", null, "sw")] })[0].produttore, null));
  it("lease dinamico o statico, commento DHCP", () => {
    const r = unisci({ lease: [lease("10.0.0.1", "AA:BB:CC:00:00:01", { dynamic_lease: 0, description: "stampante" }), lease("10.0.0.2", "AA:BB:CC:00:00:02", { dynamic_lease: 1 })] });
    assert.deepEqual(r.map((x) => [x.lease, x.commentoDhcp]), [["statico", "stampante"], ["dinamico", null]]);
    assert.equal(unisci({ arp: [arp("10.0.0.3", "AA:BB:CC:00:00:03")] })[0].lease, null);
  });
  it("interfaccia: quella dell'ARP, altrimenti la porta locale del vicino", () => {
    assert.equal(unisci({ arp: [arp("10.0.0.5", "AA:BB:CC:00:00:01")], vicini: [vicino("10.0.0.5", null, "sw")] })[0].interfaccia, "vlan10");
    assert.equal(unisci({ vicini: [vicino("10.0.0.5", null, "sw")] })[0].interfaccia, "ether5");
  });
  it("visto: il più recente fra le fonti, anche con formati diversi", () => {
    const [r] = unisci({ arp: [arp("10.0.0.5", "AA:BB:CC:00:00:01", { timestamp: "2026-10-21 09:00:00" })], vicini: [vicino("10.0.0.5", null, "sw", { timestamp: "2026-10-21T09:40:00.000Z" })], lease: [lease("10.0.0.5", "AA:BB:CC:00:00:01", { last_seen: "2026-10-20 18:00:00" })] });
    assert.equal(r.visto, "2026-10-21T09:40:00.000Z");
  });
  it("lldp e hostId", () => {
    const [r] = unisci({ vicini: [vicino("10.0.0.5", null, "sw")], host: [host("10.0.0.5", null, { id: 42 })] });
    assert.equal(r.lldp, true);
    assert.equal(r.hostId, 42);
  });
});

describe("filtri, conteggi, pagine", () => {
  const righe = unisciDispositivi({
    arp: [arp("10.0.0.1", "00:BB:CC:00:00:01"), arp("10.0.0.2", "00:BB:CC:00:00:02"), arp("10.0.0.3", "00:BB:CC:00:00:03"), arp("10.0.0.4", "00:BB:CC:00:00:09")],
    lease: [lease("10.0.0.1", "00:BB:CC:00:00:01", { hostname: "Pc-Uno" }), lease("10.0.0.2", "00:BB:CC:00:00:02", { dynamic_lease: 0, description: "Stampante corridoio" }), lease("10.0.0.4", "00:BB:CC:00:00:04")],
    vicini: [vicino("10.0.0.3", null, "SW-CORE")], host: [],
  }, (m) => (m.endsWith("01") ? "Dell Inc." : null));
  it("conteggi", () => assert.deepEqual(contaDispositivi(righe), { tutti: 4, dhcp: 3, statici: 1, lldp: 1, discordanti: 1 }));
  it("filtri per chip", () => {
    assert.deepEqual(filtraDispositivi(righe, "dhcp", "").map((r) => r.ip), ["10.0.0.1", "10.0.0.2", "10.0.0.4"]);
    assert.deepEqual(filtraDispositivi(righe, "statici", "").map((r) => r.ip), ["10.0.0.2"]);
    assert.deepEqual(filtraDispositivi(righe, "lldp", "").map((r) => r.ip), ["10.0.0.3"]);
    assert.deepEqual(filtraDispositivi(righe, "discordanti", "").map((r) => r.ip), ["10.0.0.4"]);
  });
  it("la ricerca guarda IP, MAC, nome, produttore e commento, senza badare alle maiuscole", () => {
    const q = (s: string) => filtraDispositivi(righe, "tutti", s).map((r) => r.ip);
    assert.deepEqual(q("0.0.3"), ["10.0.0.3"]);
    assert.deepEqual(q("cc:00:00:02"), ["10.0.0.2"]);
    assert.deepEqual(q("pc-uno"), ["10.0.0.1"]);
    assert.deepEqual(q("dell"), ["10.0.0.1"]);
    assert.deepEqual(q("CORRIDOIO"), ["10.0.0.2"]);
    assert.deepEqual(q("   "), ["10.0.0.1", "10.0.0.2", "10.0.0.3", "10.0.0.4"]);
  });
  it("paginaDispositivi: 14 per pagina, conteggi sul totale, pagina fuori misura riportata nei limiti", () => {
    const molte = unisciDispositivi({ ...vuoto, arp: Array.from({ length: 30 }, (_, k) => arp(`10.0.1.${k + 1}`, "AA:BB:CC:00:00:01")) }, nessuno);
    const p2 = paginaDispositivi(molte, { pagina: 2, filtro: "tutti", q: "" });
    assert.equal(PER_PAGINA, 14);
    assert.deepEqual([p2.righe.length, p2.totale, p2.pagina, p2.pagine, p2.conteggi.tutti], [14, 30, 2, 3, 30]);
    assert.equal(p2.righe[0].ip, "10.0.1.15");
    const ultima = paginaDispositivi(molte, { pagina: 99, filtro: "tutti", q: "" });
    assert.deepEqual([ultima.pagina, ultima.righe.length], [3, 2]);
    const prima = paginaDispositivi(molte, { pagina: -4, filtro: "tutti", q: "" });
    assert.equal(prima.pagina, 1);
    const nulla = paginaDispositivi(molte, { pagina: 1, filtro: "lldp", q: "" });
    assert.deepEqual([nulla.righe.length, nulla.totale, nulla.pagine, nulla.conteggi.tutti], [0, 0, 1, 30]);
  });
});
