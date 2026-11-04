/**
 * Prova a mano di un legame WMI (piano accesso Windows, Task 8).
 *
 * Fino al Task 8 un legame `wmi` creato a mano rispondeva «Test non disponibile» e non si poteva provare: la tendina WMI era
 * stata tolta per questo. Ora si prova con la stessa prova leggera della scansione (`runWmiIdentita`: una query su
 * Win32_ComputerSystem, solo lettura, tetto di 20 secondi).
 *
 * Il rifiuto del bridge può citare l'utente o la password: nel messaggio che torna alla pagina e finisce nel registro non ci
 * devono essere.
 *
 * Run: node --import tsx --test src/lib/devices/__tests__/prova-binding-wmi.test.ts
 */
import { TEST_DATA_DIR } from "@/lib/__tests__/support/data-dir-isolata";
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { encrypt } from "@/lib/crypto";
import { closeHubDb } from "@/lib/db-hub";
import { createCredential, deleteTenantDatabase, withTenant } from "@/lib/db-tenant";
import { WmiError, type WmiIdentita } from "../wmi-run";
import { provaBinding } from "../prova-binding";

void TEST_DATA_DIR;
const T = "TESTPROVABINDWMI";
const UTENTE = "CLIENTE\\scansioni";
const PASSWORD = "S3greta!mai-nel-messaggio";

after(() => {
  deleteTenantDatabase(T);
  closeHubDb();
});

interface Chiamata { host: string; username: string; password: string }

function prova(esito: WmiIdentita | Error): { chiamate: Chiamata[]; wmiIdentita: (h: string, u: string, p: string) => Promise<WmiIdentita> } {
  const chiamate: Chiamata[] = [];
  return {
    chiamate,
    wmiIdentita: async (host, username, password) => {
      chiamate.push({ host, username, password });
      if (esito instanceof Error) throw esito;
      return esito;
    },
  };
}

const INLINE = { credential_id: null, inline_username: UTENTE, inline_encrypted_password: encrypt(PASSWORD) };

describe("provaBinding: legame WMI", () => {
  it("riuscita: success, non «test non disponibile», e la prova riceve host, utente e password del legame", async () => {
    const p = prova({ hostname: "PC-CONTAB", dominio: "cliente.local" });
    const r = await provaBinding("10.0.0.5", { ...INLINE, protocol_type: "wmi", port: 135 }, "1", { wmiIdentita: p.wmiIdentita });
    assert.equal(r.success, true);
    assert.equal(r.nonDisponibile, undefined);
    assert.match(r.message, /WMI/);
    assert.deepEqual(p.chiamate, [{ host: "10.0.0.5", username: UTENTE, password: PASSWORD }]);
  });

  it("voce d'archivio: utente e password si leggono dalla voce Windows", async () => {
    const id = withTenant(T, () =>
      createCredential({ name: "Scansioni", credential_type: "windows", encrypted_username: encrypt(UTENTE), encrypted_password: encrypt(PASSWORD) }).id,
    );
    const p = prova({ hostname: "SRV01", dominio: null });
    const r = await withTenant(T, () =>
      provaBinding("10.0.0.6", { credential_id: id, inline_username: null, inline_encrypted_password: null, protocol_type: "wmi", port: 135 }, "1", { wmiIdentita: p.wmiIdentita }),
    );
    assert.equal(r.success, true);
    assert.deepEqual(p.chiamate, [{ host: "10.0.0.6", username: UTENTE, password: PASSWORD }]);
  });

  it("rifiutata: success false, e né l'utente né la password restano nel messaggio, nemmeno nella forma JSON", async () => {
    const err = new WmiError({
      code: "AUTH_REJECTED",
      message: `rpc_s_access_denied per ${UTENTE} con password ${PASSWORD} ({"u":"CLIENTE\\\\scansioni"})`,
    });
    const r = await provaBinding("10.0.0.5", { ...INLINE, protocol_type: "wmi", port: 135 }, "1", { wmiIdentita: prova(err).wmiIdentita });
    assert.equal(r.success, false);
    assert.ok(!r.message.includes(PASSWORD), r.message);
    assert.ok(!r.message.toLowerCase().includes("scansioni"), r.message);
    assert.match(r.message, /^WMI/);
  });

  it("porta 135 chiusa: success false col perché, non un'eccezione", async () => {
    const err = new WmiError({ code: "TCP_CLOSED", message: "Porta RPC 135 non disponibile (refused).", primaDelBridge: true });
    const r = await provaBinding("10.0.0.5", { ...INLINE, protocol_type: "wmi", port: 135 }, "1", { wmiIdentita: prova(err).wmiIdentita });
    assert.equal(r.success, false);
    assert.match(r.message, /135/);
  });

  it("senza utente: «Username mancante», nessuna prova parte", async () => {
    const p = prova({ hostname: "x", dominio: null });
    const r = await provaBinding("10.0.0.5", { credential_id: null, inline_username: null, inline_encrypted_password: null, protocol_type: "wmi", port: 135 }, "1", { wmiIdentita: p.wmiIdentita });
    assert.equal(r.success, false);
    assert.equal(r.message, "Username mancante");
    assert.deepEqual(p.chiamate, []);
  });

  it("senza password: «Password mancante», nessuna prova parte (un logon con password vuota è un logon errato)", async () => {
    const p = prova({ hostname: "x", dominio: null });
    const r = await provaBinding("10.0.0.5", { credential_id: null, inline_username: UTENTE, inline_encrypted_password: null, protocol_type: "wmi", port: 135 }, "1", { wmiIdentita: p.wmiIdentita });
    assert.equal(r.success, false);
    assert.equal(r.message, "Password mancante");
    assert.deepEqual(p.chiamate, []);
  });
});

describe("legame WMI: una macchina muta non è una password rifiutata", () => {
  it("porta 135 chiusa, firewall che scarta, bridge che non risponde: errore di trasporto; un rifiuto no", async () => {
    const { eErroreDiTrasporto } = await import("@/lib/credentials/trova");
    for (const code of ["TCP_CLOSED", "TCP_TIMEOUT", "BRIDGE_TIMEOUT"] as const) {
      const r = await provaBinding("10.0.0.5", { ...INLINE, protocol_type: "wmi", port: 135 }, "1", {
        wmiIdentita: prova(new WmiError({ code, message: "nessuna risposta", primaDelBridge: code !== "BRIDGE_TIMEOUT" })).wmiIdentita,
      });
      assert.equal(eErroreDiTrasporto("wmi", r.message, r.kind), true, code);
    }
    const rifiuto = await provaBinding("10.0.0.5", { ...INLINE, protocol_type: "wmi", port: 135 }, "1", {
      wmiIdentita: prova(new WmiError({ code: "AUTH_REJECTED", message: "accesso negato" })).wmiIdentita,
    });
    assert.equal(eErroreDiTrasporto("wmi", rifiuto.message, rifiuto.kind), false);
  });
});
