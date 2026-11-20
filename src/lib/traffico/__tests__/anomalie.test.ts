/**
 * Anomalie del traffico (2026-11-20): una prova per regola, l'apprendimento che tace,
 * «normale» che non torna.
 *
 * Run: node --import tsx --test src/lib/traffico/__tests__/anomalie.test.ts
 */
import "@/lib/__tests__/support/data-dir-isolata";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { closeTenantDb, deleteTenantDatabase, withTenant } from "@/lib/db-tenant";
import { closeHubDb } from "@/lib/db-hub";
import {
  calcolaVolumi, chiaveCoppia, elencoAnomalie, segnaAnomalia, valutaFinestra, volumeAnomalo,
  type CoppiaFinestra, type IngressoFinestra,
} from "@/lib/traffico/anomalie";
import { creaCollector, dbTraffico, sincronizzaTraffico, type Lettore, type RigaCollector } from "@/lib/traffico/lettura";

const c = (client: string, server: string, porta: number, proto = 6, esterni = 0): CoppiaFinestra => ({ client, server, proto, porta, byte: 100, esterni });
// Reti finte: 10.1.x = rete 1, 10.2.x = rete 2, il resto fuori dalle reti censite.
const reteDi = (ip: string): number | null => (ip.startsWith("10.1.") ? 1 : ip.startsWith("10.2.") ? 2 : null);
function ingresso(coppie: CoppiaFinestra[], altro: Partial<IngressoFinestra> = {}): IngressoFinestra {
  const ip = coppie.flatMap((x) => [x.client, x.server]);
  return {
    coppie, abitudini: new Set(), serverNoti: new Map(), retiInApprendimento: new Set(), reteDi,
    impianti: new Set(), censiti: new Set(ip), chiuse: new Set(), ...altro,
  };
}
const tipi = (i: IngressoFinestra) => valutaFinestra(i).map((a) => a.tipo).sort();

test("coppia_nuova: mai vista, tutti e due interni; nota o verso fuori non esce", () => {
  const x = c("10.1.0.5", "10.1.0.9", 445);
  const a = valutaFinestra(ingresso([x]));
  assert.deepEqual(a.map((y) => [y.tipo, y.gravita, y.client, y.server, y.porta]), [["coppia_nuova", 1, "10.1.0.5", "10.1.0.9", 445]]);
  assert.deepEqual(tipi(ingresso([x], { abitudini: new Set([chiaveCoppia(x)]) })), []);
  assert.deepEqual(tipi(ingresso([c("10.1.0.5", "esterno", 443, 6, 3)])), []);
  assert.deepEqual(tipi(ingresso([c("10.1.0.5", "diffusione", 5353, 17)])), []);
});

test("porta_nuova: server noto, porta mai vista su di lui e diversa da 0", () => {
  const noti = new Map([["10.1.0.9", new Set([445])]]);
  const a = valutaFinestra(ingresso([c("10.1.0.5", "10.1.0.9", 3389)], { serverNoti: noti }));
  assert.deepEqual(a.map((y) => [y.tipo, y.gravita, y.porta]), [["porta_nuova", 2, 3389]]);
  assert.deepEqual(tipi(ingresso([c("10.1.0.5", "10.1.0.9", 0)], { serverNoti: noti })), ["coppia_nuova"]);
  assert.deepEqual(tipi(ingresso([c("10.1.0.6", "10.1.0.9", 445)], { serverNoti: noti })), ["coppia_nuova"]);
});

test("molti_contatti: 30 server interni diversi nella stessa finestra, 29 no", () => {
  const verso = (n: number) => Array.from({ length: n }, (_, i) => c("10.1.0.5", `10.1.1.${i + 1}`, 445));
  const abit = (n: number) => new Set(verso(n).map(chiaveCoppia));
  assert.deepEqual(tipi(ingresso(verso(29), { abitudini: abit(29) })), []);
  const a = valutaFinestra(ingresso(verso(30), { abitudini: abit(30) }));
  assert.deepEqual(a.map((y) => [y.tipo, y.gravita, y.client, y.dettaglio.server]), [["molti_contatti", 3, "10.1.0.5", 30]]);
});

test("impianto: coppia nuova con un impianto, o un impianto che esce", () => {
  const plc = new Set(["10.1.0.50"]);
  assert.deepEqual(valutaFinestra(ingresso([c("10.1.0.5", "10.1.0.50", 502)], { impianti: plc })).map((y) => [y.tipo, y.gravita]), [["impianto", 3]]);
  const fuori = c("10.1.0.50", "esterno", 443, 6, 2);
  // verso fuori vale anche se è un'abitudine: solo «è normale» lo spegne
  assert.deepEqual(tipi(ingresso([fuori], { impianti: plc, abitudini: new Set([chiaveCoppia(fuori)]) })), ["impianto"]);
  const nota = c("10.1.0.5", "10.1.0.50", 502);
  assert.deepEqual(tipi(ingresso([nota], { impianti: plc, abitudini: new Set([chiaveCoppia(nota)]) })), []);
});

test("vlan_chiuse: reti chiuse nella matrice, nel verso giusto, anche in apprendimento", () => {
  const x = c("10.1.0.5", "10.2.0.9", 22);
  const chiuse = new Set(["1|2"]);
  const a = valutaFinestra(ingresso([x], { chiuse, abitudini: new Set([chiaveCoppia(x)]), retiInApprendimento: new Set([1, 2]) }));
  assert.deepEqual(a.map((y) => [y.tipo, y.gravita]), [["vlan_chiuse", 3]]);
  assert.deepEqual(tipi(ingresso([c("10.2.0.9", "10.1.0.5", 22)], { chiuse, retiInApprendimento: new Set([1, 2]) })), []);
});

test("non_censito: IP interno di una rete censita che IPAM non conosce, anche in apprendimento", () => {
  const x = c("10.1.0.77", "10.1.0.9", 80);
  const a = valutaFinestra(ingresso([x], { censiti: new Set(["10.1.0.9"]), retiInApprendimento: new Set([1]) }));
  assert.deepEqual(a.map((y) => [y.tipo, y.gravita, y.client, y.server]), [["non_censito", 2, "10.1.0.77", ""]]);
  // fuori dalle reti censite non è un avviso: sarebbe rumore
  assert.deepEqual(tipi(ingresso([c("172.20.0.7", "10.1.0.9", 80)], { censiti: new Set(["10.1.0.9"]), abitudini: new Set(["172.20.0.7|10.1.0.9|6|80"]) })), []);
});

test("apprendimento: coppia, porta, molti contatti e impianto tacciono", () => {
  const coppie = [c("10.1.0.5", "10.1.0.50", 502), c("10.1.0.5", "10.1.0.9", 3389), ...Array.from({ length: 30 }, (_, i) => c("10.1.0.6", `10.1.1.${i + 1}`, 445))];
  const i = ingresso(coppie, { impianti: new Set(["10.1.0.50"]), serverNoti: new Map([["10.1.0.9", new Set([445])]]), retiInApprendimento: new Set([1]) });
  assert.deepEqual(tipi(i), []);
  assert.ok(tipi({ ...i, retiInApprendimento: new Set() }).length >= 3);
});

test("volume: più di 5 volte la mediana E più di 500 MB, con almeno 7 giorni di storia", () => {
  const MB = 1024 * 1024;
  const storia = Array(14).fill(100 * MB) as number[];
  assert.deepEqual(volumeAnomalo(600 * MB, storia), { mediana: 100 * MB });
  assert.equal(volumeAnomalo(499 * MB, Array(14).fill(MB) as number[]), null); // sotto i 500 MB
  assert.equal(volumeAnomalo(600 * MB, Array(14).fill(200 * MB) as number[]), null); // solo 3 volte
  assert.equal(volumeAnomalo(600 * MB, storia.slice(0, 6)), null); // storia troppo corta
});

// ── Col database: apprendimento per rete, «normale» che non torna ─────────────
const T = "TRAFFAN2011";
after(() => {
  closeTenantDb(T);
  deleteTenantDatabase(T);
  closeHubDb();
});

const giorno = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
function finto(righe: RigaCollector[]): Lettore {
  return (async (_c: unknown, percorso: string) => {
    if (percorso === "/v1/stato") return { copertura: 1 };
    const dopo = Number(new URL(percorso, "https://x").searchParams.get("dopo"));
    const pagina = righe.filter((r) => r.seq > dopo);
    return { righe: pagina, ultimo_seq: pagina.at(-1)?.seq ?? dopo, altri: false, buco: false };
  }) as Lettore;
}
const riga = (seq: number, inizio: string, client: string, server: string, porta: number): RigaCollector =>
  ({ seq, inizio, durata_s: 300, client, server, proto: 6, porta, byte: 10, pacchetti: 1, flussi: 1, esterni: 0 });

test("dal collector al database: l'apprendimento tace, dopo 14 giorni l'avviso esce, «normale» non torna", async () => {
  await withTenant(T, async () => {
    creaCollector({ nome: "banco", sede: "", url: "https://192.168.99.89:8477", gettone: "gettone-di-prova-1", impronta: "AA" });
    const d = dbTraffico();
    const tutte = () => elencoAnomalie(d, {}).anomalie;
    // 20 giorni fa: prima coppia della rete, in apprendimento → nessun avviso, ma è un'abitudine
    await sincronizzaTraffico(finto([riga(1, `${giorno(20)} 10:00:00`, "172.20.0.5", "172.20.0.9", 445)]));
    assert.equal(tutte().length, 0);
    assert.equal((d.prepare("SELECT COUNT(*) AS n FROM traffico_abitudini").get() as { n: number }).n, 1);
    // oggi: la stessa coppia tace, una nuova avvisa
    await sincronizzaTraffico(finto([
      riga(2, `${giorno(0)} 10:00:00`, "172.20.0.5", "172.20.0.9", 445),
      riga(3, `${giorno(0)} 10:00:00`, "172.20.0.6", "172.20.0.9", 3389),
    ]));
    let a = tutte();
    assert.deepEqual(a.map((x) => [x.tipo, x.client, x.porta, x.stato, x.conteggio]), [["porta_nuova", "172.20.0.6", 3389, "nuova", 1]]);
    // «è normale»: stato e abitudine confermata
    assert.equal(segnaAnomalia(d, a[0].id, "normale"), true);
    assert.equal(segnaAnomalia(d, 9999, "vista"), false);
    assert.equal((d.prepare("SELECT confermata FROM traffico_abitudini WHERE client = '172.20.0.6'").get() as { confermata: number }).confermata, 1);
    // il fatto si ripete (qui a mano, come farebbe una regola che non guarda le abitudini): resta «normale»
    d.prepare("DELETE FROM traffico_abitudini WHERE client = '172.20.0.6'").run();
    await sincronizzaTraffico(finto([riga(4, `${giorno(0)} 10:05:00`, "172.20.0.6", "172.20.0.9", 3389)]));
    a = tutte();
    assert.deepEqual(a.map((x) => [x.tipo, x.stato, x.conteggio]), [["porta_nuova", "normale", 2]]);
    assert.equal(elencoAnomalie(d, { stato: "nuova" }).totale, 0);
    assert.equal(elencoAnomalie(d, { stato: "normale", tipo: "porta_nuova" }).totale, 1);
  });
});

test("volume dal database: ieri contro i 14 giorni prima", async () => {
  await withTenant(T, async () => {
    const d = dbTraffico();
    const ins = d.prepare("INSERT INTO traffico_coppie (giorno, collector_id, client, server, proto, porta, byte, pacchetti, flussi, prima_vista, ultima_vista) VALUES (?, 1, '172.20.0.5', 'esterno', 6, 443, ?, 1, 1, ?, ?)");
    const MB = 1024 * 1024;
    for (let n = 2; n <= 12; n++) ins.run(giorno(n), 50 * MB, `${giorno(n)} 10:00:00`, `${giorno(n)} 10:00:00`);
    ins.run(giorno(1), 800 * MB, `${giorno(1)} 10:00:00`, `${giorno(1)} 10:00:00`);
    assert.equal(calcolaVolumi(d, giorno(1)), 1);
    const v = elencoAnomalie(d, { tipo: "volume" }).anomalie[0];
    assert.deepEqual([v.client, v.gravita, v.dettaglio.byte, v.dettaglio.mediana], ["172.20.0.5", 2, 800 * MB, 50 * MB]);
  });
});
