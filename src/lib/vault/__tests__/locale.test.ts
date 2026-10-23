/**
 * da-vault, passo 5: backend `locale` di `@domarc/vault` (appliance). I segreti propri dell'app (es. il key file
 * dell'esportazione KeePass) in `segreti.json` nella cartella dell'archivio, ognuno cifrato con la chiave dei dati
 * degli slot e legato al suo percorso. Senza la chiave (vault bloccato): errore dichiarato.
 *
 * Run: node --import tsx --test src/lib/vault/__tests__/locale.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocaleStore } from "../locale";
import { ErroreVault } from "../tipi";

const SEGRETO = "valore-segreto-di-prova-9f3a";

function nuovo(chiave: Buffer | null = randomBytes(32)) {
  const dir = mkdtempSync(join(tmpdir(), "da-vault-locale-"));
  let k = chiave;
  return { dir, store: new LocaleStore({ dir, chiave: () => k }), chiudi: () => { k = null; }, apri: (c: Buffer) => { k = c; } };
}

async function codiceDi(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    assert.ok(e instanceof ErroreVault, String(e));
    return e.codice;
  }
  return "nessun errore";
}

describe("LocaleStore", () => {
  it("put, get, list, delete", async () => {
    const { store } = nuovo();
    assert.equal(store.backend, "locale");
    await store.put("app/da-ipam/keepass/keyfile", { keyfile: SEGRETO });
    await store.put("app/da-ipam/altro", { a: "1" });
    assert.deepEqual(await store.get("app/da-ipam/keepass/keyfile"), { keyfile: SEGRETO });
    assert.deepEqual(await store.list("app/da-ipam"), ["app/da-ipam/altro", "app/da-ipam/keepass/keyfile"]);
    assert.deepEqual(await store.list("app/da-ipam/keepass"), ["app/da-ipam/keepass/keyfile"]);
    await store.delete("app/da-ipam/altro");
    assert.equal(await codiceDi(store.get("app/da-ipam/altro")), "non_trovato");
  });

  it("su disco il valore non è in chiaro", async () => {
    const { dir, store } = nuovo();
    await store.put("app/da-ipam/keepass/keyfile", { keyfile: SEGRETO });
    const grezzo = readFileSync(join(dir, "segreti.json"), "utf8");
    assert.ok(!grezzo.includes(SEGRETO));
    assert.ok(!grezzo.includes(Buffer.from(SEGRETO).toString("base64")));
  });

  it("vault bloccato (nessuna chiave): bloccato, sia in lettura sia in scrittura", async () => {
    const { store, chiudi } = nuovo();
    await store.put("app/da-ipam/x", { a: "1" });
    chiudi();
    assert.equal(await codiceDi(store.get("app/da-ipam/x")), "bloccato");
    assert.equal(await codiceDi(store.put("app/da-ipam/y", { a: "1" })), "bloccato");
    assert.equal(store.stato().pronto, false);
  });

  it("con la chiave di un altro archivio la voce non si legge (errore dichiarato, non un valore vuoto)", async () => {
    const { store, apri } = nuovo();
    await store.put("app/da-ipam/x", { a: "1" });
    apri(randomBytes(32));
    assert.equal(await codiceDi(store.get("app/da-ipam/x")), "slot_estraneo");
  });

  it("una voce copiata sotto un altro percorso non si legge", async () => {
    const { dir, store } = nuovo();
    await store.put("app/da-ipam/a", { v: SEGRETO });
    const f = JSON.parse(readFileSync(join(dir, "segreti.json"), "utf8")) as { voci: Record<string, string> };
    f.voci["app/da-ipam/b"] = f.voci["app/da-ipam/a"];
    writeFileSync(join(dir, "segreti.json"), JSON.stringify(f));
    assert.equal(await codiceDi(store.get("app/da-ipam/b")), "slot_estraneo");
  });

  it("un percorso non valido è rifiutato", async () => {
    const { store } = nuovo();
    assert.equal(await codiceDi(store.put("../fuori", { a: "1" })), "percorso_non_valido");
  });
});
