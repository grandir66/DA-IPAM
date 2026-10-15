// I nomi nelle righe di «Cosa cambierebbe con la mappa nuova» (spec topologia §13.11.3): due oggetti con lo stesso nome
// devono potersi distinguere. Visto a schermo nella verifica di T2 (Task 15, 15/10): sulla copia della rete B tre host con
// lo stesso nome (un NAS con tre schede) davano due righe identiche «‹nome› · padre oggi ‹router› · …».
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTopologyModel } from "@/lib/topology/model";
import { costruisciModelloCavi } from "@/lib/topology/cavi/modello";
import { calcolaTraccia, nomiTraccia } from "@/lib/topology/cavi/traccia";
import { baseInput, dev } from "./support/righe";
import { ingresso } from "./support/cavi";

const rete = () => {
  const t1 = baseInput({ devices: [dev(1, { name: "RTR-1", device_type: "router" }), dev(2, { name: "SW-2" }), dev(3, { name: "SW-3" })] });
  return { t1, modello: buildTopologyModel(t1) };
};

test("due oggetti con lo stesso nome: accanto al nome l'indirizzo, o l'id se l'indirizzo manca", () => {
  const { t1, modello } = rete();
  const m = costruisciModelloCavi(ingresso(t1), modello, { testaScelta: "dev:1" });
  const omonimi = {
    ...modello,
    nodes: modello.nodes.map((n) => (n.id === "dev:2" || n.id === "dev:3" ? { ...n, name: "NAS", mgmtIp: n.id === "dev:2" ? "10.1.0.2" : null } : n)),
  };
  const oggi: Record<string, string | null> = { "dev:1": null, "dev:2": "dev:1", "dev:3": "dev:1" };
  const tr = calcolaTraccia(oggi, { ...m, albero: { ...m.albero, padri: { "dev:1": null } } });
  const nomi = nomiTraccia(omonimi, m, tr);
  assert.deepEqual([nomi["dev:1"], nomi["dev:2"], nomi["dev:3"]], ["RTR-1", "NAS (10.1.0.2)", "NAS (dev:3)"]);
});

test("un nome che non si ripete resta com'è, senza indirizzo", () => {
  const { t1, modello } = rete();
  const m = costruisciModelloCavi(ingresso(t1), modello, { testaScelta: "dev:1" });
  const oggi: Record<string, string | null> = { "dev:1": null, "dev:2": "dev:1", "dev:3": "dev:1" };
  const tr = calcolaTraccia(oggi, { ...m, albero: { ...m.albero, padri: { "dev:1": null } } });
  const nomi = nomiTraccia(modello, m, tr);
  assert.deepEqual([nomi["dev:1"], nomi["dev:2"], nomi["dev:3"]], ["RTR-1", "SW-2", "SW-3"]);
});

// M1 (revisione finale di T2): la traccia dava solo il numero delle anomalie «core che esce da uno switch di accesso», e a
// schermo non si sapeva quali apparati guardare. Adesso anche l'elenco (limitato), coi nomi in parole: chi, sotto chi, quanti
// altri switch allo stesso livello del padre.
test("M1: le anomalie in elenco (nodo, padre, quanti altri), limitate, coi nomi fra quelli della traccia", () => {
  const { t1, modello } = rete();
  const m = costruisciModelloCavi(ingresso(t1), modello, { testaScelta: "dev:1" });
  const anomalie = [{ nodo: "dev:3", padre: "dev:2", altri: ["dev:7", "dev:8"] }, ...Array.from({ length: 24 }, (_, i) => ({ nodo: `dev:${100 + i}`, padre: "dev:2", altri: ["dev:7", "dev:8", "dev:9"] }))];
  const tr = calcolaTraccia({}, { ...m, albero: { ...m.albero, padri: {}, anomalie } });
  assert.equal(tr.anomalie, 25, "il numero resta il totale");
  assert.equal(tr.elencoAnomalie.length, 20, "l'elenco è limitato");
  assert.deepEqual(tr.elencoAnomalie[0], { nodo: "dev:3", padre: "dev:2", altri: 2 });
  const nomi = nomiTraccia(modello, m, tr);
  assert.deepEqual([nomi["dev:3"], nomi["dev:2"]], ["SW-3", "SW-2"]);
});
