// Hub DB isolato per questo file: `getSetting`/`setSetting` scrivono sul vero
// hub.db se non si sovrascrive il path (vedi db-hub.ts:15). Va impostato PRIMA
// di importare qualunque modulo che tocchi db-hub, altrimenti la costante
// HUB_DB_PATH del modulo si blocca già sul path di default.
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

process.env.ENCRYPTION_KEY ||= "test-encryption-key-wazuh-cfg01";
process.env.DA_IPAM_HUB_DB_PATH = path.join(
  os.tmpdir(),
  `da-ipam-test-hub-wazuh-config-${process.pid}.db`,
);

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb } from "@/lib/db-hub";
import { getWazuhConfig, setWazuhConfig } from "../wazuh-config";

after(() => {
  closeHubDb();
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      fs.rmSync(process.env.DA_IPAM_HUB_DB_PATH + suffix, { force: true });
    } catch {
      /* ignore */
    }
  }
});

// Fix review "Minor": a differenza di url/username/indexerUrl, token e pin
// non passavano da .trim(). Un pin copiato da un terminale con un newline in
// coda fa fallire il confronto esatto in probePinTls con due impronte
// visivamente identiche; un newline nel token manda in crash Node
// (ERR_INVALID_CHAR) mascherato da "errore di rete".
test("il token dell'endpoint di stato repliche viene salvato senza newline/spazi", () => {
  setWazuhConfig({ immutableStoreToken: "abcdef123456\n" });
  assert.equal(getWazuhConfig().immutableStoreToken, "abcdef123456");
});

test("l'impronta TLS (pin) viene salvata senza newline/spazi", () => {
  setWazuhConfig({ immutableStoreCertPin: "  sha256/AAAAbbbbCCCC=  \n" });
  assert.equal(getWazuhConfig().immutableStoreCertPin, "sha256/AAAAbbbbCCCC=");
});

test("un token solo whitespace non sovrascrive quello già salvato (write-only, come password)", () => {
  setWazuhConfig({ immutableStoreToken: "primo-token" });
  setWazuhConfig({ immutableStoreToken: "   \n" });
  assert.equal(getWazuhConfig().immutableStoreToken, "primo-token");
});
