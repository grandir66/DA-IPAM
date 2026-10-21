/**
 * Pezzi puri della scheda (21/10): porte dal JSON dell'host, "acceso da", caselle della striscia
 * generica e vecchi nomi di tab (?tab=software, ?tab=vulnerabilita) che i link esistenti usano.
 * La striscia non rende caselle vuote: un dato che non c'è non diventa un "—".
 *
 * Run: DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test src/lib/scheda/__tests__/panoramica.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { porteDaJson, accesoDa, casellePanoramicaGenerica, tabDaQuery } from "../panoramica";

describe("porteDaJson", () => {
  it("elenco di numeri = TCP", () => {
    assert.deepEqual(porteDaJson("[22,80]"), { tcp: [22, 80], udp: [] });
  });
  it("oggetti con protocollo", () => {
    assert.deepEqual(porteDaJson('[{"port":53,"protocol":"udp"},{"port":443}]'), { tcp: [443], udp: [53] });
  });
  it("forma {tcp, udp}", () => {
    assert.deepEqual(porteDaJson('{"tcp":[1],"udp":[2,3]}'), { tcp: [1], udp: [2, 3] });
  });
  it("JSON rotto o assente = nessuna porta, senza eccezioni", () => {
    assert.deepEqual(porteDaJson("{rotto"), { tcp: [], udp: [] });
    assert.deepEqual(porteDaJson(null), { tcp: [], udp: [] });
  });
});

describe("accesoDa", () => {
  it("giorni noti", () => assert.equal(accesoDa({ uptime_days: 41 }), "41 g"));
  it("0 giorni è un dato vero", () => assert.equal(accesoDa({ uptime_days: 0 }), "0 g"));
  it("testo se non ci sono i giorni", () => assert.equal(accesoDa({ uptime: " 3 days " }), "3 days"));
  it("niente = null", () => {
    assert.equal(accesoDa({}), null);
    assert.equal(accesoDa(null), null);
    assert.equal(accesoDa({ uptime: "  " }), null);
  });
});

describe("casellePanoramicaGenerica", () => {
  it("host online con porte e uptime: tre caselle", () => {
    const c = casellePanoramicaGenerica({ stato: "online", ms: 2, tcp: [22, 80], udp: [53], acceso: "41 g" });
    assert.deepEqual(c.map((x) => x.etichetta), ["Stato", "Porte aperte", "Acceso da"]);
    assert.equal(c[1].valore, "2");
    assert.equal(c[1].sotto, "+ 1 UDP");
    assert.equal(c[0].attenzione, undefined);
  });
  it("senza porte né uptime: solo lo stato, nessuna casella vuota", () => {
    const c = casellePanoramicaGenerica({ stato: "online", ms: null, tcp: [], udp: [], acceso: null });
    assert.equal(c.length, 1);
    assert.equal(c[0].sotto, undefined);
  });
  it("offline è in attenzione", () => {
    const c = casellePanoramicaGenerica({ stato: "offline", ms: null, tcp: [], udp: [], acceso: null });
    assert.equal(c[0].attenzione, true);
    assert.match(c[0].valore, /offline/);
  });
  it("le porte aperte portano alla tab Dettagli solo se esiste", () => {
    const c = casellePanoramicaGenerica({ stato: "online", ms: 1, tcp: [22], udp: [], acceso: null });
    assert.equal(c[1].tab, undefined);
  });
});

describe("tabDaQuery", () => {
  const dettagli: Parameters<typeof tabDaQuery>[1] = ["panoramica", "dettagli", "sicurezza", "gestione", "storico"];
  it("nome nuovo valido", () => assert.deepEqual(tabDaQuery("gestione", dettagli), { tab: "gestione" }));
  it("?tab=software porta a Dettagli > Software", () => assert.deepEqual(tabDaQuery("software", dettagli), { tab: "dettagli", sotto: "software" }));
  it("?tab=vulnerabilita porta a Sicurezza", () => assert.deepEqual(tabDaQuery("vulnerabilita", dettagli), { tab: "sicurezza" }));
  it("?tab=asset porta a Gestione", () => assert.deepEqual(tabDaQuery("asset", dettagli), { tab: "gestione" }));
  it("?tab=network porta a Dettagli > Rete", () => assert.deepEqual(tabDaQuery("network", dettagli), { tab: "dettagli", sotto: "network" }));
  it("tab che il tipo non ha: la prima", () => {
    assert.deepEqual(tabDaQuery("gestione", ["panoramica", "sicurezza", "storico"]), { tab: "panoramica" });
    assert.deepEqual(tabDaQuery("software", ["panoramica", "sicurezza", "storico"]), { tab: "panoramica" });
  });
  it("server: ?tab=software e ?tab=network non perdono la strada senza «Dettagli»", () => {
    const linux: Parameters<typeof tabDaQuery>[1] = ["panoramica", "sistema", "servizi", "aggiornamenti", "utenti", "sicurezza", "gestione", "storico"];
    const windows: Parameters<typeof tabDaQuery>[1] = ["panoramica", "sistema", "servizi", "aggiornamenti", "software", "utenti", "sicurezza", "gestione", "storico"];
    assert.deepEqual(tabDaQuery("software", linux), { tab: "aggiornamenti" }, "Linux: i pacchetti");
    assert.deepEqual(tabDaQuery("software", windows), { tab: "software" }, "Windows ha la sua");
    assert.deepEqual(tabDaQuery("network", linux), { tab: "sistema" });
    assert.deepEqual(tabDaQuery("sistema", windows), { tab: "sistema" });
  });
  it("assente o sconosciuta: la prima", () => {
    assert.deepEqual(tabDaQuery(null, dettagli), { tab: "panoramica" });
    assert.deepEqual(tabDaQuery("boh", dettagli), { tab: "panoramica" });
  });
});
