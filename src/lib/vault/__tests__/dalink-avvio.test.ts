/**
 * Vault semplice, passo 6 (piano DA-Link `2026-10-29-vault-passo6-app.md`, S1): configurazione e selezione del
 * backend `dalink` all'avvio.
 *
 * - Spento di serie: `DA_VAULT_DALINK` assente o `0` = l'avvio di oggi.
 * - `DA_VAULT_OPENBAO=1` rimasto nel file (OpenBao tolto il 02/11), da solo o con `DA_VAULT_DALINK=1`: configurazione
 *   rifiutata col motivo «usa DA_VAULT_DALINK=1», nessun backend, errore nel log (fail-closed: i lettori vedono un
 *   vault acceso senza store e rifiutano).
 * - `DALINK_VAULT_URL`, `DALINK_VAULT_GETTONE`, `DALINK_VAULT_IMPRONTA`: uno che manca o è malformato rifiuta la
 *   configurazione col nome della variabile, mai col valore.
 * - Con DA-Link acceso i chiamanti di oggi (`segreti.ts`, «mostra password», cancellazione) vedono lo store senza
 *   cambiare: `vaultRemotoAcceso()` vale «backend remoto del vault acceso».
 *
 * Run: node --import tsx --test src/lib/vault/__tests__/dalink-avvio.test.ts
 */
import "@/lib/__tests__/support/data-dir-isolata";
import { describe, it, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { avviaVault, configurazioneDalink, sceltaBackendRemoto } from "../avvio";
import { DaLinkStore } from "../dalink";
import { statoVaultProcesso, vaultDalinkAcceso, vaultRemotoAcceso } from "../stato";
import { creaDaLinkFinto } from "./support/dalink-finto";

const GETTONE = "dlv_" + "AbC-_9".repeat(7) + "x";
const IMPRONTA_B64 = Buffer.alloc(32, 7).toString("base64");
const BUONA = {
  DALINK_VAULT_URL: "https://192.168.4.44:8443",
  DALINK_VAULT_GETTONE: GETTONE,
  DALINK_VAULT_IMPRONTA: `sha256//${IMPRONTA_B64}`,
};

/** Le righe di console.error/warn/info durante `fn`. */
function console_(fn: () => void): string {
  const righe: string[] = [];
  const orig = { info: console.info, warn: console.warn, error: console.error, log: console.log };
  for (const k of Object.keys(orig) as Array<keyof typeof orig>) console[k] = (...a: unknown[]) => void righe.push(a.map(String).join(" "));
  try {
    fn();
  } finally {
    Object.assign(console, orig);
  }
  return righe.join("\n");
}

const ambientePrima = { ...process.env };
afterEach(() => {
  statoVaultProcesso().remoto = null;
});
after(() => {
  for (const k of ["DA_VAULT_DALINK", "DA_VAULT_OPENBAO"]) {
    if (ambientePrima[k] === undefined) delete process.env[k];
    else process.env[k] = ambientePrima[k];
  }
});

describe("configurazioneDalink", () => {
  it("le tre variabili giuste: url, gettone e impronta nella forma di DA-IPAM (sha256/…)", () => {
    const c = configurazioneDalink(BUONA);
    assert.ok(c.ok);
    assert.equal(String(c.config.url), "https://192.168.4.44:8443/");
    assert.equal(c.config.gettone, GETTONE);
    assert.equal(c.config.impronta, `sha256/${IMPRONTA_B64}`);
  });

  it("una che manca: rifiutata col nome della variabile", () => {
    for (const nome of Object.keys(BUONA) as Array<keyof typeof BUONA>) {
      const c = configurazioneDalink({ ...BUONA, [nome]: undefined });
      assert.ok(!c.ok, nome);
      assert.ok(!c.ok && c.motivo.includes(nome), !c.ok ? c.motivo : "");
      const vuota = configurazioneDalink({ ...BUONA, [nome]: "   " });
      assert.ok(!vuota.ok && vuota.motivo.includes(nome), nome);
    }
    const nessuna = configurazioneDalink({});
    assert.ok(!nessuna.ok && Object.keys(BUONA).every((n) => nessuna.motivo.includes(n)), "con tutte assenti le nomina tutte");
  });

  it("malformate: rifiutate col nome, mai col valore", () => {
    const casi: Array<[keyof typeof BUONA, string]> = [
      ["DALINK_VAULT_URL", "http://192.168.4.44:8443"],
      ["DALINK_VAULT_URL", "non-un-indirizzo-zz9"],
      ["DALINK_VAULT_URL", "https://utente:segreto-zz9@192.168.4.44:8443"],
      ["DALINK_VAULT_GETTONE", "dlk_" + "a".repeat(43)],
      ["DALINK_VAULT_GETTONE", "dlv_corto"],
      ["DALINK_VAULT_GETTONE", `dlv_${"a".repeat(40)} zz9`],
      ["DALINK_VAULT_IMPRONTA", IMPRONTA_B64],
      ["DALINK_VAULT_IMPRONTA", "sha256//zz9"],
      ["DALINK_VAULT_IMPRONTA", `sha1//${IMPRONTA_B64}`],
    ];
    for (const [nome, valore] of casi) {
      const c = configurazioneDalink({ ...BUONA, [nome]: valore });
      assert.ok(!c.ok, `${nome}=${valore} accettata`);
      assert.ok(!c.ok && c.motivo.includes(nome), !c.ok ? c.motivo : "");
      assert.ok(!c.ok && !c.motivo.includes(valore) && !c.motivo.includes("zz9") && !c.motivo.includes(GETTONE), !c.ok ? c.motivo : "");
    }
  });
});

describe("sceltaBackendRemoto: spento di serie, DA_VAULT_OPENBAO=1 rifiutato", () => {
  it("nessun interruttore, o DA_VAULT_DALINK=0: nessun backend remoto", () => {
    assert.deepEqual(sceltaBackendRemoto({}), { backend: "nessuno" });
    assert.deepEqual(sceltaBackendRemoto({ DA_VAULT_DALINK: "0" }), { backend: "nessuno" });
    assert.deepEqual(sceltaBackendRemoto({ DA_VAULT_DALINK: "", DA_VAULT_OPENBAO: "0" }), { backend: "nessuno" });
  });

  it("DA_VAULT_DALINK=1: DA-Link", () => {
    assert.deepEqual(sceltaBackendRemoto({ DA_VAULT_DALINK: "1" }), { backend: "dalink" });
  });

  it("DA_VAULT_OPENBAO=1, da solo o con DA-Link: rifiutato, il motivo dice che OpenBao è stato tolto", () => {
    for (const env of [{ DA_VAULT_OPENBAO: "1" }, { DA_VAULT_OPENBAO: "1", DA_VAULT_DALINK: "0" }, { DA_VAULT_OPENBAO: "1", DA_VAULT_DALINK: "1" }]) {
      assert.deepEqual(sceltaBackendRemoto(env), { backend: "rifiutato", motivo: "OpenBao è stato tolto il 02/11, usa DA_VAULT_DALINK=1" });
    }
  });
});

describe("avviaVault", () => {
  it("DA_VAULT_OPENBAO=1 rimasto con DA-Link: nessuno store, errore nel log; i lettori vedono il vault acceso senza store (rifiutano)", () => {
    process.env.DA_VAULT_OPENBAO = "1";
    process.env.DA_VAULT_DALINK = "1";
    const log = console_(() => avviaVault({ ...BUONA, DA_VAULT_OPENBAO: "1", DA_VAULT_DALINK: "1" }));
    assert.equal(statoVaultProcesso().remoto, null);
    assert.match(log, /OpenBao è stato tolto il 02\/11, usa DA_VAULT_DALINK=1/);
    assert.equal(vaultRemotoAcceso(), true, "fail-closed: un vault remoto risulta acceso, e senza store i lettori rifiutano");
    assert.ok(!log.includes(GETTONE));
  });

  it("DA_VAULT_DALINK=1 con la configurazione che manca: nessuno store, errore col nome della variabile", () => {
    const log = console_(() => avviaVault({ ...BUONA, DA_VAULT_DALINK: "1", DALINK_VAULT_IMPRONTA: undefined }));
    assert.equal(statoVaultProcesso().remoto, null);
    assert.match(log, /DALINK_VAULT_IMPRONTA/);
    assert.ok(!log.includes(GETTONE));
  });

  it("DA_VAULT_DALINK=1 con la configurazione giusta: lo store è DaLinkStore, fa il primo giro, i chiamanti lo vedono", async () => {
    const finto = await creaDaLinkFinto();
    finto.scriviDaFuori("clienti/70001/da-ipam/router-1", { password: "p-avvio-1" });
    try {
      process.env.DA_VAULT_OPENBAO = "";
      process.env.DA_VAULT_DALINK = "1";
      const log = console_(() =>
        avviaVault({ DA_VAULT_DALINK: "1", DALINK_VAULT_URL: finto.url, DALINK_VAULT_GETTONE: finto.gettone, DALINK_VAULT_IMPRONTA: finto.impronta.replace("sha256/", "sha256//") }),
      );
      const store = statoVaultProcesso().remoto;
      assert.ok(store instanceof DaLinkStore);
      assert.equal(store.backend, "dalink");
      assert.match(log, /DA-Link/);
      assert.ok(!log.includes(finto.gettone));
      await new Promise((r) => setTimeout(r, 300));
      assert.deepEqual(store.leggiSync("clienti/70001/da-ipam/router-1"), { password: "p-avvio-1" });
      assert.equal(vaultRemotoAcceso(), true);
      assert.equal(vaultDalinkAcceso(), true);
    } finally {
      await finto.chiudi();
    }
  });

  it("spento di serie: nessun interruttore, nessuno store e nessuna riga di log del vault remoto", () => {
    process.env.DA_VAULT_OPENBAO = "";
    process.env.DA_VAULT_DALINK = "";
    const log = console_(() => avviaVault({ ...BUONA }));
    assert.equal(statoVaultProcesso().remoto, null);
    assert.equal(log, "");
    assert.equal(vaultRemotoAcceso(), false);
    assert.equal(vaultDalinkAcceso(), false);
  });
});
