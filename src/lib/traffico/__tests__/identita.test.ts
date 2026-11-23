/**
 * Chi è un indirizzo (2026-11-23): le identità lette dal collector riempiono MAC e nome dove mancano,
 * senza toccare ciò che c'è; IP doppio e MAC cambiato.
 *
 * Run: node --import tsx --test src/lib/traffico/__tests__/identita.test.ts
 */
import "@/lib/__tests__/support/data-dir-isolata";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { closeTenantDb, deleteTenantDatabase, withTenant } from "@/lib/db-tenant";
import { closeHubDb } from "@/lib/db-hub";
import { creaCollector, dbTraffico, sincronizzaTraffico, type Lettore } from "@/lib/traffico/lettura";
import { identitaValida, ipDoppi, macCambiati, macVirtuale, type IdentitaCollector } from "@/lib/traffico/identita";
import { nomiDegliIp } from "@/lib/traffico/quadro";

const T = "TRAFFID2311";
const adesso = new Date();
const alle = (secondiFa: number): string => new Date(adesso.getTime() - secondiFa * 1000).toISOString().slice(0, 19).replace("T", " ");
let seq = 0;
const voce = (mac: string, ip: string, fonte: string, extra: Partial<IdentitaCollector> = {}): IdentitaCollector =>
  ({ seq: ++seq, visto: alle(60), mac, ip, vlan: 0, fonte, nome: "", tipo: "", ...extra });

function finto(identita: IdentitaCollector[]): Lettore {
  return (async (_c: unknown, percorso: string) => {
    if (percorso === "/v1/stato") return { versione: "t", nome: "t", avviato: "", ultimo_seq: 0, pacchetti_visti: 1, pacchetti_persi: 0, copertura: 1 };
    const u = new URL(percorso, "https://x");
    const dopo = Number(u.searchParams.get("dopo"));
    if (u.pathname !== "/v1/identita") return { righe: [], ultimo_seq: dopo, altri: false, buco: false };
    const righe = identita.filter((r) => r.seq > dopo);
    return { righe, ultimo_seq: righe.at(-1)?.seq ?? dopo, altri: false, buco: false };
  }) as Lettore;
}

after(() => {
  closeTenantDb(T);
  deleteTenantDatabase(T);
  closeHubDb();
});

test("regole pure: doppione solo fra MAC vicini nel tempo e sulla stessa VLAN, mai coi MAC virtuali", () => {
  const v = (mac: string, fa: number, vlan = 0) => ({ ip: "10.4.0.10", mac, vlan, ultima_vista: alle(fa) });
  assert.equal(ipDoppi([v("aa:aa:aa:aa:aa:01", 10), v("aa:aa:aa:aa:aa:02", 100)]).length, 1);
  assert.deepEqual(ipDoppi([v("aa:aa:aa:aa:aa:02", 10), v("aa:aa:aa:aa:aa:01", 100)])[0].dettaglio, { mac_a: "aa:aa:aa:aa:aa:01", mac_b: "aa:aa:aa:aa:aa:02", quanti: 2 });
  // l'indirizzo ha cambiato padrone un'ora fa (DHCP): non è un doppione
  assert.equal(ipDoppi([v("aa:aa:aa:aa:aa:01", 10), v("aa:aa:aa:aa:aa:02", 3600)]).length, 0);
  assert.equal(ipDoppi([v("aa:aa:aa:aa:aa:01", 10, 10), v("aa:aa:aa:aa:aa:02", 20, 20)]).length, 0);
  assert.equal(ipDoppi([v("aa:aa:aa:aa:aa:01", 10), v("00:00:5e:00:01:0a", 20)]).length, 0);
  assert.ok(macVirtuale("00:00:0C:07:AC:01"));
  assert.equal(macCambiati([v("aa:aa:aa:aa:aa:02", 10)], new Map([["10.4.0.10", "AA:AA:AA:AA:AA:01"]])).length, 1);
  assert.equal(macCambiati([v("aa:aa:aa:aa:aa:01", 10)], new Map([["10.4.0.10", "AA:AA:AA:AA:AA:01"]])).length, 0);
  assert.equal(macCambiati([v("aa:aa:aa:aa:aa:01", 10)], new Map()).length, 0);
  assert.ok(!identitaValida(voce("AA:BB", "10.4.0.1", "arp")));
  assert.ok(!identitaValida(voce("aa:aa:aa:aa:aa:01", "999.1.1.1", "arp")));
  assert.ok(!identitaValida(voce("aa:aa:aa:aa:aa:01", "10.4.0.1", "inventata")));
  assert.ok(identitaValida(voce("aa:aa:aa:aa:aa:01", "", "lldp", { nome: "sw-piano1", tipo: "porta 12" })));
});

test("dal collector agli host: riempie il vuoto, non tocca il pieno; IP doppio e MAC cambiato; l'host del MAC", async () => {
  await withTenant(T, async () => {
    const d = dbTraffico();
    creaCollector({ nome: "banco", sede: "", url: "https://192.168.99.89:8477", gettone: "g", impronta: "AA" });
    const rete = Number(d.prepare("INSERT INTO networks (cidr, name) VALUES ('10.4.0.0/24', 'Uffici')").run().lastInsertRowid);
    const host = d.prepare("INSERT INTO hosts (network_id, ip, mac, hostname, custom_name) VALUES (?, ?, ?, ?, ?)");
    host.run(rete, "10.4.0.10", null, null, null);                       // senza MAC e senza nome
    host.run(rete, "10.4.0.11", "AA:AA:AA:AA:AA:11", "nome-vero", null); // tutto pieno
    host.run(rete, "10.4.0.12", null, null, "Messo a mano");             // nome dato da una persona
    host.run(rete, "10.4.0.13", "AA:AA:AA:AA:AA:13", "portatile", null); // poi cambia indirizzo
    const righe = [
      voce("bb:bb:bb:bb:bb:10", "10.4.0.10", "arp"),
      voce("bb:bb:bb:bb:bb:10", "10.4.0.10", "dhcp", { nome: "pc-magazzino", tipo: "MSFT 5.0" }),
      voce("bb:bb:bb:bb:bb:11", "10.4.0.11", "arp"),
      voce("bb:bb:bb:bb:bb:11", "10.4.0.11", "dhcp", { nome: "altro-nome" }),
      voce("bb:bb:bb:bb:bb:12", "10.4.0.12", "mdns", { nome: "stampante.local" }),
      voce("bb:bb:bb:bb:bb:12", "10.4.0.12", "arp"),
      voce("cc:cc:cc:cc:cc:01", "10.4.0.50", "arp"),
      voce("cc:cc:cc:cc:cc:02", "10.4.0.50", "arp", { visto: alle(30) }),
      voce("aa:aa:aa:aa:aa:13", "10.4.0.99", "arp"),                     // il portatile ora ha un altro indirizzo
      voce("zz", "10.4.0.10", "arp"),                                     // riga storta: si salta
    ];
    assert.equal((await sincronizzaTraffico(finto(righe))).errori, 0);
    const h = (ip: string) => d.prepare("SELECT mac, hostname, hostname_source, custom_name FROM hosts WHERE ip = ?").get(ip) as { mac: string | null; hostname: string | null; hostname_source: string | null; custom_name: string | null };
    assert.deepEqual([h("10.4.0.10").mac, h("10.4.0.10").hostname, h("10.4.0.10").hostname_source], ["BB:BB:BB:BB:BB:10", "pc-magazzino", "collector"]);
    assert.deepEqual([h("10.4.0.11").mac, h("10.4.0.11").hostname], ["AA:AA:AA:AA:AA:11", "nome-vero"]);
    assert.deepEqual([h("10.4.0.12").mac, h("10.4.0.12").hostname, h("10.4.0.12").custom_name], ["BB:BB:BB:BB:BB:12", null, "Messo a mano"]);
    const avvisi = d.prepare("SELECT tipo, client, gravita FROM traffico_anomalie ORDER BY tipo, client").all() as { tipo: string; client: string; gravita: number }[];
    assert.deepEqual(avvisi, [{ tipo: "ip_doppio", client: "10.4.0.50", gravita: 3 }, { tipo: "mac_cambiato", client: "10.4.0.11", gravita: 1 }]);
    // l'indirizzo nuovo del portatile porta al suo host, anche se in IPAM è ancora sul vecchio
    assert.equal(nomiDegliIp(["10.4.0.99"])["10.4.0.99"]?.nome, "portatile");
    // secondo giro: niente di nuovo, il cursore è avanti
    assert.equal((d.prepare("SELECT cursore_identita AS c FROM traffico_collector").get() as { c: number }).c, righe.at(-1)!.seq);
    // il controllo spento per quella rete: l'avviso non nasce
    d.prepare("DELETE FROM traffico_anomalie").run();
    d.prepare("INSERT INTO traffico_controlli (network_id, tipo, acceso) VALUES (?, 'ip_doppio', 0)").run(rete);
    await sincronizzaTraffico(finto([...righe, voce("cc:cc:cc:cc:cc:03", "10.4.0.50", "arp", { visto: alle(5) })]));
    assert.equal((d.prepare("SELECT COUNT(*) AS n FROM traffico_anomalie WHERE tipo = 'ip_doppio'").get() as { n: number }).n, 0);
  });
});

import { vlanSbagliate } from "@/lib/traffico/identita";
import { valutaFatti } from "@/lib/traffico/anomalie";
import { fraseAnomalia } from "@/lib/traffico/frasi";

test("tappa 6: VLAN sbagliata solo con un tag diverso da quello della rete censita", () => {
  const reti = [{ cidr: "10.30.0.0/24", vlan_id: 30 }, { cidr: "10.40.0.0/24", vlan_id: 40 }];
  const a = vlanSbagliate([
    { ip: "10.30.0.5", mac: "aa:aa:aa:aa:aa:05", vlan: 40 },   // sbagliata
    { ip: "10.30.0.6", mac: "aa:aa:aa:aa:aa:06", vlan: 30 },   // giusta
    { ip: "10.30.0.7", mac: "aa:aa:aa:aa:aa:07", vlan: 0 },    // senza tag: non si sa
    { ip: "10.99.0.8", mac: "aa:aa:aa:aa:aa:08", vlan: 40 },   // fuori dalle reti censite
  ], reti);
  assert.deepEqual(a.map((x) => [x.client, x.dettaglio.vista, x.dettaglio.attesa]), [["10.30.0.5", 40, 30]]);
  assert.equal(fraseAnomalia({ ...a[0], dettaglio: a[0].dettaglio }), "Si annuncia sulla VLAN 40, la sua rete è sulla VLAN 30");
});

test("tappa 6: i tre fatti nuovi del collector diventano anomalie con la loro gravità", () => {
  const fatto = (tipo: string, client: string, server: string, porta: number, dettaglio: Record<string, unknown> = {}) => ({ tipo, client, server, porta, dettaglio });
  const a = valutaFatti({
    fatti: [
      fatto("tls_certificato", "", "10.30.0.9", 443, { motivo: "scaduto", scaduto_il: "2025-01-01" }),
      fatto("dns_esterno", "10.30.0.5", "esterno", 53),
      fatto("dns_errori", "10.30.0.5", "", 53, { richieste: 40, errori: 25, senza_risposta: 0 }),
    ],
    spenti: new Set(["1|dns_esterno"]), reteDi: (ip) => (ip.startsWith("10.30.") ? 1 : null), confermate: new Set(),
  });
  assert.deepEqual(a.map((x) => [x.tipo, x.gravita]), [["tls_certificato", 2], ["dns_errori", 1]]);
  assert.equal(fraseAnomalia(a[0]), "Servizio con certificato scaduto il 01/01/2025");
});
