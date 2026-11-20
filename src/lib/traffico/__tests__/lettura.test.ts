/**
 * Lettura dei collector di traffico (2026-11-20): somma sul conflitto, cursore fermo
 * su errore, massimo fra collector, buco, gettone mai in chiaro.
 *
 * Run: node --import tsx --test src/lib/traffico/__tests__/lettura.test.ts
 */
import "@/lib/__tests__/support/data-dir-isolata";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { closeTenantDb, deleteTenantDatabase, withTenant } from "@/lib/db-tenant";
import { closeHubDb } from "@/lib/db-hub";
import {
  accessoCollector, coppieDiHost, creaCollector, dbTraffico, elencoCollector, eliminaCollector,
  sincronizzaTraffico, type Lettore, type RigaCollector,
} from "@/lib/traffico/lettura";
import { normalizzaImpronta, urlCollector } from "@/lib/traffico/collector-client";

const T = "TRAFF2011";
const oggi = new Date().toISOString().slice(0, 10);

function riga(seq: number, client: string, server: string, porta: number, byte: number, ora = "10:00:00"): RigaCollector {
  return { seq, inizio: `${oggi} ${ora}`, durata_s: 300, client, server, proto: 6, porta, byte, pacchetti: 1, flussi: 1, esterni: 0 };
}

/** Un collector finto: risponde dalle righe date, a pagine, come l'API vera. */
function finto(righe: RigaCollector[], opzioni: { buco?: boolean; rotto?: boolean } = {}): Lettore {
  return (async (_c: unknown, percorso: string) => {
    if (percorso === "/v1/stato") return { versione: "t", nome: "t", avviato: "", ultimo_seq: righe.length, pacchetti_visti: 90, pacchetti_persi: 10, copertura: 0.9 };
    if (opzioni.rotto) throw new Error("Collector non raggiungibile: connect ECONNREFUSED 192.168.99.89:8477");
    const u = new URL(percorso, "https://x");
    const dopo = Number(u.searchParams.get("dopo"));
    const limite = Number(u.searchParams.get("limite"));
    const dopoIl = righe.filter((r) => r.seq > dopo);
    const pagina = dopoIl.slice(0, limite);
    return { righe: pagina, ultimo_seq: pagina.at(-1)?.seq ?? dopo, altri: dopoIl.length > limite, buco: opzioni.buco === true };
  }) as Lettore;
}

after(() => {
  closeTenantDb(T);
  deleteTenantDatabase(T);
  closeHubDb();
});

test("somma sul conflitto, cursore, copertura; il gettone non esce e non sta in chiaro", async () => {
  await withTenant(T, async () => {
    const id = creaCollector({ nome: "banco", sede: "lab", url: "https://192.168.99.89:8477", gettone: "segreto-di-prova", impronta: "AA:BB" });
    const righe = [riga(1, "192.168.99.88", "192.168.99.221", 502, 100), riga(2, "192.168.99.88", "192.168.99.221", 502, 50, "10:05:00"), riga(3, "192.168.99.88", "192.168.99.222", 80, 7)];
    assert.deepEqual(await sincronizzaTraffico(finto(righe)), { collector: 1, righe: 3, errori: 0 });
    // secondo giro senza novità: niente si somma due volte
    assert.deepEqual(await sincronizzaTraffico(finto(righe)), { collector: 1, righe: 0, errori: 0 });
    const c = elencoCollector()[0];
    assert.equal(c.cursore_coppie, 3);
    assert.equal(c.copertura, 0.9);
    assert.equal(c.ultimo_errore, null);
    assert.ok(!JSON.stringify(c).includes("segreto"));
    assert.ok(!("gettone_enc" in c));
    const cifrato = (dbTraffico().prepare("SELECT gettone_enc FROM traffico_collector WHERE id = ?").get(id) as { gettone_enc: string }).gettone_enc;
    assert.ok(!cifrato.includes("segreto-di-prova"));
    assert.equal(accessoCollector(id)?.gettone, "segreto-di-prova");
    const h = coppieDiHost("192.168.99.221");
    assert.equal(h.gliParlano.length, 1);
    assert.deepEqual([h.gliParlano[0].altro, h.gliParlano[0].porta, h.gliParlano[0].byte, h.gliParlano[0].flussi], ["192.168.99.88", 502, 150, 2]);
    assert.equal(h.gliParlano[0].ultima_vista, `${oggi} 10:05:00`);
    assert.equal(coppieDiHost("192.168.99.88").parlaCon.length, 2);
  });
});

test("errore di rete: cursore fermo, motivo scritto senza indirizzi; poi si riparte da lì", async () => {
  await withTenant(T, async () => {
    const righe = [riga(4, "192.168.99.88", "192.168.99.222", 80, 5)];
    const e = await sincronizzaTraffico(finto(righe, { rotto: true }));
    assert.equal(e.errori, 1);
    let c = elencoCollector()[0];
    assert.equal(c.cursore_coppie, 3);
    assert.match(c.ultimo_errore ?? "", /non raggiungibile/);
    assert.ok(!(c.ultimo_errore ?? "").includes("192.168.99.89"));
    assert.equal((await sincronizzaTraffico(finto(righe, { buco: true }))).righe, 1);
    c = elencoCollector()[0];
    assert.equal(c.cursore_coppie, 4);
    assert.equal(c.ultimo_errore, null);
    assert.ok(c.ultimo_buco, "il buco va scritto");
  });
});

test("lo stesso flusso da due collector: massimo, non somma", async () => {
  await withTenant(T, async () => {
    const secondo = creaCollector({ nome: "secondo", sede: "lab", url: "https://192.168.99.90:8477", gettone: "altro", impronta: "CC" });
    dbTraffico().prepare("UPDATE traffico_collector SET attivo = 0 WHERE id <> ?").run(secondo);
    await sincronizzaTraffico(finto([riga(1, "192.168.99.88", "192.168.99.221", 502, 400)]));
    const h = coppieDiHost("192.168.99.221");
    assert.equal(h.gliParlano.length, 1);
    assert.equal(h.gliParlano[0].byte, 400); // 150 dal primo, 400 dal secondo: 400, non 550
    assert.equal(eliminaCollector(secondo), true);
    assert.equal(coppieDiHost("192.168.99.221").gliParlano[0].byte, 150);
  });
});

test("più pagine in un giro, e righe malformate scartate", async () => {
  await withTenant(T, async () => {
    const id = creaCollector({ nome: "grande", sede: "", url: "https://192.168.99.91:8477", gettone: "g", impronta: "DD" });
    dbTraffico().prepare("UPDATE traffico_collector SET attivo = CASE WHEN id = ? THEN 1 ELSE 0 END").run(id);
    const righe = Array.from({ length: 2500 }, (_, i) => riga(i + 1, `10.1.${Math.floor(i / 250)}.${i % 250}`, "10.9.9.9", 443, 1));
    righe[10] = { ...righe[10], inizio: "2026-11-20T10:00:00" }; // la «T»: non deve entrare
    assert.deepEqual(await sincronizzaTraffico(finto(righe)), { collector: 1, righe: 2499, errori: 0 });
    assert.equal(elencoCollector().find((c) => c.id === id)?.cursore_coppie, 2500);
  });
});

test("impronta e indirizzo", () => {
  assert.equal(normalizzaImpronta("6d:8f:a7"), normalizzaImpronta("6D8FA7"));
  assert.equal(urlCollector("http://192.168.99.89:8477"), null);
  assert.equal(urlCollector("https://utente:pw@192.168.99.89:8477"), null);
  assert.equal(urlCollector("https://192.168.99.89:8477")?.port, "8477");
});
