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
import { andamentoTraffico, insiemeTraffico } from "@/lib/traffico/insieme";

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
    if (u.pathname !== "/v1/coppie") return { righe: [], ultimo_seq: dopo, altri: false, buco: false }; // niente fatti né nomi
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

test("fonte: il NetFlow dello stesso collector non si somma al mirror; tabella nata senza `fonte` ricostruita", async () => {
  await withTenant(T, async () => {
    const id = creaCollector({ nome: "misto", sede: "", url: "https://192.168.99.92:8477", gettone: "g", impronta: "EE" });
    dbTraffico().prepare("UPDATE traffico_collector SET attivo = CASE WHEN id = ? THEN 1 ELSE 0 END").run(id);
    await sincronizzaTraffico(finto([
      { ...riga(1, "10.5.0.1", "10.5.0.2", 443, 1000), fonte: "mirror" },
      { ...riga(2, "10.5.0.1", "10.5.0.2", 443, 900), fonte: "netflow" },
      { ...riga(3, "10.5.0.1", "10.5.0.2", 443, 10), fonte: "inventata" },
    ]));
    const h = coppieDiHost("10.5.0.2").gliParlano;
    assert.equal(h.length, 1);
    assert.equal(h[0].byte, 1010); // mirror 1000 + 10 (fonte sconosciuta = mirror); il netflow (900) non si somma
    assert.deepEqual(h[0].fonti.split(",").sort(), ["mirror", "netflow"]);
  });
  // la migrazione: una tabella con la chiave vecchia tiene le sue righe e prende la colonna
  const Database = (await import("better-sqlite3")).default;
  const { assicuraTabelleTraffico } = await import("@/lib/traffico/schema");
  const d = new Database(":memory:");
  d.exec(`CREATE TABLE traffico_coppie (
    giorno TEXT NOT NULL, collector_id INTEGER NOT NULL, client TEXT NOT NULL, server TEXT NOT NULL,
    proto INTEGER NOT NULL, porta INTEGER NOT NULL, byte INTEGER NOT NULL, pacchetti INTEGER NOT NULL,
    flussi INTEGER NOT NULL, esterni INTEGER NOT NULL DEFAULT 0, prima_vista TEXT NOT NULL, ultima_vista TEXT NOT NULL,
    PRIMARY KEY (giorno, collector_id, client, server, proto, porta));
    INSERT INTO traffico_coppie VALUES ('2026-11-20', 1, 'a', 'b', 6, 80, 5, 1, 1, 0, 'x', 'y');`);
  assicuraTabelleTraffico(d);
  assert.deepEqual(d.prepare("SELECT fonte, byte FROM traffico_coppie").all(), [{ fonte: "mirror", byte: 5 }]);
  d.prepare("INSERT INTO traffico_coppie (giorno, collector_id, fonte, client, server, proto, porta, byte, pacchetti, flussi, prima_vista, ultima_vista) VALUES ('2026-11-20', 1, 'sflow', 'a', 'b', 6, 80, 7, 1, 1, 'x', 'y')").run();
  assert.equal((d.prepare("SELECT COUNT(*) AS n FROM traffico_coppie").get() as { n: number }).n, 2);
  d.close();
});

test("sonde note (22/11): le loro scansioni non si salvano, chi apre un loro servizio sì; il già salvato si toglie", async () => {
  const { ripulisciRumore, rumoreDiSonda } = await import("@/lib/traffico/sonde");
  const sonde = new Set(["192.168.50.8"]);
  assert.equal(rumoreDiSonda({ client: "192.168.50.8", server: "192.168.50.20", proto: 6, porta: 22 }, sonde), true);
  assert.equal(rumoreDiSonda({ client: "192.168.50.20", server: "192.168.50.8", proto: 6, porta: 0 }, sonde), true);
  assert.equal(rumoreDiSonda({ client: "192.168.50.20", server: "192.168.50.8", proto: 1, porta: 0 }, sonde), true);
  assert.equal(rumoreDiSonda({ client: "192.168.50.20", server: "192.168.50.8", proto: 6, porta: 443 }, sonde), false);
  assert.equal(rumoreDiSonda({ client: "192.168.50.8", server: "192.168.50.20", proto: 6, porta: 22 }, new Set()), false);
  await withTenant(T, async () => {
    const d = dbTraffico();
    const id = creaCollector({ nome: "sonde", sede: "lab", url: "https://192.168.50.89:8477", gettone: "g", impronta: "AA:BB" });
    const righe = [
      riga(1, "192.168.50.8", "192.168.50.20", 22, 100),
      riga(2, "192.168.50.20", "192.168.50.8", 0, 100),
      riga(3, "192.168.50.20", "192.168.50.8", 443, 100),
    ];
    // Prima senza conoscere la sonda: entra tutto.
    await sincronizzaTraffico(finto(righe));
    const conta = () => (d.prepare("SELECT COUNT(*) AS n FROM traffico_coppie WHERE collector_id = ?").get(id) as { n: number }).n;
    assert.equal(conta(), 3);
    // Poi la sonda è nota: il già salvato si toglie, resta chi apre la sua 443.
    const tolte = ripulisciRumore(d, sonde);
    assert.equal(tolte.coppie, 2);
    assert.equal(conta(), 1);
    assert.deepEqual(ripulisciRumore(d, sonde), { coppie: 0, abitudini: 0, anomalie: 0 }); // seconda volta: niente da fare
    // E le righe nuove della sonda non entrano, ma il cursore avanza.
    await sincronizzaTraffico(finto([...righe, riga(4, "192.168.50.8", "192.168.50.21", 80, 100)]), undefined, sonde);
    assert.equal(conta(), 1);
    assert.equal((d.prepare("SELECT cursore_coppie AS c FROM traffico_collector WHERE id = ?").get(id) as { c: number }).c, 4);
  });
});

test("le coppie per ora: stessa ora si somma, ore diverse restano distinte, il massimo fra collector, via col collector", async () => {
  const T2 = "TRAFFORE23";
  try {
    await withTenant(T2, async () => {
      const a = creaCollector({ nome: "a", sede: "", url: "https://192.168.99.89:8477", gettone: "g", impronta: "AA" });
      creaCollector({ nome: "b", sede: "", url: "https://192.168.99.90:8477", gettone: "g", impronta: "AA" });
      const adesso = new Date();
      const hh = (d: Date) => d.toISOString().slice(11, 13);
      const ora = hh(adesso);
      const prima = hh(new Date(adesso.getTime() - 3 * 3_600_000));
      // i due collector vedono le stesse righe: non si sommano fra loro
      const righe = [
        riga(1, "192.168.99.88", "192.168.99.221", 502, 100, `${ora}:00:00`),
        riga(2, "192.168.99.88", "192.168.99.221", 502, 50, `${ora}:05:00`),
        riga(3, "192.168.99.88", "192.168.99.221", 502, 7, `${prima}:00:00`),
      ];
      await sincronizzaTraffico(finto(righe));
      const d = dbTraffico();
      const perOra = d.prepare("SELECT ora, byte FROM traffico_ore WHERE collector_id = ? ORDER BY byte").all(a) as { ora: string; byte: number }[];
      assert.deepEqual(perOra.map((x) => x.byte), [7, 150]);
      assert.ok(perOra.every((x) => x.ora.endsWith(":00:00")));
      const stessoGiorno = ora >= prima; // a cavallo della mezzanotte UTC la riga «prima» ha la data di oggi ma un'ora futura
      const ultimaOra = insiemeTraffico({ vista: "coppie", giorni: 0 });
      assert.equal(ultimaOra.tessere.byte, stessoGiorno ? 150 : 157);
      assert.ok(ultimaOra.dalle);
      const oggiTutto = insiemeTraffico({ vista: "coppie", giorni: 1 });
      assert.equal(oggiTutto.tessere.byte, 157);
      assert.deepEqual([oggiTutto.coppie[0].pacchetti, oggiTutto.coppie[0].flussi], [3, 3]);
      const punti = andamentoTraffico({ host: "192.168.99.88" }).punti;
      assert.equal(punti.length, 24);
      assert.equal(punti.at(-1)!.byte, 150);
      assert.equal(andamentoTraffico({ host: "192.168.99.1" }).punti.reduce((s, p) => s + p.byte, 0), 0);
      eliminaCollector(a);
      assert.equal((d.prepare("SELECT COUNT(*) AS n FROM traffico_ore WHERE collector_id = ?").get(a) as { n: number }).n, 0);
    });
  } finally {
    closeTenantDb(T2);
    deleteTenantDatabase(T2);
  }
});
