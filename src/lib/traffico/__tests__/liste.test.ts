/**
 * Liste di DA-GEO (24/11/2026): si scaricano intere, si confrontano in locale, una lista non arrivata intera non
 * sostituisce quella di prima, il codice non esce mai. Nessuna richiesta vera: `fetch` è finta.
 *
 * Run: node --import tsx --test src/lib/traffico/__tests__/liste.test.ts
 */
import "@/lib/__tests__/support/data-dir-isolata";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { closeTenantDb, deleteTenantDatabase, withTenant } from "@/lib/db-tenant";
import { closeHubDb } from "@/lib/db-hub";
import { dbTraffico, creaCollector, sincronizzaTraffico, type Lettore } from "@/lib/traffico/lettura";
import { aggiornaListe, codiceValido, creaCercaListe, impostaFonte, leggiConfigurazione, leggiPrefissi, statoListe, togliFonte, urlListe, versoCompromessi } from "@/lib/traffico/liste";
import { esternoTraffico } from "@/lib/traffico/esterno";

const T = "TRAFFLISTE2411";
const CODICE = "0123456789abcdef0123456789abcdef";
const vera = globalThis.fetch;
after(() => { globalThis.fetch = vera; closeTenantDb(T); deleteTenantDatabase(T); closeHubDb(); });

const lista = (nome: string, tipo: string, voci: number) => ({ nome, tipo, titolo: nome.toUpperCase(), fonte: "", voci, generato: "2026-11-24 04:10:00", in_errore: false });
let config: unknown = null;
let file: Record<string, string> = {};
const chieste: string[] = [];
globalThis.fetch = (async (u: string | URL) => {
  chieste.push(String(u));
  if (String(u).endsWith("/config.json")) return config === null ? new Response("no", { status: 404 }) : new Response(JSON.stringify(config));
  const t = file[String(u).split("/").at(-1)!];
  return t === undefined ? new Response("no", { status: 503 }) : new Response(t);
}) as typeof fetch;

const adesso = new Date();
const riga = (seq: number, interno: string, ip: string, verso = "fuori") =>
  ({ seq, inizio: adesso.toISOString().slice(0, 19).replace("T", " "), interno, ip, verso, proto: 6, porta: 443, byte: 10, pacchetti: 1, flussi: 1 });
const finto = (esterni: ReturnType<typeof riga>[]): Lettore => (async (_c: unknown, percorso: string) => {
  if (percorso === "/v1/stato") return { versione: "t", nome: "t", avviato: "", ultimo_seq: 0, pacchetti_visti: 1, pacchetti_persi: 0, copertura: 1 };
  const u = new URL(percorso, "https://x");
  const dopo = Number(u.searchParams.get("dopo"));
  const righe = u.pathname === "/v1/esterni" ? esterni.filter((r) => r.seq > dopo) : [];
  return { righe, ultimo_seq: righe.at(-1)?.seq ?? dopo, altri: false, buco: false };
}) as Lettore;

test("regole pure: indirizzo, codice, prefissi, configurazione", () => {
  assert.equal(urlListe("https://survey.domarc.it/geo/"), "https://survey.domarc.it/geo");
  for (const u of ["http://survey.domarc.it/geo", "https://a:b@x/geo", "https://x/geo?a=1", "boh"]) assert.equal(urlListe(u), null);
  assert.ok(codiceValido(CODICE) && !codiceValido("../../admin"));
  assert.deepEqual(leggiPrefissi("# testa\n1.2.3.0/24\n1.2.4.9/32\n"), [[16909056, 16909311], [16909321, 16909321]]);
  assert.deepEqual(leggiPrefissi("0.0.0.0/0"), [[0, 4294967295]]);
  assert.equal(leggiPrefissi("1.2.3.0/24\n<html>"), null);
  assert.equal(leggiPrefissi("999.2.3.0/24"), null);
  assert.equal(leggiConfigurazione({ formato: 2, liste: [] }), null);
  assert.equal(leggiConfigurazione({ formato: 1, liste: [lista("../x", "geo", 1)] }), null);
  assert.equal(leggiConfigurazione({ formato: 1, liste: [lista("x", "altro", 1)] }), null);
  const cerca = (ip: string) => (ip === "5.0.0.1" ? [{ nome: "r", titolo: "R", tipo: "reputazione" as const }] : []);
  const r = { interno: "10.0.0.1", proto: 6, porta: 443 };
  assert.deepEqual(versoCompromessi([{ ...r, ip: "5.0.0.1", verso: "fuori" }, { ...r, ip: "5.0.0.1", verso: "dentro" }, { ...r, ip: "6.0.0.1", verso: "fuori" }], cerca).map((a) => [a.client, a.server, a.gravita]), [["10.0.0.1", "5.0.0.1", 3]]);
});

test("scarico, confronto, avviso, lista troncata, errore senza codice", async () => {
  await withTenant(T, async () => {
    assert.equal((await aggiornaListe()).configurato, false);
    assert.equal(chieste.length, 0);
    config = { formato: 1, liste: [lista("rep", "reputazione", 2), lista("geo-BLOCK", "geo", 1), lista("amm", "ammessi", 1)] };
    file = { "rep.txt": "5.0.0.0/24\n7.0.0.0/24\n", "geo-BLOCK.txt": "6.0.0.0/8\n", "amm.txt": "7.0.0.9/32\n" };
    impostaFonte("https://survey.domarc.it/geo", CODICE);
    let s = await aggiornaListe(new Date("2026-11-24T06:00:00Z"));
    assert.deepEqual([s.errore, s.liste.map((l) => [l.nome, l.voci, l.vecchia])], [null, [["rep", 2, false], ["geo-BLOCK", 1, false], ["amm", 1, false]]]);
    assert.ok(!JSON.stringify(s).includes(CODICE));
    assert.equal(statoListe(new Date("2026-12-24T06:00:00Z")).liste[0].vecchia, true);
    const d = dbTraffico();
    assert.ok(!JSON.stringify(d.prepare("SELECT * FROM traffico_liste_fonte").all()).includes(CODICE));
    const cerca = () => (ip: string) => creaCercaListe(d)(ip).map((x) => x.nome);
    assert.deepEqual(["5.0.0.77", "5.0.1.0", "6.255.255.255", "7.0.0.8", "7.0.0.9", "::1", "altri"].map(cerca()), [["rep"], [], ["geo-BLOCK"], ["rep"], ["amm"], [], []]);

    creaCollector({ nome: "a", sede: "", url: "https://192.168.99.89:8477", gettone: "g", impronta: "AA" });
    assert.equal((await sincronizzaTraffico(finto([riga(1, "10.4.0.10", "5.0.0.77"), riga(2, "10.4.0.11", "6.1.1.1"), riga(3, "10.4.0.12", "7.0.0.9"), riga(4, "10.4.0.13", "5.0.0.78", "dentro"), riga(5, "10.4.0.14", "9.9.9.9")]))).errori, 0);
    assert.deepEqual(d.prepare("SELECT client, server, gravita, dettaglio FROM traffico_anomalie WHERE tipo = 'indirizzo_compromesso'").all(), [{ client: "10.4.0.10", server: "5.0.0.77", gravita: 3, dettaglio: '{"lista":"REP"}' }]);
    const v = esternoTraffico({ giorni: 1, per: "destinazione" });
    assert.deepEqual([v.tessere.compromesse, v.tessere.bloccherebbe], [2, 1]);
    assert.deepEqual(esternoTraffico({ giorni: 1, per: "destinazione", segnate: "bloccate" }).righe.map((r) => [r.chiave, r.liste.map((l) => l.nome)]), [["6.1.1.1", ["geo-BLOCK"]]]);
    const t = esternoTraffico({ giorni: 1, per: "destinazione", segnate: "bloccate" }).tessere;
    assert.deepEqual([t.destinazioni, t.compromesse, t.bloccherebbe], [1, 2, 1]); // il filtro non azzera l'altra tessera
    assert.deepEqual(esternoTraffico({ giorni: 1, per: "host", segnate: "compromesse" }).righe.map((r) => r.chiave).sort(), ["10.4.0.10", "10.4.0.13"]);

    // troncata: la lista di prima resta; non più dichiarata: si toglie
    config = { formato: 1, liste: [lista("rep", "reputazione", 3), lista("amm", "ammessi", 1)] };
    s = await aggiornaListe();
    assert.match(s.errore ?? "", /rep/);
    assert.deepEqual(["5.0.0.77", "6.1.1.1"].map(cerca()), [["rep"], []]);
    // codice revocato: errore senza il codice, le liste restano
    config = null;
    s = await aggiornaListe();
    assert.ok(s.errore && !s.errore.includes(CODICE));
    assert.deepEqual(cerca()("5.0.0.77"), ["rep"]);
    // controllo spento per le reti non censite: niente avviso
    d.prepare("DELETE FROM traffico_anomalie").run();
    d.prepare("INSERT INTO traffico_controlli (network_id, tipo, acceso) VALUES (0, 'indirizzo_compromesso', 0)").run();
    await sincronizzaTraffico(finto([riga(6, "10.4.0.10", "5.0.0.79")]));
    assert.equal((d.prepare("SELECT COUNT(*) AS n FROM traffico_anomalie WHERE tipo = 'indirizzo_compromesso'").get() as { n: number }).n, 0);
    togliFonte();
    assert.deepEqual([statoListe().configurato, cerca()("5.0.0.77")], [false, []]);
  });
  assert.ok(chieste.every((u) => u.startsWith("https://survey.domarc.it/geo/l/") && !/10\.4|5\.0\.0|9\.9/.test(u)));
});
