// G16 e I38 (spec topologia §13.12.2, «La rete-campione in quattro letture»; Task 12 del piano di T3): UNA rete inventata letta in
// quattro modi — MikroTik più controller (A), Cisco in Rapid-PVST via SNMP (B), HP/Aruba in MSTP via SNMP (C), l'hypervisor dal suo
// lato (D) — deve dare gli stessi collegamenti (i due capi per chiave di porta, il genere), lo stesso stato e la stessa fiducia di
// ognuno, e lo stesso padre per ogni nodo. «Uguale» è `uguale()` di support/quattro-letture.ts, che dice le differenze in parole.
//
// COSA PROVA E COSA NO: B e C sono forme DEDOTTE dalle MIB standard, scritte da chi ha scritto anche i lettori e il modello. Provano
// che la logica è coerente fra le forme, non che sia indipendente dal prodotto: quella si prova solo con una lettura SNMP vera
// (§13.5.4), e oggi SNMP è spento. L'ADR sull'indipendenza dal prodotto non si scrive su questi risultati.
import { test } from "node:test";
import assert from "node:assert/strict";
import { modelloMappaDaIngresso } from "@/lib/topology/cavi/mappa";
import type { Collegamento } from "@/lib/topology/cavi/collegamenti";
import { letturaA, letturaB, letturaC, letturaD, N, uguale } from "./support/quattro-letture";

const mod = (i: Parameters<typeof modelloMappaDaIngresso>[0]) => modelloMappaDaIngresso(i, { testaScelta: null }).m;
/** Quello che B e C non hanno: il tunnel (nessun tunnel nella MIB) e gli annunci di segmento (MNDP). */
const senzaTunnel = (c: Collegamento): boolean => c.genere !== "tunnel";
/** I capi di un nodo come li vede ogni lettura: l'altro apparato, la chiave della porta di LUI e il genere (la porta dell'hypervisor no). */
const capiDi = (m: ReturnType<typeof mod>, nodo: string): string[] => m.collegamenti.filter((c) => c.a.nodo === nodo || c.b.nodo === nodo)
  .map((c) => { const altro = c.a.nodo === nodo ? c.b : c.a; return `${c.genere} ${altro.nodo}:${altro.chiave ?? "?"}`; }).sort();
const fra = (m: ReturnType<typeof mod>, x: string, y: string) => m.collegamenti.filter((c) => (c.a.nodo === x && c.b.nodo === y) || (c.a.nodo === y && c.b.nodo === x));

test("A (il riferimento): la rete-campione è quella disegnata — fascio, instradato, due bloccati, segmento della WAN, radio, tunnel bloccato, anomalia", () => {
  const m = mod(letturaA());
  assert.equal(m.albero.testa, N.R);
  const fascio = fra(m, N.R, N.C1).filter((c) => c.genere === "fascio");
  assert.deepEqual(fascio.map((c) => [c.membri?.length, c.velocitaMbps, c.stato, c.fiducia]), [[2, 50000, "inoltra", "certo"]], "un fascio da 2 × 25G, provato");
  assert.deepEqual(fra(m, N.R, N.A1).map((c) => [c.genere, c.stato, c.velocitaMbps]), [["cavo", "instradato", 2500]], "ether2 ↔ porta 47, fuori dal bridge");
  const bloccati = m.collegamenti.filter((c) => c.stato === "bloccato" && c.genere === "cavo").map((c) => [c.a.nodo, c.b.nodo].sort().join("|")).sort();
  assert.deepEqual(bloccati, ["dev:12|dev:21", "dev:12|dev:22"], "le porte 9 e 12 di core 2, bloccate dal suo lato");
  assert.deepEqual(m.segmenti.map((s) => [s.id, s.altriApparati, s.membri.map((p) => p.nodo).sort()]), [["seg:1:5", 1, [N.R, N.RR]]], "R, RR e un modem non gestito");
  assert.deepEqual(m.collegamenti.filter((c) => c.genere === "radio" || c.genere === "tunnel").map((c) => [c.genere, c.stato]).sort(), [["radio", "inoltra"], ["tunnel", "bloccato"]]);
  assert.deepEqual(m.albero.anomalie.map((a) => [a.nodo, a.padre]), [[N.C2, N.A3]], "core 2 esce da uno switch di accesso");
  assert.deepEqual(m.albero.padri, {
    [N.R]: null, [N.C1]: N.R, [N.A1]: N.C1, [N.A2]: N.C1, [N.A3]: N.C1, [N.C2]: N.A3, [N.RR]: N.A2, [N.V]: N.R, [N.L]: N.V, [N.R2S]: N.L, [N.H]: N.C1, "seg:1:5": N.R,
  });
});

test("G16 · tutte le famiglie · A = B: Cisco in Rapid-PVST via SNMP dà gli stessi collegamenti, stati, fiducia e padri (tutto tranne il tunnel)", () => {
  assert.deepEqual(uguale(letturaA(), letturaB(), senzaTunnel), []);
});

test("G16 · tutte le famiglie · A = C: HP/Aruba in MSTP via SNMP dà gli stessi collegamenti, stati, fiducia e padri (tutto tranne il tunnel)", () => {
  assert.deepEqual(uguale(letturaA(), letturaC(), senzaTunnel), []);
});

test("G16 · il tunnel c'è solo dove lo si legge: A e D lo hanno (bloccato, probabile), B e C no — e l'albero non cambia per questo", () => {
  for (const [nome, ing] of [["A", letturaA()], ["D", letturaD()]] as const) {
    assert.deepEqual(mod(ing).collegamenti.filter((c) => c.genere === "tunnel").map((c) => [c.stato, c.fiducia]), [["bloccato", "probabile"]], nome);
  }
  for (const [nome, ing] of [["B", letturaB()], ["C", letturaC()]] as const) assert.equal(mod(ing).collegamenti.some((c) => c.genere === "tunnel"), false, nome);
  assert.deepEqual(mod(letturaA()).albero.padri, mod(letturaB()).albero.padri, "il tunnel è bloccato nell'albero comune: una ridondanza, non un padre");
});

test("G16 · C non sa la porta designata: nei suoi fatti non c'è, e decide il resto — la porta radice per nome, poi la chiave di Prim — con lo stesso albero", () => {
  const c = letturaC();
  assert.ok(c.fattiPorta.every((f) => f.designated_bridge === null && f.designated_port === null), "nessun fatto di C dice il bridge o la porta designata");
  assert.ok(c.fattiBridge.every((b) => b.region_name === "REGIONE-X" && b.instance === 0), "MSTP: il ruolo nell'albero comune (istanza 0) e la regione");
  assert.deepEqual(mod(c).albero.padri, mod(letturaA()).albero.padri);
});

// Il difetto che la rete-campione di C trova: nell'ingresso vero (`snmp-topologia.ts:192`) la porta radice di un bridge è il NOME
// dell'interfaccia («1/1/49»), mentre `lldpRemPortId` degli HP/Aruba è il numero («49»): la porta dell'altro capo di un cavo si
// chiama «49» nel collegamento, e `suPorta` (cavi/albero.ts) confronta il nome o la chiave «n:», mai la chiave «i:49» che il nome
// risolve. La porta radice «non ha un collegamento visto» e decide il ripiego; qui il ripiego dà lo stesso albero, su una rete
// dove i cavi non sono pari non sarebbe così.
test("G16 · C · la porta radice per nome si riconosce anche se l'altro capo del cavo la annuncia col numero", { todo: "difetto del modello: suPorta (cavi/albero.ts) non risolve il nome della porta radice («1/1/49») nella chiave «i:49» del cavo che l'altro capo chiama «49»" }, () => {
  assert.deepEqual(mod(letturaC()).albero.avvisi, []);
});

test("G16 · D · l'hypervisor letto dal suo lato: gli stessi capi e lo stesso genere di A, e il cavo di riserva si scrive «riserva del bond»", () => {
  const a = mod(letturaA()), d = mod(letturaD());
  // La porta dell'hypervisor è «non nota» nelle letture degli switch (due nomi verso lo stesso apparato senza elenco: I46) e «ens1»/«ens2»
  // nella sua: il confronto è sul lato dello switch e sul genere.
  assert.deepEqual(capiDi(d, N.H), [`cavo ${N.C1}:i:20`, `cavo ${N.A3}:i:20`]);
  assert.deepEqual(capiDi(a, N.H), capiDi(d, N.H));
  assert.deepEqual(capiDi(mod(letturaB()), N.H), capiDi(d, N.H));
  assert.deepEqual(capiDi(mod(letturaC()), N.H), capiDi(d, N.H));
  const stato = (m: ReturnType<typeof mod>, sw: string) => m.collegamenti.find((c) => (c.a.nodo === sw && c.b.nodo === N.H) || (c.b.nodo === sw && c.a.nodo === N.H))!.stato;
  assert.deepEqual([stato(d, N.C1), stato(d, N.A3)], ["inoltra", "riserva_bond"], "ens1 attiva, ens2 di riserva");
  assert.deepEqual([stato(a, N.C1), stato(a, N.A3)], ["inoltra", "inoltra"], "gli switch non sanno quale delle due schede è di riserva");
  // Il resto della rete non cambia perché ora la legge anche l'host.
  assert.deepEqual(uguale(letturaA(), letturaD(), () => true, new Set([N.H])), []);
  assert.equal(d.albero.padri[N.H], N.C1, "l'hypervisor sta sotto il cavo attivo");
});

test("G16 · D · i cavi dell'hypervisor da una lettura sola: senza le righe degli switch, restano «probabile» (un solo osservatore)", () => {
  const d = mod(letturaD());
  assert.deepEqual(d.collegamenti.filter((c) => c.a.nodo === N.H || c.b.nodo === N.H).map((c) => c.fiducia), ["probabile", "probabile"]);
});

// Il difetto che la lettura D trova: a pari velocità il principale dell'hypervisor lo spareggia l'id, e il cavo di riserva del bond non
// conta. Con la riserva sul cavo che ha l'id più piccolo, l'hypervisor finisce sotto la riserva.
test("G16 · D · a pari velocità l'hypervisor sta sotto il cavo attivo, mai sotto il membro di riserva del bond", { todo: "difetto del modello: primCavi (cavi/albero.ts, principale dell'hypervisor) e chiaveCavo ignorano stato «riserva_bond»; a pari velocità decide l'id" }, () => {
  const ing = letturaD();
  ing.t1.ports = ing.t1.ports!.map((p) => (p.device_id === 23 && p.port_index === 20 ? { ...p, speed: "10000 Mbps" } : p));
  // la riserva è ens1 (il cavo verso core 1, l'id più piccolo), l'attiva è ens2
  ing.fattiPorta = ing.fattiPorta.map((f) => (f.device_id === 31 && f.port_name === "ens1" ? { ...f, lag_state: "riserva" } : f.device_id === 31 && f.port_name === "ens2" ? { ...f, lag_state: "attivo" } : f));
  const m = mod(ing);
  assert.equal(m.collegamenti.find((c) => c.a.nodo === N.C1 && c.b.nodo === N.H)?.stato, "riserva_bond");
  assert.equal(m.albero.padri[N.H], N.A3);
});

test("controprova: `uguale` vede una differenza — uno stato cambiato, un fatto tolto, una riga tolta", () => {
  const b = letturaB();
  b.fattiPorta = b.fattiPorta.map((f) => (f.device_id === 12 && f.stp_state === "discarding" ? { ...f, stp_state: "forwarding", stp_role: null } : f));
  const d1 = uguale(letturaA(), b, senzaTunnel);
  assert.ok(d1.some((x) => x.includes("bloccato")), d1.join("\n"));
  const c = letturaC();
  c.vicini = c.vicini.filter((r) => !(r.device_id === ID_A2 && r.remote_device_name === "RT-RISERVA"));
  assert.ok(uguale(letturaA(), c, senzaTunnel).length > 0, "una riga in meno cambia il confronto (il cavo non è più certo)");
});
const ID_A2 = 22;

test("Task 6, il fascio letto da capi opposti è un fascio solo: l'osservatore sia il router, sia il core, sia il fatto LAG di un capo solo", () => {
  const solo = (osservatore: number) => {
    const ing = letturaA();
    const membri = (r: { device_id: number; local_port: string }) => r.device_id === 1 ? /^sfp28-[12]/.test(r.local_port) : r.device_id === 11 && /^SFP28 [12]$/.test(r.local_port);
    ing.vicini = ing.vicini.filter((r) => !membri(r) || r.device_id === osservatore);
    ing.fattiPorta = ing.fattiPorta.filter((f) => !(f.lag_group !== null && f.device_id !== osservatore));
    return ing;
  };
  for (const [nome, oss] of [["dal router", 1], ["dal core", 11]] as const) {
    const m = mod(solo(oss));
    const f = fra(m, N.R, N.C1);
    assert.deepEqual(f.map((c) => [c.genere, c.membri?.length]), [["fascio", 2]], `${nome}: un fascio solo di due cavi, non due cavi né due fasci`);
    assert.equal(f[0].velocitaMbps, 50000, nome);
  }
});

test("Task 6, il fascio letto da capi opposti — un membro lo vede solo il router, l'altro solo il core — è un fascio solo, non due cavi", () => {
  const ing = letturaA();
  // il membro 1 (sfp28-1 ↔ SFP28 1) lo scrive solo il router; il membro 2 (sfp28-2 ↔ SFP28 2) solo il core: i due cavi hanno i capi scambiati
  ing.vicini = ing.vicini.filter((r) => !((r.device_id === 11 && r.local_port === "SFP28 1") || (r.device_id === 1 && /^sfp28-2/.test(r.local_port))));
  // senza lo spanning tree sui membri il fascio non si può dedurre: solo la prova del fascio letto lo tiene insieme
  ing.fattiPorta = ing.fattiPorta.map((x) => (x.lag_group !== null && x.if_kind !== "lag" ? { ...x, stp_state: null, stp_role: null } : x));
  const f = fra(mod(ing), N.R, N.C1);
  assert.deepEqual(f.map((c) => [c.genere, c.membri?.length, c.velocitaMbps, c.fascioDedotto]), [["fascio", 2, 50000, false]]);
  assert.deepEqual(f[0].membri?.map((m) => [m.a.nodo, m.b.nodo]).sort(), [[N.C1, N.R], [N.R, N.C1]].sort(), "e i due membri hanno i capi scambiati, come li hanno letti");
});
