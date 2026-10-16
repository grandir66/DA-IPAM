/**
 * Un lettore solo dei segreti (tappa 2 credenziali, T3, 15/10).
 *
 * Prima sette funzioni leggevano i segreti, ognuna con le sue regole, e
 * SNMPv3 si leggeva a metà:
 * - getDeviceSnmpV3Credentials prendeva la chiave da `encrypted_password`
 *   (db.ts:4462) e ignorava livello, protocolli e chiave di privacy. Una v3
 *   scritta dalla pagina, con le chiavi in `encrypted_auth_key` e
 *   `encrypted_priv_key`, dava null, e l'apparato ripiegava sulla community,
 *   cioè su «public»;
 * - una voce passata da v2c a v3 nella pagina tiene la community vecchia in
 *   `encrypted_password`: getCredentialCommunityString la restituiva, e la
 *   discovery la mandava in chiaro come v2c.
 *
 * Si prova sullo schema di oggi (TENANT_SCHEMA_SQL, senza le colonne del T11) e
 * su quello di un DEFAULT mai riaperto (senza `port`). segreti.ts legge con
 * SELECT *, e una colonna che non c'è vale come assente: una SELECT con le
 * colonne nuove per nome fermerebbe ogni lettura di segreti dal rilascio 2a.
 *
 * Run: DA_INVENT_DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ipam.XXXXXX")" node --import tsx --test src/lib/credentials/__tests__/segreti.test.ts
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

process.env.ENCRYPTION_KEY ||= "test-encryption-key-segreti";

import { encrypt } from "@/lib/crypto";
import { TENANT_SCHEMA_SQL } from "@/lib/db-tenant-schema";
import {
  withTenant,
  getTenantDb,
  deleteTenantDatabase,
  getCredentialLoginPair as loginTenant,
  getSshLinuxCredentialPair as sshTenant,
  getCredentialCommunityString as communityTenant,
  credenzialeSnmpApparato as snmpTenant,
  getNetworkDeviceById as apparatoTenant,
} from "@/lib/db-tenant";
import {
  getCredentialLoginPair as loginFacciata,
  getSshLinuxCredentialPair as sshFacciata,
  getCredentialCommunityString as communityFacciata,
  credenzialeSnmpApparato as snmpFacciata,
  getNetworkDeviceById as apparatoFacciata,
} from "@/lib/db";
import { leggiSegretoDb, leggiSegretoInline, opzioniSsh, type EsitoSegreto, type Segreto } from "../segreti";
import { snmpValidateV3 } from "@/lib/protocols/snmpv3";

interface Voce {
  id: number;
  name: string;
  credential_type: string;
  username?: string;
  password?: string;
  security_level?: string;
  auth_protocol?: string;
  auth_key?: string;
  priv_protocol?: string;
  priv_key?: string;
  port?: number;
  auth_method?: string;
  private_key?: string;
  key_passphrase?: string;
}

/** Scrive una voce come la scrive l'API (segreti cifrati), solo nelle colonne che la tabella ha. */
function inserisci(d: Database.Database, v: Voce): void {
  const colonne = new Set((d.prepare("PRAGMA table_info(credentials)").all() as Array<{ name: string }>).map((c) => c.name));
  const valori: Record<string, unknown> = {
    id: v.id,
    name: v.name,
    credential_type: v.credential_type,
    encrypted_username: v.username != null ? encrypt(v.username) : null,
    encrypted_password: v.password != null ? encrypt(v.password) : null,
    security_level: v.security_level ?? null,
    auth_protocol: v.auth_protocol ?? null,
    encrypted_auth_key: v.auth_key != null ? encrypt(v.auth_key) : null,
    priv_protocol: v.priv_protocol ?? null,
    encrypted_priv_key: v.priv_key != null ? encrypt(v.priv_key) : null,
    port: v.port ?? null,
    auth_method: v.auth_method ?? null,
    encrypted_private_key: v.private_key != null ? encrypt(v.private_key) : null,
    encrypted_key_passphrase: v.key_passphrase != null ? encrypt(v.key_passphrase) : null,
  };
  const nomi = Object.keys(valori).filter((k) => colonne.has(k));
  d.prepare(`INSERT INTO credentials (${nomi.join(", ")}) VALUES (${nomi.map(() => "?").join(", ")})`).run(
    ...nomi.map((k) => valori[k]),
  );
}

const VOCI: Voce[] = [
  { id: 1, name: "ssh-root", credential_type: "ssh", username: "root", password: "segreto-ssh", port: 2222 },
  { id: 2, name: "linux-vecchia", credential_type: "linux", username: "admin", password: "pw-linux" },
  { id: 3, name: "win-dominio", credential_type: "windows", username: "DOM\\adm", password: "pw-win" },
  { id: 4, name: "api-bmc", credential_type: "api", username: "bmc", password: "pw-api" },
  { id: 5, name: "community-v2c", credential_type: "snmp", password: "comunita" },
  // v3 come la scrive la pagina: utente, livello, protocolli, chiavi nelle colonne loro.
  {
    id: 6, name: "v3-pagina", credential_type: "snmp", username: "monitor", security_level: "authPriv",
    auth_protocol: "SHA", auth_key: "chiave-auth-1", priv_protocol: "AES", priv_key: "chiave-priv-1",
  },
  // v3 nata da una v2c modificata: la community vecchia è rimasta in encrypted_password.
  {
    id: 7, name: "v3-ex-v2c", credential_type: "snmp", username: "monitor2", password: "vecchia-community",
    security_level: "authNoPriv", auth_protocol: "SHA256", auth_key: "chiave-auth-2",
  },
  // formato v3 «vecchio»: snmp senza livello, con utente e password.
  { id: 8, name: "v3-formato-vecchio", credential_type: "snmp", username: "utente-v3", password: "chiave-md5" },
  { id: 9, name: "ssh-con-spazi", credential_type: "ssh", username: " root ", password: " pw con spazi " },
  // authPriv senza chiave di privacy: incompleta.
  {
    id: 10, name: "v3-incompleta", credential_type: "snmp", username: "monitor3", security_level: "authPriv",
    auth_protocol: "SHA", auth_key: "chiave-auth-3", priv_protocol: "AES",
  },
  { id: 11, name: "ssh-senza-password", credential_type: "ssh", username: "root" },
];

function dbOggi(): Database.Database {
  const d = new Database(":memory:");
  d.exec(TENANT_SCHEMA_SQL);
  for (const v of VOCI) inserisci(d, v);
  return d;
}

function segretoDi(e: EsitoSegreto): Segreto {
  assert.equal(e.ok, true, e.ok ? "" : e.motivo);
  if (!e.ok) throw new Error("non raggiungibile");
  return e.segreto;
}

function motivoDi(e: EsitoSegreto): string {
  assert.equal(e.ok, false, "atteso un rifiuto");
  if (e.ok) throw new Error("non raggiungibile");
  return e.motivo;
}

describe("leggiSegretoDb — schema di oggi (2a, senza le colonne del T11)", () => {
  let d: Database.Database;
  before(() => {
    d = dbOggi();
  });
  after(() => d.close());

  it("SSH: utente e password, con la porta della voce e il suo nome", () => {
    const e = leggiSegretoDb(d, 1, "ssh");
    assert.deepEqual(e, {
      ok: true,
      credentialId: 1,
      nome: "ssh-root",
      tipo: "ssh",
      segreto: { forma: "utente", username: "root", password: "segreto-ssh" },
      port: 2222,
    });
  });

  it("una voce «linux» vale per SSH, e il tipo resta quello scritto", () => {
    const e = leggiSegretoDb(d, 2, "ssh");
    assert.equal(e.ok && e.tipo, "linux");
    assert.deepEqual(segretoDi(e), { forma: "utente", username: "admin", password: "pw-linux" });
  });

  it("SNMP v2c: la community", () => {
    assert.deepEqual(segretoDi(leggiSegretoDb(d, 5, "snmp")), { forma: "community", community: "comunita" });
  });

  it("v3 scritta dalla pagina: il record completo (oggi getDeviceSnmpV3Credentials dà null)", () => {
    const e = leggiSegretoDb(d, 6, "snmp");
    assert.deepEqual(segretoDi(e), {
      forma: "v3",
      record: {
        username: "monitor",
        securityLevel: "authPriv",
        authProtocol: "SHA",
        authKey: "chiave-auth-1",
        privProtocol: "AES",
        privKey: "chiave-priv-1",
      },
    });
    assert.equal(e.ok && e.formatoVecchio, undefined);
  });

  it("una v3 non diventa mai una community, nemmeno con una password rimasta", () => {
    const s = segretoDi(leggiSegretoDb(d, 7, "snmp"));
    assert.equal(s.forma, "v3");
    assert.deepEqual(s.forma === "v3" ? s.record : null, {
      username: "monitor2",
      securityLevel: "authNoPriv",
      authProtocol: "SHA256",
      authKey: "chiave-auth-2",
      privProtocol: null,
      privKey: null,
    });
    // E chiesta per un apparato v3, resta la v3 vera: la password non diventa la chiave.
    const perV3 = segretoDi(leggiSegretoDb(d, 7, "snmp", { apparatoV3: true }));
    assert.equal(perV3.forma === "v3" && perV3.record.authKey, "chiave-auth-2");
  });

  it("formato v3 vecchio: per un apparato v3 è authNoPriv/MD5 con la chiave da encrypted_password, segnato", () => {
    const e = leggiSegretoDb(d, 8, "snmp", { apparatoV3: true });
    assert.deepEqual(segretoDi(e), {
      forma: "v3",
      record: { username: "utente-v3", securityLevel: "authNoPriv", authProtocol: "MD5", authKey: "chiave-md5", privProtocol: null, privKey: null },
    });
    assert.equal(e.ok && e.formatoVecchio, true);
    // Chiesta come SNMP qualunque è la community di oggi (la password).
    assert.deepEqual(segretoDi(leggiSegretoDb(d, 8, "snmp")), { forma: "community", community: "chiave-md5" });
  });

  it("una community chiesta per un apparato v3 resta una community (niente utente)", () => {
    assert.deepEqual(segretoDi(leggiSegretoDb(d, 5, "snmp", { apparatoV3: true })), { forma: "community", community: "comunita" });
  });

  it("i valori escono come sono stati salvati: chi li ripulisce lo fa nel suo involucro", () => {
    assert.deepEqual(segretoDi(leggiSegretoDb(d, 9, "ssh")), { forma: "utente", username: " root ", password: " pw con spazi " });
  });

  it("una voce Windows chiesta per SSH: rifiuto col nome e il tipo per esteso", () => {
    const m = motivoDi(leggiSegretoDb(d, 3, "ssh"));
    assert.equal(m, "La credenziale «win-dominio» è di tipo Windows (WinRM e WMI), non vale per SSH");
  });

  it("le regole di tipo sono quelle di tipiPerProtocollo: api accetta ssh, winrm no", () => {
    assert.equal(leggiSegretoDb(d, 1, "api").ok, true);
    assert.match(motivoDi(leggiSegretoDb(d, 1, "winrm")), /non vale per WinRM/);
    assert.match(motivoDi(leggiSegretoDb(d, 5, "ssh")), /SNMP v1\/v2c, non vale per SSH/);
    assert.match(motivoDi(leggiSegretoDb(d, 3, "snmp")), /non vale per SNMP/);
  });

  it("voce incompleta o inesistente: rifiuto che dice cosa manca, mai il segreto", () => {
    const incompleta = motivoDi(leggiSegretoDb(d, 10, "snmp"));
    assert.match(incompleta, /«v3-incompleta»/);
    assert.match(incompleta, /privacy/);
    assert.doesNotMatch(incompleta, /chiave-auth-3/);
    assert.match(motivoDi(leggiSegretoDb(d, 11, "ssh")), /«ssh-senza-password».*password/);
    assert.match(motivoDi(leggiSegretoDb(d, 999, "ssh")), /#999/);
  });

  it("un segreto che non si decifra è un rifiuto, non un'eccezione", () => {
    d.prepare("INSERT INTO credentials (id, name, credential_type, encrypted_username, encrypted_password) VALUES (50, 'rotta', 'ssh', ?, 'non-cifrato')").run(encrypt("root"));
    assert.match(motivoDi(leggiSegretoDb(d, 50, "ssh")), /«rotta».*non si decifra/);
  });
});

describe("leggiSegretoDb — DEFAULT dell'hub con lo schema vecchio", () => {
  // db.ts:261-274 (3 tipi) più gli ALTER SNMPv3 di :278-282, senza la porta (:284).
  const FORMA_A = `CREATE TABLE credentials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      credential_type TEXT NOT NULL CHECK(credential_type IN ('ssh', 'snmp', 'api')),
      encrypted_username TEXT,
      encrypted_password TEXT,
      encrypted_auth_key TEXT,
      auth_protocol TEXT,
      encrypted_priv_key TEXT,
      priv_protocol TEXT,
      security_level TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`;
  // db.ts:650-662: ricostruzione a 5 tipi e 7 colonne, senza gli ALTER dopo.
  const FORMA_B = `CREATE TABLE "credentials" (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        credential_type TEXT NOT NULL CHECK(credential_type IN ('ssh', 'snmp', 'api', 'windows', 'linux')),
        encrypted_username TEXT,
        encrypted_password TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )`;

  for (const [nome, ddl] of [["forma di db.ts:261", FORMA_A], ["forma ricostruita di db.ts:650", FORMA_B]] as const) {
    it(`${nome}: una voce SSH e una SNMP si leggono, porta assente = null`, () => {
      const d = new Database(":memory:");
      try {
        d.exec(ddl);
        inserisci(d, VOCI[0]);
        inserisci(d, VOCI[4]);
        assert.deepEqual(leggiSegretoDb(d, 1, "ssh"), {
          ok: true,
          credentialId: 1,
          nome: "ssh-root",
          tipo: "ssh",
          segreto: { forma: "utente", username: "root", password: "segreto-ssh" },
          port: null,
        });
        assert.deepEqual(segretoDi(leggiSegretoDb(d, 5, "snmp")), { forma: "community", community: "comunita" });
      } finally {
        d.close();
      }
    });
  }
});

describe("leggiSegretoDb — colonne del T11 e tipi della 2c (forme nuove)", () => {
  let d: Database.Database;
  before(() => {
    d = new Database(":memory:");
    // Le colonne del T11 e il CHECK a otto tipi, come saranno dopo la 2c.
    d.exec(`CREATE TABLE credentials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      credential_type TEXT NOT NULL CHECK(credential_type IN ('ssh','snmp','snmp_v3','windows','api','unifi','omada','ad')),
      auth_method TEXT,
      encrypted_username TEXT,
      encrypted_password TEXT,
      encrypted_private_key TEXT,
      encrypted_key_passphrase TEXT,
      encrypted_auth_key TEXT,
      auth_protocol TEXT,
      encrypted_priv_key TEXT,
      priv_protocol TEXT,
      security_level TEXT,
      port INTEGER
    )`);
    const voci: Voce[] = [
      { id: 1, name: "chiave-ssh", credential_type: "ssh", auth_method: "chiave", username: "deploy", private_key: "-----BEGIN KEY-----", key_passphrase: "frase" },
      { id: 2, name: "chiave-senza-frase", credential_type: "ssh", auth_method: "chiave", username: "deploy", private_key: "-----BEGIN KEY-----" },
      { id: 3, name: "token-api", credential_type: "api", auth_method: "token", username: "root@pam!ipam", password: "uuid-segreto" },
      { id: 4, name: "unifi-chiave", credential_type: "unifi", password: "chiave-unifi" },
      { id: 5, name: "omada-client", credential_type: "omada", username: "client-id", password: "client-secret" },
      { id: 6, name: "ad-ldap", credential_type: "ad", username: "ldap@dom", password: "pw-ldap" },
      { id: 7, name: "v3-tipo-nuovo", credential_type: "snmp_v3", username: "mon", security_level: "noAuthNoPriv" },
      { id: 8, name: "chiave-mancante", credential_type: "ssh", auth_method: "chiave", username: "deploy" },
      { id: 9, name: "metodo-ignoto", credential_type: "ssh", auth_method: "boh", username: "u", password: "p" },
    ];
    for (const v of voci) inserisci(d, v);
  });
  after(() => d.close());

  it("chiave SSH, con e senza passphrase", () => {
    assert.deepEqual(segretoDi(leggiSegretoDb(d, 1, "ssh")), { forma: "chiave_ssh", username: "deploy", privateKey: "-----BEGIN KEY-----", passphrase: "frase" });
    assert.deepEqual(segretoDi(leggiSegretoDb(d, 2, "ssh")), { forma: "chiave_ssh", username: "deploy", privateKey: "-----BEGIN KEY-----", passphrase: null });
  });

  it("token API, chiave UniFi, client Omada, account AD", () => {
    assert.deepEqual(segretoDi(leggiSegretoDb(d, 3, "api")), { forma: "token", tokenId: "root@pam!ipam", token: "uuid-segreto" });
    assert.deepEqual(segretoDi(leggiSegretoDb(d, 4, "controller_unifi")), { forma: "chiave_api", chiave: "chiave-unifi" });
    assert.deepEqual(segretoDi(leggiSegretoDb(d, 5, "controller_omada")), { forma: "client", clientId: "client-id", clientSecret: "client-secret" });
    assert.deepEqual(segretoDi(leggiSegretoDb(d, 6, "ldap")), { forma: "utente", username: "ldap@dom", password: "pw-ldap" });
  });

  it("snmp_v3 è sempre v3; UniFi, Omada e AD non valgono per i protocolli degli apparati", () => {
    assert.deepEqual(segretoDi(leggiSegretoDb(d, 7, "snmp")), {
      forma: "v3",
      record: { username: "mon", securityLevel: "noAuthNoPriv", authProtocol: null, authKey: null, privProtocol: null, privKey: null },
    });
    assert.match(motivoDi(leggiSegretoDb(d, 6, "winrm")), /Active Directory, non vale per WinRM/);
    assert.match(motivoDi(leggiSegretoDb(d, 4, "api")), /Controller UniFi, non vale per API/);
    assert.match(motivoDi(leggiSegretoDb(d, 5, "controller_unifi")), /Controller Omada/);
  });

  it("chiave mancante e metodo sconosciuto: rifiuto", () => {
    assert.match(motivoDi(leggiSegretoDb(d, 8, "ssh")), /«chiave-mancante».*chiave privata/);
    assert.match(motivoDi(leggiSegretoDb(d, 9, "ssh")), /«metodo-ignoto».*boh/);
  });
});

describe("opzioniSsh e leggiSegretoInline", () => {
  it("opzioniSsh: password, chiave (passphrase solo se c'è), altro → null", () => {
    assert.deepEqual(opzioniSsh({ forma: "utente", username: "root", password: "pw" }), { username: "root", password: "pw" });
    assert.deepEqual(opzioniSsh({ forma: "chiave_ssh", username: "d", privateKey: "K", passphrase: "f" }), { username: "d", privateKey: "K", passphrase: "f" });
    assert.deepEqual(opzioniSsh({ forma: "chiave_ssh", username: "d", privateKey: "K", passphrase: null }), { username: "d", privateKey: "K" });
    assert.equal(opzioniSsh({ forma: "community", community: "public" }), null);
  });

  it("binding inline: community per SNMP, utente e password per gli altri, nessuna voce", () => {
    const snmp = leggiSegretoInline({ protocol_type: "snmp", inline_username: null, inline_encrypted_password: encrypt("comunita") });
    assert.deepEqual(snmp, { ok: true, credentialId: null, nome: "credenziale nel binding", tipo: "snmp", segreto: { forma: "community", community: "comunita" }, port: null });
    const ssh = leggiSegretoInline({ protocol_type: "ssh", inline_username: "root", inline_encrypted_password: encrypt("pw") });
    assert.deepEqual(segretoDi(ssh), { forma: "utente", username: "root", password: "pw" });
    const winrm = leggiSegretoInline({ protocol_type: "winrm", inline_username: "adm", inline_encrypted_password: encrypt("pw") });
    assert.equal(winrm.ok && winrm.tipo, "windows");
    assert.match(motivoDi(leggiSegretoInline({ protocol_type: "ssh", inline_username: "root", inline_encrypted_password: null })), /password/);
  });
});

const T = "TESTSEGRETI";

describe("le gemelle di db.ts e db-tenant danno lo stesso esito sullo stesso DB", () => {
  const apparati: Record<string, number> = {};
  before(() => {
    withTenant(T, () => {
      const d = getTenantDb(T);
      for (const v of VOCI) inserisci(d, v);
      const ins = d.prepare(
        "INSERT INTO network_devices (name, host, device_type, vendor, protocol, credential_id, snmp_credential_id) VALUES (?, ?, 'switch', 'cisco', ?, ?, ?)",
      );
      apparati.v3Pagina = Number(ins.run("sw-v3", "10.0.0.1", "snmp_v3", 6, null).lastInsertRowid);
      apparati.v3Vecchio = Number(ins.run("sw-v3-vecchio", "10.0.0.2", "snmp_v3", 8, null).lastInsertRowid);
      apparati.soloCommunity = Number(ins.run("sw-v2c", "10.0.0.3", "snmp_v3", 5, null).lastInsertRowid);
      // Apparato SSH con la v3 come credenziale SNMP secondaria.
      apparati.sshConV3 = Number(ins.run("rt-ssh", "10.0.0.4", "ssh", 1, 6).lastInsertRowid);
    });
  });
  after(() => deleteTenantDatabase(T));

  const ids = VOCI.map((v) => v.id);

  it("getCredentialLoginPair, getSshLinuxCredentialPair, getCredentialCommunityString: uguali voce per voce", () => {
    withTenant(T, () => {
      for (const id of ids) {
        for (const tipo of ["windows", "linux", "api"] as const) {
          assert.deepEqual(loginTenant(id, tipo), loginFacciata(id, tipo), `login ${id} ${tipo}`);
        }
        assert.deepEqual(sshTenant(id), sshFacciata(id), `ssh ${id}`);
        assert.deepEqual(communityTenant(id), communityFacciata(id), `community ${id}`);
      }
    });
  });

  it("le letture di oggi restano: tipo esatto, valori ripuliti, porta della voce", () => {
    withTenant(T, () => {
      for (const [ssh, login, community] of [[sshTenant, loginTenant, communityTenant], [sshFacciata, loginFacciata, communityFacciata]] as const) {
        assert.deepEqual(ssh(1), { username: "root", password: "segreto-ssh", port: 2222 });
        assert.deepEqual(ssh(9), { username: "root", password: "pw con spazi", port: null });
        assert.equal(ssh(11), null);
        assert.deepEqual(login(2, "linux"), { username: "admin", password: "pw-linux" });
        assert.equal(login(1, "linux"), null, "getCredentialLoginPair resta sul tipo esatto");
        assert.equal(login(1, "api"), null, "una voce ssh non è una coppia «api»");
        assert.deepEqual(login(3, "windows"), { username: "DOM\\adm", password: "pw-win" });
        assert.equal(community(5), "comunita");
        assert.equal(community(8), "chiave-md5");
        assert.equal(community(6), null);
      }
    });
  });

  it("una v3 con la community vecchia rimasta non dà più la community (oggi sì)", () => {
    withTenant(T, () => {
      assert.equal(communityTenant(7), null);
      assert.equal(communityFacciata(7), null);
    });
  });

  // Dal T8 la v3 di un apparato la dà credenzialeSnmpApparato (il motore), che ha preso il posto di
  // getDeviceSnmpV3Credentials: stesso record, ripulito; un apparato snmp_v3 senza v3 è un rifiuto.
  it("credenzialeSnmpApparato: il record v3 completo, uguale sulle due gemelle", () => {
    withTenant(T, () => {
      for (const [snmp, apparato] of [[snmpTenant, apparatoTenant], [snmpFacciata, apparatoFacciata]] as const) {
        const leggi = (chiave: string) => {
          const dev = apparato(apparati[chiave]);
          assert.ok(dev, chiave);
          const c = snmp(dev);
          return c.ok && c.cred.forma === "v3" ? c.cred.record : null;
        };
        assert.deepEqual(leggi("v3Pagina"), {
          username: "monitor",
          securityLevel: "authPriv",
          authProtocol: "SHA",
          authKey: "chiave-auth-1",
          privProtocol: "AES",
          privKey: "chiave-priv-1",
        });
        assert.deepEqual(leggi("v3Vecchio"), {
          username: "utente-v3",
          securityLevel: "authNoPriv",
          authProtocol: "MD5",
          authKey: "chiave-md5",
          privProtocol: null,
          privKey: null,
        });
        assert.equal(leggi("soloCommunity"), null);
        assert.equal(leggi("sshConV3")?.privKey, "chiave-priv-1");
      }
    });
  });

  it("snmpValidateV3 accetta solo la forma v3: una community o un altro tipo si rifiutano prima della rete", async () => {
    const community = await withTenant(T, () => snmpValidateV3("127.0.0.1", 5, { timeoutMs: 200 }));
    assert.equal(community.ok, false);
    assert.match(community.error ?? "", /«community-v2c».*non .*SNMPv3/);
    const windows = await withTenant(T, () => snmpValidateV3("127.0.0.1", 3, { timeoutMs: 200 }));
    assert.match(windows.error ?? "", /non vale per SNMP/);
  });
});
