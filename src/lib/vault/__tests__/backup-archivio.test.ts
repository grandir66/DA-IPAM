/**
 * da-vault, passo 10 (prova del piano: «backup coerente con gli slot»): col vault acceso il backup notturno copia
 * anche l'archivio (archivio.json, slot, segreti.json, recuperi.jsonl), così un ripristino dei database ricifrati
 * ha gli slot che li aprono. Gli slot sono già cifrati: copiarli non espone la chiave.
 *
 * Run: node --import tsx --test src/lib/vault/__tests__/backup-archivio.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateX25519Identity, identityToRecipient } from "age-encryption";
import { creaArchivio } from "../archivio";
import { copiaArchivioVault } from "../backup";

describe("copiaArchivioVault", () => {
  it("copia i file dell'archivio, 0600, con lo sha256, senza i temporanei", async () => {
    const dir = mkdtempSync(join(tmpdir(), "da-vault-bk-"));
    await creaArchivio(dir, { passphrase: "passphrase-backup-lunga", chiaveDomarc: await identityToRecipient(await generateX25519Identity()), scryptLogN: 10 });
    writeFileSync(join(dir, "segreti.json"), '{"formato":1,"voci":{}}\n');
    writeFileSync(join(dir, ".archivio.json.123.tmp"), "temporaneo");
    const out = mkdtempSync(join(tmpdir(), "da-vault-bk-out-"));
    const voci = copiaArchivioVault(dir, out);
    assert.deepEqual(readdirSync(join(out, "vault")).sort(), ["archivio.json", "segreti.json", "slot-cliente.age", "slot-domarc.age"]);
    for (const v of voci) {
      assert.equal(v.ok, true);
      const copia = readFileSync(v.output);
      assert.deepEqual(copia, readFileSync(v.source));
      assert.equal(v.sha256, createHash("sha256").update(copia).digest("hex"));
      assert.equal(statSync(v.output).mode & 0o777, 0o600);
    }
  });

  it("senza archivio non copia niente", () => {
    const out = mkdtempSync(join(tmpdir(), "da-vault-bk-out-"));
    assert.deepEqual(copiaArchivioVault(mkdtempSync(join(tmpdir(), "vuota-")), out), []);
    assert.equal(existsSync(join(out, "vault")), false);
  });
});
