// La misura delle unioni a mano (piano 2026-10-16, Task 3 Step 4; ADR 0021), sulla rete del NAS di support/nas.ts e mai su dati
// veri: le righe in memoria di `misura-cavi --unisci/--separa` (gruppi negativi, l'ancora di un apparato è il suo host, senza
// niente l'ingresso è lo stesso oggetto), il confronto fra prima e dopo (i collegamenti ri-puntati sul nodo unito, quello a mano
// fra due membri che diventa un autoanello, una coppia persa che si dice) e le fusioni per motivo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTopologyModel } from "@/lib/topology/model";
import { indiceDeiNodi } from "@/lib/topology/node-index";
import { aggiungiScelte, confrontoUnione, fusioniPerCome } from "@/lib/topology/misura-unioni";
import { GRUPPO_NAS, nas, nasPromosso } from "./support/nas";
import { baseInput, dev, host } from "./support/righe";

test("aggiungiScelte: niente da aggiungere = lo stesso ingresso; gruppi negativi con le ancore; le coppie così come sono, dopo le righe che c'erano", () => {
  const t = nas();
  assert.equal(aggiungiScelte(t, [], []), t);
  const u = aggiungiScelte(nasPromosso(), [["dev:5", "host:12"], ["host:13", "host:99"]], []);
  assert.deepEqual(u.unioni, [{ gruppo: -1, membro: "host:11" }, { gruppo: -1, membro: "host:12" }, { gruppo: -2, membro: "host:13" }, { gruppo: -2, membro: "host:99" }]);
  assert.equal("separazioni" in u, false, "una chiave solo se ha righe");
  const s = aggiungiScelte({ ...nasPromosso(), unioni: [{ gruppo: 4, membro: "host:12" }], separazioni: [{ membro: "host:12", altro: "dev:1" }] }, [["host:11", "dev:5"]], [["host:13", "dev:5"]]);
  assert.deepEqual(s.unioni, [{ gruppo: 4, membro: "host:12" }, { gruppo: -1, membro: "host:11" }], "dev:5 e il suo host sono la stessa ancora");
  assert.deepEqual(s.separazioni, [{ membro: "host:12", altro: "dev:1" }, { membro: "host:13", altro: "dev:5" }]);
});

test("confrontoUnione: il NAS unito in memoria ha due nodi in meno, i due LLDP ri-puntati, la correzione fra due membri autoanello, nessuna coppia persa", () => {
  const prima = buildTopologyModel(nas());
  const dopo = buildTopologyModel(aggiungiScelte(nas(), [["host:11", "host:12", "host:13"]], []));
  assert.deepEqual(confrontoUnione(prima, dopo), { nodiPrima: prima.nodes.length, nodiDopo: prima.nodes.length - 2, ripuntati: 2, coppieScomparse: [], autoanelli: 1 });
  assert.deepEqual(confrontoUnione(prima, prima), { nodiPrima: prima.nodes.length, nodiDopo: prima.nodes.length, ripuntati: 0, coppieScomparse: [], autoanelli: 0 });
  // Nel verso opposto (si separa ciò che era unito) le linee del nodo unito non ci sono più: la misura le nomina.
  assert.deepEqual(confrontoUnione(dopo, prima).coppieScomparse, ["dev:2–host:11", "dev:3–host:11"]);
});

test("fusioniPerCome: quanti host stanno nel nodo di un altro, per motivo, tutti i motivi sempre presenti", () => {
  assert.deepEqual(fusioniPerCome(indiceDeiNodi({ ...nasPromosso(), unioni: GRUPPO_NAS })), {
    host_dell_apparato: 1, stesso_ip: 0, stesso_apparato_fisico: 0, stesso_mac: 0, stesso_nome: 0, a_mano: 2,
  });
  const mac = baseInput({ devices: [dev(1, { host: "10.71.9.1", controller_mac: "02:00:7e:00:09:01" })],
    hosts: [host(41, { ip: "10.71.9.41", mac: "02:00:7e:00:09:01" }), host(43, { ip: "10.71.9.43", mac: "02:00:7e:00:09:43" }), host(44, { ip: "10.71.9.44", mac: "02:00:7e:00:09:43" })] });
  assert.deepEqual(fusioniPerCome(indiceDeiNodi(mac)), {
    host_dell_apparato: 0, stesso_ip: 0, stesso_apparato_fisico: 0, stesso_mac: 2, stesso_nome: 0, a_mano: 0,
  });
});
