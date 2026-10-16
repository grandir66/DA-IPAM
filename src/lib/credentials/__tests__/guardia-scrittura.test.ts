/**
 * Lo stato di un'unità systemd per gli script che scrivono sui dati veri
 * (tappa 2g credenziali, T27: `pulizia-t2.ts`, `togli-chiavi-hub.ts`, «a
 * servizio fermo»).
 *
 * Perché: `systemctl is-active` di un'unità che non esiste risponde
 * «inactive», come un servizio fermo: un nome sbagliato farebbe scrivere sul DB
 * con il servizio acceso. Si legge `systemctl show` (LoadState e ActiveState),
 * e un comando remoto o locale ha tre esiti: fermo, attivo, non so (lezione
 * 5: un errore di trasporto non è una risposta). Solo «fermo» lascia scrivere.
 *
 * Run: DA_INVENT_DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ipam.XXXXXX")" node --import tsx --test src/lib/credentials/__tests__/guardia-scrittura.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { leggiStatoSystemctl, nomeUnitaValido } from "@/lib/credentials/guardia-scrittura";

const show = (load: string, active: string) => ({ status: 0, stdout: `LoadState=${load}\nActiveState=${active}\n` });

describe("leggiStatoSystemctl", () => {
  for (const active of ["inactive", "failed"]) {
    it(`caricata e ${active} → fermo`, () => {
      assert.deepEqual(leggiStatoSystemctl(show("loaded", active)), { stato: "fermo" });
    });
  }

  for (const active of ["active", "activating", "deactivating", "reloading", "refreshing"]) {
    it(`caricata e ${active} → attivo`, () => {
      const s = leggiStatoSystemctl(show("loaded", active));
      assert.equal(s.stato, "attivo");
    });
  }

  it("unità che non c'è (LoadState=not-found, ActiveState=inactive) → assente, mai fermo", () => {
    assert.equal(leggiStatoSystemctl(show("not-found", "inactive")).stato, "assente");
  });

  it("niente systemctl (errore di avvio) → non so", () => {
    const s = leggiStatoSystemctl({ status: null, stdout: "", error: Object.assign(new Error("spawn systemctl ENOENT"), { code: "ENOENT" }) });
    assert.equal(s.stato, "non_so");
  });

  it("uscita diversa da 0, risposta vuota o illeggibile, stato sconosciuto → non so", () => {
    assert.equal(leggiStatoSystemctl({ status: 1, stdout: "LoadState=loaded\nActiveState=inactive\n" }).stato, "non_so");
    assert.equal(leggiStatoSystemctl({ status: 0, stdout: "" }).stato, "non_so");
    assert.equal(leggiStatoSystemctl(show("loaded", "qualcosa")).stato, "non_so");
    assert.equal(leggiStatoSystemctl(show("masked", "inactive")).stato, "non_so");
  });
});

describe("nomeUnitaValido", () => {
  it("nomi di unità come da-invent, da-ipam, da-ipam-update.timer", () => {
    for (const n of ["da-invent", "da-ipam", "da-ipam-update.timer", "app@1.service"]) assert.equal(nomeUnitaValido(n), true, n);
  });
  it("niente opzioni, spazi o percorsi", () => {
    for (const n of ["", "--all", "da ipam", "../x", "a;b"]) assert.equal(nomeUnitaValido(n), false, n);
  });
});
