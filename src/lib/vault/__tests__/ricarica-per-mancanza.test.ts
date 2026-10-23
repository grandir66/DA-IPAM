/**
 * Revisione PR #50 di DA-Vul-can (rilievo 1), portata in DA-IPAM: dopo un `--applica` ad app accesa un riferimento nuovo
 * non è nella cache del processo fino al giro successivo (fino a 5 minuti), e le letture davano `non_trovato` per tutto
 * quel tempo.
 *
 * Ora, su `non_trovato` per un percorso valido, la cache parte con un giro (`aggiorna()`), UNO solo alla volta e non più di
 * uno ogni 30 secondi per le mancanze (un percorso che manca davvero non fa una raffica verso OpenBao): la lettura che l'ha
 * scoperto dà l'errore dichiarato («ricaricamento avviato, riprova»), la successiva trova la voce. Se manca anche dopo il
 * giro, l'errore resta, senza altre richieste.
 *
 * Run: node --import tsx --test src/lib/vault/__tests__/ricarica-per-mancanza.test.ts
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { OpenBaoStore } from "../openbao";
import { creaOpenBaoFinto, type OpenBaoFinto } from "./support/openbao-finto";

const SEC = 1000;
let adesso = Date.parse("2026-10-24T08:00:00Z");
let finto: OpenBaoFinto;

function store(extra: Partial<ConstructorParameters<typeof OpenBaoStore>[0]> = {}): OpenBaoStore {
  return new OpenBaoStore({
    url: finto.url,
    roleId: finto.roleId,
    secretId: () => finto.secretId,
    cartelle: ["app/da-ipam"],
    percorsiExtra: () => [...finto.kv.keys()],
    aggiornaOgniMs: 5 * 60 * SEC,
    durataCacheMs: 30 * 60 * SEC,
    fetch: finto.fetch,
    ora: () => adesso,
    ...extra,
  });
}
const dopoIlGiro = () => new Promise((r) => setTimeout(r, 20));
const richiesteDati = () => finto.richieste.filter((r) => r.percorso.includes("/data/")).length;

beforeEach(() => {
  adesso = Date.parse("2026-10-24T08:00:00Z");
  finto = creaOpenBaoFinto({ ora: () => adesso });
  finto.kv.set("clienti/70001/da-ipam/router-a-1", { snmp_community: "a" });
});

describe("riferimento nuovo con l'app accesa", () => {
  it("la prima lettura dà l'errore dichiarato e fa partire il giro; la successiva trova il segreto", async () => {
    const s = store();
    await s.aggiorna();
    finto.kv.set("clienti/70001/da-ipam/router-b-2", { snmp_community: "b" }); // come dopo `--applica`
    assert.throws(() => s.leggiSync("clienti/70001/da-ipam/router-b-2"), /ricaricamento .*avviato/);
    await dopoIlGiro();
    assert.deepEqual(s.leggiSync("clienti/70001/da-ipam/router-b-2"), { snmp_community: "b" });
  });

  it("niente raffica: dieci letture di fila fanno un giro solo, e un percorso che manca davvero non ne fa altri per 30 secondi", async () => {
    const s = store();
    await s.aggiorna();
    const prima = richiesteDati();
    for (let i = 0; i < 10; i++) assert.throws(() => s.leggiSync("clienti/70001/da-ipam/router-manca-9"));
    await dopoIlGiro();
    assert.equal(richiesteDati() - prima, 1); // il giro rilegge il solo segreto presente (router-a)
    // dopo il giro la voce manca ancora: errore semplice, nessuna richiesta nuova
    const dopo = finto.richieste.length;
    assert.throws(() => s.leggiSync("clienti/70001/da-ipam/router-manca-9"), /non è in OpenBao/);
    assert.throws(() => s.leggiSync("clienti/70001/da-ipam/router-manca-9"), /non è in OpenBao/);
    await dopoIlGiro();
    assert.equal(finto.richieste.length, dopo);
    // passati i 30 secondi una mancanza fa ripartire un giro
    adesso += 31 * SEC;
    assert.throws(() => s.leggiSync("clienti/70001/da-ipam/router-manca-9"), /ricaricamento .*avviato/);
    await dopoIlGiro();
    assert.ok(finto.richieste.length > dopo);
  });

  it("OpenBao giù durante il giro per mancanza: nessuna eccezione non gestita, l'errore resta quello dichiarato", async () => {
    const s = store();
    await s.aggiorna();
    finto.giu = true;
    assert.throws(() => s.leggiSync("clienti/70001/da-ipam/router-b-2"), /non è in OpenBao/);
    await dopoIlGiro();
    assert.deepEqual(s.leggiSync("clienti/70001/da-ipam/router-a-1"), { snmp_community: "a" }); // la cache buona resta
  });

  it("un percorso non valido non fa partire nessun giro", async () => {
    const s = store();
    await s.aggiorna();
    const prima = finto.richieste.length;
    assert.throws(() => s.leggiSync("../fuori"), /non valido/);
    await dopoIlGiro();
    assert.equal(finto.richieste.length, prima);
  });
});
