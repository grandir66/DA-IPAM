/**
 * da-vault, passo 10: la ricifra dalla chiave di ENCRYPTION_KEY alla chiave degli slot.
 *
 * - prova a vuoto di default (nessuna scrittura), `applica` esplicito;
 * - tutto o niente: ogni database in una transazione, e prima di scrivere una prova a vuoto su tutti;
 * - verificata sopra il lettore unico (`credentials/segreti.ts`): ogni voce dà gli stessi campi prima e dopo;
 * - prende tutti gli `encrypt()` dell'app (credenziali, binding, integrazioni dell'hub, profili edge di vuln,
 *   inventory-agent, network-services, credenziali di sistema), non i segreti dell'accesso (TOTP);
 * - crash a metà (processo ucciso con SIGKILL dentro la transazione): archivio integro, poi si ripete e finisce;
 * - dopo ricifra + VACUUM nei file SQLite non resta né un segreto in chiaro né un valore della chiave vecchia.
 *
 * I dati hanno la forma vera degli schemi (database del cliente e hub creati dall'app, funzioni di scrittura vere).
 *
 * Run: node --import tsx --test src/lib/vault/__tests__/ricifra.test.ts
 */
import { TEST_DATA_DIR } from "@/lib/__tests__/support/data-dir-isolata";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { cifraAccesso, decifraConChiave, encrypt, chiaveInstallazione } from "@/lib/crypto";
import { closeTenantDb, getTenantDb, withTenant } from "@/lib/db-tenant";
import { closeHubDb, createUser, getHubDb, setSetting } from "@/lib/db-hub";
import { creaCredenzialeDb } from "@/lib/credentials/archivio";
import { campiVoceDb } from "@/lib/credentials/segreti";
import { getWazuhConfig, setWazuhConfig } from "@/lib/integrations/wazuh-config";
import { installNetServices, getNetServicesState } from "@/lib/network-services/feature";
import { generateInventoryIngestToken, getStoredInventoryIngestTokenPlaintext } from "@/lib/inventory-agent/feature";
import { createCredential, getCredentialSecrets } from "@/lib/credentials-vault";
import { ricifra, fileDaRicifrare } from "../ricifra";
import { chiudiVault, impostaChiaveDati } from "../stato";

const T = "RICIFRA1";
const SEGRETI = {
  sshPassword: "Ssh-Pw-prova-1a2b",
  sshKey: "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAprova\n-----END OPENSSH PRIVATE KEY-----",
  sshKeyPass: "frase-chiave-prova-3c4d",
  community: "community-prova-5e6f",
  authKey: "auth-v3-prova-7a8b",
  privKey: "priv-v3-prova-9c0d",
  inline: "inline-pw-prova-1e2f",
  edge: "edge-token-prova-3a4b",
  wazuh: "wazuh-pw-prova-5c6d",
  netsvc: "netsvc-token-prova-7e8f",
  sistema: "sistema-pw-prova-9a0b",
  totp: "JBSWY3DPEHPK3PXP",
};
const CHIARI = Object.values(SEGRETI);
const RE_CIFRATO = /(?<![0-9a-f])[0-9a-f]{32}:[0-9a-f]{32}:[0-9a-f]*/g;

let K: Buffer;
let vecchia: Buffer;
let idVoci: number[] = [];
let campiPrima: string;
let inventoryToken: string;
let totpCifrato: string;
/** Il valore di una credenziale cancellata prima della ricifra: resta nelle pagine libere del file finché non c'è un VACUUM. */
let cancellato: string;

function tuttiIValori(file: string): Map<string, string> {
  const db = new Database(file, { readonly: true });
  const out = new Map<string, string>();
  try {
    const tabelle = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];
    for (const { name } of tabelle) {
      for (const r of db.prepare(`SELECT rowid AS _r, * FROM "${name}"`).all() as Record<string, unknown>[]) {
        for (const [c, v] of Object.entries(r)) if (typeof v === "string" && c !== "_r") out.set(`${name}.${c}#${String(r._r)}`, v);
      }
    }
  } finally {
    db.close();
  }
  return out;
}

function fotografia(): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of fileDaRicifrare(TEST_DATA_DIR)) for (const [k, v] of tuttiIValori(f)) out.set(`${f}:${k}`, v);
  return out;
}

function cifratiVecchi(): string[] {
  const out: string[] = [];
  for (const v of fotografia().values()) {
    for (const m of v.match(RE_CIFRATO) ?? []) {
      try {
        decifraConChiave(vecchia, m);
        out.push(m);
      } catch {
        /* non della chiave vecchia */
      }
    }
  }
  return out;
}

function chiudiTutto(): void {
  closeTenantDb(T);
  closeHubDb();
}

before(() => {
  delete process.env.DA_VAULT_LOCALE;
  vecchia = chiaveInstallazione();
  // ── Appliance com'è oggi: tutto con ENCRYPTION_KEY ──
  withTenant(T, () => {
    const d = getTenantDb(T);
    idVoci = [
      creaCredenzialeDb(d, { name: "Firewall ssh", credential_type: "ssh", auth_method: "password", encrypted_username: encrypt("admin"), encrypted_password: encrypt(SEGRETI.sshPassword), port: 22 }).id,
      creaCredenzialeDb(d, { name: "Linux chiave", credential_type: "ssh", auth_method: "chiave", encrypted_username: encrypt("root"), encrypted_private_key: encrypt(SEGRETI.sshKey), encrypted_key_passphrase: encrypt(SEGRETI.sshKeyPass) }).id,
      creaCredenzialeDb(d, { name: "Switch v2c", credential_type: "snmp", encrypted_password: encrypt(SEGRETI.community) }).id,
      creaCredenzialeDb(d, {
        name: "Switch v3", credential_type: "snmp_v3", encrypted_username: encrypt("monitor"), security_level: "authPriv",
        auth_protocol: "SHA", encrypted_auth_key: encrypt(SEGRETI.authKey), priv_protocol: "AES", encrypted_priv_key: encrypt(SEGRETI.privKey),
      }).id,
    ];
    const dev = Number(d.prepare("INSERT INTO network_devices (name, host, device_type, vendor, protocol) VALUES ('sw1', '10.99.0.2', 'switch', 'hp', 'ssh')").run().lastInsertRowid);
    d.prepare("INSERT INTO device_credential_bindings (device_id, protocol_type, port, inline_username, inline_encrypted_password) VALUES (?, 'ssh', 22, 'manager', ?)").run(dev, encrypt(SEGRETI.inline));
    d.prepare("INSERT INTO vuln_scanners (name, base_url, token_encrypted) VALUES ('edge', 'https://edge.prova:8443', ?)").run(encrypt(SEGRETI.edge));
    campiPrima = JSON.stringify(idVoci.map((id) => campiVoceDb(d, id)));
    cancellato = encrypt("password-di-una-voce-cancellata");
    const via = creaCredenzialeDb(d, { name: "Vecchio router", credential_type: "ssh", encrypted_username: encrypt("admin"), encrypted_password: cancellato }).id;
    d.prepare("DELETE FROM credentials WHERE id = ?").run(via);
  });
  setWazuhConfig({ url: "https://wazuh.prova:55000", username: "wazuh-wui", password: SEGRETI.wazuh });
  installNetServices(T, null, { apiUrl: "https://netsvc.prova", apiToken: SEGRETI.netsvc });
  inventoryToken = generateInventoryIngestToken(T);
  createCredential({ kind: "librenms", label: "LibreNMS", url: "https://librenms.prova", username: "admin", password: SEGRETI.sistema });
  setSetting("valore_non_cifrato", "aa:bb:cc testo qualsiasi");
  const u = createUser("admin-totp", "$2b$04$hashfinto", "admin", null);
  totpCifrato = cifraAccesso(SEGRETI.totp);
  getHubDb().prepare("UPDATE users SET totp_richiesta = 1, totp_segreto = ? WHERE id = ?").run(totpCifrato, u.id);

  // ── L'archivio è stato creato e l'interruttore acceso: la chiave degli slot è aperta ──
  K = randomBytes(32);
  process.env.DA_VAULT_LOCALE = "1";
  impostaChiaveDati(K, "passphrase");
  chiudiTutto();
});

after(() => {
  delete process.env.DA_VAULT_LOCALE;
  chiudiVault(null);
  chiudiTutto();
});

describe("precondizioni", () => {
  it("rifiuta con l'interruttore spento o senza la chiave degli slot aperta", () => {
    delete process.env.DA_VAULT_LOCALE;
    assert.throws(() => ricifra({ dataDir: TEST_DATA_DIR, chiaveNuova: K, applica: false }), /DA_VAULT_LOCALE/);
    process.env.DA_VAULT_LOCALE = "1";
    assert.throws(() => ricifra({ dataDir: TEST_DATA_DIR, chiaveNuova: randomBytes(32), applica: false }), /non è quella aperta/);
  });

  it("i file sono hub.db e i database dei clienti, non i file vuoti o con nomi strani", () => {
    const f = fileDaRicifrare(TEST_DATA_DIR).map((p) => p.slice(TEST_DATA_DIR.length + 1));
    assert.ok(f.includes("hub.db"));
    assert.ok(f.includes(join("tenants", `${T}.db`)));
  });
});

describe("prova a vuoto (di serie)", () => {
  it("conta i valori per tabella e colonna e non scrive niente", () => {
    const prima = fotografia();
    const e = ricifra({ dataDir: TEST_DATA_DIR, chiaveNuova: K });
    assert.equal(e.applicata, false);
    const tenant = e.file.find((f) => f.file.endsWith(`${T}.db`));
    const hub = e.file.find((f) => f.file.endsWith("hub.db"));
    assert.ok(tenant && hub);
    assert.equal(tenant.perColonna["credentials.encrypted_password"], 2);
    assert.equal(tenant.perColonna["credentials.encrypted_username"], 3);
    assert.equal(tenant.perColonna["credentials.encrypted_private_key"], 1);
    assert.equal(tenant.perColonna["credentials.encrypted_key_passphrase"], 1);
    assert.equal(tenant.perColonna["credentials.encrypted_auth_key"], 1);
    assert.equal(tenant.perColonna["credentials.encrypted_priv_key"], 1);
    assert.equal(tenant.perColonna["device_credential_bindings.inline_encrypted_password"], 1);
    assert.equal(tenant.perColonna["vuln_scanners.token_encrypted"], 1);
    assert.equal(tenant.vociVerificate, 4);
    assert.ok((hub.perColonna["settings.value"] ?? 0) >= 1, "password di Wazuh");
    assert.equal(hub.perColonna["tenant_features.config_json"], 2, "network-services e inventory-agent");
    assert.ok((hub.perColonna["system_credentials.password_enc"] ?? 0) >= 1);
    assert.equal(hub.perColonna["users.totp_segreto"], undefined, "i segreti dell'accesso non si toccano");
    assert.deepEqual(fotografia(), prima, "la prova a vuoto ha scritto");
  });

  it("il rapporto non contiene valori, né in chiaro né cifrati", () => {
    const testo = JSON.stringify(ricifra({ dataDir: TEST_DATA_DIR, chiaveNuova: K }));
    for (const s of CHIARI) assert.ok(!testo.includes(s));
    assert.ok(!RE_CIFRATO.test(testo));
  });
});

describe("tutto o niente", () => {
  it("un errore a metà: nessun valore cambiato in nessun database", () => {
    const prima = fotografia();
    assert.throws(
      () => ricifra({ dataDir: TEST_DATA_DIR, chiaveNuova: K, applica: true, alPasso: (n) => { if (n === 3) throw new Error("guasto di prova"); } }),
      /guasto di prova/,
    );
    assert.deepEqual(fotografia(), prima);
  });

  it("crash a metà (SIGKILL dentro la transazione): archivio integro, tutto ancora con la chiave vecchia", () => {
    const prima = fotografia();
    const r = spawnSync(process.execPath, ["--import", "tsx", join(__dirname, "support", "ricifra-crash.ts")], {
      env: { ...process.env, DA_INVENT_DATA_DIR: TEST_DATA_DIR, DA_VAULT_LOCALE: "1", PROVA_CHIAVE_SLOT: K.toString("hex"), PROVA_CRASH_AL_PASSO: "4" },
      encoding: "utf8",
      cwd: process.cwd(),
    });
    assert.equal(r.signal, "SIGKILL", `il figlio doveva morire ucciso: ${r.status} ${r.stderr}`);
    for (const f of fileDaRicifrare(TEST_DATA_DIR)) {
      const db = new Database(f);
      try {
        assert.equal((db.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check, "ok", f);
      } finally {
        db.close();
      }
    }
    assert.deepEqual(fotografia(), prima, "dopo il crash un valore è cambiato");
  });
});

describe("applica", () => {
  it("ricifra tutto, verifica col lettore unico, poi VACUUM: nei file non restano segreti né valori della chiave vecchia", () => {
    const vecchi = cifratiVecchi();
    assert.ok(vecchi.length >= 14, `pochi valori vecchi trovati: ${vecchi.length}`);
    const fileTenant = join(TEST_DATA_DIR, "tenants", `${T}.db`);
    assert.ok(readFileSync(fileTenant).includes(Buffer.from(cancellato)), "la prova non vale: il valore cancellato non è nel file nemmeno prima");
    const e = ricifra({ dataDir: TEST_DATA_DIR, chiaveNuova: K, applica: true });
    assert.equal(e.applicata, true);
    assert.ok(e.file.every((f) => f.vacuum));

    // Restano con la chiave vecchia solo i segreti dell'accesso.
    assert.deepEqual(cifratiVecchi(), [totpCifrato]);

    // Il lettore unico dà gli stessi campi.
    withTenant(T, () => {
      assert.equal(JSON.stringify(idVoci.map((id) => campiVoceDb(getTenantDb(T), id))), campiPrima);
    });
    // Le letture vere dell'app danno i valori di prima.
    assert.equal(getWazuhConfig().password, SEGRETI.wazuh);
    assert.equal(getStoredInventoryIngestTokenPlaintext(T), inventoryToken);
    assert.equal(getCredentialSecrets(1)?.password, SEGRETI.sistema);

    // Nei file (database, WAL, journal) non c'è niente di leggibile.
    chiudiTutto();
    const file = [join(TEST_DATA_DIR, "hub.db"), ...readdirSync(join(TEST_DATA_DIR, "tenants")).map((n) => join(TEST_DATA_DIR, "tenants", n))]
      .flatMap((f) => [f, `${f}-wal`, `${f}-journal`])
      .filter((f) => existsSync(f));
    for (const f of file) {
      const b = readFileSync(f);
      for (const s of CHIARI.filter((x) => x !== SEGRETI.totp)) assert.ok(!b.includes(Buffer.from(s)), `${f}: segreto in chiaro`);
      for (const v of [...vecchi.filter((x) => x !== totpCifrato), cancellato]) assert.ok(!b.includes(Buffer.from(v)), `${f}: valore della chiave vecchia rimasto`);
    }
  });

  it("si può ripetere: la seconda volta non c'è niente da fare", () => {
    const e = ricifra({ dataDir: TEST_DATA_DIR, chiaveNuova: K, applica: true });
    assert.equal(e.totale, 0);
  });

  it("network-services legge ancora il suo token", async () => {
    const s = await getNetServicesState(T);
    assert.ok(s.configured);
    assert.equal(s.apiToken, SEGRETI.netsvc);
  });
});
