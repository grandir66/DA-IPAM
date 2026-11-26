/**
 * La vista della tabella Apparati di DatIA Mon (26/11/2026): filtri, colonne salvate, raggruppamenti.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ApparatoElenco } from "../apparati";
import {
  FILTRI_VUOTI, NESSUNO, VISTA_DI_SERIE, conColonna, leggiVista, passa, raggruppa, spostaColonna, valoriFiltro,
} from "../vista-apparati";

function apparato(p: Partial<ApparatoElenco> & { chiave: string }): ApparatoElenco {
  return {
    hostid: null, hostIdIpam: null, nome: p.chiave, hostTecnico: null, ip: null, famiglia: "altro", stato: "da_aggiungere",
    motivo: null, modelli: [], agente: "non_serve", sistema: null, schedaIpam: null, rete: null, vlan: null, marca: null,
    modello: null, mac: null, credenziali: [], proxy: null, problemi: 0, nonVistoGiorni: null, ...p,
  };
}

const A = [
  apparato({ chiave: "sw2", famiglia: "switch", rete: "Server", vlan: 40, marca: "HPE", credenziali: ["snmp"] }),
  apparato({ chiave: "sw10", famiglia: "switch", rete: "Server", vlan: 40, hostid: "7", stato: "attenzione", modelli: ["M1", "M2"] }),
  apparato({ chiave: "pc", famiglia: "windows", agente: "da_installare", sistema: "windows", ip: "10.0.0.5" }),
];

test("i filtri: stato, scelta, «nessuno» e testo", () => {
  const nomi = (f: Parameters<typeof passa>[1]) => A.filter((a) => passa(a, f)).map((a) => a.chiave);
  assert.deepEqual(nomi({ ...FILTRI_VUOTI, stato: "monitorati" }), ["sw10"]);
  assert.deepEqual(nomi({ ...FILTRI_VUOTI, stato: "problemi" }), ["sw10"]);
  assert.deepEqual(nomi({ ...FILTRI_VUOTI, stato: "agente" }), ["pc"]);
  assert.deepEqual(nomi({ ...FILTRI_VUOTI, scelte: { rete: "Server · VLAN 40", marca: "HPE" } }), ["sw2"]);
  assert.deepEqual(nomi({ ...FILTRI_VUOTI, scelte: { credenziale: NESSUNO } }), ["sw10", "pc"]);
  assert.deepEqual(nomi({ ...FILTRI_VUOTI, scelte: { modelloZabbix: "M2" } }), ["sw10"]);
  assert.deepEqual(nomi({ ...FILTRI_VUOTI, testo: "10.0.0" }), ["pc"]);
});

test("sospesi e non visti: un sospeso non è «in monitoraggio» né «con problemi», e non si segnala come non visto", () => {
  const B = [
    apparato({ chiave: "vivo", hostid: "1", stato: "funziona", nonVistoGiorni: 2 }),
    apparato({ chiave: "sparito", hostid: "2", stato: "fermo", nonVistoGiorni: 30 }),
    apparato({ chiave: "in-pausa", hostid: "3", stato: "sospeso", nonVistoGiorni: 90 }),
    apparato({ chiave: "nuovo", nonVistoGiorni: null }),
  ];
  const nomi = (stato: Parameters<typeof passa>[1]["stato"]) => B.filter((a) => passa(a, { ...FILTRI_VUOTI, stato })).map((a) => a.chiave);
  assert.deepEqual(nomi("monitorati"), ["vivo", "sparito"]);
  assert.deepEqual(nomi("sospesi"), ["in-pausa"]);
  assert.deepEqual(nomi("non_visti"), ["sparito"]);
  assert.deepEqual(nomi("problemi"), ["sparito"]);
});

test("i valori di un filtro portano i conteggi e la voce di chi non ha il dato", () => {
  assert.deepEqual(valoriFiltro(A, "marca"), [{ valore: "HPE", quanti: 1 }, { valore: NESSUNO, quanti: 2 }]);
});

test("i gruppi: le famiglie nell'ordine del centro, i nomi in ordine naturale", () => {
  const g = raggruppa(A, VISTA_DI_SERIE, [{ codice: "windows", etichetta: "Windows" }, { codice: "switch", etichetta: "Switch" }]);
  assert.deepEqual(g.map((x) => [x.etichetta, x.lista.map((a) => a.chiave)]), [["Windows", ["pc"]], ["Switch", ["sw2", "sw10"]]]);
  assert.equal(raggruppa(A, { ...VISTA_DI_SERIE, gruppo: "nessuno" }, []).length, 1);
  assert.deepEqual(raggruppa(A, { ...VISTA_DI_SERIE, gruppo: "rete" }, []).map((x) => x.etichetta), ["Server · VLAN 40", "Senza rete in DA-IPAM"]);
});

test("la vista salvata: il rotto torna quello di serie, la colonna fissa resta, le sconosciute spariscono", () => {
  assert.deepEqual(leggiVista("{rotto"), VISTA_DI_SERIE);
  const v = leggiVista(JSON.stringify({ colonne: ["ip", "inventata", "ip"], gruppo: "marca", ordine: { colonna: "ip", verso: "giu" } }));
  assert.deepEqual(v, { colonne: ["nome", "ip"], gruppo: "marca", ordine: { colonna: "ip", verso: "giu" } });
  assert.deepEqual(conColonna(v, "nome", false).colonne, ["nome", "ip"]);
  assert.deepEqual(spostaColonna(conColonna(v, "mac", true), "mac", -1).colonne, ["nome", "mac", "ip"]);
});
