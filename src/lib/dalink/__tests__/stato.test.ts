/**
 * Tappa C1, Task 2: il livello di privacy e lo stato del segnale, nell'hub.
 *
 * Il livello lo sceglie solo l'amministratore dell'istanza (spec §5.3, decisione 13)
 * e ogni cambio resta nel registro, con chi e quando: la tabella è il registro, e le
 * righe non si sovrascrivono. Senza righe non c'è scelta dichiarata, e vale «solo
 * stato». Quando il livello si abbassa, la pagina dice «in attesa di conferma» finché
 * DA-Link non risponde a un segnale «solo stato» partito DOPO l'abbassamento.
 *
 * Hub di prova isolato: `support/hub-isolato` va importato PER PRIMO.
 */
import { removeTestHubDb } from "../../integrations/__tests__/support/hub-isolato";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb, getHubDb } from "@/lib/db-hub";
import {
  impostaLivello,
  livelloAttuale,
  registroLivello,
  salvaEsitoSegnale,
  statoConferma,
  statoSegnale,
} from "../stato";

after(() => {
  closeHubDb();
  removeTestHubDb();
});

beforeEach(() => {
  getHubDb().exec("DELETE FROM dalink_livello_registro; DELETE FROM dalink_segnale_stato;");
});

const T = (hh: number, mm: number, ss = 0) => new Date(Date.UTC(2026, 9, 15, hh, mm, ss));

test("senza righe non c'è livello dichiarato", () => {
  assert.equal(livelloAttuale(), null);
  assert.deepEqual(statoConferma(), { stato: "nessuna_richiesta" });
});

test("impostaLivello aggiunge una riga e non sovrascrive", () => {
  impostaLivello("stato_inventario", "Mario Rossi", T(8, 0));
  impostaLivello("solo_stato", "Anna Bianchi", T(9, 0));
  const a = livelloAttuale();
  assert.deepEqual(a, { livello: "solo_stato", scelto_da: "Anna Bianchi", scelto_il: "2026-10-15 09:00:00" });
  const r = registroLivello();
  assert.equal(r.length, 2);
  assert.equal(r[0].livello, "solo_stato");
  assert.equal(r[1].livello, "stato_inventario");
  assert.equal(r[1].scelto_da, "Mario Rossi");
});

test("un livello non ammesso non entra", () => {
  assert.throws(() => impostaLivello("tutto" as never, "x"));
  assert.equal(registroLivello().length, 0);
});

test("chi sceglie è obbligatorio", () => {
  assert.throws(() => impostaLivello("solo_stato", "   "));
  assert.equal(registroLivello().length, 0);
});

test("il registro rispetta il limite e parte dal più recente", () => {
  for (let i = 0; i < 5; i++) impostaLivello(i % 2 ? "solo_stato" : "stato_inventario", `u${i}`, T(8, i));
  const r = registroLivello(3);
  assert.deepEqual(r.map((x) => x.scelto_da), ["u4", "u3", "u2"]);
});

test("mai stato a «stato + inventario»: niente da confermare", () => {
  impostaLivello("solo_stato", "u", T(8, 0));
  assert.deepEqual(statoConferma(), { stato: "nessuna_richiesta" });
});

test("abbassato e nessuna risposta dopo → in attesa", () => {
  impostaLivello("stato_inventario", "u", T(8, 0));
  impostaLivello("solo_stato", "u", T(9, 0));
  assert.deepEqual(statoConferma(), { stato: "in_attesa", dal: "2026-10-15 09:00:00" });
});

test("ok a «solo stato» partito dopo l'abbassamento, con la data di cancellazione → confermata", () => {
  impostaLivello("stato_inventario", "u", T(8, 0));
  impostaLivello("solo_stato", "u", T(9, 0));
  salvaEsitoSegnale({
    tentato_il: T(9, 1),
    esito: "ok",
    dettaglio: "ricevuto",
    livello: "solo_stato",
    risposta: { ricevuto_il: "2026-10-15 09:01:02", inventario_cancellato_il: "2026-10-15 09:01:02" },
  });
  assert.deepEqual(statoConferma(), {
    stato: "confermata",
    cancellato_il: "2026-10-15 09:01:02",
    risposta_il: "2026-10-15 09:01:02",
  });
});

test("ok partito PRIMA dell'abbassamento non conferma niente", () => {
  impostaLivello("stato_inventario", "u", T(8, 0));
  salvaEsitoSegnale({
    tentato_il: T(8, 30),
    esito: "ok",
    dettaglio: "ricevuto",
    livello: "solo_stato",
    risposta: { ricevuto_il: "2026-10-15 08:30:01", inventario_cancellato_il: "2026-10-15 08:30:01" },
  });
  impostaLivello("solo_stato", "u", T(9, 0));
  assert.equal(statoConferma().stato, "in_attesa");
});

test("ok col livello vecchio, anche se partito dopo, non conferma", () => {
  impostaLivello("stato_inventario", "u", T(8, 0));
  impostaLivello("solo_stato", "u", T(9, 0));
  salvaEsitoSegnale({
    tentato_il: T(9, 0, 30),
    esito: "ok",
    dettaglio: "ricevuto",
    livello: "stato_inventario",
    risposta: { ricevuto_il: "2026-10-15 09:00:31", inventario_cancellato_il: null },
  });
  assert.equal(statoConferma().stato, "in_attesa");
});

test("un errore dopo un ok non cancella l'ultimo ok", () => {
  salvaEsitoSegnale({
    tentato_il: T(9, 0),
    esito: "ok",
    dettaglio: "ricevuto",
    livello: "solo_stato",
    risposta: { ricevuto_il: "2026-10-15 09:00:01", inventario_cancellato_il: "2026-10-15 09:00:01" },
  });
  salvaEsitoSegnale({ tentato_il: T(9, 5), esito: "errore", dettaglio: "DA-Link non raggiungibile", livello: "solo_stato" });
  const s = statoSegnale();
  assert.ok(s);
  assert.equal(s.esito, "errore");
  assert.equal(s.tentato_il, "2026-10-15 09:05:00");
  assert.equal(s.ok_il, "2026-10-15 09:00:00");
  assert.equal(s.ricevuto_il, "2026-10-15 09:00:01");
});
