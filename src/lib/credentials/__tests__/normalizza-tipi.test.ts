/**
 * Normalizzazione dei tipi dell'archivio (tappa 2c credenziali, T11 del piano
 * `plans/2026-10-15-tappa2-archivio-credenziali.md`).
 *
 * Perché: dalla 2c i tipi si scrivono per esteso. `linux` diventa `ssh`, e
 * SNMP v3 diventa un tipo (`snmp_v3`) invece di una `snmp` col livello. Il
 * rischio è cambiare la credenziale che un apparato usa davvero:
 *   - una voce «ibrida» (`snmp` con livello E community) la usano come v3 gli
 *     apparati SNMPv3 e come community gli altri: si divide, e ognuno deve
 *     continuare a leggere quello che leggeva;
 *   - una v3 «vecchia» (`snmp` senza livello, con utente e password, usata da
 *     un apparato SNMPv3) dalla 2a si legge come authNoPriv/MD5 con la chiave
 *     da `encrypted_password`: dopo la conversione deve dare lo stesso record;
 *   - un tipo che non si conosce non si indovina: resta com'è e si elenca.
 * Le letture si controllano col motore vero (`credenzialeSnmpApparatoDb`,
 * `leggiSegretoDb`), con `registra: false`. Gli apparati di queste prove hanno
 * la voce nelle colonne, come prima della 2e: dalla 2g (T26) il motore non le
 * legge più da solo, e la scelta di prima la ricostruiscono le fonti vecchie
 * della conversione della 2e (`opzioniDiPrima`), le stesse con cui la 2e
 * controlla di non cambiare la scelta.
 *
 * Run: DA_INVENT_DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ipam.XXXXXX")" node --import tsx --test src/lib/credentials/__tests__/normalizza-tipi.test.ts
 */
import "@/lib/__tests__/support/data-dir-isolata";
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type Database from "better-sqlite3";

import { encrypt, decrypt } from "@/lib/crypto";
import { getTenantDb, deleteTenantDatabase, withTenant } from "@/lib/db-tenant";
import { normalizzaTipiCredenziali } from "@/lib/credentials/normalizza-tipi";
import { credenzialeSnmpApparatoDb, type ApparatoInAcquisizione } from "@/lib/credentials/resolve";
import { opzioniDiPrima } from "@/lib/credentials/converti-apparati";
import { coppiaSshDb, leggiSegretoDb } from "@/lib/credentials/segreti";

const T = "TESTNORMTIPI";
let db: Database.Database;

function voce(campi: Record<string, unknown>): number {
  const colonne = Object.keys(campi);
  return Number(
    db
      .prepare(`INSERT INTO credentials (${colonne.join(", ")}) VALUES (${colonne.map(() => "?").join(", ")})`)
      .run(...colonne.map((c) => campi[c]))
      .lastInsertRowid
  );
}

function apparato(nome: string, protocollo: string, colonne: { credential_id?: number | null; snmp_credential_id?: number | null } = {}): number {
  return Number(
    db
      .prepare(
        `INSERT INTO network_devices (name, host, device_type, vendor, protocol, port, credential_id, snmp_credential_id)
         VALUES (?, ?, 'switch', 'hp', ?, 161, ?, ?)`
      )
      .run(nome, `10.77.0.${Math.floor(Math.random() * 250) + 1}`, protocollo, colonne.credential_id ?? null, colonne.snmp_credential_id ?? null)
      .lastInsertRowid
  );
}

function binding(deviceId: number, credentialId: number, protocollo = "snmp", porta = 161): void {
  db.prepare("INSERT INTO device_credential_bindings (device_id, credential_id, protocol_type, port, sort_order) VALUES (?, ?, ?, ?, 0)").run(
    deviceId,
    credentialId,
    protocollo,
    porta
  );
}

function riga(id: number): Record<string, unknown> {
  return db.prepare("SELECT * FROM credentials WHERE id = ?").get(id) as Record<string, unknown>;
}

function snmpDi(deviceId: number) {
  return credenzialeSnmpApparatoDb(db, { id: deviceId, name: "" } as ApparatoInAcquisizione, { registra: false, ...opzioniDiPrima(db, deviceId) });
}

function tutto(): unknown {
  return {
    credentials: db.prepare("SELECT * FROM credentials ORDER BY id").all(),
    apparati: db.prepare("SELECT id, credential_id, snmp_credential_id FROM network_devices ORDER BY id").all(),
    binding: db.prepare("SELECT device_id, credential_id, protocol_type FROM device_credential_bindings ORDER BY id").all(),
    reti: db.prepare("SELECT network_id, credential_id FROM network_credentials ORDER BY id").all(),
  };
}

describe("normalizzaTipiCredenziali", () => {
  before(() => {
    db = withTenant(T, () => getTenantDb(T));
  });
  after(() => deleteTenantDatabase(T));
  beforeEach(() => {
    db.exec(
      "DELETE FROM device_credential_bindings; DELETE FROM network_credentials; DELETE FROM network_devices; DELETE FROM networks; DELETE FROM credentials;"
    );
  });

  it("linux → ssh: stesso id, stessa coppia letta", () => {
    const id = voce({ name: "Server Linux", credential_type: "linux", encrypted_username: encrypt("root"), encrypted_password: encrypt("Segreto-1") });
    const coppiaPrima = coppiaSshDb(db, id);
    const esito = normalizzaTipiCredenziali(db);
    assert.equal(esito.linuxInSsh, 1);
    assert.equal(riga(id).credential_type, "ssh");
    assert.deepEqual(coppiaSshDb(db, id), coppiaPrima);
    assert.deepEqual(esito.lasciate, []);
  });

  it("snmp con livello e senza community → snmp_v3, stesso record v3", () => {
    const id = voce({
      name: "V3 pulita",
      credential_type: "snmp",
      encrypted_username: encrypt("monitor"),
      security_level: "authPriv",
      auth_protocol: "SHA",
      encrypted_auth_key: encrypt("chiave-auth-1"),
      priv_protocol: "AES",
      encrypted_priv_key: encrypt("chiave-priv-1"),
    });
    const prima = leggiSegretoDb(db, id, "snmp");
    const esito = normalizzaTipiCredenziali(db);
    assert.equal(esito.snmpInV3, 1);
    assert.equal(riga(id).credential_type, "snmp_v3");
    const dopo = leggiSegretoDb(db, id, "snmp");
    assert.ok(prima.ok && dopo.ok);
    assert.deepEqual(dopo.segreto, prima.segreto);
    assert.equal(dopo.segreto.forma, "v3");
  });

  it("ibrida (livello e community) usata da un apparato SNMPv3: divisa, l'apparato apre la v3 con la voce nuova", () => {
    const utente = encrypt("utente-v3");
    const auth = encrypt("chiave-auth-2");
    const id = voce({
      name: "Ibrida",
      credential_type: "snmp",
      encrypted_username: utente,
      encrypted_password: encrypt("comunita-ibrida"),
      security_level: "authNoPriv",
      auth_protocol: "SHA",
      encrypted_auth_key: auth,
      port: 1161,
    });
    const v3col = apparato("v3 colonna", "snmp_v3", { credential_id: id });
    const v3bind = apparato("v3 binding", "snmp_v3");
    binding(v3bind, id);
    const v2 = apparato("v2 colonna", "snmp_v2", { snmp_credential_id: id });
    const rete = Number(db.prepare("INSERT INTO networks (cidr, name) VALUES ('10.77.1.0/24', 'Rete ibrida')").run().lastInsertRowid);
    db.prepare("INSERT INTO network_credentials (network_id, credential_id, sort_order) VALUES (?, ?, 0)").run(rete, id);
    const v3Prima = snmpDi(v3col);
    assert.ok(v3Prima.ok && v3Prima.cred.forma === "v3", "precondizione: l'apparato v3 legge la v3 dall'ibrida");

    const esito = normalizzaTipiCredenziali(db);

    assert.equal(esito.ibrideDivise.length, 1);
    const { id: originale, nuova } = esito.ibrideDivise[0];
    assert.equal(originale, id);
    // L'originale resta snmp con la community, senza niente di v3: nemmeno l'utente.
    const o = riga(id);
    assert.equal(o.credential_type, "snmp");
    assert.equal(decrypt(o.encrypted_password as string), "comunita-ibrida");
    for (const c of ["encrypted_username", "security_level", "auth_protocol", "encrypted_auth_key", "priv_protocol", "encrypted_priv_key"]) {
      assert.equal(o[c], null, `${c} resta sull'originale`);
    }
    // La voce nuova ha i campi v3 e l'utente, cifrati come erano (stesso testo cifrato).
    const n = riga(nuova);
    assert.equal(n.name, "Ibrida (v3)");
    assert.equal(n.credential_type, "snmp_v3");
    assert.equal(n.encrypted_username, utente);
    assert.equal(n.encrypted_auth_key, auth);
    assert.equal(n.security_level, "authNoPriv");
    assert.equal(n.auth_protocol, "SHA");
    assert.equal(n.encrypted_password, null);
    assert.equal(n.port, 1161);
    // Gli usi degli apparati v3 passano alla voce nuova; gli altri restano.
    assert.deepEqual(db.prepare("SELECT credential_id FROM network_devices WHERE id = ?").get(v3col), { credential_id: nuova });
    assert.deepEqual(db.prepare("SELECT credential_id FROM device_credential_bindings WHERE device_id = ?").get(v3bind), { credential_id: nuova });
    assert.deepEqual(db.prepare("SELECT snmp_credential_id FROM network_devices WHERE id = ?").get(v2), { snmp_credential_id: id });
    assert.deepEqual(db.prepare("SELECT credential_id FROM network_credentials WHERE network_id = ?").get(rete), { credential_id: id });

    for (const app of [v3col, v3bind]) {
      const s = snmpDi(app);
      assert.ok(s.ok, `l'apparato v3 #${app} non legge più la v3`);
      assert.equal(s.credential_id, nuova);
      assert.equal(s.cred.forma, "v3");
      assert.ok(v3Prima.ok && v3Prima.cred.forma === "v3");
      assert.deepEqual(s.cred, v3Prima.cred);
    }
    const sv2 = snmpDi(v2);
    assert.ok(sv2.ok && sv2.cred.forma === "community");
    assert.equal(sv2.cred.community, "comunita-ibrida");
  });

  it("v3 vecchia usata solo da apparati SNMPv3: convertita sul posto, stesso record di prima", () => {
    const pass = encrypt("chiave-vecchia-3");
    const user = encrypt("utente-vecchio");
    const id = voce({ name: "V3 vecchia", credential_type: "snmp", encrypted_username: user, encrypted_password: pass });
    const a = apparato("v3 a", "snmp_v3", { snmp_credential_id: id });
    const b = apparato("v3 b", "snmp_v3");
    binding(b, id);
    const primaA = snmpDi(a);
    assert.ok(primaA.ok && primaA.cred.forma === "v3", "precondizione: il formato vecchio si legge come v3");

    const esito = normalizzaTipiCredenziali(db);

    assert.equal(esito.v3Vecchie, 1);
    assert.deepEqual(esito.v3VecchieDivise, []);
    const r = riga(id);
    assert.equal(r.credential_type, "snmp_v3");
    assert.equal(r.security_level, "authNoPriv");
    assert.equal(r.auth_protocol, "MD5");
    assert.equal(r.encrypted_auth_key, pass, "il testo cifrato si copia, senza decifrare");
    assert.equal(r.encrypted_password, null);
    assert.equal(r.encrypted_username, user);
    for (const app of [a, b]) {
      const s = snmpDi(app);
      assert.ok(s.ok && s.cred.forma === "v3");
      assert.equal(s.credential_id, id);
      assert.ok(primaA.ok);
      assert.deepEqual(s.cred, primaA.cred);
    }
  });

  it("v3 vecchia usata da un apparato SNMPv3 e da uno v2c: divisa, il v2c legge la stessa community, il v3 la voce nuova col suo utente", () => {
    const pass = encrypt("comunita-o-chiave");
    const user = encrypt("utente-misto");
    const id = voce({ name: "Mista", credential_type: "snmp", encrypted_username: user, encrypted_password: pass });
    const v3 = apparato("v3", "snmp_v3", { credential_id: id });
    const v2 = apparato("v2", "snmp_v2", { credential_id: id });
    const v3Prima = snmpDi(v3);
    const v2Prima = snmpDi(v2);
    assert.ok(v3Prima.ok && v3Prima.cred.forma === "v3");
    assert.ok(v2Prima.ok && v2Prima.cred.forma === "community");

    const esito = normalizzaTipiCredenziali(db);

    assert.equal(esito.v3Vecchie, 0);
    assert.equal(esito.v3VecchieDivise.length, 1);
    const { nuova } = esito.v3VecchieDivise[0];
    const o = riga(id);
    assert.equal(o.credential_type, "snmp");
    assert.equal(o.encrypted_password, pass);
    assert.equal(o.encrypted_username, null, "l'utente v3 non resta sull'originale");
    const n = riga(nuova);
    assert.equal(n.name, "Mista (v3)");
    assert.equal(n.credential_type, "snmp_v3");
    assert.equal(n.encrypted_username, user);
    assert.equal(n.encrypted_auth_key, pass);
    assert.equal(n.security_level, "authNoPriv");
    assert.equal(n.auth_protocol, "MD5");
    assert.equal(n.encrypted_password, null);

    const s3 = snmpDi(v3);
    assert.ok(s3.ok);
    assert.equal(s3.credential_id, nuova);
    assert.deepEqual(s3.cred, v3Prima.cred);
    const s2 = snmpDi(v2);
    assert.ok(s2.ok);
    assert.equal(s2.credential_id, id);
    assert.deepEqual(s2.cred, v2Prima.cred);
  });

  it("snmp con utente e password ma senza apparati SNMPv3: è una community, non si tocca", () => {
    const id = voce({ name: "Community con utente", credential_type: "snmp", encrypted_username: encrypt("x"), encrypted_password: encrypt("public2") });
    apparato("v2", "snmp_v2", { credential_id: id });
    const prima = tutto();
    const esito = normalizzaTipiCredenziali(db);
    assert.deepEqual(tutto(), prima);
    assert.equal(esito.v3Vecchie + esito.v3VecchieDivise.length + esito.ibrideDivise.length + esito.snmpInV3, 0);
  });

  it("nome «(v3)» già nell'archivio: la voce nuova si distingue con l'id dell'originale", () => {
    voce({ name: "Doppia (v3)", credential_type: "snmp", encrypted_password: encrypt("altra") });
    const id = voce({
      name: "Doppia",
      credential_type: "snmp",
      encrypted_username: encrypt("u"),
      encrypted_password: encrypt("c"),
      security_level: "noAuthNoPriv",
    });
    const esito = normalizzaTipiCredenziali(db);
    assert.equal(riga(esito.ibrideDivise[0].nuova).name, `Doppia (v3) (voce #${id})`);
  });

  it("tipo sconosciuto: lasciato com'è ed elencato col motivo", () => {
    const id = voce({ name: "Telnet", credential_type: "telnet", encrypted_username: encrypt("u"), encrypted_password: encrypt("p") });
    const esito = normalizzaTipiCredenziali(db);
    assert.equal(riga(id).credential_type, "telnet");
    assert.equal(esito.lasciate.length, 1);
    assert.equal(esito.lasciate[0].id, id);
    assert.match(esito.lasciate[0].motivo, /telnet/);
  });

  it("seconda chiamata: nessun effetto", () => {
    voce({ name: "L", credential_type: "linux", encrypted_username: encrypt("u"), encrypted_password: encrypt("p") });
    const ib = voce({ name: "I", credential_type: "snmp", encrypted_username: encrypt("u"), encrypted_password: encrypt("c"), security_level: "authNoPriv", encrypted_auth_key: encrypt("k") });
    apparato("v3", "snmp_v3", { credential_id: ib });
    const vv = voce({ name: "VV", credential_type: "snmp", encrypted_username: encrypt("u"), encrypted_password: encrypt("k") });
    apparato("v3 bis", "snmp_v3", { credential_id: vv });
    apparato("v2 bis", "snmp_v2", { credential_id: vv });
    normalizzaTipiCredenziali(db);
    const dopoPrima = tutto();
    const esito = normalizzaTipiCredenziali(db);
    assert.deepEqual(tutto(), dopoPrima);
    assert.deepEqual(esito, { linuxInSsh: 0, snmpInV3: 0, ibrideDivise: [], v3Vecchie: 0, v3VecchieDivise: [], usiSpostati: 0, lasciate: [] });
  });
});
