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

import { test, describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb } from "@/lib/db-hub";
import { getWazuhConfig, setWazuhConfig, normalizeSpkiPin } from "../wazuh-config";

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

// Bug di campo (appliance 192.168.4.8 vs Wazuh 192.168.4.19): lo script di
// installazione dell'endpoint di stato repliche stampa il pin come solo
// base64, senza il prefisso "sha256/" che invece produce/confronta
// probePinTls. Le due stringhe sono visivamente quasi identiche ma non
// facevano mai match: la funzionalità non partiva alla prima configurazione.
describe("normalizeSpkiPin — entrambe le forme portano alla stessa forma canonica", () => {
  const BASE64 = "BTpdXO7bUSEX9XavrKiRsiqrdDkQyVIpfEzd9dMPIFc=";
  const CANONICO = `sha256/${BASE64}`;

  it("forma con prefisso sha256/ resta invariata", () => {
    assert.equal(normalizeSpkiPin(CANONICO), CANONICO);
  });

  it("solo base64 (senza prefisso, come stampato dallo script di installazione) viene canonicalizzato", () => {
    assert.equal(normalizeSpkiPin(BASE64), CANONICO);
  });

  it("spazi/newline attorno a entrambe le forme vengono tollerati", () => {
    assert.equal(normalizeSpkiPin(`  ${CANONICO}  \n`), CANONICO);
    assert.equal(normalizeSpkiPin(`  ${BASE64}  \n`), CANONICO);
  });

  it("stringa vuota resta vuota (nessun pin configurato non diventa 'sha256/')", () => {
    assert.equal(normalizeSpkiPin(""), "");
    assert.equal(normalizeSpkiPin("   "), "");
  });

  it("un pin davvero diverso resta un mismatch dopo la normalizzazione", () => {
    const altro = normalizeSpkiPin("altroPinCompletamenteDiverso=");
    assert.notEqual(altro, CANONICO);
  });
});

test("setWazuhConfig salva il pin in forma canonica anche se fornito senza prefisso sha256/", () => {
  const base64 = "BTpdXO7bUSEX9XavrKiRsiqrdDkQyVIpfEzd9dMPIFc=";
  setWazuhConfig({ immutableStoreCertPin: base64 });
  assert.equal(getWazuhConfig().immutableStoreCertPin, `sha256/${base64}`);
});

test("setWazuhConfig produce lo stesso valore canonico con o senza prefisso/spazi", () => {
  const base64 = "BTpdXO7bUSEX9XavrKiRsiqrdDkQyVIpfEzd9dMPIFc=";
  setWazuhConfig({ immutableStoreCertPin: `  ${base64}  ` });
  const conSoloBase64 = getWazuhConfig().immutableStoreCertPin;
  setWazuhConfig({ immutableStoreCertPin: `  sha256/${base64}  \n` });
  const conPrefisso = getWazuhConfig().immutableStoreCertPin;
  assert.equal(conSoloBase64, conPrefisso);
});
