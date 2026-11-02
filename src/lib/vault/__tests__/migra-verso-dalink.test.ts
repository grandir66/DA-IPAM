/**
 * da-vault, passo 6 (hub): la migrazione delle credenziali dei device verso DA-Link (`migra-verso-dalink.ts`), qui
 * contro un vault remoto finto in memoria (il trasporto vero di DA-Link sta in `migra-verso-dalink-cli.test.ts`).
 *
 * - prova a vuoto di default: niente scritto né in DA-Link né nel database; il rapporto dice voci e percorsi, mai
 *   valori;
 * - `applica`: ogni voce senza riferimento va in DA-Link (`clienti/<codcli>/da-ipam/<nome>-<id>`), si rilegge e si
 *   confronta, e solo se tutte le voci del cliente tornano uguali si scrive `credential_ref` (una transazione per
 *   cliente). Le colonne restano: doppia lettura per una versione;
 * - si può ripetere; una verifica confronta DA-Link e colonne;
 * - conteggi uguali: con `DA_VAULT_DALINK=1` il lettore unico dà le stesse letture di prima.
 *
 * Run: node --import tsx --test src/lib/vault/__tests__/migra-verso-dalink.test.ts
 */
import "@/lib/__tests__/support/data-dir-isolata";
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { encrypt } from "@/lib/crypto";
import { closeTenantDb, deleteTenantDatabase, getTenantDb, withTenant } from "@/lib/db-tenant";
import { closeHubDb } from "@/lib/db-hub";
import { creaCredenzialeDb } from "@/lib/credentials/archivio";
import { campiVoceDb, leggiSegretoDb, type UsoSegreto } from "@/lib/credentials/segreti";
import { migraVersoDalink, percorsoCredenziale, verificaMigrazione } from "../migra-verso-dalink";
import { statoVaultProcesso } from "../stato";
import { percorsoValido } from "../tipi";
import { VaultRemotoFinto } from "./support/vault-remoto-finto";

const T = "C70001";
const SEGRETI = ["pw-migra-ssh-11", "comm-migra-22", "auth-migra-33", "priv-migra-44", "pem-migra-55"];
let store: VaultRemotoFinto;
const ids: number[] = [];

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
  delete process.env.DA_VAULT_DALINK;
  statoVaultProcesso().remoto = null;
  store = new VaultRemotoFinto();
});

after(() => {
  delete process.env.DA_VAULT_DALINK;
  statoVaultProcesso().remoto = null;
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
  it("niente in DA-Link, niente nel database; il rapporto ha voci e percorsi ma nessun valore", async () => {
    const e = await migraVersoDalink({ store, tenants: tenant() });
    assert.equal(e.applicata, false);
    assert.equal(e.perTenant[0].daMigrare, 4);
    assert.equal(e.perTenant[0].percorsi.length, 4);
    assert.equal(store.voci.size, 0);
    assert.deepEqual(store.chiamate, []);
    assert.deepEqual(riferimenti(), [null, null, null, null]);
    const testo = JSON.stringify(e);
    for (const s of SEGRETI) assert.ok(!testo.includes(s));
  });
});

describe("applica", () => {
  it("DA-Link giù a metà: nessun riferimento scritto per quel cliente", async () => {
    store.guastaAlPut = 3;
    const e = await migraVersoDalink({ store, tenants: tenant(), applica: true });
    assert.equal(e.perTenant[0].errore !== null, true);
    assert.deepEqual(riferimenti(), [null, null, null, null]);
  });

  it("una rilettura diversa da quella scritta: nessun riferimento scritto", async () => {
    const storto = new VaultRemotoFinto();
    const get = storto.get.bind(storto);
    storto.get = async (p, o) => ({ ...(await get(p, o)), password: "diverso" });
    const e = await migraVersoDalink({ store: storto, tenants: tenant(), applica: true });
    assert.match(e.perTenant[0].errore ?? "", /non torna uguale/);
    assert.deepEqual(riferimenti(), [null, null, null, null]);
  });

  it("scrive in DA-Link, rilegge, poi i riferimenti; le colonne restano; i conteggi tornano", async () => {
    const usi: Array<[number, UsoSegreto]> = [[ids[0], "ssh"], [ids[1], "snmp"], [ids[2], "snmp"], [ids[3], "ssh"]];
    const prima = usi.map(([id, uso]) => leggiSegretoDb(getTenantDb(T), id, uso));
    const e = await migraVersoDalink({ store, tenants: tenant(), applica: true });
    assert.equal(e.applicata, true);
    assert.equal(e.perTenant[0].migrate, 4, JSON.stringify({ ...e.perTenant[0], percorsi: undefined }));
    assert.equal(e.perTenant[0].errore, null);
    const refs = riferimenti();
    assert.ok(refs.every((r) => r && r.startsWith("clienti/c70001/da-ipam/")));
    assert.deepEqual(store.voci.get(refs[0] as string), { username: "admin", password: SEGRETI[0] });
    assert.deepEqual(store.voci.get(refs[2] as string), { username: "mon", auth_key: SEGRETI[2], priv_key: SEGRETI[3] });
    // Le colonne ci sono ancora (doppia lettura per una versione).
    const colonne = getTenantDb(T).prepare("SELECT COUNT(*) AS n FROM credentials WHERE COALESCE(encrypted_username, encrypted_password) IS NOT NULL").get() as { n: number };
    assert.equal(colonne.n, 4);

    // Interruttore acceso: le stesse letture di prima, da DA-Link.
    statoVaultProcesso().remoto = store;
    process.env.DA_VAULT_DALINK = "1";
    const dopo = usi.map(([id, uso]) => leggiSegretoDb(getTenantDb(T), id, uso));
    assert.deepEqual(dopo, prima);
    store.voci.set(refs[0] as string, { username: "admin", password: "cambiata-in-dalink" });
    const c = campiVoceDb(getTenantDb(T), ids[0]);
    assert.equal(c.ok && c.campi.password, "cambiata-in-dalink", "con l'interruttore acceso la fonte è DA-Link");
  });

  it("si ripete senza rifare niente", async () => {
    const e = await migraVersoDalink({ store, tenants: tenant(), applica: true });
    assert.equal(e.perTenant[0].daMigrare, 0);
    assert.equal(e.perTenant[0].giaMigrate, 4);
    assert.deepEqual(store.chiamate, [], "nessuna scrittura nuova");
  });
});

describe("verifica", () => {
  it("dice quali voci hanno in DA-Link un valore diverso dalla colonna (cambiate dopo la migrazione)", async () => {
    for (const r of riferimenti()) store.voci.set(r as string, {});
    // DA-Link «vuoto» per tutte: la verifica le segnala tutte, senza valori nel rapporto.
    const v = await verificaMigrazione({ store, tenants: tenant() });
    assert.equal(v.perTenant[0].controllate, 4);
    assert.equal(v.perTenant[0].diverse.length, 4);
    const testo = JSON.stringify(v);
    for (const s of SEGRETI) assert.ok(!testo.includes(s));
  });
});
