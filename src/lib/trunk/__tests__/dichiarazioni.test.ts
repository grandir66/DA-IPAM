/**
 * Cosa gli apparati dicono di sé sul trunk (SSDP, mDNS, DHCP) diventa prova di riconoscimento e si
 * vede accanto all'oggetto (10/11/2026). Valori veri raccolti dal sensore dell'hub.
 * Run: node --import tsx --test src/lib/trunk/__tests__/dichiarazioni.test.ts
 */
import "@/lib/__tests__/support/data-dir-isolata";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { closeTenantDb, deleteTenantDatabase, getTenantDb, getTenantSetting, setTenantSetting, withTenant } from "@/lib/db-tenant";
import { closeHubDb } from "@/lib/db-hub";
import {
  CHIAVE_CURSORE, portaDichiarazioniSugliHost, proveDaDichiarazioni, pulisciMdnsRipetuto, salvaDichiarazioni, sincronizzaDichiarazioni, sistemaDa,
} from "@/lib/trunk/dichiarazioni";

const T = "TRUNKDICH10";
const ORA = "2026-11-10T20:00:00Z";
after(() => {
  try { closeTenantDb(T); deleteTenantDatabase(T); } catch { /* già tolto */ }
  closeHubDb();
});

test("sistemaDa: dalla classe DHCP e dal programma che cerca in SSDP", () => {
  assert.equal(sistemaDa("MSFT 5.0"), "windows");
  assert.equal(sistemaDa("Chromium/151.0.7922.138 Mac OS X"), "macos");
  assert.equal(sistemaDa("android-dhcp-14"), "android");
  assert.equal(sistemaDa("udhcp 1.34.1"), "linux");
  assert.equal(sistemaDa("ARM__boot"), null);
});

test("proveDaDichiarazioni: le stesse regole delle sonde attive, e il sistema operativo", () => {
  const prove = proveDaDichiarazioni([
    { chiave: "mdns_servizio", valore: "_googlecast._tcp" },
    { chiave: "mdns_modello", valore: "Chromecast Ultra" },
    { chiave: "dhcp_classe", valore: "MSFT 5.0" },
  ]);
  assert.ok(prove.some((p) => p.source === "mdns"), "il servizio mDNS diventa una prova mdns");
  assert.deepEqual(prove.filter((p) => p.dimension === "os").map((p) => [p.source, p.claim]), [["dhcp", "windows"]]);
  assert.deepEqual(proveDaDichiarazioni([{ chiave: "dhcp_fqdn", valore: "pc.esempio" }]), []);
});

test("dal sensore agli host: si aggancia per MAC, riempie modello e nome solo dove mancano", async () => {
  await withTenant(T, async () => {
    const d = getTenantDb(T);
    const net = Number(d.prepare("INSERT INTO networks (cidr, name) VALUES ('10.66.0.0/24', 'lan')").run().lastInsertRowid);
    const cast = Number(d.prepare("INSERT INTO hosts (network_id, ip, mac) VALUES (?, '10.66.0.5', 'AA:BB:CC:00:00:05')").run(net).lastInsertRowid);
    const pc = Number(d.prepare("INSERT INTO hosts (network_id, ip, mac, hostname, model) VALUES (?, '10.66.0.6', 'AA:BB:CC:00:00:06', 'gia-scritto', 'OptiPlex')").run(net).lastInsertRowid);
    const risposta = {
      dichiarazioni: [
        { mac: "aa:bb:cc:00:00:05", chiave: "mdns_servizio", valore: "_googlecast._tcp", vid: 7, ultima_vista: ORA },
        { mac: "aa:bb:cc:00:00:05", chiave: "mdns_modello", valore: "Chromecast Ultra", vid: 7, ultima_vista: ORA },
        { mac: "aa:bb:cc:00:00:06", chiave: "dhcp_fqdn", valore: "pc-ammin.esempio", vid: 5, ultima_vista: ORA },
        { mac: "aa:bb:cc:00:00:06", chiave: "mdns_modello", valore: "Altro", vid: 5, ultima_vista: ORA },
        { mac: "aa:bb:cc:00:00:99", chiave: "ssdp_server", valore: "HP-iLO-5/3.22 UPnP/1.0 HP-iLO/2.0", vid: 40, ultima_vista: ORA },
        { mac: "aa:bb:cc:00:00:05", chiave: "chiave_sconosciuta", valore: "x", vid: 7, ultima_vista: ORA },
      ],
    };
    const chiamate: Array<Record<string, string | number> | undefined> = [];
    const leggi = (async (_p: string, params?: Record<string, string | number>) => { chiamate.push(params); return risposta; }) as Parameters<typeof sincronizzaDichiarazioni>[0];
    const esito = await sincronizzaDichiarazioni(leggi);
    assert.equal(esito?.host, 2);
    const riga = (id: number) => d.prepare("SELECT hostname, model FROM hosts WHERE id = ?").get(id) as { hostname: string | null; model: string | null };
    assert.equal(riga(cast).model, "Chromecast Ultra");
    assert.deepEqual(riga(pc), { hostname: "gia-scritto", model: "OptiPlex" }, "ciò che è già scritto non si tocca");
    const salvate = d.prepare("SELECT COUNT(*) AS n, COUNT(host_id) AS con FROM trunk_dichiarazioni").get() as { n: number; con: number };
    assert.deepEqual(salvate, { n: 5, con: 4 }, "la chiave sconosciuta non entra; il MAC senza host resta, senza aggancio");
    assert.ok((d.prepare("SELECT COUNT(*) AS n FROM attribution_evidence WHERE host_id = ? AND source = 'mdns'").get(cast) as { n: number }).n > 0);
    // Il giro dopo riparte dall'ultima vista: non rilegge tutto.
    await sincronizzaDichiarazioni(leggi);
    assert.equal(chiamate[1]?.dopo, ORA);
    // Un secondo passaggio sugli stessi host non duplica le prove.
    const prima = (d.prepare("SELECT COUNT(*) AS n FROM attribution_evidence WHERE host_id = ?").get(cast) as { n: number }).n;
    portaDichiarazioniSugliHost([cast]);
    assert.equal((d.prepare("SELECT COUNT(*) AS n FROM attribution_evidence WHERE host_id = ? AND superseded_by IS NULL").get(cast) as { n: number }).n <= prima, true);
    assert.deepEqual(salvaDichiarazioni([]), []);
  });
});

test("un computer che offre AirPlay non è uno schermo", () => {
  const categoria = (righe: Array<{ chiave: string; valore: string }>) =>
    proveDaDichiarazioni(righe).filter((p) => p.dimension === "category").map((p) => p.claim);
  const airplay = [{ chiave: "mdns_servizio", valore: "_airplay._tcp" }, { chiave: "mdns_servizio", valore: "_raop._tcp" }];
  const soloAirplay = categoria(airplay);
  // un Mac: offre anche SSH e il collegamento fra dispositivi Apple
  assert.deepEqual(categoria([...airplay, { chiave: "mdns_servizio", valore: "_ssh._tcp" }, { chiave: "mdns_servizio", valore: "_companion-link._tcp" }]), []);
  // un computer che cerca in SSDP col browser
  assert.deepEqual(categoria([...airplay, { chiave: "ssdp_agente", valore: "Chromium/151.0 Mac OS X" }]), []);
  assert.ok(soloAirplay.length <= 1, "da solo AirPlay resta com'era nelle regole delle sonde attive");
});

test("pulizia una volta: via le mDNS ripetute dal gateway e le loro prove, poi si rilegge da capo", async () => {
  await withTenant(T, async () => {
    const d = getTenantDb(T);
    setTenantSetting("trunk_dichiarazioni_pulizia", "");
    const prima = (d.prepare("SELECT COUNT(*) AS n FROM trunk_dichiarazioni WHERE chiave LIKE 'mdns%'").get() as { n: number }).n;
    assert.ok(prima > 0);
    const ricalcolati = pulisciMdnsRipetuto();
    assert.ok(ricalcolati >= 1);
    assert.equal((d.prepare("SELECT COUNT(*) AS n FROM trunk_dichiarazioni WHERE chiave LIKE 'mdns%'").get() as { n: number }).n, 0);
    assert.ok((d.prepare("SELECT COUNT(*) AS n FROM trunk_dichiarazioni").get() as { n: number }).n > 0, "le altre restano");
    assert.equal((d.prepare("SELECT COUNT(*) AS n FROM attribution_evidence WHERE source = 'mdns'").get() as { n: number }).n, 0);
    assert.equal(getTenantSetting(CHIAVE_CURSORE), "");
    assert.equal(pulisciMdnsRipetuto(), 0, "la seconda volta non fa niente");
  });
});

test("un sensore più vecchio non ha la rotta: nessun errore", async () => {
  await withTenant(T, async () => {
    const leggi = (async () => { throw new Error("sensore: HTTP 404"); }) as Parameters<typeof sincronizzaDichiarazioni>[0];
    assert.equal(await sincronizzaDichiarazioni(leggi), null);
  });
});
