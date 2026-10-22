/**
 * L'esito delle conversioni dell'import si vede nella pagina di trasferimento
 * (revisione della 2c, 16/10).
 *
 * Perché: dalla 2c l'import rilancia la normalizzazione dei tipi delle
 * credenziali e ne mette l'esito in `ImportResult.conversioni`, «così non
 * succede in silenzio» (piano, vincoli «Migrazioni»). Ma la pagina, l'unica che
 * legge la risposta, mostrava solo «Import completato: N righe…»: un
 * `parziale:` o una voce divisa dopo un'unione non li vedeva nessuno.
 * Il piano (Rischi) vuole anche nella pagina l'avviso sui bundle nuovi
 * importati in un'installazione di prima della 2c.
 *
 * Run: node --import tsx --test src/lib/transfer/__tests__/esito-import.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { righeConversioni, righeSaltate } from "../esito-import";

const ZERO = "linux_ssh=0,snmp_v3=0,ibride=0,v3_vecchie=0,v3_vecchie_divise=0,usi_spostati=0,lasciate=0";
const DETTAGLIO_ZERO =
  "linux → ssh 0, snmp → snmp_v3 0, ibride divise 0, v3 vecchie sul posto 0, v3 vecchie divise 0, usi spostati 0, lasciate 0";

describe("righeConversioni", () => {
  it("nessuna conversione nella risposta (import di prima della 2c): nessuna riga", () => {
    assert.deepEqual(righeConversioni(undefined), []);
    assert.deepEqual(righeConversioni({}), []);
  });

  it("done senza niente da convertire: una riga breve, non da controllare", () => {
    const righe = righeConversioni({ credenziali_t2_tipi: { segno: `done:2026-10-16T10:11:12.345Z:${ZERO}`, dettaglio: DETTAGLIO_ZERO } });
    assert.deepEqual(righe, [{ testo: "Tipi delle credenziali: niente da convertire", daControllare: false }]);
  });

  it("done con voci convertite (un'unione che divide un'ibrida): il dettaglio per id, non da controllare", () => {
    const dettaglio = "linux → ssh 1, snmp → snmp_v3 0, ibride divise 1 [#3→#9], v3 vecchie sul posto 0, v3 vecchie divise 0, usi spostati 2, lasciate 0";
    const righe = righeConversioni({
      credenziali_t2_tipi: { segno: "done:2026-10-16T10:11:12.345Z:linux_ssh=1,snmp_v3=0,ibride=1,v3_vecchie=0,v3_vecchie_divise=0,usi_spostati=2,lasciate=0", dettaglio },
    });
    assert.deepEqual(righe, [{ testo: `Tipi delle credenziali convertiti: ${dettaglio}`, daControllare: false }]);
  });

  it("parziale: da controllare, col dettaglio delle voci lasciate", () => {
    const dettaglio = "linux → ssh 0, snmp → snmp_v3 0, ibride divise 0, v3 vecchie sul posto 0, v3 vecchie divise 0, usi spostati 0, lasciate 1 [#5: tipo sconosciuto «boh»]";
    const righe = righeConversioni({ credenziali_t2_tipi: { segno: "parziale:2026-10-16T10:11:12.345Z:lasciate=1", dettaglio } });
    assert.equal(righe.length, 1);
    assert.equal(righe[0].daControllare, true);
    assert.equal(righe[0].testo, `Tipi delle credenziali, conversione parziale: ${dettaglio}`);
  });

  it("errore: da controllare, col messaggio e il riprova", () => {
    const righe = righeConversioni({
      credenziali_t2_tipi: { segno: "errore:database is locked", dettaglio: "normalizzazione dei tipi delle credenziali non eseguita" },
    });
    assert.deepEqual(righe, [
      {
        testo: "Tipi delle credenziali: normalizzazione dei tipi delle credenziali non eseguita (database is locked). Si riprova alla prossima apertura del tenant.",
        daControllare: true,
      },
    ]);
  });

  it("segno che non si riconosce, o conversione senza nome: si mostra com'è, da controllare", () => {
    const righe = righeConversioni({ credenziali_t2_nuova: { segno: "boh", dettaglio: "x" } });
    assert.deepEqual(righe, [{ testo: "credenziali_t2_nuova: esito non riconosciuto («boh»): x", daControllare: true }]);
  });
});

describe("la pagina di trasferimento", () => {
  const pagina = readFileSync(join(process.cwd(), "src/app/(dashboard)/settings/transfer/page.tsx"), "utf8");

  it("mostra l'esito delle conversioni della risposta", () => {
    assert.match(pagina, /righeConversioni\(r\?\.conversioni\)/);
  });

  it("avvisa, all'export, che un'installazione di prima della 2c rifiuta il bundle", () => {
    assert.match(pagina, /SNMP v3, UniFi,\s+Omada, Active Directory/);
    assert.match(pagina, /senza chiave/);
  });
});

// Unione, decisione del 19/10 (analisi F01): vince la destinazione, e le chiavi
// rimaste quelle di prima si dicono, una per una.
describe("righeSaltate", () => {
  it("nessuna chiave saltata → nessuna riga", () => {
    assert.deepEqual(righeSaltate({}), []);
    assert.deepEqual(righeSaltate(undefined), []);
    assert.deepEqual(righeSaltate({ tenant_settings: [] }), []);
  });
  it("le chiavi saltate si elencano per tabella, al singolare e al plurale", () => {
    assert.deepEqual(righeSaltate({ tenant_settings: ["audit-key"] }), [
      { testo: "tenant_settings: 1 chiave già presente, resta il valore attuale (audit-key)", daControllare: false },
    ]);
    assert.deepEqual(righeSaltate({ tenant_settings: ["a", "b"] }), [
      { testo: "tenant_settings: 2 chiavi già presenti, restano i valori attuali (a, b)", daControllare: false },
    ]);
  });
});
