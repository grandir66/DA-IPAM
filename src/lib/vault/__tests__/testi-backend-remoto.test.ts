/**
 * Vault semplice, passo 6, correzioni della revisione: con DA-Link acceso i testi di errore del lettore unico dei
 * segreti nominano il backend vero (o un nome neutro). OpenBao è stato tolto il 02/11/2026: `DA_VAULT_OPENBAO=1`
 * rimasto nel file dà il motivo del rifiuto, che dice di usare `DA_VAULT_DALINK=1`.
 *
 * Run: node --import tsx --test src/lib/vault/__tests__/testi-backend-remoto.test.ts
 */
import "@/lib/__tests__/support/data-dir-isolata";
import { describe, it, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { encrypt } from "@/lib/crypto";
import { closeTenantDb, deleteTenantDatabase, getTenantDb, withTenant } from "@/lib/db-tenant";
import { closeHubDb } from "@/lib/db-hub";
import { creaCredenzialeDb } from "@/lib/credentials/archivio";
import { leggiSegretoDb } from "@/lib/credentials/segreti";
import { statoVaultProcesso } from "../stato";

const T = "VAULTTESTI";
let idConRef: number;

before(() => {
  withTenant(T, () => {
    const d = getTenantDb(T);
    idConRef = creaCredenzialeDb(d, { name: "Firewall", credential_type: "ssh", encrypted_username: encrypt("u"), encrypted_password: encrypt("p") }).id;
    d.prepare("UPDATE credentials SET credential_ref = ? WHERE id = ?").run("clienti/vaultitesti/da-ipam/firewall", idConRef);
  });
});
afterEach(() => {
  delete process.env.DA_VAULT_OPENBAO;
  delete process.env.DA_VAULT_DALINK;
  statoVaultProcesso().remoto = null;
  statoVaultProcesso().remotoNonAvviato = null;
});
after(() => {
  try { closeTenantDb(T); deleteTenantDatabase(T); } catch { /* già tolto */ }
  closeHubDb();
});

const leggi = () => withTenant(T, () => leggiSegretoDb(getTenantDb(T), idConRef, "ssh"));
const finto = (backend: "dalink", leggiSync: () => never) => ({
  backend,
  leggiSync,
  get: async () => { throw new Error("non usato"); },
  delete: async () => undefined,
  stato: () => ({ pronto: true as const, aggiornatoAlle: null }),
});

describe("lettore unico dei segreti: il rifiuto nomina il backend vero", () => {
  it("DA-Link acceso senza store: il motivo dice DA-Link e il motivo dell'avvio, mai OpenBao", () => {
    process.env.DA_VAULT_DALINK = "1";
    const r = leggi();
    assert.ok(!r.ok && /DA-Link/.test(r.motivo) && !/OpenBao/.test(r.motivo), !r.ok ? r.motivo : "");
    statoVaultProcesso().remotoNonAvviato = "DA_VAULT_DALINK=1 ma manca DALINK_VAULT_URL";
    const r2 = leggi();
    assert.ok(!r2.ok && /DALINK_VAULT_URL/.test(r2.motivo) && !/OpenBao/.test(r2.motivo), !r2.ok ? r2.motivo : "");
  });

  it("DA_VAULT_OPENBAO=1 rimasto nel file, da solo o con DA-Link: il motivo dice che OpenBao è stato tolto", () => {
    process.env.DA_VAULT_OPENBAO = "1";
    const r = leggi();
    assert.ok(!r.ok && /OpenBao è stato tolto il 02\/11, usa DA_VAULT_DALINK=1/.test(r.motivo), !r.ok ? r.motivo : "");
    process.env.DA_VAULT_DALINK = "1";
    const r2 = leggi();
    assert.ok(!r2.ok && /OpenBao è stato tolto/.test(r2.motivo), !r2.ok ? r2.motivo : "");
  });

  it("lo store che lancia un errore anonimo: il testo porta il nome del suo backend", () => {
    process.env.DA_VAULT_DALINK = "1";
    statoVaultProcesso().remoto = finto("dalink", () => { throw "giù"; });
    const r = leggi();
    assert.ok(!r.ok && /DA-Link non ha risposto/.test(r.motivo) && !/OpenBao/.test(r.motivo), !r.ok ? r.motivo : "");
  });
});
