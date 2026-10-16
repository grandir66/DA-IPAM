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
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { controllaDatiVeri, leggiStatoSystemctl, nomeUnitaValido, type StatoUnita } from "@/lib/credentials/guardia-scrittura";

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

/**
 * Revisione della 2g (16/10): il timer si ricavava come `${unità}-update.timer`
 * e «assente» passava. Con `--servizio da-ipam.service` (come si scrive spesso
 * con systemd) la guardia guardava `da-ipam.service-update.timer`, che non
 * esiste, e lasciava scrivere col vero `da-ipam-update.timer` acceso: mentre
 * lo script scrive, il timer lancia auto-update.sh (pull, npm install, build
 * nella stessa cartella). E fermare il timer non ferma un aggiornamento già
 * partito (`<app>-update.service`, oneshot, riavvia il servizio alla fine).
 */
describe("controllaDatiVeri: servizio, timer e aggiornamento", () => {
  const dati = fs.mkdtempSync(path.join(os.tmpdir(), "guardia-scrittura-"));
  fs.writeFileSync(path.join(dati, "hub.db"), "");
  fs.mkdirSync(path.join(dati, "tenants"));
  after(() => fs.rmSync(dati, { recursive: true, force: true }));

  const FERMO: StatoUnita = { stato: "fermo" };
  const ACCESO: StatoUnita = { stato: "attivo", dettaglio: "active" };
  /** Un systemctl finto: le unità non elencate non esistono. */
  const lettore = (unita: Record<string, StatoUnita>) => (nome: string): StatoUnita => unita[nome] ?? { stato: "assente" };
  const esito = (servizio: string, unita: Record<string, StatoUnita>) => controllaDatiVeri({ dati, unita: servizio, cartelle: [dati] }, lettore(unita));
  const controlla = (servizio: string, unita: Record<string, StatoUnita>) => esito(servizio, unita).errori;
  const cliente = (timer: StatoUnita, aggiornamento: StatoUnita = FERMO) => ({
    "da-ipam.service": FERMO,
    "da-ipam-update.timer": timer,
    "da-ipam-update.service": aggiornamento,
  });

  for (const nome of ["da-ipam", "da-ipam.service"]) {
    it(`--servizio ${nome} col timer da-ipam-update.timer acceso → non scrive`, () => {
      const errori = controlla(nome, cliente(ACCESO));
      assert.ok(errori.some((e) => /il timer da-ipam-update\.timer è acceso/.test(e)), errori.join("\n"));
    });
  }

  for (const nome of ["da-ipam", "da-ipam.service"]) {
    it(`--servizio ${nome} con servizio, timer e aggiornamento fermi → si scrive, e si dice quale timer si è guardato`, () => {
      const e = esito(nome, cliente(FERMO));
      assert.deepEqual(e.errori, []);
      assert.deepEqual(e.controllate, ["da-ipam.service: fermo", "da-ipam-update.timer: fermo", "da-ipam-update.service: fermo"]);
    });
  }

  it("il timer non c'è ma l'aggiornamento sì → non scrive (il timer ha un altro nome: non si sa se è fermo)", () => {
    const errori = controlla("da-ipam.service", { "da-ipam.service": FERMO, "da-ipam-update.service": FERMO });
    assert.ok(errori.some((e) => /da-ipam-update\.timer non esiste/.test(e)), errori.join("\n"));
  });

  it("né timer né aggiornamento (nessun aggiornamento automatico) → si scrive", () => {
    assert.deepEqual(controlla("da-ipam.service", { "da-ipam.service": FERMO }), []);
  });

  it("un aggiornamento in corso (da-ipam-update.service attivo) col timer fermo → non scrive", () => {
    const errori = controlla("da-ipam.service", cliente(FERMO, { stato: "attivo", dettaglio: "activating" }));
    assert.ok(errori.some((e) => /da-ipam-update\.service è in corso/.test(e)), errori.join("\n"));
  });

  it("un nome con un altro suffisso o un punto → non scrive, e non si indovina", () => {
    for (const nome of ["da-ipam.timer", "da-ipam-update.timer", "da.ipam"]) {
      const errori = controlla(nome, { [nome]: FERMO, "da-ipam.service": FERMO });
      assert.ok(errori.some((e) => /non è il nome di un servizio/.test(e)), `${nome}: ${errori.join("\n")}`);
    }
  });
});
