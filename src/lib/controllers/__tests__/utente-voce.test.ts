/**
 * L'utente di un controller per gli script di misura (`scripts/misura-topologia.ts`,
 * `scripts/misura-mac-porta.ts`), tappa 2g credenziali (T27).
 *
 * Perché: gli script leggevano `network_controllers.username`, che la pulizia
 * della 2g svuota (`''`). Dalla 2f l'utente sta nella voce dell'archivio,
 * cifrato. La password agli script arriva da stdin (la copia può avere
 * un'altra ENCRYPTION_KEY), quindi qui si decifra solo l'utente. Una riga
 * senza voce, o una voce che non si decifra, è un errore detto in italiano,
 * mai un utente vuoto mandato al controller.
 *
 * Run: DA_INVENT_DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ipam.XXXXXX")" node --import tsx --test src/lib/controllers/__tests__/utente-voce.test.ts
 */
import { TEST_DATA_DIR } from "@/lib/__tests__/support/data-dir-isolata";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { encrypt } from "@/lib/crypto";
import { TENANT_SCHEMA_SQL } from "@/lib/db-tenant-schema";
import { utenteVoceControllerDb } from "@/lib/controllers/credenziale";

void TEST_DATA_DIR;

function db(): Database.Database {
  const d = new Database(":memory:");
  d.exec(TENANT_SCHEMA_SQL);
  return d;
}

describe("utenteVoceControllerDb", () => {
  it("l'utente della voce, decifrato", () => {
    const d = db();
    const id = Number(
      d.prepare("INSERT INTO credentials (name, credential_type, auth_method, encrypted_username, encrypted_password) VALUES ('UniFi · Sede', 'unifi', 'utente', ?, ?)")
        .run(encrypt("lettore"), encrypt("pw")).lastInsertRowid,
    );
    assert.deepEqual(utenteVoceControllerDb(d, id), { ok: true, username: "lettore" });
  });

  it("senza voce → errore, non un utente vuoto", () => {
    const r = utenteVoceControllerDb(db(), null);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.motivo, /voce/);
  });

  it("voce che non c'è, senza utente o che non si decifra → errore", () => {
    const d = db();
    const senza = Number(d.prepare("INSERT INTO credentials (name, credential_type, encrypted_password) VALUES ('UniFi · chiave', 'unifi', ?)").run(encrypt("k")).lastInsertRowid);
    const rotta = Number(d.prepare("INSERT INTO credentials (name, credential_type, encrypted_username, encrypted_password) VALUES ('UniFi · rotta', 'unifi', 'aa:bb:cc', ?)").run(encrypt("k")).lastInsertRowid);
    for (const id of [999, senza, rotta]) {
      const r = utenteVoceControllerDb(d, id);
      assert.equal(r.ok, false, `voce #${id}`);
    }
  });
});
