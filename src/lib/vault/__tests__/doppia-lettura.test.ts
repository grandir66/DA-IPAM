/**
 * da-vault, passo 6 (hub): `credential_ref` accanto alle colonne cifrate, letto dal lettore unico
 * (`credentials/segreti.ts`) solo col vault remoto acceso (`DA_VAULT_DALINK=1`).
 *
 * - con il riferimento: i segreti vengono da DA-Link (cache del backend; qui un finto in memoria), mai dalle colonne;
 *   DA-Link oltre la cache o segreto assente = rifiuto dichiarato, nessun ripiego sulla colonna;
 * - `DA_VAULT_OPENBAO=1` rimasto nel file (OpenBao tolto il 02/11): nessuno store, rifiuto col motivo, mai la colonna;
 * - senza riferimento (doppia lettura, per una versione): si legge la colonna e si scrive un avviso, una volta per voce;
 * - interruttore spento: il riferimento non conta, tutto come oggi;
 * - una modifica dei segreti dalla pagina toglie il riferimento (la voce torna alla colonna con il valore nuovo e la
 *   migrazione la riporta in DA-Link).
 *
 * Run: node --import tsx --test src/lib/vault/__tests__/doppia-lettura.test.ts
 */
import "@/lib/__tests__/support/data-dir-isolata";
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { encrypt } from "@/lib/crypto";
import { closeTenantDb, deleteTenantDatabase, getTenantDb, withTenant } from "@/lib/db-tenant";
import { closeHubDb } from "@/lib/db-hub";
import { creaCredenzialeDb } from "@/lib/credentials/archivio";
import { aggiornamentiCredenziale } from "@/lib/credentials/aggiornamenti";
import { campiVoceDb, communityDb, coppiaSshDb, leggiSegretoDb, v3ApparatoDb } from "@/lib/credentials/segreti";
import { statoVaultProcesso } from "../stato";
import { VaultRemotoFinto } from "./support/vault-remoto-finto";

const T = "VAULTDOPPIA";
let store: VaultRemotoFinto;
const id: Record<string, number> = {};

before(() => {
  withTenant(T, () => {
    const d = getTenantDb(T);
    id.ssh = creaCredenzialeDb(d, { name: "Firewall", credential_type: "ssh", encrypted_username: encrypt("col-admin"), encrypted_password: encrypt("pw-dalla-colonna"), port: 22 }).id;
    id.snmp = creaCredenzialeDb(d, { name: "Switch v2c", credential_type: "snmp", encrypted_password: encrypt("comm-dalla-colonna") }).id;
    id.v3 = creaCredenzialeDb(d, {
      name: "Switch v3", credential_type: "snmp_v3", encrypted_username: encrypt("col-mon"), security_level: "authPriv",
      auth_protocol: "SHA", encrypted_auth_key: encrypt("auth-colonna"), priv_protocol: "AES", encrypted_priv_key: encrypt("priv-colonna"),
    }).id;
    id.senzaRef = creaCredenzialeDb(d, { name: "Router vecchio", credential_type: "ssh", encrypted_username: encrypt("root"), encrypted_password: encrypt("pw-solo-colonna") }).id;
    const ref = d.prepare("UPDATE credentials SET credential_ref = ? WHERE id = ?");
    ref.run(`clienti/${T.toLowerCase()}/da-ipam/firewall-${id.ssh}`, id.ssh);
    ref.run(`clienti/${T.toLowerCase()}/da-ipam/switch-v2c-${id.snmp}`, id.snmp);
    ref.run(`clienti/${T.toLowerCase()}/da-ipam/switch-v3-${id.v3}`, id.v3);
  });
});

beforeEach(() => {
  const t = T.toLowerCase();
  store = new VaultRemotoFinto({
    [`clienti/${t}/da-ipam/firewall-${id.ssh}`]: { username: "dl-admin", password: "pw-da-dalink" },
    [`clienti/${t}/da-ipam/switch-v2c-${id.snmp}`]: { password: "comm-da-dalink" },
    [`clienti/${t}/da-ipam/switch-v3-${id.v3}`]: { username: "dl-mon", auth_key: "auth-dalink", priv_key: "priv-dalink" },
  });
  statoVaultProcesso().remoto = store;
  statoVaultProcesso().remotoNonAvviato = null;
  statoVaultProcesso().doppiaLetturaSegnalata.clear();
  delete process.env.DA_VAULT_OPENBAO;
  process.env.DA_VAULT_DALINK = "1";
});

after(() => {
  delete process.env.DA_VAULT_DALINK;
  delete process.env.DA_VAULT_OPENBAO;
  statoVaultProcesso().remoto = null;
  try { closeTenantDb(T); deleteTenantDatabase(T); } catch { /* già tolto */ }
  closeHubDb();
});

const db = () => getTenantDb(T);

function avvisi(fn: () => void): string[] {
  const righe: string[] = [];
  const orig = console.warn;
  console.warn = (...a: unknown[]) => { righe.push(a.map(String).join(" ")); };
  try {
    fn();
  } finally {
    console.warn = orig;
  }
  return righe;
}

describe("interruttore spento", () => {
  it("il riferimento non conta: si legge la colonna, come oggi, senza avvisi", () => {
    delete process.env.DA_VAULT_DALINK;
    const righe = avvisi(() => {
      assert.deepEqual(coppiaSshDb(db(), id.ssh), { username: "col-admin", password: "pw-dalla-colonna", port: 22 });
      assert.equal(communityDb(db(), id.snmp), "comm-dalla-colonna");
      leggiSegretoDb(db(), id.senzaRef, "ssh");
    });
    assert.deepEqual(righe, []);
  });
});

describe("interruttore acceso, con il riferimento", () => {
  it("i segreti vengono da DA-Link, non dalle colonne", () => {
    assert.deepEqual(coppiaSshDb(db(), id.ssh), { username: "dl-admin", password: "pw-da-dalink", port: 22 });
    assert.equal(communityDb(db(), id.snmp), "comm-da-dalink");
    const v3 = v3ApparatoDb(db(), { protocol: "snmp_v3", credential_id: id.v3 });
    assert.equal(v3?.username, "dl-mon");
    assert.equal(v3?.authKey, "auth-dalink");
    assert.equal(v3?.privKey, "priv-dalink");
    const c = campiVoceDb(db(), id.ssh);
    assert.deepEqual(c.ok && c.campi, { username: "dl-admin", password: "pw-da-dalink" });
  });

  it("DA-Link oltre la cache: rifiuto dichiarato, mai la colonna", () => {
    store.giu = true;
    const e = leggiSegretoDb(db(), id.ssh, "ssh");
    assert.equal(e.ok, false);
    assert.match(e.ok ? "" : e.motivo, /«Firewall».*DA-Link non risponde/);
    assert.equal(coppiaSshDb(db(), id.ssh), null);
    assert.ok(!JSON.stringify(e).includes("pw-dalla-colonna"));
  });

  it("il segreto non c'è in DA-Link: rifiuto col percorso, mai la colonna", () => {
    store.voci.delete(`clienti/${T.toLowerCase()}/da-ipam/switch-v2c-${id.snmp}`);
    const e = leggiSegretoDb(db(), id.snmp, "snmp");
    assert.equal(e.ok, false);
    assert.match(e.ok ? "" : e.motivo, /non è in DA-Link/);
    assert.equal(communityDb(db(), id.snmp), null);
  });

  it("DA-Link acceso ma non avviato: rifiuto che lo dice", () => {
    statoVaultProcesso().remoto = null;
    const e = leggiSegretoDb(db(), id.ssh, "ssh");
    assert.match(e.ok ? "" : e.motivo, /DA-Link.*non avviato/);
  });

  it("DA_VAULT_OPENBAO=1 rimasto nel file: nessuno store, rifiuto col motivo, mai la colonna", () => {
    statoVaultProcesso().remoto = null;
    process.env.DA_VAULT_OPENBAO = "1";
    for (const solo of [true, false]) {
      if (solo) delete process.env.DA_VAULT_DALINK;
      else process.env.DA_VAULT_DALINK = "1";
      const e = leggiSegretoDb(db(), id.ssh, "ssh");
      assert.match(e.ok ? "" : e.motivo, /OpenBao è stato tolto il 02\/11, usa DA_VAULT_DALINK=1/);
      assert.ok(!JSON.stringify(e).includes("pw-dalla-colonna"));
    }
  });
});

describe("interruttore acceso, senza il riferimento (doppia lettura)", () => {
  it("si legge la colonna e si scrive un avviso, una volta sola per voce, senza il segreto", () => {
    const righe = avvisi(() => {
      assert.deepEqual(coppiaSshDb(db(), id.senzaRef), { username: "root", password: "pw-solo-colonna", port: null });
      coppiaSshDb(db(), id.senzaRef);
      campiVoceDb(db(), id.senzaRef);
    });
    assert.equal(righe.length, 1);
    assert.match(righe[0], new RegExp(`#${id.senzaRef}.*senza riferimento al vault remoto`));
    assert.ok(!righe[0].includes("pw-solo-colonna"));
  });
});

describe("modifica dalla pagina", () => {
  it("con l'interruttore acceso, un segreto cambiato toglie il riferimento; senza segreti nuovi resta", () => {
    assert.equal(aggiornamentiCredenziale({ password: "nuova" }, {}).credential_ref, null);
    assert.equal("credential_ref" in aggiornamentiCredenziale({ name: "solo il nome" }, {}), false);
    delete process.env.DA_VAULT_DALINK;
    assert.equal("credential_ref" in aggiornamentiCredenziale({ password: "nuova" }, {}), false);
  });
});
