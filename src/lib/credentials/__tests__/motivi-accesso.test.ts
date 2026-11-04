/**
 * Una parola e una sola azione per ogni motivo dell'accesso Windows (piano accesso Windows, Task 9).
 *
 * Il catalogo dei motivi è `MotivoAccesso` del motore: qui si prova che nessun motivo resti senza parola né azione, che le
 * azioni dei diritti vengano dal catalogo dei diritti (non copiate), e che la posizione nella classifica in SQL sia la
 * stessa del motore.
 *
 * Run: node --import tsx --test src/lib/credentials/__tests__/motivi-accesso.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ORDINE_MOTIVI, type MotivoAccesso } from "@/lib/scanner/accesso-windows";
import { dirittoPerId } from "../diritti";
import { aspettoDelMotivo, azioneDelMotivo, comeMotivo, MOTIVI, motivoDaPosizione, parolaDelMotivo, segnoDelMotivo } from "../motivi-accesso";

describe("ogni motivo ha una parola e un segno", () => {
  for (const m of MOTIVI) {
    it(m, () => {
      assert.ok(parolaDelMotivo(m).length > 0);
      assert.ok(!/\s/.test(parolaDelMotivo(m)), `«${parolaDelMotivo(m)}» deve essere una parola sola`);
      assert.ok(["si", "attenzione", "no", "non_provato"].includes(segnoDelMotivo(m)));
    });
  }

  it("nessun motivo (null) è «Non provato», col segno tratteggiato", () => {
    assert.equal(parolaDelMotivo(null), "Non provato");
    assert.equal(segnoDelMotivo(null), "non_provato");
  });

  it("porte chiuse e budget esaurito non hanno provato niente: segno «non provato», come senza riga", () => {
    assert.equal(segnoDelMotivo("porte_chiuse"), "non_provato");
    assert.equal(segnoDelMotivo("budget_esaurito"), "non_provato");
  });

  it("solo «ok» è sì; diritti, password ed errore sono no; il firewall non dice niente della voce: attenzione", () => {
    assert.equal(segnoDelMotivo("ok"), "si");
    for (const m of ["diritti_mancanti", "password_errata", "errore"] as const) assert.equal(segnoDelMotivo(m), "no", m);
    assert.equal(segnoDelMotivo("firewall"), "attenzione");
  });

  it("stato e forma: Firewall ambra con lo scudo, Negato pieno col lucchetto, mai la stessa forma", () => {
    assert.deepEqual(aspettoDelMotivo("firewall"), { segno: "attenzione", forma: "scudo" });
    assert.deepEqual(aspettoDelMotivo("diritti_mancanti"), { segno: "no", forma: "lucchetto" });
    assert.deepEqual(aspettoDelMotivo("ok"), { segno: "si", forma: "spunta" });
    assert.deepEqual(aspettoDelMotivo(null), { segno: "non_provato", forma: "trattino" });
  });
});

describe("l'azione", () => {
  it("ok non ha azione; ogni altro motivo ne ha una, per ogni strada", () => {
    for (const strada of ["winrm", "wmi"] as const) {
      assert.equal(azioneDelMotivo("ok", strada), null);
      for (const m of MOTIVI.filter((x) => x !== "ok")) assert.ok((azioneDelMotivo(m, strada) ?? "").length > 0, `${m}/${strada}`);
      assert.ok((azioneDelMotivo(null, strada) ?? "").length > 0);
    }
  });

  it("i diritti mancanti dicono cosa abilitare scritto nel catalogo dei diritti, per la strada giusta", () => {
    assert.ok(azioneDelMotivo("diritti_mancanti", "winrm")?.includes(dirittoPerId("inventario_winrm").abilitare));
    assert.ok(azioneDelMotivo("diritti_mancanti", "wmi")?.includes(dirittoPerId("inventario_wmi").abilitare));
  });
});

describe("la posizione per la classifica in SQL", () => {
  it("segue l'ordine del motore: ok per primo, poi quanto sta in ORDINE_MOTIVI", () => {
    assert.deepEqual(MOTIVI.slice(0, ORDINE_MOTIVI.length), [...ORDINE_MOTIVI]);
  });

  it("motivoDaPosizione è l'inverso, e null per una posizione che non c'è", () => {
    MOTIVI.forEach((m, i) => assert.equal(motivoDaPosizione(i), m));
    assert.equal(motivoDaPosizione(null), null);
    assert.equal(motivoDaPosizione(99), null);
  });
});

describe("comeMotivo: un testo del database che non è un motivo non diventa un motivo", () => {
  it("riconosce i motivi e scarta il resto", () => {
    assert.equal(comeMotivo("firewall"), "firewall");
    assert.equal(comeMotivo("boh"), null);
    assert.equal(comeMotivo(null), null);
  });

  it("MOTIVI non perde nessun motivo del motore", () => {
    const tutti: MotivoAccesso[] = ["ok", "diritti_mancanti", "password_errata", "firewall", "porte_chiuse", "nessuna_voce", "budget_esaurito", "errore"];
    for (const m of tutti) assert.ok(MOTIVI.includes(m), m);
  });
});
