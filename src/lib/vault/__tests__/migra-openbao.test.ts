/**
 * da-vault, passo 6 (hub): la migrazione delle credenziali dei device verso OpenBao.
 *
 * - prova a vuoto di default: niente scritto né in OpenBao né nel database; il rapporto dice voci e percorsi, mai
 *   valori;
 * - `applica`: ogni voce senza riferimento va in OpenBao (`clienti/<codcli>/da-ipam/<nome>-<id>`), si rilegge e si
 *   confronta, e solo se tutte le voci del cliente tornano uguali si scrive `credential_ref` (una transazione per
 *   cliente). Le colonne restano: doppia lettura per una versione;
 * - si può ripetere; una verifica confronta OpenBao e colonne prima di accendere l'interruttore;
 * - conteggi uguali: con `DA_VAULT_OPENBAO=1` il lettore unico dà le stesse letture di prima.
 *
 * Run: node --import tsx --test src/lib/vault/__tests__/migra-openbao.test.ts
 */
import "@/lib/__tests__/support/data-dir-isolata";
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encrypt } from "@/lib/crypto";
import { closeTenantDb, deleteTenantDatabase, getTenantDb, withTenant } from "@/lib/db-tenant";
import { closeHubDb } from "@/lib/db-hub";
import { creaCredenzialeDb } from "@/lib/credentials/archivio";
import { campiVoceDb, leggiSegretoDb, type UsoSegreto } from "@/lib/credentials/segreti";
import { OpenBaoStore } from "../openbao";
import { migraVersoOpenBao, percorsoCredenziale, verificaMigrazione } from "../migra-openbao";
import { configurazioneOpenBao } from "../avvio";
import { statoVaultProcesso } from "../stato";
import { percorsoValido } from "../tipi";
import { creaOpenBaoFinto, type OpenBaoFinto } from "./support/openbao-finto";

const T = "C70001";
const SEGRETI = ["pw-migra-ssh-11", "comm-migra-22", "auth-migra-33", "priv-migra-44", "pem-migra-55"];
let finto: OpenBaoFinto;
let store: OpenBaoStore;
const ids: number[] = [];

function nuovoStore(): OpenBaoStore {
  return new OpenBaoStore({ url: finto.url, roleId: finto.roleId, secretId: () => finto.secretId, cartelle: [], fetch: finto.fetch });
}

const tenant = () => [{ codice: T, dbh: getTenantDb(T) }];

before(() => {
  withTenant(T, () => {
    const d = getTenantDb(T);
    ids.push(
      creaCredenzialeDb(d, { name: "Firewall Sede", credential_type: "ssh", encrypted_username: encrypt("admin"), encrypted_password: encrypt(SEGRETI[0]), port: 22 }).id,
      creaCredenzialeDb(d, { name: "Switch v2c", credential_type: "snmp", encrypted_password: encrypt(SEGRETI[1]) }).id,
      creaCredenzialeDb(d, {
        name: "Switch v3", credential_type: "snmp_v3", encrypted_username: encrypt("mon"), security_level: "authPriv",
        auth_protocol: "SHA", encrypted_auth_key: encrypt(SEGRETI[2]), priv_protocol: "AES", encrypted_priv_key: encrypt(SEGRETI[3]),
      }).id,
      creaCredenzialeDb(d, { name: "Linux (chiave)", credential_type: "ssh", auth_method: "chiave", encrypted_username: encrypt("root"), encrypted_private_key: encrypt(SEGRETI[4]) }).id,
    );
  });
});

beforeEach(() => {
  delete process.env.DA_VAULT_OPENBAO;
  statoVaultProcesso().openbao = null;
  finto = creaOpenBaoFinto({ ora: Date.now });
  store = nuovoStore();
});

after(() => {
  delete process.env.DA_VAULT_OPENBAO;
  statoVaultProcesso().openbao = null;
  try { closeTenantDb(T); deleteTenantDatabase(T); } catch { /* già tolto */ }
  closeHubDb();
});

function riferimenti(): Array<string | null> {
  return (getTenantDb(T).prepare("SELECT credential_ref FROM credentials ORDER BY id").all() as Array<{ credential_ref: string | null }>).map((r) => r.credential_ref);
}

describe("percorsi", () => {
  it("clienti/<codcli>/da-ipam/<nome>-<id>, minuscolo con trattini, validi", () => {
    assert.equal(percorsoCredenziale("C70001", 7, "Firewall Sede (VPN)"), "clienti/c70001/da-ipam/firewall-sede-vpn-7");
    assert.equal(percorsoCredenziale("C70001", 8, "Città/àèì"), "clienti/c70001/da-ipam/citta-aei-8");
    assert.equal(percorsoCredenziale("C70001", 9, "***"), "clienti/c70001/da-ipam/credenziale-9");
    for (const p of ["clienti/c70001/da-ipam/firewall-sede-vpn-7", "clienti/c70001/da-ipam/credenziale-9"]) assert.ok(percorsoValido(p));
  });
});

describe("prova a vuoto (di serie)", () => {
  it("niente in OpenBao, niente nel database; il rapporto ha voci e percorsi ma nessun valore", async () => {
    const e = await migraVersoOpenBao({ store, tenants: tenant() });
    assert.equal(e.applicata, false);
    assert.equal(e.perTenant[0].daMigrare, 4);
    assert.equal(e.perTenant[0].percorsi.length, 4);
    assert.equal(finto.kv.size, 0);
    assert.ok(finto.richieste.every((r) => r.metodo !== "POST" || r.percorso === "/v1/auth/approle/login"));
    assert.deepEqual(riferimenti(), [null, null, null, null]);
    const testo = JSON.stringify(e);
    for (const s of SEGRETI) assert.ok(!testo.includes(s));
  });
});

describe("applica", () => {
  it("OpenBao giù a metà: nessun riferimento scritto per quel cliente", async () => {
    let n = 0;
    const giuAlTerzo: typeof fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "POST" && String(input).includes("/data/") && ++n === 3) finto.giu = true;
      return finto.fetch(input, init);
    }) as typeof fetch;
    const s = new OpenBaoStore({ url: finto.url, roleId: finto.roleId, secretId: () => finto.secretId, cartelle: [], fetch: giuAlTerzo });
    const e = await migraVersoOpenBao({ store: s, tenants: tenant(), applica: true });
    assert.equal(e.perTenant[0].errore !== null, true);
    assert.deepEqual(riferimenti(), [null, null, null, null]);
    finto.giu = false;
  });

  it("una rilettura diversa da quella scritta: nessun riferimento scritto", async () => {
    const storto = nuovoStore();
    const get = storto.get.bind(storto);
    storto.get = async (p, o) => ({ ...(await get(p, o)), password: "diverso" });
    const e = await migraVersoOpenBao({ store: storto, tenants: tenant(), applica: true });
    assert.match(e.perTenant[0].errore ?? "", /non torna uguale/);
    assert.deepEqual(riferimenti(), [null, null, null, null]);
  });

  it("scrive in OpenBao, rilegge, poi i riferimenti; le colonne restano; i conteggi tornano", async () => {
    const usi: Array<[number, UsoSegreto]> = [[ids[0], "ssh"], [ids[1], "snmp"], [ids[2], "snmp"], [ids[3], "ssh"]];
    const prima = usi.map(([id, uso]) => leggiSegretoDb(getTenantDb(T), id, uso));
    const e = await migraVersoOpenBao({ store, tenants: tenant(), applica: true });
    assert.equal(e.applicata, true);
    assert.equal(e.perTenant[0].migrate, 4, JSON.stringify({ ...e.perTenant[0], percorsi: undefined }));
    assert.equal(e.perTenant[0].errore, null);
    const refs = riferimenti();
    assert.ok(refs.every((r) => r && r.startsWith("clienti/c70001/da-ipam/")));
    assert.deepEqual(finto.kv.get(refs[0] as string), { username: "admin", password: SEGRETI[0] });
    assert.deepEqual(finto.kv.get(refs[2] as string), { username: "mon", auth_key: SEGRETI[2], priv_key: SEGRETI[3] });
    // Le colonne ci sono ancora (doppia lettura per una versione).
    const colonne = getTenantDb(T).prepare("SELECT COUNT(*) AS n FROM credentials WHERE COALESCE(encrypted_username, encrypted_password) IS NOT NULL").get() as { n: number };
    assert.equal(colonne.n, 4);

    // Interruttore acceso: le stesse letture di prima, da OpenBao.
    const lettore = new OpenBaoStore({ url: finto.url, roleId: finto.roleId, secretId: () => finto.secretId, cartelle: [], percorsiExtra: () => refs as string[], fetch: finto.fetch });
    await lettore.aggiorna();
    statoVaultProcesso().openbao = lettore;
    process.env.DA_VAULT_OPENBAO = "1";
    const dopo = usi.map(([id, uso]) => leggiSegretoDb(getTenantDb(T), id, uso));
    assert.deepEqual(dopo, prima);
    finto.kv.set(refs[0] as string, { username: "admin", password: "cambiata-in-openbao" });
    await lettore.aggiorna();
    const c = campiVoceDb(getTenantDb(T), ids[0]);
    assert.equal(c.ok && c.campi.password, "cambiata-in-openbao", "con l'interruttore acceso la fonte è OpenBao");
  });

  it("si ripete senza rifare niente", async () => {
    const e = await migraVersoOpenBao({ store, tenants: tenant(), applica: true });
    assert.equal(e.perTenant[0].daMigrare, 0);
    assert.equal(e.perTenant[0].giaMigrate, 4);
    assert.equal(finto.kv.size, 0, "nessuna scrittura nuova");
  });
});

describe("verifica prima di accendere", () => {
  it("dice quali voci hanno in OpenBao un valore diverso dalla colonna (cambiate dopo la migrazione)", async () => {
    for (const r of riferimenti()) finto.kv.set(r as string, {});
    // OpenBao «vuoto» per tutte: la verifica le segnala tutte, senza valori nel rapporto.
    const v = await verificaMigrazione({ store, tenants: tenant() });
    assert.equal(v.perTenant[0].controllate, 4);
    assert.equal(v.perTenant[0].diverse.length, 4);
    const testo = JSON.stringify(v);
    for (const s of SEGRETI) assert.ok(!testo.includes(s));
  });
});

describe("configurazione da ambiente", () => {
  it("senza URL o AppRole: errore che dice cosa manca", () => {
    const c = configurazioneOpenBao({});
    assert.equal(c.ok, false);
    assert.match(c.ok ? "" : c.motivo, /DA_VAULT_OPENBAO_URL/);
  });

  it("il secret_id si legge dal file (credenziale di systemd) a ogni login, non sta nell'ambiente", () => {
    const dir = mkdtempSync(join(tmpdir(), "da-vault-sid-"));
    writeFileSync(join(dir, "openbao-secret-id"), "sid-dal-file\n");
    const c = configurazioneOpenBao({ DA_VAULT_OPENBAO_URL: "https://bao.prova:8200", DA_VAULT_OPENBAO_ROLE_ID: "role-1", CREDENTIALS_DIRECTORY: dir });
    assert.ok(c.ok);
    if (!c.ok) return;
    assert.equal(c.config.secretId(), "sid-dal-file");
    writeFileSync(join(dir, "openbao-secret-id"), "sid-ruotato\n");
    assert.equal(c.config.secretId(), "sid-ruotato");
    assert.deepEqual(c.config.cartelle, ["app/da-ipam"]);
    assert.equal(c.config.mount, "kv-domarc");
  });
});

describe("riferimenti nella cache all'avvio (hub)", () => {
  it("riferimentiDelleCredenziali dà i credential_ref di tutti i clienti attivi, una volta ciascuno", async () => {
    const { createTenant } = await import("@/lib/db-hub");
    const { riferimentiDelleCredenziali } = await import("../avvio");
    createTenant({ codice_cliente: T, ragione_sociale: "Cliente di prova", active: 1 } as Parameters<typeof createTenant>[0]);
    const refs = riferimenti().filter((r): r is string => Boolean(r));
    assert.equal(refs.length, 4);
    assert.deepEqual(riferimentiDelleCredenziali().sort(), [...refs].sort());
  });
});
