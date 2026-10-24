/**
 * da-vault, svuotamento delle colonne (ADR 0035): le letture che prima guardavano la colonna cifrata di `credentials`
 * (`credentials/trova.ts`, `integrations/self-identity.ts`, `controllers/credenziale.ts`, il `for_edit` di
 * `/api/credentials/[id]`, la maschera `ha_…`, la CTE delle patch) passano dal lettore unico: con `DA_VAULT_OPENBAO=1` e il
 * riferimento i valori vengono da OpenBao anche se le colonne sono VUOTE; OpenBao oltre la cache è un rifiuto dichiarato.
 * A interruttore spento leggono le colonne come sempre.
 *
 * Il guasto provato per ognuna: con le colonne vuote il vecchio codice dava «assente» (utente vuoto, «Username e password
 * richiesti», host senza WinRM, voce senza segreti) come se la credenziale non esistesse.
 *
 * Run: node --import tsx --test src/lib/credentials/__tests__/letture-senza-colonne.test.ts
 */
import "@/lib/__tests__/support/data-dir-isolata";
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { encrypt } from "@/lib/crypto";
import { closeTenantDb, deleteTenantDatabase, getTenantDb, withTenant } from "@/lib/db-tenant";
import { closeHubDb } from "@/lib/db-hub";
import { TENANT_SCHEMA_SQL, TENANT_INDEXES_SQL } from "@/lib/db-tenant-schema";
import { creaCredenzialeDb } from "@/lib/credentials/archivio";
import { colonneChiareDb, presenzaSegretiDb, utentiDelleVociDb } from "@/lib/credentials/segreti";
import { provaCredenzialeSuHost } from "@/lib/credentials/trova";
import { collectSelfIdentity } from "@/lib/integrations/self-identity";
import { utenteVoceControllerDb } from "@/lib/controllers/credenziale";
import { hostConCredenzialeWinrmDb, loadWinrmCredentialsForHost } from "@/lib/patch/credentials";
import { OpenBaoStore } from "@/lib/vault/openbao";
import { statoVaultProcesso } from "@/lib/vault/stato";
import { creaOpenBaoFinto, type OpenBaoFinto } from "@/lib/vault/__tests__/support/openbao-finto";

const T = "C70032";
const CL = "c70032";
const MIN = 60_000;
let adesso = Date.parse("2026-10-24T12:00:00Z");
let finto: OpenBaoFinto;
let store: OpenBaoStore;
const id: Record<string, number> = {};

const db = () => getTenantDb(T);

before(() => {
  withTenant(T, () => {
    const d = db();
    // Voci con il riferimento e le colonne VUOTE: com'è un hub dopo lo svuotamento.
    const nuova = (nome: string, tipo: string) => creaCredenzialeDb(d, { name: nome, credential_type: tipo }).id;
    id.win = nuova("Account Windows", "windows");
    id.ad = nuova("Account AD", "ad");
    id.unifi = nuova("UniFi sede", "unifi");
    id.colonne = creaCredenzialeDb(d, { name: "Solo colonna", credential_type: "windows", encrypted_username: encrypt("col\\user"), encrypted_password: encrypt("col-pw") }).id;
    const ref = d.prepare("UPDATE credentials SET credential_ref = ? WHERE id = ?");
    ref.run(`clienti/${CL}/da-ipam/account-windows-${id.win}`, id.win);
    ref.run(`clienti/${CL}/da-ipam/account-ad-${id.ad}`, id.ad);
    ref.run(`clienti/${CL}/da-ipam/unifi-sede-${id.unifi}`, id.unifi);
  });
});

beforeEach(async () => {
  adesso = Date.parse("2026-10-24T12:00:00Z");
  finto = creaOpenBaoFinto({ ora: () => adesso });
  finto.kv.set(`clienti/${CL}/da-ipam/account-windows-${id.win}`, { username: "DOM\\svc-bao", password: "pw-win-bao" });
  finto.kv.set(`clienti/${CL}/da-ipam/account-ad-${id.ad}`, { username: "svc-ldap@dom.local", password: "pw-ad-bao" });
  finto.kv.set(`clienti/${CL}/da-ipam/unifi-sede-${id.unifi}`, { username: "unifi-admin", password: "pw-unifi-bao" });
  store = new OpenBaoStore({
    url: finto.url,
    roleId: finto.roleId,
    secretId: () => finto.secretId,
    cartelle: [],
    percorsiExtra: () => [...finto.kv.keys()],
    fetch: finto.fetch,
    fetchSync: finto.fetchSync,
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
  try {
    closeTenantDb(T);
    deleteTenantDatabase(T);
  } catch {
    /* già tolto */
  }
  closeHubDb();
});

describe("colonneChiareDb (il lettore di un valore solo)", () => {
  it("acceso, col riferimento: i valori di OpenBao, a colonne vuote", () => {
    const r = withTenant(T, () => colonneChiareDb(db(), id.win, ["encrypted_username", "encrypted_password"]));
    assert.ok(r.ok && r.esiste);
    assert.deepEqual(r.ok && r.esiste && r.valori, { encrypted_username: "DOM\\svc-bao", encrypted_password: "pw-win-bao" });
  });

  it("acceso, OpenBao oltre la cache: rifiuto dichiarato, mai la colonna", () => {
    finto.giu = true;
    adesso += 31 * MIN;
    const r = withTenant(T, () => colonneChiareDb(db(), id.win, ["encrypted_username"]));
    assert.equal(r.ok, false);
    assert.match(r.ok ? "" : r.motivo, /«Account Windows».*OpenBao non risponde/);
  });

  it("spento: le colonne, e il riferimento non conta", () => {
    delete process.env.DA_VAULT_OPENBAO;
    const vuota = withTenant(T, () => colonneChiareDb(db(), id.win, ["encrypted_username"]));
    assert.ok(vuota.ok && vuota.esiste);
    assert.deepEqual(vuota.ok && vuota.esiste && vuota.valori, { encrypted_username: "" });
    const piena = withTenant(T, () => colonneChiareDb(db(), id.colonne, ["encrypted_username", "encrypted_password"]));
    assert.deepEqual(piena.ok && piena.esiste && piena.valori, { encrypted_username: "col\\user", encrypted_password: "col-pw" });
    assert.equal(withTenant(T, () => colonneChiareDb(db(), 99999, ["encrypted_username"])).ok, true);
  });
});

describe("trova.ts: la prova di una voce Windows", () => {
  it("legge utente e password da OpenBao (colonne vuote): non dice «Username e password richiesti»", async () => {
    // La prova va a 127.0.0.1:1 (nessuno in ascolto): quel che conta è che il segreto sia stato letto e si sia arrivati
    // alla connessione. Con la colonna vuota il vecchio codice si fermava prima.
    const e = await withTenant(T, () => provaCredenzialeSuHost(db(), id.win, "127.0.0.1", 1));
    assert.equal(e.ok, false);
    const errore = e.ok ? "" : (e.errore ?? "");
    assert.doesNotMatch(errore, /Username e password richiesti|corrotta/);
    assert.ok(!errore.includes("pw-win-bao"));
  });

  it("OpenBao oltre la cache: il motivo dichiarato, non «richiesti»", async () => {
    finto.giu = true;
    adesso += 31 * MIN;
    const e = await withTenant(T, () => provaCredenzialeSuHost(db(), id.win, "127.0.0.1", 1));
    assert.equal(e.ok, false);
    assert.match(e.ok ? "" : (e.errore ?? ""), /OpenBao non risponde/);
  });
});

describe("self-identity: gli account delle voci Windows e AD", () => {
  it("gli utenti di OpenBao entrano fra gli account nostri anche con le colonne vuote", () => {
    const s = withTenant(T, () => collectSelfIdentity(db()));
    assert.ok(s.accounts.includes("svc-bao"), JSON.stringify(s.accounts));
    assert.ok(s.accounts.includes("svc-ldap"), JSON.stringify(s.accounts));
  });

  it("una voce che non si legge (OpenBao oltre la cache) non ferma la raccolta e lo dice una volta nel log", () => {
    finto.giu = true;
    adesso += 31 * MIN;
    const righe: string[] = [];
    const orig = console.warn;
    console.warn = (...a: unknown[]) => { righe.push(a.map(String).join(" ")); };
    try {
      withTenant(T, () => collectSelfIdentity(db()));
      withTenant(T, () => collectSelfIdentity(db()));
    } finally {
      console.warn = orig;
    }
    const mie = righe.filter((r) => r.includes("[self-identity] credenziale"));
    assert.ok(mie.length >= 1 && mie.length <= 3, `avvisi: ${mie.length}`);
    assert.ok(mie.every((r) => !r.includes("pw-")));
  });

  it("spento: la colonna, come prima", () => {
    delete process.env.DA_VAULT_OPENBAO;
    const s = withTenant(T, () => collectSelfIdentity(db()));
    assert.ok(s.accounts.includes("user"), JSON.stringify(s.accounts));
    assert.equal(s.accounts.includes("svc-bao"), false);
  });

  it("utentiDelleVociDb: una query, il riferimento letto dalla cache", () => {
    const u = withTenant(T, () => utentiDelleVociDb(db(), ["windows", "ad"]));
    assert.deepEqual(u.map((v) => v.username).sort(), ["DOM\\svc-bao", "col\\user", "svc-ldap@dom.local"].sort());
  });
});

describe("controllers/credenziale: l'utente della voce di un controller", () => {
  it("da OpenBao, a colonna vuota", () => {
    const r = withTenant(T, () => utenteVoceControllerDb(db(), id.unifi));
    assert.deepEqual(r, { ok: true, username: "unifi-admin" });
  });

  it("OpenBao oltre la cache: il motivo di OpenBao, non «non ha un utente»", () => {
    finto.giu = true;
    adesso += 31 * MIN;
    const r = withTenant(T, () => utenteVoceControllerDb(db(), id.unifi));
    assert.equal(r.ok, false);
    assert.match(r.ok ? "" : r.motivo, /OpenBao non risponde/);
  });

  it("spento, voce senza utente: il messaggio di sempre", () => {
    delete process.env.DA_VAULT_OPENBAO;
    const r = withTenant(T, () => utenteVoceControllerDb(db(), id.unifi));
    assert.equal(r.ok, false);
    assert.match(r.ok ? "" : r.motivo, /non ha un utente/);
  });
});

describe("presenzaSegretiDb (la maschera ha_…)", () => {
  it("acceso: dice cosa ha il segreto in OpenBao; spento: le colonne", () => {
    const voce = db().prepare("SELECT * FROM credentials WHERE id = ?").get(id.win) as { id: number; name: string };
    const p = withTenant(T, () => presenzaSegretiDb(db(), voce));
    assert.ok(p.ok);
    assert.equal(p.ok && p.presenti.encrypted_username, true);
    assert.equal(p.ok && p.presenti.encrypted_password, true);
    assert.equal(p.ok && p.presenti.encrypted_private_key, false);
    delete process.env.DA_VAULT_OPENBAO;
    const spenta = withTenant(T, () => presenzaSegretiDb(db(), voce));
    assert.ok(spenta.ok);
    assert.equal(spenta.ok && spenta.presenti.encrypted_password, false, "spento il riferimento non conta: la colonna è vuota");
  });
});

describe("patch: «WinRM disponibile» per le pagine patch", () => {
  let mem: Database.Database;

  beforeEach(() => {
    mem = new Database(":memory:");
    mem.pragma("foreign_keys = ON");
    mem.exec(TENANT_SCHEMA_SQL);
    mem.exec(TENANT_INDEXES_SQL);
    try {
      mem.exec("ALTER TABLE network_devices ADD COLUMN host_id INTEGER REFERENCES hosts(id) ON DELETE SET NULL");
    } catch {
      /* già nello schema */
    }
    if (!(mem.prepare("PRAGMA table_info(credentials)").all() as Array<{ name: string }>).some((c) => c.name === "credential_ref")) {
      mem.exec("ALTER TABLE credentials ADD COLUMN credential_ref TEXT");
    }
    mem.prepare("INSERT INTO networks (id, cidr, name) VALUES (1, '10.9.0.0/24', 'Rete patch')").run();
  });

  function hostConVoce(ip: string, ref: string | null, colonne: boolean): number {
    const c = Number(
      mem
        .prepare("INSERT INTO credentials (name, credential_type, encrypted_username, encrypted_password, credential_ref) VALUES (?, 'windows', ?, ?, ?)")
        .run(`W ${ip}`, colonne ? encrypt("u") : null, colonne ? encrypt("p") : null, ref).lastInsertRowid,
    );
    const h = Number(mem.prepare("INSERT INTO hosts (network_id, ip, os_info) VALUES (1, ?, 'Windows Server 2022')").run(ip).lastInsertRowid);
    mem.prepare("INSERT INTO host_credentials (host_id, credential_id, protocol_type, port, validated, sort_order) VALUES (?, ?, 'winrm', 5985, 1, 0)").run(h, c);
    return h;
  }

  it("acceso: una voce col riferimento e le colonne vuote conta, e il loader la trova davvero", () => {
    finto.kv.set(`clienti/${CL}/da-ipam/patch-1`, { username: "dom\\patch", password: "pw-patch" });
    const conRef = hostConVoce("10.9.0.40", `clienti/${CL}/da-ipam/patch-1`, false);
    const senza = hostConVoce("10.9.0.41", null, false);
    const colonne = hostConVoce("10.9.0.42", null, true);
    return store.aggiorna().then(() => {
      const set = hostConCredenzialeWinrmDb(mem);
      assert.deepEqual([...set].sort((a, b) => a - b), [conRef, colonne]);
      assert.equal(loadWinrmCredentialsForHost(mem, conRef)?.username, "dom\\patch");
      assert.equal(loadWinrmCredentialsForHost(mem, senza), null);
    });
  });

  it("spento: la regola di prima, il riferimento non conta", () => {
    delete process.env.DA_VAULT_OPENBAO;
    const conRef = hostConVoce("10.9.0.40", `clienti/${CL}/da-ipam/patch-1`, false);
    const colonne = hostConVoce("10.9.0.42", null, true);
    assert.deepEqual([...hostConCredenzialeWinrmDb(mem)].sort((a, b) => a - b), [colonne]);
    assert.ok(conRef > 0);
  });
});
