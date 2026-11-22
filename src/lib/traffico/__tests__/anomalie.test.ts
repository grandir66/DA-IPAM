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
  // 22/11: senza una porta di servizio (porte alte, ICMP) non si sa chi ha aperto: la risposta a un ping non è traffico dalla rete chiusa
  assert.deepEqual(tipi(ingresso([c("10.1.0.5", "10.2.0.9", 0), c("10.1.0.5", "10.2.0.9", 0, 1)], { chiuse, retiInApprendimento: new Set([1, 2]) })), []);
});

test("non_censito: IP interno di una rete censita che IPAM non conosce, anche in apprendimento", () => {
  const x = c("10.1.0.77", "10.1.0.9", 80);
  const a = valutaFinestra(ingresso([x], { censiti: new Set(["10.1.0.9"]), retiInApprendimento: new Set([1]) }));
  assert.deepEqual(a.map((y) => [y.tipo, y.gravita, y.client, y.server]), [["non_censito", 2, "10.1.0.77", ""]]);
  // 22/11: la destinazione di una scansione non è un host che parla (1.113 avvisi su 1.114 sull'IPAM dell'ufficio)
  assert.deepEqual(tipi(ingresso([c("10.1.0.9", "10.1.0.200", 80)], { censiti: new Set(["10.1.0.9"]), abitudini: new Set(["10.1.0.9|10.1.0.200|6|80"]) })), []);
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
    const u = new URL(percorso, "https://x");
    const dopo = Number(u.searchParams.get("dopo"));
    if (u.pathname !== "/v1/coppie") return { righe: [], ultimo_seq: dopo, altri: false, buco: false }; // niente fatti né nomi
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

// ── Fatti dei controlli sul contenuto (Task 6) ───────────────────────────────
import { controlliSpenti, impostaControllo, valutaFatti } from "@/lib/traffico/anomalie";
import { nomiDiHost } from "@/lib/traffico/lettura";
import { CollectorErrore } from "@/lib/traffico/collector-client";

const fatto = (tipo: string, client: string, server: string, porta: number, dettaglio: unknown = {}) => ({ tipo, client, server, porta, dettaglio });

test("fatti: gravità, interruttore per rete, scrittura confermata, tipo sconosciuto", () => {
  const base = { spenti: new Set<string>(), reteDi, confermate: new Set<string>() };
  const a = valutaFatti({ ...base, fatti: [
    fatto("chiaro_ftp", "10.1.0.5", "10.1.0.9", 21),
    fatto("tls_vecchio", "10.1.0.5", "esterno", 443, { versione: "TLS 1.0" }),
    fatto("snmp_vecchio", "10.1.0.5", "10.1.0.1", 161, { versione: "2c", comunita_nota: true, annidato: { x: 1 } }),
    fatto("del_futuro", "10.1.0.5", "10.1.0.9", 1),
  ] });
  assert.deepEqual(a.map((x) => [x.tipo, x.gravita]), [["chiaro_ftp", 3], ["tls_vecchio", 2], ["snmp_vecchio", 2]]);
  assert.deepEqual(a[2].dettaglio, { versione: "2c", comunita_nota: true });
  // spento per la rete 1: tace lì, non altrove
  const spento = valutaFatti({ ...base, spenti: new Set(["1|snmp_vecchio"]), fatti: [fatto("snmp_vecchio", "10.1.0.5", "10.1.0.1", 161), fatto("snmp_vecchio", "10.2.0.5", "10.2.0.1", 161)] });
  assert.deepEqual(spento.map((x) => x.client), ["10.2.0.5"]);
  // scrittura verso un impianto: tace solo se la coppia è confermata
  const scrive = fatto("impianto_scrittura", "10.1.0.5", "10.1.0.50", 502, { protocollo: "modbus" });
  assert.equal(valutaFatti({ ...base, fatti: [scrive] }).length, 1);
  assert.equal(valutaFatti({ ...base, confermate: new Set(["10.1.0.5|10.1.0.50|6|502"]), fatti: [scrive] }).length, 0);
});

test("dal collector: fatti e nomi coi loro cursori; «normale» su una scrittura la fa tacere; collector vecchio senza ascolto", async () => {
  await withTenant(T, async () => {
    const d = dbTraffico();
    const oggi = giorno(0);
    const fatti = [
      { seq: 1, visto: `${oggi} 11:00:00`, tipo: "chiaro_ftp", client: "172.20.0.5", server: "172.20.0.9", porta: 21, dettaglio: {} },
      { seq: 2, visto: `${oggi} 11:00:01`, tipo: "impianto_scrittura", client: "172.20.0.5", server: "172.20.0.50", porta: 502, dettaglio: { protocollo: "modbus", cosa: "registro" } },
    ];
    const nomi = [
      { seq: 1, visto: `${oggi} 11:00:00`, client: "172.20.0.5", tipo: "dns", nome: "www.esempio.it", conteggio: 3 },
      { seq: 2, visto: `${oggi} 11:05:00`, client: "172.20.0.5", tipo: "dns", nome: "www.esempio.it", conteggio: 2 },
      { seq: 3, visto: `${oggi} 11:05:00`, client: "172.20.0.5", tipo: "sni", nome: "posta.esempio.it", conteggio: 1 },
      { seq: 4, visto: `${oggi} 11:05:00`, client: "172.20.0.5", tipo: "altro", nome: "x", conteggio: 1 },
    ];
    const lettore = (conAscolto: boolean): Lettore => (async (_c: unknown, percorso: string) => {
      if (percorso === "/v1/stato") return { copertura: 1 };
      const u = new URL(percorso, "https://x");
      const dopo = Number(u.searchParams.get("dopo"));
      if (u.pathname === "/v1/coppie") return { righe: [], ultimo_seq: dopo, altri: false, buco: false };
      if (!conAscolto) throw new CollectorErrore("Il collector risponde 404", 404);
      const righe = (u.pathname === "/v1/fatti" ? fatti : nomi).filter((r) => r.seq > dopo);
      return { righe, ultimo_seq: righe.at(-1)?.seq ?? dopo, altri: false, buco: false };
    }) as Lettore;

    assert.equal((await sincronizzaTraffico(lettore(false))).errori, 0); // senza ascolto: nessun errore
    assert.equal((await sincronizzaTraffico(lettore(true))).errori, 0);
    await sincronizzaTraffico(lettore(true)); // secondo giro: i cursori tengono, niente doppioni
    const c = d.prepare("SELECT cursore_fatti, cursore_nomi FROM traffico_collector WHERE attivo = 1").get() as { cursore_fatti: number; cursore_nomi: number };
    assert.deepEqual(c, { cursore_fatti: 2, cursore_nomi: 4 });
    const a = elencoAnomalie(d, {}).anomalie.filter((x) => x.tipo === "chiaro_ftp" || x.tipo === "impianto_scrittura");
    assert.deepEqual(a.map((x) => [x.tipo, x.gravita, x.conteggio, x.stato]).sort(), [["chiaro_ftp", 3, 1, "nuova"], ["impianto_scrittura", 3, 1, "nuova"]]);
    assert.deepEqual(nomiDiHost("172.20.0.5").map((n) => [n.tipo, n.nome, n.conteggio]), [["dns", "www.esempio.it", 5], ["sni", "posta.esempio.it", 1]]);

    // «è normale» sulla scrittura: l'abitudine è confermata e il fatto, ripetuto, non aggiunge niente
    const scrittura = a.find((x) => x.tipo === "impianto_scrittura")!;
    segnaAnomalia(d, scrittura.id, "normale");
    fatti.push({ ...fatti[1], seq: 3, visto: `${oggi} 12:00:01` });
    await sincronizzaTraffico(lettore(true));
    const dopo = elencoAnomalie(d, { tipo: "impianto_scrittura" }).anomalie[0];
    assert.deepEqual([dopo.stato, dopo.conteggio], ["normale", 1]);

    impostaControllo(d, 0, "chiaro_ftp", false);
    assert.deepEqual(controlliSpenti(d), [{ network_id: 0, tipo: "chiaro_ftp" }]);
    impostaControllo(d, 0, "chiaro_ftp", true);
    assert.deepEqual(controlliSpenti(d), []);
  });
});
