/**
 * Testo da girare all'IT del cliente (piano accesso Windows, Task 8).
 *
 * Riccardo, 04/11/2026: «deve essere chiaro cosa abilitare per l'utente e cosa per la sicurezza del dominio».
 * La richiesta si copia dal catalogo dei diritti: contiene i comandi dei soli diritti che mancano davvero (`no`), mai
 * quelli non verificati, e mai una password.
 *
 * Run: node --import tsx --test src/lib/credentials/__tests__/richiesta-it.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DIRITTI, dirittoPerId } from "../diritti";
import { dirittiMancanti, testoConteggioMancanti, testoRichiestaIt } from "../richiesta-it";

describe("dirittiMancanti: solo lo stato «no»", () => {
  it("un diritto non verificato non è mancante: non lo si può chiedere all'IT senza sapere", () => {
    const m = dirittiMancanti([
      { dirittoId: "eventi_dc", stato: "no" },
      { dirittoId: "dhcp", stato: "non_verificato" },
      { dirittoId: "account_dominio", stato: "si" },
    ]);
    assert.deepEqual(m.map((d) => d.id), ["eventi_dc"]);
  });

  it("«in parte» è un diritto mancante: su alcuni host manca davvero", () => {
    const m = dirittiMancanti([{ dirittoId: "inventario_wmi", stato: "in_parte" }]);
    assert.deepEqual(m.map((d) => d.id), ["inventario_wmi"]);
  });

  it("l'ordine è quello del catalogo, non quello delle righe", () => {
    const m = dirittiMancanti([
      { dirittoId: "dhcp", stato: "no" },
      { dirittoId: "inventario_wmi", stato: "no" },
    ]);
    assert.deepEqual(m.map((d) => d.id), ["inventario_wmi", "dhcp"]);
  });

  it("un id fuori catalogo è un errore di programmazione e si dice", () => {
    assert.throws(() => dirittiMancanti([{ dirittoId: "inventato", stato: "no" }]), /Diritto sconosciuto/);
  });
});

describe("testoConteggioMancanti", () => {
  it("il conto per famiglia: i due account sono separati, un totale non direbbe a chi chiedere cosa", () => {
    const m = [dirittoPerId("inventario_wmi"), dirittoPerId("inventario_winrm"), dirittoPerId("eventi_dc")];
    assert.equal(testoConteggioMancanti(m), "Mancano 2 per l'utente delle scansioni · 1 per la sicurezza del dominio");
  });

  it("una famiglia sola, e il singolare", () => {
    assert.equal(testoConteggioMancanti([dirittoPerId("eventi_dc")]), "Manca 1 per la sicurezza del dominio");
  });

  it("niente che manchi: vuoto", () => {
    assert.equal(testoConteggioMancanti([]), "");
  });
});

describe("testoRichiestaIt", () => {
  it("una richiesta, due blocchi, un account per blocco: dice che sono due account separati", () => {
    const testo = testoRichiestaIt([dirittoPerId("inventario_wmi"), dirittoPerId("eventi_dc")]);
    assert.equal(testo.split("Richiesta per l'IT").length - 1, 1);
    assert.match(testo, /== Utente delle scansioni — account svc-ipam ==/);
    assert.match(testo, /== Sicurezza del dominio — account svc-ipam-dc ==/);
    assert.match(testo, /due account separati/);
    assert.ok(testo.indexOf("svc-ipam ==") < testo.indexOf("svc-ipam-dc =="));
  });

  it("anche con una famiglia sola si spiega che sono due: chi legge non deve unire gli account", () => {
    assert.match(testoRichiestaIt([dirittoPerId("inventario_wmi")]), /due account separati/);
  });

  it("elenca tutti i nomi d'esempio usati nei comandi", () => {
    const testo = testoRichiestaIt(DIRITTI.filter((d) => d.comandoIt));
    const elenco = /Nei comandi i nomi \(([^)]*)\) sono d'esempio/.exec(testo)?.[1] ?? "";
    for (const nome of ["svc-ipam", "svc-ipam-dc", "DOMINIO", "dominio.fqdn"]) {
      assert.ok(elenco.split(", ").includes(nome), `manca ${nome} in «${elenco}»`);
      assert.ok(DIRITTI.some((d) => d.comandoIt?.includes(nome)), `${nome} non è più nei comandi`);
    }
  });

  it("nessun diritto mancante: testo vuoto", () => {
    assert.equal(testoRichiestaIt([]), "");
  });

  it("riporta funzione e comando di ogni diritto mancante, e solo di quelli", () => {
    const testo = testoRichiestaIt([dirittoPerId("eventi_dc"), dirittoPerId("inventario_wmi")]);
    for (const id of ["eventi_dc", "inventario_wmi"]) {
      const d = dirittoPerId(id);
      assert.ok(testo.includes(d.funzione), `manca la funzione di ${id}`);
      assert.ok(testo.includes(d.comandoIt ?? ""), `manca il comando di ${id}`);
    }
    assert.ok(!testo.includes(dirittoPerId("dhcp").comandoIt ?? "§"), "il comando di un diritto non richiesto non c'entra");
  });

  it("due diritti con lo stesso comando lo portano una volta sola", () => {
    const a = dirittoPerId("inventario_winrm");
    const b = dirittoPerId("software_patch");
    assert.equal(a.comandoIt, b.comandoIt);
    const testo = testoRichiestaIt([a, b]);
    assert.equal(testo.split(a.comandoIt ?? "").length - 1, 1);
    assert.ok(testo.includes(a.funzione) && testo.includes(b.funzione), "le due funzioni restano scritte");
  });

  it("niente password: nessuna riga assegna un valore a una password", () => {
    const testo = testoRichiestaIt(DIRITTI.filter((d) => d.comandoIt));
    // `$password = Read-Host …` è la richiesta della password al momento, non un valore scritto.
    const senzaPrompt = testo.split("\n").filter((r) => !/Read-Host/i.test(r)).join("\n");
    assert.ok(!/password\s*[:=]\s*\S/i.test(senzaPrompt));
    assert.ok(/Read-Host/.test(testo), "il comando che crea l'account chiede la password al momento");
    assert.ok(!/ConvertTo-SecureString/i.test(testo), "la password non si scrive nemmeno cifrata");
  });
});
