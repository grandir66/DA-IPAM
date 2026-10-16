// Le decisioni delle rotte di «Unisci con…» e «Separa…» (piano 2026-10-16, Task 3; ADR 0021), pure: che cosa si scrive (il
// piano per `scriviPianoUnioni`), che cosa si vedrà (l'anteprima, con lo stesso indice della mappa) e quando no (404/409 coi
// testi di `TESTI_UNIONI`). Una prova per regola del piano: `ancoraDi` (che cosa si scrive: gli indirizzi, Scelte 3), `nodoDi`,
// `decidiUnione` (doppi, mancanti, già insieme, due apparati anche attraverso i gruppi esistenti, sempre un gruppo nuovo che si
// applica per ultimo, un'altra unione che cambierebbe, il gemello che arriva «insieme a», Caso 5), `decidiSeparazione` (fuori dal
// nodo, l'apparato, i non separabili, le coppie, Caso 4 nelle sue due forme), `statoDelNodo`, `cercaCandidati`. Reti: il NAS di
// support/nas.ts e reti minime come nel Task 1.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTopologyModel } from "@/lib/topology/model";
import type { TopologyModelInput } from "@/lib/topology/model-types";
import { indiceDeiNodi } from "@/lib/topology/node-index";
import {
  ancoraDi, anteprimaUnione, cercaCandidati, conRighe, decidiSeparazione, decidiUnione, nodoDi, righeDopo, statoDelNodo, TESTO_OGGETTO_SOLO,
  type RigheScelte,
} from "@/lib/topology/unioni";
import { PAROLA_COME, TESTI_UNIONI, type ModelSeparazioneRow, type ModelUnioneRow } from "@/lib/topology/unioni-tipi";
import { GRUPPO_NAS, nas, nasDueApparati, nasPromosso } from "./support/nas";
import { baseInput, dev, host } from "./support/righe";

const ORA_U = "2026-10-16 09:00:00";
const ORA_S = "2026-10-16 09:30:00";
/** Righe attive come le dà `getRigheScelte`: unioni con id 1, 2, …; separazioni con id 101, 102, … */
const righe = (unioni: ModelUnioneRow[] = [], separazioni: ModelSeparazioneRow[] = []): RigheScelte => ({
  unioni: unioni.map((u, i) => ({ id: i + 1, ...u, creato_da: "anna", creato_il: ORA_U })),
  separazioni: separazioni.map((s, i) => ({ id: 101 + i, ...s, creato_da: "bruno", creato_il: ORA_S })),
});
const NESSUNA = righe();
const A_MANO = PAROLA_COME.a_mano;
/** Il NAS col gemello del secondo indirizzo: stesso MAC, un altro IP nella stessa rete (Caso 4). */
const conGemello = (t: TopologyModelInput): TopologyModelInput => {
  t.hosts.push(host(14, { network_id: 2, ip: "10.71.2.21", mac: "02:00:7b:00:02:12", classification: "nas" }));
  return t;
};
/** La catena della prova 14 di unioni-indice: 30 e 31 stesso MAC; 20 e 40 soli. */
const catena = (): TopologyModelInput => baseInput({
  hosts: [
    host(20, { ip: "10.71.5.20", mac: "02:00:71:00:05:20" }), host(30, { ip: "10.71.5.30", mac: "02:00:72:00:05:30" }),
    host(31, { ip: "10.71.6.31", mac: "02:00:72:00:05:30" }), host(40, { ip: "10.71.6.40", mac: "02:00:73:00:06:40" }),
  ],
});
const no = (status: 404 | 409, error: string) => ({ ok: false, status, error });

test("ancoraDi: un host è sé stesso; un apparato è il suo host (host_id, poi l'IP, l'id più basso), sé stesso solo se non ne ha", () => {
  const t = nas();
  assert.equal(ancoraDi(t, "host:12"), "host:12");
  assert.equal(ancoraDi(t, "dev:1"), "dev:1", "nessun host con l'IP dello switch");
  for (const x of ["host:99", "dev:98", "vm:1:2", "seg:1:2", "host:0", ""]) assert.equal(ancoraDi(t, x), null, x);
  assert.equal(ancoraDi(nasPromosso(), "dev:5"), "host:11", "host_id");
  const perIp = nas();
  perIp.devices.push(dev(7, { name: "QWNAS-7", host: "10.71.3.20", device_type: "nas" }));
  perIp.hosts.push(host(9, { network_id: 9, ip: "10.71.3.20" }));
  assert.equal(ancoraDi(perIp, "dev:7"), "host:9", "senza host_id: l'host di id più basso con l'IP dell'apparato");
  const rotto = nasPromosso();
  rotto.devices = rotto.devices.map((d) => (d.id === 5 ? { ...d, host_id: 77 } : d));
  assert.equal(ancoraDi(rotto, "dev:5"), "host:11", "un host_id che non c'è più: l'IP");
});

test("nodoDi: il nodo che contiene l'oggetto; un host solo è il suo nodo; un apparato o un host che non ci sono → null", () => {
  const idx = indiceDeiNodi({ ...nas(), unioni: GRUPPO_NAS });
  assert.deepEqual(["host:11", "host:12", "host:13", "dev:2"].map((x) => nodoDi(idx, x)), ["host:11", "host:11", "host:11", "dev:2"]);
  for (const x of ["dev:98", "host:99", "vm:1:2"]) assert.equal(nodoDi(idx, x), null, x);
  const solo = indiceDeiNodi(nas());
  assert.equal(nodoDi(solo, "host:12"), "host:12");
  assert.equal(solo.nodes.has("host:12"), false, "nodoDi non aggiunge nodi all'indice");
  assert.equal(nodoDi(indiceDeiNodi(nasPromosso()), "host:11"), "dev:5");
});

test("conRighe e righeDopo: l'ingresso con le righe date (solo gruppo e membro); il piano applicato in memoria, «nuovo» dopo i gruppi attivi", () => {
  const r = righe([{ gruppo: 3, membro: "host:11" }, { gruppo: 3, membro: "host:12" }], [{ membro: "host:13", altro: "dev:1" }]);
  const conAltre: TopologyModelInput = { ...nas(), unioni: [{ gruppo: 9, membro: "host:1" }] };
  const ing = conRighe(conAltre, r);
  assert.deepEqual(Object.keys(ing).sort(), ["devices", "hosts", "knownMacs", "neighbors", "separazioni", "unioni"]);
  assert.deepEqual(ing.unioni, [{ gruppo: 3, membro: "host:11" }, { gruppo: 3, membro: "host:12" }], "le righe date sostituiscono quelle dell'ingresso");
  assert.deepEqual(ing.separazioni, [{ membro: "host:13", altro: "dev:1" }]);
  assert.deepEqual(righeDopo(r, {
    togliUnioni: [2], togliSeparazioni: [101],
    aggiungiUnioni: [{ gruppo: "nuovo", membro: "host:20" }, { gruppo: 3, membro: "host:21" }],
    aggiungiSeparazioni: [{ membro: "host:22", altro: "host:23" }],
  }), {
    unioni: [{ gruppo: 3, membro: "host:11" }, { gruppo: 4, membro: "host:20" }, { gruppo: 3, membro: "host:21" }],
    separazioni: [{ membro: "host:22", altro: "host:23" }],
  });
});

test("decidiUnione: i tre indirizzi del NAS in un gruppo nuovo; l'anteprima è il nodo che la mappa avrà, con chi entra e perché", () => {
  const d = decidiUnione(nas(), NESSUNA, ["host:11", "host:12", "host:13"]);
  assert.ok(d.ok, JSON.stringify(d));
  assert.deepEqual(d.dati.piano, {
    togliUnioni: [], togliSeparazioni: [], aggiungiSeparazioni: [],
    aggiungiUnioni: [{ gruppo: "nuovo", membro: "host:11" }, { gruppo: "nuovo", membro: "host:12" }, { gruppo: "nuovo", membro: "host:13" }],
  });
  assert.deepEqual(d.dati.anteprima, {
    nodo: "host:11", nome: "QWNAS-7", separazioniTolte: [],
    entrano: [{ id: "host:12", nome: "10.71.2.20", ip: "10.71.2.20", perche: A_MANO }, { id: "host:13", nome: "10.71.3.20", ip: "10.71.3.20", perche: A_MANO }],
  });
  // L'anteprima e la mappa sono la stessa cosa: il modello con le righe del piano ha quel nodo.
  const m = buildTopologyModel({ ...nas(), ...righeDopo(NESSUNA, d.dati.piano) });
  assert.deepEqual(m.nodes.find((n) => n.id === "host:11")?.fusedHostIds, [12, 13]);
});

test("decidiUnione: per un apparato si scrive il suo host; il nodo che resta è l'apparato", () => {
  const d = decidiUnione(nasPromosso(), NESSUNA, ["dev:5", "host:12"]);
  assert.ok(d.ok, JSON.stringify(d));
  assert.deepEqual(d.dati.piano.aggiungiUnioni, [{ gruppo: "nuovo", membro: "host:11" }, { gruppo: "nuovo", membro: "host:12" }]);
  assert.deepEqual(d.dati.anteprima, { nodo: "dev:5", nome: "QWNAS-7", separazioniTolte: [], entrano: [{ id: "host:12", nome: "10.71.2.20", ip: "10.71.2.20", perche: A_MANO }] });
});

test("decidiUnione: chi entra porta il suo IP, così tre indirizzi con lo stesso nome non sono tre righe uguali (verifica a schermo)", () => {
  // Lo stesso hostname sui tre indirizzi, MAC di OUI diversi: da soli non si fondono (node-index.ts, «per nome solo se nessun
  // MAC vero lo contraddice»). Prima l'anteprima diceva «QWNAS-7» due volte, e nient'altro.
  const t = nas();
  t.hosts = t.hosts.map((h) => ({ ...h, hostname: "QWNAS-7" }));
  assert.equal(indiceDeiNodi(t).nodes.has("host:11"), false, "senza unione tre oggetti");
  const d = decidiUnione(t, NESSUNA, ["host:11", "host:12", "host:13"]);
  assert.ok(d.ok, JSON.stringify(d));
  assert.deepEqual(d.dati.anteprima.entrano, [
    { id: "host:12", nome: "QWNAS-7", ip: "10.71.2.20", perche: A_MANO }, { id: "host:13", nome: "QWNAS-7", ip: "10.71.3.20", perche: A_MANO },
  ]);
});

test("decidiUnione: doppi 409, un oggetto che non c'è 404, già lo stesso oggetto 409 (anche un apparato col suo host)", () => {
  assert.deepEqual(decidiUnione(nas(), NESSUNA, ["host:11", "host:11"]), no(409, TESTI_UNIONI.doppio));
  assert.deepEqual(decidiUnione(nas(), NESSUNA, ["host:11", "host:99"]), no(404, TESTI_UNIONI.nonTrovato("host:99")));
  assert.deepEqual(decidiUnione(nas(), NESSUNA, ["host:11", "vm:1:2"]), no(404, TESTI_UNIONI.nonTrovato("vm:1:2")));
  assert.deepEqual(decidiUnione(nas(), righe(GRUPPO_NAS), ["host:12", "host:13"]), no(409, TESTI_UNIONI.giaStesso));
  assert.deepEqual(decidiUnione(nasPromosso(), NESSUNA, ["dev:5", "host:11"]), no(409, TESTI_UNIONI.giaStesso));
});

test("decidiUnione: due apparati no, anche quando il secondo arriva da un gruppo esistente di un'ancora", () => {
  const dueApp = no(409, TESTI_UNIONI.dueApparati("QWNAS-7", "QWNAS-7-B"));
  assert.deepEqual(decidiUnione(nasDueApparati(), NESSUNA, ["dev:5", "dev:6"]), dueApp);
  assert.deepEqual(decidiUnione(nasDueApparati(), NESSUNA, ["host:11", "host:12"]), dueApp);
  // Il gruppo 1 {11, 12} non si applica (due apparati): oggi 12 è in dev:6 e 13 è solo. Unire 12 e 13 fonde il gruppo 1, che
  // porta dev:5: contando solo i nodi delle ancore passerebbe (dev:6 e host:13).
  assert.deepEqual(decidiUnione(nasDueApparati(), righe([{ gruppo: 1, membro: "host:11" }, { gruppo: 1, membro: "host:12" }]), ["host:12", "host:13"]), dueApp);
});

test("decidiUnione: sempre un gruppo nuovo; le righe dei gruppi delle ancore si tolgono e si rimettono lì (l'unione si applica per ultima)", () => {
  const uno = decidiUnione(nas(), righe([{ gruppo: 3, membro: "host:11" }, { gruppo: 3, membro: "host:12" }]), ["host:12", "host:13"]);
  assert.ok(uno.ok, JSON.stringify(uno));
  assert.deepEqual(uno.dati.piano, {
    togliUnioni: [1, 2], togliSeparazioni: [], aggiungiSeparazioni: [],
    aggiungiUnioni: [{ gruppo: "nuovo", membro: "host:11" }, { gruppo: "nuovo", membro: "host:12" }, { gruppo: "nuovo", membro: "host:13" }],
  });
  assert.deepEqual(uno.dati.anteprima.entrano, [{ id: "host:13", nome: "10.71.3.20", ip: "10.71.3.20", perche: A_MANO }]);

  const t = nas();
  t.hosts.push(host(20, { network_id: 4, ip: "10.71.4.20", mac: "02:00:7d:00:04:20" }));
  const r = righe([{ gruppo: 3, membro: "host:11" }, { gruppo: 3, membro: "host:12" }, { gruppo: 5, membro: "host:13" }, { gruppo: 5, membro: "host:20" }]);
  const due = decidiUnione(t, r, ["host:12", "host:13"]);
  assert.ok(due.ok, JSON.stringify(due));
  assert.deepEqual(due.dati.piano, {
    togliUnioni: [1, 2, 3, 4], togliSeparazioni: [], aggiungiSeparazioni: [],
    aggiungiUnioni: ["host:11", "host:12", "host:13", "host:20"].map((membro) => ({ gruppo: "nuovo" as const, membro })),
  });
  assert.deepEqual(due.dati.anteprima, {
    nodo: "host:11", nome: "QWNAS-7", separazioniTolte: [],
    entrano: [{ id: "host:13", nome: "10.71.3.20", ip: "10.71.3.20", perche: A_MANO }, { id: "host:20", nome: "10.71.4.20", ip: "10.71.4.20", perche: A_MANO }],
  });
});

test("decidiUnione: chi arriva col gemello (stesso MAC) entra «insieme a» lui, fra soli host e in un apparato", () => {
  const soli = decidiUnione(conGemello(nas()), NESSUNA, ["host:11", "host:12"]);
  assert.ok(soli.ok, JSON.stringify(soli));
  assert.deepEqual(soli.dati.piano.aggiungiUnioni, [{ gruppo: "nuovo", membro: "host:11" }, { gruppo: "nuovo", membro: "host:12" }], "il gemello non si scrive");
  assert.deepEqual(soli.dati.anteprima.entrano, [
    { id: "host:12", nome: "10.71.2.20", ip: "10.71.2.20", perche: A_MANO }, { id: "host:14", nome: "10.71.2.21", ip: "10.71.2.21", perche: "insieme a 10.71.2.20" },
  ]);
  const app = decidiUnione(conGemello(nasPromosso()), NESSUNA, ["dev:5", "host:12"]);
  assert.ok(app.ok, JSON.stringify(app));
  assert.equal(app.dati.anteprima.nodo, "dev:5");
  assert.deepEqual(app.dati.anteprima.entrano.map((e) => [e.id, e.perche]), [["host:12", A_MANO], ["host:14", "insieme a 10.71.2.20"]]);
});

test("decidiUnione: il gemello che è membro di un'altra unione entra «insieme a» lui; «unito a mano» vale per le righe di questa", () => {
  // 41 e 42 hanno lo stesso MAC; il gruppo 1 lega 40 e 41, così il nodo «10.71.4.40» è {40, 41, 42}. «Unisci 42 con QWNAS-7»
  // lascia il gruppo 1 com'è: il 41 arriva col 42, il suo gemello; il 40 per l'unione di prima. Revisione finale: i membri
  // espliciti erano quelli di tutti i gruppi, e il 41 risultava «unito a mano».
  const t = nas();
  t.hosts.push(host(40, { network_id: 4, ip: "10.71.4.40", mac: "02:00:74:00:04:40" }),
    host(41, { network_id: 4, ip: "10.71.4.41", mac: "02:00:75:00:04:41" }), host(42, { network_id: 4, ip: "10.71.4.42", mac: "02:00:75:00:04:41" }));
  const d = decidiUnione(t, righe([{ gruppo: 1, membro: "host:40" }, { gruppo: 1, membro: "host:41" }]), ["host:42", "host:11"]);
  assert.ok(d.ok, JSON.stringify(d));
  assert.deepEqual(d.dati.piano.aggiungiUnioni, [{ gruppo: "nuovo", membro: "host:42" }, { gruppo: "nuovo", membro: "host:11" }], "il gruppo 1 resta com'è");
  assert.deepEqual(d.dati.anteprima.entrano.map((e) => [e.id, e.perche]), [["host:40", A_MANO], ["host:41", "insieme a 10.71.4.42"], ["host:42", A_MANO]]);
});

test("Caso 5: «Unisci» dopo un «Separa» fra gli stessi oggetti toglie quella separazione (con la data) e lascia le altre", () => {
  const r = righe([], [{ membro: "host:12", altro: "dev:5" }, { membro: "host:13", altro: "dev:5" }]);
  const d = decidiUnione(nasPromosso(), r, ["host:12", "dev:5"]);
  assert.ok(d.ok, JSON.stringify(d));
  assert.deepEqual(d.dati.piano, {
    togliUnioni: [], togliSeparazioni: [101], aggiungiSeparazioni: [],
    aggiungiUnioni: [{ gruppo: "nuovo", membro: "host:12" }, { gruppo: "nuovo", membro: "host:11" }],
  });
  assert.deepEqual(d.dati.anteprima, {
    nodo: "dev:5", nome: "QWNAS-7", entrano: [{ id: "host:12", nome: "10.71.2.20", ip: "10.71.2.20", perche: A_MANO }],
    separazioniTolte: [{ membro: "host:12", altro: "dev:5", il: ORA_S, nomeMembro: "10.71.2.20", ipMembro: "10.71.2.20", nomeAltro: "QWNAS-7", ipAltro: "10.71.1.20" }],
  });
  // Fra soli host: separato il 31 dalla catena, riunirlo al 20 toglie le coppie verso i nodi che si uniscono, non quella col 40.
  const sep = righe([{ gruppo: 1, membro: "host:20" }, { gruppo: 1, membro: "host:30" }],
    [{ membro: "host:31", altro: "host:20" }, { membro: "host:31", altro: "host:30" }, { membro: "host:31", altro: "host:40" }]);
  const c = decidiUnione(catena(), sep, ["host:31", "host:20"]);
  assert.ok(c.ok, JSON.stringify(c));
  assert.deepEqual(c.dati.piano, {
    togliUnioni: [1, 2], togliSeparazioni: [101, 102], aggiungiSeparazioni: [],
    aggiungiUnioni: ["host:20", "host:30", "host:31"].map((membro) => ({ gruppo: "nuovo" as const, membro })),
  });
  assert.deepEqual(c.dati.anteprima.separazioniTolte.map((s) => s.altro), ["host:20", "host:30"]);
  assert.deepEqual(c.dati.anteprima.entrano.map((e) => e.id), ["host:31"]);
});

/**
 * Revisione finale della tappa (16/10): il NAS promosso col gemello del 12 (il 14, stesso MAC) separato a mano dall'apparato, e
 * il 30 e il 31 su un'altra rete. Col gruppo più basso un'unione nuova si applicava prima di una più recente, e nel ramo
 * «apparato» l'indice tirava dentro l'intera radice automatica di un'ancora (il 14 resta legato al 12 nel union-find).
 */
const gemelloSeparato = (): TopologyModelInput => {
  const t = conGemello(nasPromosso());
  t.hosts.push(host(30, { network_id: 5, ip: "10.71.5.30", mac: "02:00:70:00:05:30" }), host(31, { network_id: 5, ip: "10.71.5.31", mac: "02:00:6f:00:05:31" }));
  return t;
};
const SEPARATO_14: ModelSeparazioneRow[] = [{ membro: "host:14", altro: "dev:5" }];
const nodiDopo = (t: TopologyModelInput, r: RigheScelte, d: ReturnType<typeof decidiUnione>, ids: string[]) => {
  assert.ok(d.ok, JSON.stringify(d));
  const idx = indiceDeiNodi(conRighe(t, righeDopo(r, d.dati.piano)));
  return { nodi: ids.map((x) => nodoDi(idx, x)), nonApplicate: idx.nonApplicate };
};

test("Caso A: il gruppo 1 di soli host {30, 31} e il NAS nel 2; «Unisci 14 con 30» va in un gruppo nuovo (prima: «unione incoerente», 500)", () => {
  const t = gemelloSeparato();
  const r = righe([{ gruppo: 1, membro: "host:30" }, { gruppo: 1, membro: "host:31" }, { gruppo: 2, membro: "host:11" }, { gruppo: 2, membro: "host:12" }], SEPARATO_14);
  const d = decidiUnione(t, r, ["host:14", "host:30"]);
  assert.ok(d.ok, JSON.stringify(d));
  assert.deepEqual(d.dati.piano, {
    togliUnioni: [1, 2], togliSeparazioni: [], aggiungiSeparazioni: [],
    aggiungiUnioni: ["host:30", "host:31", "host:14"].map((membro) => ({ gruppo: "nuovo" as const, membro })),
  });
  assert.deepEqual([d.dati.anteprima.nodo, d.dati.anteprima.entrano.map((e) => e.id)], ["host:14", ["host:30", "host:31"]]);
  assert.deepEqual(nodiDopo(t, r, d, ["host:11", "host:12", "host:14", "host:30", "host:31"]), {
    nodi: ["dev:5", "dev:5", "host:14", "host:14", "host:14"], nonApplicate: [],
  });
});

test("Caso B: il gruppo 1 {SRV-SEI, 30} e il NAS nel 2; «Unisci 14 con 30» non porta via il 12 dal NAS (prima il NAS diventava «non applicata»)", () => {
  const t = gemelloSeparato();
  t.hosts.push(host(60, { network_id: 6, ip: "10.71.6.60", mac: "02:00:6e:00:06:60" }));
  t.devices.push(dev(6, { name: "SRV-SEI", host: "10.71.6.60", device_type: "server", host_id: 60 }));
  const r = righe([{ gruppo: 1, membro: "host:30" }, { gruppo: 1, membro: "host:60" }, { gruppo: 2, membro: "host:11" }, { gruppo: 2, membro: "host:12" }], SEPARATO_14);
  const d = decidiUnione(t, r, ["host:14", "host:30"]);
  assert.ok(d.ok, JSON.stringify(d));
  assert.deepEqual(d.dati.piano, {
    togliUnioni: [1, 2], togliSeparazioni: [], aggiungiSeparazioni: [],
    aggiungiUnioni: ["host:30", "host:60", "host:14"].map((membro) => ({ gruppo: "nuovo" as const, membro })),
  });
  assert.deepEqual([d.dati.anteprima.nodo, d.dati.anteprima.entrano.map((e) => e.id)], ["dev:6", ["host:14"]]);
  assert.deepEqual(nodiDopo(t, r, d, ["host:11", "host:12", "host:14", "host:30", "host:60"]), {
    nodi: ["dev:5", "dev:5", "dev:6", "dev:6", "dev:6"], nonApplicate: [],
  });
});

test("decidiUnione: un'unione che cambierebbe un'altra unione già fatta è 409, col nome di quella", () => {
  // Il NAS nel gruppo 1 {11, 12}; il 14 separato dall'apparato e poi unito a mano col 30 (gruppo 2): il nodo «10.71.2.21» è
  // {14, 30}, legato al 12 dal MAC del 14. «Unisci QWNAS-7 con 40» porta il gruppo 1 in fondo: il 2 si applica prima, e nel ramo
  // «apparato» il 30 finirebbe nel NAS senza che nessuno l'abbia scelto.
  const t = gemelloSeparato();
  t.hosts.push(host(40, { network_id: 4, ip: "10.71.4.40", mac: "02:00:74:00:04:40" }));
  const r = righe([{ gruppo: 1, membro: "host:11" }, { gruppo: 1, membro: "host:12" }, { gruppo: 2, membro: "host:14" }, { gruppo: 2, membro: "host:30" }], SEPARATO_14);
  const prima = indiceDeiNodi(conRighe(t, r));
  assert.deepEqual(["host:12", "host:14", "host:30"].map((x) => nodoDi(prima, x)), ["dev:5", "host:14", "host:14"], "la rete di partenza");
  assert.deepEqual(decidiUnione(t, r, ["dev:5", "host:40"]), no(409, TESTI_UNIONI.cambiaAltra("10.71.2.21")));
});

test("anteprimaUnione: righe in cui le ancore non finiscono insieme danno 409, mai un'eccezione (prima: «unione incoerente»)", () => {
  // Le righe del Caso A scritte col gruppo più basso, com'era prima: il NAS (gruppo 2) tira il 30 e il 31 nell'apparato.
  const t = gemelloSeparato();
  const r = righe([{ gruppo: 1, membro: "host:30" }, { gruppo: 1, membro: "host:31" }, { gruppo: 2, membro: "host:11" }, { gruppo: 2, membro: "host:12" }], SEPARATO_14);
  const dopo = { unioni: [...r.unioni, { gruppo: 1, membro: "host:14" }], separazioni: SEPARATO_14 };
  assert.deepEqual(anteprimaUnione(t, r, dopo, ["host:14", "host:30"], []), no(409, TESTI_UNIONI.cambiaAltra("QWNAS-7")));
});

test("decidiSeparazione: fuori dal nodo 409, l'apparato 409, i suoi indirizzi non si separano, un oggetto che non c'è 404", () => {
  const r = righe(GRUPPO_NAS);
  assert.deepEqual(decidiSeparazione(nas(), NESSUNA, "host:11", "host:12"), no(409, TESTI_UNIONI.nonNelNodo));
  assert.deepEqual(decidiSeparazione(nasPromosso(), r, "dev:5", "dev:5"), no(409, TESTI_UNIONI.eLApparato));
  assert.deepEqual(decidiSeparazione(nasPromosso(), r, "dev:5", "host:11"), no(409, TESTI_UNIONI.nonSeparabile("host_dell_apparato")));
  const perIp = nas();
  perIp.devices.push(dev(7, { name: "QWNAS-7", host: "10.71.1.20", device_type: "nas" }));
  assert.deepEqual(decidiSeparazione(perIp, NESSUNA, "dev:7", "host:11"), no(409, TESTI_UNIONI.nonSeparabile("stesso_ip")));
  assert.deepEqual(decidiSeparazione(nasPromosso(), r, "dev:5", "host:99"), no(404, TESTI_UNIONI.nonTrovato("host:99")));
  assert.deepEqual(decidiSeparazione(nasPromosso(), r, "dev:98", "host:12"), no(404, TESTI_UNIONI.nonTrovato("dev:98")));
  assert.deepEqual(decidiSeparazione(nas(), NESSUNA, "host:12", "host:12"), no(409, TESTO_OGGETTO_SOLO));
});

test("decidiSeparazione in un apparato: si toglie la riga del membro (e l'ultima del gruppo), la coppia è con l'apparato", () => {
  const d = decidiSeparazione(nasPromosso(), righe(GRUPPO_NAS), "dev:5", "host:13");
  assert.ok(d.ok, JSON.stringify(d));
  assert.deepEqual(d.dati.piano, { togliUnioni: [3], togliSeparazioni: [], aggiungiUnioni: [], aggiungiSeparazioni: [{ membro: "host:13", altro: "dev:5" }] });
  assert.deepEqual(d.dati.anteprima, {
    resta: { nodo: "dev:5", nome: "QWNAS-7", membri: ["dev:5", "host:11", "host:12"] },
    escono: [{ nodo: "host:13", nome: "10.71.3.20", membri: ["host:13"] }],
  });
  const ultimo = decidiSeparazione(nasPromosso(), righe([{ gruppo: 1, membro: "host:11" }, { gruppo: 1, membro: "host:12" }]), "dev:5", "host:12");
  assert.ok(ultimo.ok, JSON.stringify(ultimo));
  assert.deepEqual(ultimo.dati.piano.togliUnioni, [2, 1], "un gruppo di una riga sola non è un'unione");
  assert.deepEqual(ultimo.dati.anteprima.resta.membri, ["dev:5", "host:11"]);
});

test("decidiSeparazione fra soli host: una coppia per ogni altro membro, senza ripetere quelle attive; il rappresentante si separa", () => {
  const d = decidiSeparazione(nas(), righe(GRUPPO_NAS), "host:11", "host:13");
  assert.ok(d.ok, JSON.stringify(d));
  assert.deepEqual(d.dati.piano, {
    togliUnioni: [3], togliSeparazioni: [], aggiungiUnioni: [],
    aggiungiSeparazioni: [{ membro: "host:13", altro: "host:11" }, { membro: "host:13", altro: "host:12" }],
  });
  assert.deepEqual(d.dati.anteprima, {
    resta: { nodo: "host:11", nome: "QWNAS-7", membri: ["host:11", "host:12"] },
    escono: [{ nodo: "host:13", nome: "10.71.3.20", membri: ["host:13"] }],
  });
  // Una coppia attiva (anche scritta dall'altro verso: fra due host vale nei due versi) non si ripete.
  const gia = decidiSeparazione(nas(), righe(GRUPPO_NAS, [{ membro: "host:12", altro: "host:13" }]), "host:11", "host:13");
  assert.ok(gia.ok, JSON.stringify(gia));
  assert.deepEqual(gia.dati.piano.aggiungiSeparazioni, [{ membro: "host:13", altro: "host:11" }]);
  const rep = decidiSeparazione(nas(), righe(GRUPPO_NAS), "host:11", "host:11");
  assert.ok(rep.ok, JSON.stringify(rep));
  assert.deepEqual(rep.dati.piano.togliUnioni, [1]);
  assert.deepEqual(rep.dati.piano.aggiungiSeparazioni, [{ membro: "host:11", altro: "host:12" }, { membro: "host:11", altro: "host:13" }]);
  assert.deepEqual(rep.dati.anteprima, {
    resta: { nodo: "host:12", nome: "10.71.2.20", membri: ["host:12", "host:13"] },
    escono: [{ nodo: "host:11", nome: "QWNAS-7", membri: ["host:11"] }],
  });
  // Una fusione automatica (stesso MAC), senza righe: la sola coppia.
  const auto = decidiSeparazione(conGemello(nas()), NESSUNA, "host:12", "host:14");
  assert.ok(auto.ok, JSON.stringify(auto));
  assert.deepEqual(auto.dati.piano, { togliUnioni: [], togliSeparazioni: [], aggiungiUnioni: [], aggiungiSeparazioni: [{ membro: "host:14", altro: "host:12" }] });
  assert.deepEqual(auto.dati.anteprima.escono, [{ nodo: "host:14", nome: "10.71.2.21", membri: ["host:14"] }]);
});

test("Caso 4, prima forma: separato da un apparato, il membro esce col suo gemello automatico, e l'anteprima lo dice", () => {
  const r = righe([{ gruppo: 1, membro: "host:11" }, { gruppo: 1, membro: "host:12" }]);
  assert.deepEqual(indiceDeiNodi(conRighe(conGemello(nasPromosso()), r)).nodes.get("dev:5")?.fusedHostIds, [11, 12, 14]);
  const d = decidiSeparazione(conGemello(nasPromosso()), r, "dev:5", "host:12");
  assert.ok(d.ok, JSON.stringify(d));
  assert.deepEqual(d.dati.piano, { togliUnioni: [2, 1], togliSeparazioni: [], aggiungiUnioni: [], aggiungiSeparazioni: [{ membro: "host:12", altro: "dev:5" }] });
  assert.deepEqual(d.dati.anteprima, {
    resta: { nodo: "dev:5", nome: "QWNAS-7", membri: ["dev:5", "host:11"] },
    escono: [{ nodo: "host:12", nome: "10.71.2.20", membri: ["host:12", "host:14"] }],
  });
  // Il gemello da solo: esce lui, il membro resta.
  const g = decidiSeparazione(conGemello(nasPromosso()), r, "dev:5", "host:14");
  assert.ok(g.ok, JSON.stringify(g));
  assert.deepEqual(g.dati.piano, { togliUnioni: [], togliSeparazioni: [], aggiungiUnioni: [], aggiungiSeparazioni: [{ membro: "host:14", altro: "dev:5" }] });
  assert.deepEqual(g.dati.anteprima.resta.membri, ["dev:5", "host:11", "host:12"]);
  assert.deepEqual(g.dati.anteprima.escono, [{ nodo: "host:14", nome: "10.71.2.21", membri: ["host:14"] }]);
});

test("Caso 4, seconda forma: fra soli host la catena che passa dal separato si spezza, e l'anteprima mostra ogni pezzo", () => {
  const r = righe([{ gruppo: 1, membro: "host:20" }, { gruppo: 1, membro: "host:30" }, { gruppo: 2, membro: "host:31" }, { gruppo: 2, membro: "host:40" }]);
  const d = decidiSeparazione(catena(), r, "host:20", "host:31");
  assert.ok(d.ok, JSON.stringify(d));
  assert.deepEqual(d.dati.piano, {
    togliUnioni: [3, 4], togliSeparazioni: [], aggiungiUnioni: [],
    aggiungiSeparazioni: [{ membro: "host:31", altro: "host:20" }, { membro: "host:31", altro: "host:30" }, { membro: "host:31", altro: "host:40" }],
  });
  assert.deepEqual(d.dati.anteprima, {
    resta: { nodo: "host:20", nome: "10.71.5.20", membri: ["host:20", "host:30"] },
    escono: [{ nodo: "host:31", nome: "10.71.6.31", membri: ["host:31"] }, { nodo: "host:40", nome: "10.71.6.40", membri: ["host:40"] }],
  });
});

test("statoDelNodo: il nodo di un indirizzo unito, i membri (l'oggetto, poi per IP) con chi e quando", () => {
  const s = statoDelNodo(nas(), righe(GRUPPO_NAS), "host:13");
  assert.ok(s.ok, JSON.stringify(s));
  const aMano = { da: "anna", il: ORA_U };
  assert.deepEqual(s.dati, {
    oggetto: "host:13", nodo: "host:11", nome: "QWNAS-7", nonApplicata: null, mancanti: [],
    membri: [
      { id: "host:11", nome: "QWNAS-7", ip: "10.71.1.20", come: "oggetto", separabile: true, perche: null, aMano },
      { id: "host:12", nome: "10.71.2.20", ip: "10.71.2.20", come: "a_mano", separabile: true, perche: null, aMano },
      { id: "host:13", nome: "10.71.3.20", ip: "10.71.3.20", come: "a_mano", separabile: true, perche: null, aMano },
    ],
  });
  assert.deepEqual(statoDelNodo(nas(), NESSUNA, "host:99"), no(404, TESTI_UNIONI.nonTrovato("host:99")));
});

test("statoDelNodo di un apparato: l'apparato e il suo indirizzo non si separano (col perché), il gemello porta la riga del membro, IP in ordine", () => {
  const t = conGemello(nasPromosso());
  t.hosts.push(host(15, { network_id: 10, ip: "10.71.10.20", mac: "02:00:7f:00:0a:15", classification: "nas" }));
  const r: RigheScelte = {
    unioni: [
      { id: 1, gruppo: 1, membro: "host:11", creato_da: "anna", creato_il: ORA_U }, { id: 2, gruppo: 1, membro: "host:12", creato_da: "carla", creato_il: ORA_S },
      { id: 3, gruppo: 1, membro: "host:13", creato_da: "anna", creato_il: ORA_U }, { id: 4, gruppo: 1, membro: "host:15", creato_da: "anna", creato_il: ORA_U },
    ],
    separazioni: [],
  };
  const s = statoDelNodo(t, r, "dev:5");
  assert.ok(s.ok, JSON.stringify(s));
  assert.equal(s.dati.nodo, "dev:5");
  const anna = { da: "anna", il: ORA_U }, carla = { da: "carla", il: ORA_S };
  assert.deepEqual(s.dati.membri, [
    { id: "dev:5", nome: "QWNAS-7", ip: "10.71.1.20", come: "oggetto", separabile: false, perche: TESTI_UNIONI.eLApparato, aMano: null },
    { id: "host:11", nome: "QWNAS-7", ip: "10.71.1.20", come: "host_dell_apparato", separabile: false, perche: TESTI_UNIONI.nonSeparabile("host_dell_apparato"), aMano: anna },
    { id: "host:12", nome: "10.71.2.20", ip: "10.71.2.20", come: "a_mano", separabile: true, perche: null, aMano: carla },
    { id: "host:14", nome: "10.71.2.21", ip: "10.71.2.21", come: "a_mano", separabile: true, perche: null, aMano: carla },
    { id: "host:13", nome: "10.71.3.20", ip: "10.71.3.20", come: "a_mano", separabile: true, perche: null, aMano: anna },
    { id: "host:15", nome: "10.71.10.20", ip: "10.71.10.20", come: "a_mano", separabile: true, perche: null, aMano: anna },
  ]);
});

test("statoDelNodo: un'unione non applicata (due apparati) e i membri spariti dei gruppi del nodo si dicono", () => {
  const s = statoDelNodo(nasDueApparati(), righe(GRUPPO_NAS), "host:13");
  assert.ok(s.ok, JSON.stringify(s));
  assert.equal(s.dati.nodo, "host:13");
  assert.deepEqual(s.dati.membri, [{ id: "host:13", nome: "10.71.3.20", ip: "10.71.3.20", come: "oggetto", separabile: false, perche: null, aMano: { da: "anna", il: ORA_U } }]);
  assert.deepEqual(s.dati.nonApplicata, { membri: ["host:11", "host:12", "host:13"], motivo: TESTI_UNIONI.dueApparati("QWNAS-7", "QWNAS-7-B") });
  const m = statoDelNodo(nas(), righe([...GRUPPO_NAS, { gruppo: 1, membro: "host:99" }, { gruppo: 2, membro: "host:98" }, { gruppo: 2, membro: "dev:97" }]), "host:12");
  assert.ok(m.ok, JSON.stringify(m));
  assert.deepEqual(m.dati.mancanti, ["host:99"], "solo quelli dei gruppi di questo nodo");
});

test("cercaCandidati: da 2 caratteri; per nome, IP (uguale per primo), MAC e alias; mai il nodo di partenza; 404 se la partenza non c'è", () => {
  for (const q of ["", "s", " a "]) assert.deepEqual(cercaCandidati(nas(), NESSUNA, "host:12", q), { ok: true, dati: { candidati: [], altri: 0 } }, q);
  const sw = cercaCandidati(nas(), NESSUNA, "host:12", "SW-");
  assert.ok(sw.ok, JSON.stringify(sw));
  assert.deepEqual(sw.dati, {
    altri: 0,
    candidati: [
      { id: "dev:1", nome: "SW-ALFA", tipo: "apparato", indirizzi: ["10.71.1.2"], bloccato: null },
      { id: "dev:2", nome: "SW-BETA", tipo: "apparato", indirizzi: ["10.71.2.2"], bloccato: null },
      { id: "dev:3", nome: "SW-GAMMA", tipo: "apparato", indirizzi: ["10.71.3.2"], bloccato: null },
    ],
  });
  const t = nas();
  t.hosts.push(host(16, { network_id: 1, ip: "10.71.1.21" }));
  const ip = cercaCandidati(t, NESSUNA, "host:13", "10.71.1.2");
  assert.ok(ip.ok, JSON.stringify(ip));
  assert.deepEqual(ip.dati.candidati.map((c) => c.id), ["dev:1", "host:16", "host:11"], "IP uguale, poi il nome che comincia così, poi il resto");
  for (const q of ["02:00:7b", "02007B", "02-00-7b-00-02-12"]) {
    const mac = cercaCandidati(nas(), NESSUNA, "host:11", q);
    assert.ok(mac.ok, q);
    assert.deepEqual(mac.dati.candidati.map((c) => c.id), ["host:12"], q);
  }
  for (const da of ["host:11", "dev:5"]) {
    assert.deepEqual(cercaCandidati(nasPromosso(), NESSUNA, da, "qwnas"), { ok: true, dati: { candidati: [], altri: 0 } }, da);
  }
  const alias = nas();
  alias.hosts = alias.hosts.map((h) => (h.id === 12 ? { ...h, hostname: "NAS-ETH2" } : h));
  const a = cercaCandidati(alias, righe(GRUPPO_NAS), "dev:1", "eth2");
  assert.ok(a.ok, JSON.stringify(a));
  assert.deepEqual(a.dati.candidati, [{ id: "host:11", nome: "QWNAS-7", tipo: "host", indirizzi: ["10.71.1.20", "10.71.2.20", "10.71.3.20"], bloccato: null }]);
  assert.deepEqual(cercaCandidati(nas(), NESSUNA, "host:99", "sw"), no(404, TESTI_UNIONI.nonTrovato("host:99")));
});

test("cercaCandidati: due apparati sono bloccati col motivo; 20 risultati e quanti altri", () => {
  const b = cercaCandidati(nasDueApparati(), NESSUNA, "dev:5", "qwnas-7-b");
  assert.ok(b.ok, JSON.stringify(b));
  assert.deepEqual(b.dati.candidati, [{ id: "dev:6", nome: "QWNAS-7-B", tipo: "apparato", indirizzi: ["10.71.2.20"], bloccato: TESTI_UNIONI.dueApparati("QWNAS-7", "QWNAS-7-B") }]);
  const pc = baseInput({
    devices: [dev(1, { host: "10.71.8.1" })],
    hosts: Array.from({ length: 25 }, (_, i) => host(100 + i, { ip: `10.71.8.${100 + i}`, hostname: `PC-${String(i + 1).padStart(2, "0")}`, classification: "workstation" })),
  });
  const venti = cercaCandidati(pc, NESSUNA, "dev:1", "pc-");
  assert.ok(venti.ok);
  assert.equal(venti.dati.candidati.length, 20);
  assert.equal(venti.dati.altri, 5);
  assert.deepEqual(venti.dati.candidati.slice(0, 3).map((c) => c.nome), ["PC-01", "PC-02", "PC-03"]);
  const tre = cercaCandidati(pc, NESSUNA, "dev:1", "pc-", 3);
  assert.ok(tre.ok);
  assert.deepEqual([tre.dati.candidati.map((c) => c.nome), tre.dati.altri], [["PC-01", "PC-02", "PC-03"], 22]);
});
