/**
 * Le condizioni per togliere il vecchio (tappa 2g credenziali, T26 del piano
 * `plans/2026-10-15-tappa2-archivio-credenziali.md`), con le due decisioni di
 * Riccardo del 16/10:
 *   - D9 rivista: niente attesa di 14 giorni («non voglio attendere»). Restano
 *     i segni chiusi e il registro dei ripieghi a zero DAL RILASCIO DELLA 2f
 *     (la data del segno `credenziali_t2_integrazioni` del tenant), per i casi
 *     di D9 (tutti tranne `cred_public`);
 *   - lasciati accettati: il segno della 2e a `parziale:` non è più un blocco
 *     assoluto quando gli apparati lasciati, ricalcolati adesso con la
 *     conversione a vuoto, coincidono ESATTAMENTE con un elenco passato a mano
 *     per quel tenant (`--lasciati-accettati <tenant>:22,25`): mai dedotto, mai
 *     di default. Le righe di controller e AD lasciate (Omada) restano un blocco.
 * Perché una funzione pura: la stessa regola la legge lo script di misura sulle
 * copie (T26) e lo script di pulizia (T27), e un blocco deve dire il perché.
 *
 * Run: DA_INVENT_DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ipam.XXXXXX")" node --import tsx --test src/lib/credentials/__tests__/condizioni-2g.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  leggiLasciatiAccettati,
  leggiRegistroRipieghi,
  valutaCondizioni2g,
  type Registro,
  type StatoTenant2g,
} from "@/lib/credentials/condizioni-2g";

const DATA = "2026-10-16T08:00:00.000Z";
const done = (c = "x=0") => `done:${DATA}:${c}`;

function stato(o: Partial<StatoTenant2g> = {}): StatoTenant2g {
  return {
    tenant: "T2GPROVA",
    segni: { tipi: done(), catene: done(), apparati: done(), integrazioni: done(), ...(o.segni ?? {}) },
    lasciatiApparati: o.lasciatiApparati ?? [],
    lasciatiIntegrazioni: o.lasciatiIntegrazioni ?? [],
  };
}

const vuoto: Registro = { righe: [], illeggibili: 0 };

describe("valutaCondizioni2g", () => {
  it("segni done:, nessun lasciato, registro vuoto → si può; il segno della 2f di oggi non blocca (D9 rivista: niente 14 giorni)", () => {
    const e = valutaCondizioni2g(stato({ segni: { tipi: done(), catene: done(), apparati: done(), integrazioni: `done:${new Date().toISOString()}:controller=1` } }), vuoto, null);
    assert.equal(e.stato, "ok");
    assert.deepEqual(e.blocchi, []);
  });

  it("2e parziale: coi lasciati ricalcolati #22 e #25 e l'elenco 22,25 → si può, e la nota dice che restano senza credenziale", () => {
    const e = valutaCondizioni2g(
      stato({
        segni: { tipi: done(), catene: done(), apparati: `parziale:${DATA}:lasciati=2`, integrazioni: done() },
        lasciatiApparati: [
          { device_id: 25, motivo: "la scelta WinRM cambierebbe" },
          { device_id: 22, motivo: "la scelta SSH cambierebbe" },
        ],
      }),
      vuoto,
      [22, 25]
    );
    assert.equal(e.stato, "ok", e.blocchi.join("; "));
    assert.ok(e.note.some((n) => /#22, #25/.test(n) && /senza credenziale/.test(n)), e.note.join("; "));
  });

  it("2e parziale senza elenco → blocco, che dice quali sono i lasciati", () => {
    const e = valutaCondizioni2g(
      stato({ segni: { tipi: done(), catene: done(), apparati: `parziale:${DATA}:lasciati=2`, integrazioni: done() }, lasciatiApparati: [{ device_id: 22, motivo: "m" }, { device_id: 25, motivo: "m" }] }),
      vuoto,
      null
    );
    assert.equal(e.stato, "bloccato");
    assert.ok(e.blocchi.some((b) => /parziale/.test(b) && /#22, #25/.test(b)), e.blocchi.join("; "));
  });

  for (const [descr, accettati, lasciati] of [
    ["un lasciato in più", [22, 25], [22, 25, 31]],
    ["uno in meno", [22, 25], [22]],
    ["un elenco con un id diverso", [22, 26], [22, 25]],
    ["nessun lasciato ricalcolato ma l'elenco 22,25", [22, 25], []],
  ] as const) {
    it(`elenco e lasciati ricalcolati che non coincidono (${descr}) → blocco`, () => {
      const e = valutaCondizioni2g(
        stato({
          segni: { tipi: done(), catene: done(), apparati: `parziale:${DATA}:lasciati=2`, integrazioni: done() },
          lasciatiApparati: lasciati.map((id) => ({ device_id: id, motivo: "m" })),
        }),
        vuoto,
        [...accettati]
      );
      assert.equal(e.stato, "bloccato");
    });
  }

  it("2e done: ma la conversione a vuoto lascerebbe un apparato → blocco (perderebbe l'accesso)", () => {
    const e = valutaCondizioni2g(stato({ lasciatiApparati: [{ device_id: 40, motivo: "m" }] }), vuoto, null);
    assert.equal(e.stato, "bloccato");
  });

  it("righe Omada lasciate dalla 2f → blocco, anche con l'elenco degli apparati accettati", () => {
    const e = valutaCondizioni2g(
      stato({
        segni: { tipi: done(), catene: done(), apparati: `parziale:${DATA}:lasciati=2`, integrazioni: `parziale:${DATA}:lasciati=1` },
        lasciatiApparati: [{ device_id: 22, motivo: "m" }, { device_id: 25, motivo: "m" }],
        lasciatiIntegrazioni: [{ tabella: "network_controllers", id: 3, motivo: "Omada non si legge ancora" }],
      }),
      vuoto,
      [22, 25]
    );
    assert.equal(e.stato, "bloccato");
    assert.ok(e.blocchi.some((b) => /credenziali_t2_integrazioni/.test(b)));
    assert.ok(e.blocchi.some((b) => /controller #3/.test(b)));
  });

  for (const chiave of ["tipi", "catene", "integrazioni"] as const) {
    for (const valore of [`parziale:${DATA}:saltate=1`, "errore:UNIQUE constraint failed", null]) {
      it(`segno ${chiave} = ${valore ?? "assente"} (con gli altri presenti) → blocco`, () => {
        const s = stato();
        s.segni[chiave] = valore;
        assert.equal(valutaCondizioni2g(s, vuoto, null).stato, "bloccato");
      });
    }
  }

  it("2e con errore: → blocco anche con l'elenco", () => {
    const s = stato({ segni: { tipi: done(), catene: done(), apparati: "errore:la chiave", integrazioni: done() } });
    assert.equal(valutaCondizioni2g(s, vuoto, []).stato, "bloccato");
  });

  it("un tenant senza nessun segno (mai aperto dopo la 2c, come il DEFAULT dell'hub) → escluso, detto per nome", () => {
    const e = valutaCondizioni2g(stato({ segni: { tipi: null, catene: null, apparati: null, integrazioni: null } }), vuoto, null);
    assert.equal(e.stato, "escluso");
    assert.ok(e.note.some((n) => /T2GPROVA/.test(n)));
  });

  describe("registro dei ripieghi dal rilascio della 2f", () => {
    const riga = (o: Partial<Registro["righe"][number]>) => ({ ts: "2026-10-16T09:00:00.000Z", caso: "cred_colonna_apparato", tenant: "T2GPROVA", firma: "f @ src/x.ts:1:1", tipo: "conteggio", n: 1, ...o });

    it("un ripiego vecchio dopo la data del segno della 2f → blocco, con caso, firma e conteggio", () => {
      const e = valutaCondizioni2g(stato(), { righe: [riga({ n: 10, ora: "2026-10-16T09" } as never)], illeggibili: 0 }, null);
      assert.equal(e.stato, "bloccato");
      assert.ok(e.blocchi.some((b) => /cred_colonna_apparato/.test(b) && /f @ src\/x\.ts:1:1/.test(b) && /10/.test(b)), e.blocchi.join("; "));
    });

    it("prima del rilascio della 2f, cred_public, un altro tenant → non contano; un tenant non indicato sì", () => {
      const r: Registro = {
        righe: [
          riga({ ts: "2026-10-16T07:59:59.000Z" }),
          riga({ caso: "cred_public" }),
          riga({ tenant: "T2GTERZO" }),
        ],
        illeggibili: 0,
      };
      assert.equal(valutaCondizioni2g(stato(), r, null).stato, "ok");
      const conNull: Registro = { righe: [riga({ tenant: null, caso: "cred_v3_vecchia" })], illeggibili: 0 };
      assert.equal(valutaCondizioni2g(stato(), conNull, null).stato, "bloccato");
    });

    for (const caso of ["cred_colonna_apparato", "cred_binding_inline", "cred_catena_vecchia", "cred_chiave_hub", "cred_riga_integrazione", "cred_v3_vecchia"]) {
      it(`${caso} conta`, () => {
        assert.equal(valutaCondizioni2g(stato(), { righe: [riga({ caso })], illeggibili: 0 }, null).stato, "bloccato");
      });
    }

    // T27 (16/10, sessione principale): il registro scrive caso, tenant e firma, non l'apparato. Con
    // lasciati accettati, un `cred_colonna_apparato` può venire da loro (il motore della 2f ripiegava
    // sulla colonna dopo il binding fallito): non blocca da solo, si conta e si conferma per iscritto.
    const parzialeAccettato = () =>
      stato({
        segni: { tipi: done(), catene: done(), apparati: `parziale:${DATA}:lasciati=2`, integrazioni: done() },
        lasciatiApparati: [{ device_id: 22, motivo: "m" }, { device_id: 25, motivo: "m" }],
      });

    it("cred_colonna_apparato con lasciati accettati → da confermare, col conteggio e la firma, non blocco", () => {
      const r: Registro = {
        righe: [riga({ n: 10, ora: "2026-10-16T09" } as never), riga({ n: 1, ora: "2026-10-16T10", firma: "g @ src/y.ts:2:2" } as never)],
        illeggibili: 0,
      };
      const e = valutaCondizioni2g(parzialeAccettato(), r, [22, 25]);
      assert.equal(e.stato, "da_confermare", e.blocchi.join("; "));
      assert.deepEqual(e.blocchi, []);
      assert.ok(e.daConfermare, "manca il da confermare");
      assert.equal(e.daConfermare.conteggio, 11);
      assert.ok(e.daConfermare.righe.some((x) => /f @ src\/x\.ts:1:1/.test(x) && /10/.test(x)), e.daConfermare.righe.join("; "));
      assert.ok(e.daConfermare.righe.some((x) => /g @ src\/y\.ts:2:2/.test(x)), e.daConfermare.righe.join("; "));
    });

    it("con lasciati accettati gli altri casi bloccano lo stesso, e il da confermare resta elencato", () => {
      const r: Registro = { righe: [riga({}), riga({ caso: "cred_binding_inline", firma: "h @ src/z.ts:3:3" })], illeggibili: 0 };
      const e = valutaCondizioni2g(parzialeAccettato(), r, [22, 25]);
      assert.equal(e.stato, "bloccato");
      assert.ok(e.blocchi.some((b) => /cred_binding_inline/.test(b)), e.blocchi.join("; "));
      assert.ok(!e.blocchi.some((b) => /cred_colonna_apparato/.test(b)), e.blocchi.join("; "));
      assert.equal(e.daConfermare?.conteggio, 1);
    });

    it("cred_colonna_apparato senza lasciati accettati (elenco assente o vuoto) → blocco come prima", () => {
      const r: Registro = { righe: [riga({})], illeggibili: 0 };
      for (const accettati of [null, []]) {
        const e = valutaCondizioni2g(stato(), r, accettati);
        assert.equal(e.stato, "bloccato");
        assert.equal(e.daConfermare, null);
      }
    });

    it("registro vuoto con lasciati accettati → ok, niente da confermare", () => {
      const e = valutaCondizioni2g(parzialeAccettato(), vuoto, [22, 25]);
      assert.equal(e.stato, "ok");
      assert.equal(e.daConfermare, null);
    });

    it("righe illeggibili o il tetto orario raggiunto → blocco: il registro non dice tutto", () => {
      assert.equal(valutaCondizioni2g(stato(), { righe: [], illeggibili: 1 }, null).stato, "bloccato");
      const limite: Registro = { righe: [{ ts: "2026-10-16T09:00:00.000Z", caso: "", tenant: null, firma: "", tipo: "limite" }], illeggibili: 0 };
      assert.equal(valutaCondizioni2g(stato(), limite, null).stato, "bloccato");
    });
  });
});

describe("leggiLasciatiAccettati", () => {
  it("<tenant>:<id>,<id>, anche ripetuta per tenant diversi", () => {
    const m = leggiLasciatiAccettati(["T2GPROVA:22,25", "T2GALTRO:7"]);
    assert.deepEqual([...m.entries()], [["T2GPROVA", [22, 25]], ["T2GALTRO", [7]]]);
  });

  for (const sbagliato of ["22,25", "T2GPROVA:", "T2GPROVA:22,x", "T2GPROVA:0", ":22", "T2GPROVA:22,22"]) {
    it(`«${sbagliato}» → errore in italiano, niente dedotto`, () => {
      assert.throws(() => leggiLasciatiAccettati([sbagliato]), /--lasciati-accettati/);
    });
  }

  it("lo stesso tenant due volte → errore", () => {
    assert.throws(() => leggiLasciatiAccettati(["T2GPROVA:22", "T2GPROVA:25"]), /due volte/);
  });
});

describe("leggiRegistroRipieghi", () => {
  it("legge i file del registro, conta le righe che non si leggono, non scrive niente", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ripieghi-t26-"));
    fs.writeFileSync(path.join(dir, "ripieghi-2026-10-16.jsonl"), `${JSON.stringify({ ts: "2026-10-16T09:00:00.000Z", caso: "cred_public", tenant: "T2GPROVA", firma: "f", tipo: "conteggio", ora: "2026-10-16T09", n: 1 })}\nnon json\n`);
    fs.writeFileSync(path.join(dir, "altro.txt"), "ignorato");
    const prima = fs.readdirSync(dir).map((f) => [f, fs.statSync(path.join(dir, f)).mtimeMs]);
    const r = leggiRegistroRipieghi(dir);
    assert.equal(r.righe.length, 1);
    assert.equal(r.illeggibili, 1);
    assert.deepEqual(fs.readdirSync(dir).map((f) => [f, fs.statSync(path.join(dir, f)).mtimeMs]), prima);
  });

  it("una cartella che non c'è → errore, non un registro vuoto", () => {
    assert.throws(() => leggiRegistroRipieghi(path.join(os.tmpdir(), "non-esiste-t26-registro")), /registro/);
  });
});
