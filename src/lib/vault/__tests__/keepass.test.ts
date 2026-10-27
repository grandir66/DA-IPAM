/**
 * da-vault, passo 10: «Esporta in KeePass». kdbxweb con un'implementazione Argon2 collegata (hash-wasm), KDBX 4 con
 * Argon2id; il file si apre con la passphrase del cliente più un key file, che sta nell'archivio in un suo slot
 * (backend `locale`, cifrato con la chiave degli slot) e resta lo stesso fra un'esportazione e l'altra.
 * L'esportazione si riapre con kdbxweb e contiene le credenziali. Ogni esportazione va nel registro.
 *
 * Run: node --import tsx --test src/lib/vault/__tests__/keepass.test.ts
 */
import "@/lib/__tests__/support/data-dir-isolata";
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as kdbxweb from "kdbxweb";
import { argon2d, argon2id } from "hash-wasm";
import { generateX25519Identity, identityToRecipient } from "age-encryption";
import { encrypt } from "@/lib/crypto";
import { closeTenantDb, deleteTenantDatabase, getTenantDb, withTenant } from "@/lib/db-tenant";
import { closeHubDb } from "@/lib/db-hub";
import { creaCredenzialeDb } from "@/lib/credentials/archivio";
import { collegaArgon2, esportaKeePass, esportaKeyFile, PERCORSO_KEYFILE } from "../keepass";
import { registroVisualizzazioni, type UtenteSessione } from "../mostra";
import { creaArchivio } from "../archivio";
import { chiudiVault, impostaChiaveDati } from "../stato";

const T = "VAULTKDBX";
const PASS = "passphrase-cliente-kdbx-42";
const SEG = { ssh: "Ssh-kdbx-1a", community: "comm-kdbx-2b", auth: "auth-kdbx-3c", priv: "priv-kdbx-4d", pem: "-----BEGIN OPENSSH PRIVATE KEY-----\nAAAAkdbx\n-----END OPENSSH PRIVATE KEY-----" };
const ADMIN: UtenteSessione = { id: "7", nome: "cliente-admin", ruolo: "admin" };
const ARGON_PROVA = { memoriaKiB: 1024, iterazioni: 1, parallelismo: 1 };
let chiave: Buffer;
let dirVault: string;

before(async () => {
  dirVault = mkdtempSync(join(tmpdir(), "da-vault-kdbx-"));
  process.env.DA_VAULT_DIR = dirVault;
  const destinatario = await identityToRecipient(await generateX25519Identity());
  chiave = (await creaArchivio(dirVault, { passphrase: PASS, chiaveDomarc: destinatario, scryptLogN: 10 })).chiave;
  withTenant(T, () => {
    const d = getTenantDb(T);
    creaCredenzialeDb(d, { name: "Firewall", credential_type: "ssh", encrypted_username: encrypt("admin"), encrypted_password: encrypt(SEG.ssh), port: 2222 });
    creaCredenzialeDb(d, { name: "Switch v2c", credential_type: "snmp", encrypted_password: encrypt(SEG.community) });
    creaCredenzialeDb(d, {
      name: "Switch v3", credential_type: "snmp_v3", encrypted_username: encrypt("mon"), security_level: "authPriv",
      auth_protocol: "SHA", encrypted_auth_key: encrypt(SEG.auth), priv_protocol: "AES", encrypted_priv_key: encrypt(SEG.priv),
    });
    creaCredenzialeDb(d, { name: "Linux chiave", credential_type: "ssh", auth_method: "chiave", encrypted_username: encrypt("root"), encrypted_private_key: encrypt(SEG.pem) });
  });
});

after(() => {
  delete process.env.DA_VAULT_LOCALE;
  delete process.env.DA_VAULT_DIR;
  chiudiVault(null);
  try { closeTenantDb(T); deleteTenantDatabase(T); } catch { /* già tolto */ }
  closeHubDb();
});

beforeEach(() => {
  process.env.DA_VAULT_LOCALE = "1";
  impostaChiaveDati(chiave, "tpm");
});

const esporta = (pass = PASS) => withTenant(T, () => esportaKeePass({ dbh: getTenantDb(T), utente: ADMIN, passphrase: pass, argon2: ARGON_PROVA }));
const keyfile = (pass = PASS) => withTenant(T, () => esportaKeyFile({ dbh: getTenantDb(T), utente: ADMIN, passphrase: pass }));

async function apri(kdbx: ArrayBuffer, kf: Uint8Array, pass = PASS): Promise<kdbxweb.Kdbx> {
  collegaArgon2();
  return kdbxweb.Kdbx.load(kdbx, new kdbxweb.Credentials(kdbxweb.ProtectedValue.fromString(pass), kf));
}

function campo(e: kdbxweb.KdbxEntry, nome: string): string | undefined {
  const v = e.fields.get(nome);
  return v instanceof kdbxweb.ProtectedValue ? v.getText() : v;
}

describe("Argon2 collegato", () => {
  it("l'implementazione dà il vettore noto e passa d e id al tipo giusto", async () => {
    collegaArgon2();
    const pw = new TextEncoder().encode("password").buffer as ArrayBuffer;
    const salt = new TextEncoder().encode("somesalt").buffer as ArrayBuffer;
    const d = new Uint8Array(await kdbxweb.CryptoEngine.argon2(pw, salt, 64, 2, 32, 1, 0, 0x13));
    const id = new Uint8Array(await kdbxweb.CryptoEngine.argon2(pw, salt, 64, 2, 32, 1, 2, 0x13));
    const atteso = { password: "password", salt: "somesalt", memorySize: 64, iterations: 2, hashLength: 32, parallelism: 1, outputType: "binary" as const };
    assert.deepEqual(d, await argon2d(atteso));
    assert.deepEqual(id, await argon2id(atteso));
    assert.notDeepEqual(d, id);
  });
});

describe("esportazione", () => {
  it("si riapre con kdbxweb (passphrase + key file) e contiene le credenziali", async () => {
    const e = await esporta();
    assert.ok(e.ok);
    if (!e.ok) return;
    assert.equal(e.voci, 4);
    const k = await keyfile();
    assert.ok(k.ok);
    if (!k.ok) return;
    const db = await apri(e.kdbx, k.keyfile);
    assert.equal(db.header.versionMajor, 4);
    assert.equal(db.header.kdfParameters?.get("$UUID") instanceof ArrayBuffer, true);
    assert.equal(kdbxweb.ByteUtils.bytesToBase64(db.header.kdfParameters?.get("$UUID") as ArrayBuffer), kdbxweb.Consts.KdfId.Argon2id);
    const voci = new Map<string, kdbxweb.KdbxEntry>();
    for (const en of db.getDefaultGroup().allEntries()) voci.set(campo(en, "Title") ?? "", en);
    assert.deepEqual([...voci.keys()].sort(), ["Firewall", "Linux chiave", "Switch v2c", "Switch v3"]);
    const fw = voci.get("Firewall")!;
    assert.equal(campo(fw, "UserName"), "admin");
    assert.equal(campo(fw, "Password"), SEG.ssh);
    assert.match(campo(fw, "Notes") ?? "", /ssh.*2222/);
    assert.equal(campo(voci.get("Switch v2c")!, "Password"), SEG.community);
    const v3 = voci.get("Switch v3")!;
    assert.equal(campo(v3, "UserName"), "mon");
    assert.equal(campo(v3, "auth_key"), SEG.auth);
    assert.equal(campo(v3, "priv_key"), SEG.priv);
    assert.ok(v3.fields.get("priv_key") instanceof kdbxweb.ProtectedValue, "i campi segreti in più sono protetti");
    assert.equal(campo(voci.get("Linux chiave")!, "private_key"), SEG.pem);
  });

  it("senza il key file, o con la passphrase sbagliata, il file non si apre", async () => {
    const e = await esporta();
    const k = await keyfile();
    assert.ok(e.ok && k.ok);
    if (!e.ok || !k.ok) return;
    collegaArgon2();
    await assert.rejects(kdbxweb.Kdbx.load(e.kdbx, new kdbxweb.Credentials(kdbxweb.ProtectedValue.fromString(PASS))));
    await assert.rejects(apri(e.kdbx, k.keyfile, "passphrase-sbagliata-xx"));
  });

  it("il key file sta nell'archivio, cifrato, ed è lo stesso fra due esportazioni", async () => {
    const k1 = await keyfile();
    await esporta();
    const k2 = await keyfile();
    assert.ok(k1.ok && k2.ok);
    if (!k1.ok || !k2.ok) return;
    assert.deepEqual(k1.keyfile, k2.keyfile);
    const grezzo = readFileSync(join(dirVault, "segreti.json"), "utf8");
    assert.ok(grezzo.includes(PERCORSO_KEYFILE));
    assert.ok(!grezzo.includes(Buffer.from(k1.keyfile).toString("base64")));
    assert.ok(!grezzo.includes(Buffer.from(k1.keyfile).toString("utf8").slice(0, 40)));
  });

  it("il file esportato non contiene i segreti in chiaro", async () => {
    const e = await esporta();
    assert.ok(e.ok);
    if (!e.ok) return;
    const b = Buffer.from(e.kdbx);
    for (const s of Object.values(SEG)) assert.ok(!b.includes(Buffer.from(s)));
  });

  it("passphrase sbagliata: rifiuto (403), nessun file", async () => {
    const e = await esporta("passphrase-sbagliata-xx");
    assert.equal(e.ok ? 200 : e.stato, 403);
    const k = await keyfile("passphrase-sbagliata-xx");
    assert.equal(k.ok ? 200 : k.stato, 403);
  });

  it("vault bloccato: 423; interruttore spento: 404", async () => {
    chiudiVault("prova");
    assert.equal(await esporta().then((e) => (e.ok ? 200 : e.stato)), 423);
    delete process.env.DA_VAULT_LOCALE;
    assert.equal(await esporta().then((e) => (e.ok ? 200 : e.stato)), 404);
  });

  it("esportazioni e key file vanno nel registro", async () => {
    const prima = withTenant(T, () => registroVisualizzazioni(getTenantDb(T)).righe.map((r) => r.azione));
    await esporta();
    await keyfile();
    const dopo = withTenant(T, () => registroVisualizzazioni(getTenantDb(T)));
    assert.deepEqual(dopo.righe.slice(0, 2).map((r) => r.azione), ["keyfile", "esporta_keepass"]);
    assert.equal(dopo.righe.length, prima.length + 2);
    assert.ok(dopo.righe.every((r) => r.utente === "cliente-admin"));
  });
});
