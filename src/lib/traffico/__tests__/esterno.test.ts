/**
 * Verso l'esterno (2026-11-23): le destinazioni tenute dal collector, il tetto dichiarato, paese e fornitore
 * dall'archivio locale, il paese nuovo solo dopo l'apprendimento.
 *
 * Run: node --import tsx --test src/lib/traffico/__tests__/esterno.test.ts
 */
import "@/lib/__tests__/support/data-dir-isolata";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { closeTenantDb, deleteTenantDatabase, withTenant } from "@/lib/db-tenant";
import { closeHubDb } from "@/lib/db-hub";
import { creaCollector, dbTraffico, sincronizzaTraffico, type Lettore } from "@/lib/traffico/lettura";
import { calcolaEsterno, esternoTraffico, paesiNuovi, type EsternoCollector, type NomeIpCollector, type RigaEsterna } from "@/lib/traffico/esterno";
import { campiCsv, chiudiGeo, creaCercaGeo, importaGeo, statoGeo } from "@/lib/traffico/geo";
import { salvaOggetto } from "@/lib/traffico/oggetti";
import { fraseAnomalia, nomePaese } from "@/lib/traffico/frasi";

const T = "TRAFFEST2311";
const adesso = new Date();
const alle = (giorniFa: number): string => new Date(adesso.getTime() - giorniFa * 86_400_000).toISOString().slice(0, 19).replace("T", " ");
let seq = 0;
const riga = (interno: string, ip: string, byte: number, extra: Partial<EsternoCollector> = {}): EsternoCollector =>
  ({ seq: ++seq, inizio: alle(0), interno, ip, verso: "fuori", proto: 6, porta: 443, byte, pacchetti: 1, flussi: 1, ...extra });

function finto(esterni: EsternoCollector[], nomi: NomeIpCollector[] = []): Lettore {
  return (async (_c: unknown, percorso: string) => {
    if (percorso === "/v1/stato") return { versione: "t", nome: "t", avviato: "", ultimo_seq: 0, pacchetti_visti: 1, pacchetti_persi: 0, copertura: 1 };
    const u = new URL(percorso, "https://x");
    const dopo = Number(u.searchParams.get("dopo"));
    const tutte = u.pathname === "/v1/esterni" ? esterni : u.pathname === "/v1/nomi-ip" ? nomi : [];
    const righe = (tutte as { seq: number }[]).filter((r) => r.seq > dopo);
    return { righe, ultimo_seq: righe.at(-1)?.seq ?? dopo, altri: false, buco: false };
  }) as Lettore;
}

after(() => {
  chiudiGeo();
  closeTenantDb(T);
  deleteTenantDatabase(T);
  closeHubDb();
});

test("regole pure: raggruppamenti, il tetto dichiarato, la ricerca, il paese nuovo solo per chi apre da dentro", () => {
  const r = (interno: string, ip: string, byte: number, verso = "fuori", flussi = 1): RigaEsterna => ({ interno, ip, verso, proto: 6, porta: 443, byte, flussi, ultima_vista: "2026-11-23 10:00:00" });
  const righe = [r("10.4.0.10", "93.184.216.34", 1000), r("10.4.0.11", "93.184.216.34", 500), r("10.4.0.10", "5.9.1.1", 300), r("10.4.0.20", "8.8.8.8", 70, "dentro"), r("10.4.0.10", "altri", 40, "fuori", 12)];
  const info = (ip: string) => (ip.startsWith("93.") ? { nome: "posta.esempio.it", paese: "US", asn: 15133, fornitore: "Edgecast" } : ip.startsWith("5.") ? { nome: null, paese: "DE", asn: 24940, fornitore: "Hetzner" } : { nome: null, paese: null, asn: null, fornitore: null });
  const dest = calcolaEsterno(righe, info, { per: "destinazione" });
  assert.deepEqual(dest.tessere, { destinazioni: 3, paesi: 2, fornitori: 2, byte: 1870, host: 3 });
  assert.deepEqual(dest.righe.map((x) => [x.chiave, x.nome, x.paese, x.host, x.byte]), [["93.184.216.34", "posta.esempio.it", "US", 2, 1500], ["5.9.1.1", null, "DE", 1, 300], ["8.8.8.8", null, null, 1, 70]]);
  assert.equal(dest.righe[2].byte_dentro, 70);
  assert.deepEqual(dest.altri, { host: 1, byte: 40, indirizzi: 12 });
  assert.deepEqual(calcolaEsterno(righe, info, { per: "paese" }).righe.map((x) => [x.chiave, x.destinazioni, x.byte]), [["US", 1, 1500], ["DE", 1, 300], ["", 1, 70]]);
  assert.deepEqual(calcolaEsterno(righe, info, { per: "host" }).righe.map((x) => [x.chiave, x.destinazioni]), [["10.4.0.10", 2], ["10.4.0.11", 1], ["10.4.0.20", 1]]);
  assert.equal(calcolaEsterno(righe, info, { per: "destinazione", cerca: "HETZ" }).totale, 1);
  assert.equal(calcolaEsterno([r("10.4.0.10", "5.9.1.1", 1)], info, { per: "destinazione" }).altri, null);
  const geo = (ip: string) => ({ ...info(ip) });
  assert.deepEqual(paesiNuovi([{ interno: "10.4.0.10", ip: "5.9.1.1", verso: "fuori" }, { interno: "10.4.0.11", ip: "5.9.1.2", verso: "fuori" }, { interno: "10.4.0.20", ip: "93.184.216.34", verso: "dentro" }, { interno: "10.4.0.10", ip: "altri", verso: "fuori" }], new Set(), geo).map((a) => [a.client, a.server, a.dettaglio.paese]), [["10.4.0.10", "5.9.1.1", "DE"]]);
  assert.equal(paesiNuovi([{ interno: "10.4.0.10", ip: "5.9.1.1", verso: "fuori" }], new Set(["DE"]), geo).length, 0);
  assert.deepEqual(campiCsv('1.0.0.0,1.0.0.255,13335,"Cloudflare, ""Inc."""'), ["1.0.0.0", "1.0.0.255", "13335", 'Cloudflare, "Inc."']);
  assert.equal(nomePaese("DE"), "Germania");
  assert.ok(fraseAnomalia({ tipo: "paese_nuovo", client: "a", server: "b", dettaglio: { paese: "DE" } }).includes("Germania"));
});

test("dal collector alla vista: archivio locale, nome dato a mano, massimo fra collector, paese nuovo dopo 14 giorni", async () => {
  assert.equal(statoGeo().presente, false);
  assert.equal(creaCercaGeo()("5.9.1.1").paese, null); // senza archivio: nessun paese, nessun errore
  await importaGeo("paese", ["5.9.0.0,5.9.255.255,DE", "93.184.216.0,93.184.216.255,US", "2001:db8::,2001:db8::ffff,ZZ", "45.0.0.0,45.0.0.255,BR"], 1);
  await importaGeo("asn", ['5.9.0.0,5.9.255.255,24940,"Hetzner Online GmbH"', '93.184.216.0,93.184.216.255,15133,"Edgecast Inc."'], 1);
  // un archivio troppo corto non sostituisce quello buono
  await assert.rejects(importaGeo("paese", ["1.0.0.0,1.0.0.255,AU"]));
  const geo = creaCercaGeo();
  assert.deepEqual(geo("5.9.1.1"), { paese: "DE", asn: 24940, fornitore: "Hetzner Online GmbH" });
  assert.deepEqual(geo("6.0.0.1"), { paese: null, asn: null, fornitore: null }); // fra due intervalli
  assert.deepEqual([statoGeo().paesi, statoGeo().fornitori], [3, 2]);

  await withTenant(T, async () => {
    const d = dbTraffico();
    creaCollector({ nome: "a", sede: "", url: "https://192.168.99.89:8477", gettone: "g", impronta: "AA" });
    creaCollector({ nome: "b", sede: "", url: "https://192.168.99.90:8477", gettone: "g", impronta: "AA" });
    const esterni = [riga("10.4.0.10", "93.184.216.34", 1000), riga("10.4.0.10", "5.9.1.1", 300), riga("10.4.0.10", "altri", 40, { flussi: 12, proto: 0, porta: 0 }), riga("", "1.1.1.1", 5)];
    const nomi: NomeIpCollector[] = [{ seq: 1, visto: alle(0), ip: "93.184.216.34", tipo: "dns", nome: "chiesto.esempio.it" }, { seq: 2, visto: alle(0), ip: "93.184.216.34", tipo: "sni", nome: "posta.esempio.it" }];
    assert.equal((await sincronizzaTraffico(finto(esterni, nomi))).errori, 0);
    const v = esternoTraffico({ giorni: 1, per: "destinazione" });
    // i due collector vedono lo stesso: massimo, non somma; la riga storta non entra
    assert.deepEqual(v.righe.map((x) => [x.chiave, x.nome, x.paese, x.fornitore, x.byte]), [["93.184.216.34", "posta.esempio.it", "US", "Edgecast Inc.", 1000], ["5.9.1.1", null, "DE", "Hetzner Online GmbH", 300]]);
    assert.deepEqual(v.altri, { host: 1, byte: 40, indirizzi: 12 });
    assert.equal(v.archivio.presente, true);
    // il nome dato a mano (tappa 3) vince su quello letto dal traffico
    assert.ok(salvaOggetto({ chiave: "5.9.1.1", nome: "Backup fuori sede", chi: "riccardo" }).ok);
    assert.equal(esternoTraffico({ giorni: 1, per: "destinazione" }).righe[1].nome, "Backup fuori sede");
    // in apprendimento i paesi si imparano senza avvisi
    assert.equal((d.prepare("SELECT COUNT(*) AS n FROM traffico_anomalie WHERE tipo = 'paese_nuovo'").get() as { n: number }).n, 0);
    assert.deepEqual((d.prepare("SELECT paese FROM traffico_paesi ORDER BY paese").all() as { paese: string }[]).map((p) => p.paese), ["DE", "US"]);
    // quindici giorni dopo il primo paese, uno mai visto dà l'avviso; uno già noto no
    d.prepare("UPDATE traffico_paesi SET prima_vista = ?").run(alle(15));
    await sincronizzaTraffico(finto([...esterni, riga("10.4.0.11", "45.0.0.9", 9), riga("10.4.0.11", "5.9.1.2", 9)], nomi));
    assert.deepEqual(d.prepare("SELECT client, server, gravita, dettaglio FROM traffico_anomalie WHERE tipo = 'paese_nuovo'").all(), [{ client: "10.4.0.11", server: "45.0.0.9", gravita: 2, dettaglio: '{"paese":"BR"}' }]);
  });
});
