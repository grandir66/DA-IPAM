/**
 * Il limite di 3 prove in 15 minuti conta solo i logon RIFIUTATI (04/11/2026).
 *
 * Contava ogni prova, anche riuscita: la prova in massa dei «Test» di un elenco di apparati Windows si fermava alla terza.
 * Il posto si prenota prima del logon e torna libero se il logon non è un rifiuto. Un legame WinRM con la porta chiusa
 * non si marca fallito (`nonDisponibile`), come nella ricerca.
 *
 * Run: node --import tsx --test src/lib/credentials/__tests__/freno-solo-rifiuti.test.ts
 */
import { TEST_DATA_DIR } from "@/lib/__tests__/support/data-dir-isolata";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { encrypt } from "@/lib/crypto";
import { closeHubDb } from "@/lib/db-hub";
import { deleteTenantDatabase, withTenant } from "@/lib/db-tenant";
import { provaBinding, type DipendenzeProvaBinding } from "@/lib/devices/prova-binding";
import { WinrmError } from "@/lib/devices/winrm-run";
import { RicordoErrate } from "@/lib/scanner/account-windows";
import { freniDelLogon } from "../freno-logon-windows";

void TEST_DATA_DIR;
const T = "TESTFRENOSOLORIFIUTI";
const PASSWORD = "S3greta!";

const legame = (utente: string) => ({
  credential_id: null,
  inline_username: utente,
  inline_encrypted_password: encrypt(PASSWORD),
  protocol_type: "winrm",
  port: 5985,
});

function banco(esito: () => Promise<unknown>) {
  let logon = 0;
  const deps: DipendenzeProvaBinding = {
    ricordo: new RicordoErrate(),
    verificaPassword: async () => "non_so",
    winrm: async () => {
      logon += 1;
      return esito();
    },
  };
  return { deps, logon: () => logon };
}

const rifiuto = async (): Promise<never> => {
  throw new WinrmError({ code: "AUTH_REJECTED", message: "credentials were rejected" });
};

describe("il limite conta solo i logon rifiutati", () => {
  before(() => {
    withTenant(T, () => undefined);
  });
  after(() => {
    closeHubDb();
    deleteTenantDatabase(T);
  });

  it("10 prove riuscite di fila non bloccano", async () => {
    const b = banco(async () => "DA-IPAM-TEST");
    for (let i = 0; i < 10; i++) {
      const e = await withTenant(T, () => provaBinding("10.0.0.1", legame("RIUSCITE\\mario"), "1", b.deps));
      assert.equal(e.success, true, `prova ${i + 1}`);
    }
    assert.equal(b.logon(), 10);
  });

  it("5 rifiuti: al massimo 3 logon, poi il limite", async () => {
    const b = banco(rifiuto);
    const esiti = [];
    for (let i = 0; i < 5; i++) esiti.push(await withTenant(T, () => provaBinding("10.0.0.2", legame("RIFIUTI\\mario"), "1", b.deps)));
    assert.equal(b.logon(), 3);
    assert.match(esiti[3].message, /Troppe prove/);
    assert.equal(esiti[3].nonDisponibile, true);
  });

  it("porta chiusa: non consuma posti e non marca il legame fallito", async () => {
    const b = banco(async () => {
      throw new WinrmError({ code: "TCP_CLOSED", message: "porta chiusa", primaDelBridge: true });
    });
    for (let i = 0; i < 6; i++) {
      const e = await withTenant(T, () => provaBinding("10.0.0.3", legame("CHIUSA\\mario"), "1", b.deps));
      assert.equal(e.success, false);
      assert.equal(e.nonDisponibile, true, "il legame non va marcato fallito");
    }
    assert.equal(b.logon(), 6);
  });

  it("un successo non azzera i rifiuti di un'altra password dello stesso utente", async () => {
    const b = banco(rifiuto);
    for (let i = 0; i < 2; i++) await withTenant(T, () => provaBinding("10.0.0.4", legame("ALTRA\\mario"), "1", b.deps));
    const ok = banco(async () => "DA-IPAM-TEST");
    await withTenant(T, () => provaBinding("10.0.0.4", legame("ALTRA\\mario"), "1", ok.deps));
    for (let i = 0; i < 3; i++) await withTenant(T, () => provaBinding("10.0.0.4", legame("ALTRA\\mario"), "1", b.deps));
    assert.equal(b.logon(), 3, "2 rifiuti prima + 1 dopo il successo, poi il limite");
  });

  it("il parallelo: i posti si prenotano prima del logon", async () => {
    let rilascia: () => void = () => undefined;
    const attesa = new Promise<void>((r) => (rilascia = r));
    const b = banco(async () => {
      await attesa;
      return rifiuto();
    });
    const tutte = Array.from({ length: 6 }, () => withTenant(T, () => provaBinding("10.0.0.5", legame("PARALLELO\\mario"), "1", b.deps)));
    await new Promise((r) => setTimeout(r, 20));
    rilascia();
    await Promise.all(tutte);
    assert.equal(b.logon(), 3);
  });

  it("chiudi è idempotente e il freno rilascia il posto se non è un rifiuto", async () => {
    const deps = { ricordo: new RicordoErrate(), verificaPassword: async () => "non_so" as const };
    for (let i = 0; i < 8; i++) {
      const f = await withTenant(T, () => freniDelLogon("DIRETTO\\mario", PASSWORD, deps, { realm: null }));
      assert.ok(!("fermata" in f), `giro ${i + 1}`);
      if ("chiudi" in f) {
        f.chiudi(false);
        f.chiudi(true);
      }
    }
  });
});
