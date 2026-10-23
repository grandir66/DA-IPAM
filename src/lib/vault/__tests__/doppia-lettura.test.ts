/**
 * da-vault, passo 6 (hub): `credential_ref` accanto alle colonne cifrate, letto dal lettore unico
 * (`credentials/segreti.ts`) solo con `DA_VAULT_OPENBAO=1`.
 *
 * - con il riferimento: i segreti vengono da OpenBao (cache del backend), mai dalle colonne; OpenBao oltre la cache
 *   o segreto assente = rifiuto dichiarato, nessun ripiego sulla colonna;
 * - senza riferimento (doppia lettura, per una versione): si legge la colonna e si scrive un avviso, una volta per voce;
 * - interruttore spento: il riferimento non conta, tutto come oggi;
 * - una modifica dei segreti dalla pagina toglie il riferimento (la voce torna alla colonna con il valore nuovo e la
 *   migrazione la riporta in OpenBao).
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
import { OpenBaoStore } from "../openbao";
import { statoVaultProcesso } from "../stato";
import { creaOpenBaoFinto, type OpenBaoFinto } from "./support/openbao-finto";

const T = "VAULTDOPPIA";
const MIN = 60_000;
let adesso = Date.parse("2026-10-23T12:00:00Z");
let finto: OpenBaoFinto;
let store: OpenBaoStore;
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

beforeEach(async () => {
  adesso = Date.parse("2026-10-23T12:00:00Z");
  finto = creaOpenBaoFinto({ ora: () => adesso });
  const t = T.toLowerCase();
  finto.kv.set(`clienti/${t}/da-ipam/firewall-${id.ssh}`, { username: "bao-admin", password: "pw-da-openbao" });
  finto.kv.set(`clienti/${t}/da-ipam/switch-v2c-${id.snmp}`, { password: "comm-da-openbao" });
  finto.kv.set(`clienti/${t}/da-ipam/switch-v3-${id.v3}`, { username: "bao-mon", auth_key: "auth-openbao", priv_key: "priv-openbao" });
  store = new OpenBaoStore({
    url: finto.url,
    roleId: finto.roleId,
    secretId: () => finto.secretId,
    cartelle: ["app/da-ipam"],
    percorsiExtra: () => [...finto.kv.keys()],
    fetch: finto.fetch,
    ora: () => adesso,
    durataCacheMs: 30 * MIN,
  });
  await store.aggiorna();
  statoVaultProcesso().openbao = store;
  statoVaultProcesso().doppiaLetturaSegnalata.clear();
  process.env.DA_VAULT_OPENBAO = "1";
});

after(() => {
  delete process.env.DA_VAULT_OPENBAO;
  statoVaultProcesso().openbao = null;
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
    delete process.env.DA_VAULT_OPENBAO;
    const righe = avvisi(() => {
      assert.deepEqual(coppiaSshDb(db(), id.ssh), { username: "col-admin", password: "pw-dalla-colonna", port: 22 });
      assert.equal(communityDb(db(), id.snmp), "comm-dalla-colonna");
      leggiSegretoDb(db(), id.senzaRef, "ssh");
    });
    assert.deepEqual(righe, []);
  });
});

describe("interruttore acceso, con il riferimento", () => {
  it("i segreti vengono da OpenBao, non dalle colonne", () => {
    assert.deepEqual(coppiaSshDb(db(), id.ssh), { username: "bao-admin", password: "pw-da-openbao", port: 22 });
    assert.equal(communityDb(db(), id.snmp), "comm-da-openbao");
    const v3 = v3ApparatoDb(db(), { protocol: "snmp_v3", credential_id: id.v3 });
    assert.equal(v3?.username, "bao-mon");
    assert.equal(v3?.authKey, "auth-openbao");
    assert.equal(v3?.privKey, "priv-openbao");
    const c = campiVoceDb(db(), id.ssh);
    assert.deepEqual(c.ok && c.campi, { username: "bao-admin", password: "pw-da-openbao" });
  });

  it("OpenBao oltre la cache: rifiuto dichiarato, mai la colonna", () => {
    finto.giu = true;
    adesso += 31 * MIN;
    const e = leggiSegretoDb(db(), id.ssh, "ssh");
    assert.equal(e.ok, false);
    assert.match(e.ok ? "" : e.motivo, /«Firewall».*OpenBao non risponde/);
    assert.equal(coppiaSshDb(db(), id.ssh), null);
    assert.ok(!JSON.stringify(e).includes("pw-dalla-colonna"));
  });

  it("il segreto non c'è in OpenBao: rifiuto col percorso, mai la colonna", () => {
    finto.kv.delete(`clienti/${T.toLowerCase()}/da-ipam/switch-v2c-${id.snmp}`);
    return store.aggiorna().then(() => {
      const e = leggiSegretoDb(db(), id.snmp, "snmp");
      assert.equal(e.ok, false);
      assert.match(e.ok ? "" : e.motivo, /non è in OpenBao/);
      assert.equal(communityDb(db(), id.snmp), null);
    });
  });

  it("OpenBao acceso ma non configurato: rifiuto che lo dice", () => {
    statoVaultProcesso().openbao = null;
    const e = leggiSegretoDb(db(), id.ssh, "ssh");
    assert.match(e.ok ? "" : e.motivo, /OpenBao.*non configurato/);
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
    assert.match(righe[0], new RegExp(`#${id.senzaRef}.*senza riferimento OpenBao`));
    assert.ok(!righe[0].includes("pw-solo-colonna"));
  });
});

describe("modifica dalla pagina", () => {
  it("con l'interruttore acceso, un segreto cambiato toglie il riferimento; senza segreti nuovi resta", () => {
    assert.equal(aggiornamentiCredenziale({ password: "nuova" }, {}).credential_ref, null);
    assert.equal("credential_ref" in aggiornamentiCredenziale({ name: "solo il nome" }, {}), false);
    delete process.env.DA_VAULT_OPENBAO;
    assert.equal("credential_ref" in aggiornamentiCredenziale({ password: "nuova" }, {}), false);
  });
});
