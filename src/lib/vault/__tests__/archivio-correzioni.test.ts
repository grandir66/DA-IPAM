/**
 * Correzioni della revisione del 23/10 all'archivio:
 *
 * 10. La passphrase si normalizza allo stesso modo ovunque: `crea` la prendeva com'era, `reset-password` (recupero) la
 *     tagliava ai bordi, e un cliente con una passphrase con spazio finale restava fuori dopo un recupero. Ora una
 *     passphrase con spazi (o a capo, tab) ai bordi è RIFIUTATA, sia alla creazione sia al cambio; mai tagliata in silenzio.
 * 12. Senza slot Domarc (D5) il riferimento della richiesta scritta del cliente è obbligatorio e va scritto
 *     nell'archivio (`domarcEscluso`), e sopravvive alle riscritture di `archivio.json`.
 *
 * Run: node --import tsx --test src/lib/vault/__tests__/archivio-correzioni.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apriConPassphrase, creaArchivio, leggiArchivio, scriviSlotCliente, scriviSlotTpm } from "../archivio";
import { leggiIdentitaDaStdin } from "../recupero";
import { ErroreVault } from "../tipi";

const PASS = "cavallo-batteria-graffetta-42";
const LOGN = 10;
const cartella = () => mkdtempSync(join(tmpdir(), "da-vault-archivio-corr-"));

async function codiceDi(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    assert.ok(e instanceof ErroreVault, `atteso ErroreVault, arrivato ${String(e)}`);
    return `${e.codice}: ${e.message}`;
  }
  return "nessun errore";
}

describe("rilievo 10: la passphrase non si taglia, si rifiuta se ha spazi ai bordi", () => {
  for (const [nome, p] of [
    ["spazio iniziale", ` ${PASS}`],
    ["spazio finale", `${PASS} `],
    ["tab finale", `${PASS}\t`],
    ["a capo finale", `${PASS}\n`],
  ] as const) {
    it(`crea rifiuta una passphrase con ${nome}`, async () => {
      const dir = cartella();
      const esito = await codiceDi(creaArchivio(dir, { passphrase: p, chiaveDomarc: null, senzaDomarc: true, richiestaCliente: "RIC-1", scryptLogN: LOGN }));
      assert.match(esito, /^configurazione: .*(spazi|bordi|inizio)/);
      assert.ok(!esito.includes(PASS), "il messaggio ripete la passphrase");
    });
  }

  it("il cambio di passphrase (reset-password) rifiuta lo stesso: la stessa regola di crea", async () => {
    const dir = cartella();
    const { chiave } = await creaArchivio(dir, { passphrase: PASS, chiaveDomarc: null, senzaDomarc: true, richiestaCliente: "RIC-2", scryptLogN: LOGN });
    assert.match(await codiceDi(scriviSlotCliente(dir, chiave, ` ${PASS}x`, LOGN)), /^configurazione:/);
    // La passphrase vecchia è ancora quella che apre.
    assert.deepEqual(await apriConPassphrase(dir, PASS), chiave);
  });

  it("lo stdin del recupero non taglia la passphrase nuova: arriva com'è e poi viene rifiutata", () => {
    const id = `AGE-SECRET-KEY-1${"A".repeat(58)}`;
    assert.deepEqual(leggiIdentitaDaStdin(`${id}\n ${PASS} \n`).resto, [` ${PASS} `]);
  });

  it("spazi DENTRO la passphrase vanno bene, in creazione e in apertura", async () => {
    const dir = cartella();
    const frase = "una frase con molti spazi dentro 2026";
    const { chiave } = await creaArchivio(dir, { passphrase: frase, chiaveDomarc: null, senzaDomarc: true, richiestaCliente: "RIC-3", scryptLogN: LOGN });
    assert.deepEqual(await apriConPassphrase(dir, frase), chiave);
  });
});

describe("rilievo 12: richiesta scritta del cliente per escludere Domarc", () => {
  it("senza slot Domarc la richiesta è obbligatoria", async () => {
    const dir = cartella();
    assert.match(await codiceDi(creaArchivio(dir, { passphrase: PASS, chiaveDomarc: null, senzaDomarc: true, scryptLogN: LOGN })), /^configurazione: .*richiesta/i);
    assert.match(await codiceDi(creaArchivio(dir, { passphrase: PASS, chiaveDomarc: null, senzaDomarc: true, richiestaCliente: "  ", scryptLogN: LOGN })), /^configurazione: .*richiesta/i);
  });

  it("il riferimento va in archivio.json, con la data, e si legge", async () => {
    const dir = cartella();
    await creaArchivio(dir, { passphrase: PASS, chiaveDomarc: null, senzaDomarc: true, richiestaCliente: "RIC-2026-17", scryptLogN: LOGN });
    const su = JSON.parse(readFileSync(join(dir, "archivio.json"), "utf8")) as { domarcEscluso?: { richiesta: string; il: string } };
    assert.equal(su.domarcEscluso?.richiesta, "RIC-2026-17");
    assert.ok(su.domarcEscluso && !Number.isNaN(Date.parse(su.domarcEscluso.il)));
    assert.equal(leggiArchivio(dir).domarcEscluso?.richiesta, "RIC-2026-17");
  });

  it("sopravvive a una riscrittura di archivio.json (slot TPM)", async () => {
    const dir = cartella();
    const { chiave } = await creaArchivio(dir, { passphrase: PASS, chiaveDomarc: null, senzaDomarc: true, richiestaCliente: "RIC-2026-18", scryptLogN: LOGN });
    await scriviSlotTpm(dir, chiave, async (_c, _a, _stdin) => {
      writeFileSync(join(dir, "slot-tpm.cred"), "finto");
    });
    assert.equal(leggiArchivio(dir).slot.tpm, true);
    assert.equal(leggiArchivio(dir).domarcEscluso?.richiesta, "RIC-2026-18");
  });

  it("con lo slot Domarc non c'è domarcEscluso", async () => {
    const dir = cartella();
    const { generateX25519Identity, identityToRecipient } = await import("age-encryption");
    const dest = await identityToRecipient(await generateX25519Identity());
    await creaArchivio(dir, { passphrase: PASS, chiaveDomarc: dest, scryptLogN: LOGN });
    assert.equal(leggiArchivio(dir).domarcEscluso, undefined);
  });
});
