/**
 * Patch e terminale scelgono la credenziale col motore unico (tappa 2
 * credenziali, T9, 16/10).
 *
 * Prima loadWinrmCredentialsForHost e loadSshCredentialsForHost prendevano la
 * prima riga host del protocollo (validated DESC, sort_order, id) senza
 * guardare il fermo (`backoff_until`) né il tipo della voce: un host la cui
 * riga WinRM aveva appena fallito riceveva la stessa credenziale a ogni
 * operazione, cioè un altro accesso fallito vero su un account di dominio. Il
 * ripiego sull'account WinRM dell'AD non diceva da dove veniva, e le quattro
 * pagine patch decidevano «WinRM disponibile» con una CTE loro (MAX(validated)
 * o AD presente), diversa dalla regola del loader.
 *
 * Le funzioni nuove si prendono per nome: prima del T9 non esistono e la prova
 * cade alla chiamata, non all'import.
 *
 * Run: DA_INVENT_DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ipam.XXXXXX")" node --import tsx --test src/lib/patch/__tests__/credenziali-motore.test.ts
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

process.env.ENCRYPTION_KEY ||= "test-encryption-key-patch-motore";

import { encrypt } from "@/lib/crypto";
import { TENANT_SCHEMA_SQL, TENANT_INDEXES_SQL } from "@/lib/db-tenant-schema";
import * as patch from "../credentials";

type Scelta =
  | { ok: true; candidato: { credential_id: number | null; port: number; source: string }; segreto: { forma: string } }
  | { ok: false; motivo: string };
type Nuove = {
  sceltaWinrmPatchDb: (dbh: Database.Database, hostId: number, opts?: { registra?: boolean }) => Scelta;
  hostConCredenzialeWinrmDb: (dbh: Database.Database) => Set<number>;
};
const nuove = patch as unknown as Nuove;
const { loadWinrmCredentialsForHost, loadSshCredentialsForHost } = patch;

let db: Database.Database;
const futuro = (): string => new Date(Date.now() + 60 * 60 * 1000).toISOString();

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(TENANT_SCHEMA_SQL);
  db.exec(TENANT_INDEXES_SQL);
  try {
    db.exec("ALTER TABLE network_devices ADD COLUMN host_id INTEGER REFERENCES hosts(id) ON DELETE SET NULL");
  } catch {
    /* già nello schema */
  }
  db.prepare("INSERT INTO networks (id, cidr, name) VALUES (1, '10.9.0.0/24', 'Rete patch')").run();
});

function voce(nome: string, tipo: string, utente: string | null, password: string | null): number {
  return Number(
    db
      .prepare("INSERT INTO credentials (name, credential_type, encrypted_username, encrypted_password) VALUES (?, ?, ?, ?)")
      .run(nome, tipo, utente != null ? encrypt(utente) : null, password != null ? encrypt(password) : null).lastInsertRowid,
  );
}

function host(ip: string): number {
  return Number(db.prepare("INSERT INTO hosts (network_id, ip, os_info) VALUES (1, ?, 'Windows Server 2022')").run(ip).lastInsertRowid);
}

function riga(hostId: number, credId: number, proto: string, port: number, validated: number, sort: number, backoff: string | null = null): void {
  db.prepare(
    "INSERT INTO host_credentials (host_id, credential_id, protocol_type, port, validated, sort_order, backoff_until) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(hostId, credId, proto, port, validated, sort, backoff);
}

function ad(nome: string, credId: number): number {
  return Number(
    db
      .prepare(
        "INSERT INTO ad_integrations (name, dc_host, domain, base_dn, encrypted_username, encrypted_password, winrm_credential_id) VALUES (?, ?, 'dominio.local', 'DC=dominio,DC=local', ?, ?, ?)",
      )
      .run(nome, `dc-${nome}`, encrypt("ldap"), encrypt("ldap-pw"), credId).lastInsertRowid,
  );
}

describe("patch: WinRM col motore", () => {
  it("una riga in fermo non si usa più: si passa alla riga dopo (oggi la riga in fermo)", () => {
    const h = host("10.9.0.10");
    riga(h, voce("Win fermo", "windows", "admin-fermo", "pw-fermo"), "winrm", 5985, 1, 0, futuro());
    riga(h, voce("Win seconda", "windows", "admin-due", "pw-due"), "winrm", 5986, 0, 1);
    const c = loadWinrmCredentialsForHost(db, h);
    assert.equal(c?.username, "admin-due");
    assert.equal(c?.port, 5986);
  });

  it("l'unica riga in fermo: senza AD nessuna credenziale, con AD il ripiego dichiarato", () => {
    const h = host("10.9.0.11");
    riga(h, voce("Win fermo", "windows", "admin-fermo", "pw-fermo"), "winrm", 5985, 1, 0, futuro());
    assert.equal(loadWinrmCredentialsForHost(db, h), null);

    ad("ad1", voce("Account AD", "windows", "dominio\\patch", "pw-ad"));
    const c = loadWinrmCredentialsForHost(db, h);
    assert.equal(c?.username, "dominio\\patch");
    assert.equal(c?.port, 5985);
    const s = nuove.sceltaWinrmPatchDb(db, h, { registra: false });
    assert.ok(s.ok, s.ok ? "" : s.motivo);
    assert.equal(s.candidato.source, "ad_fallback");
  });

  it("il ripiego AD arriva per ultimo, dopo una riga non validata", () => {
    const h = host("10.9.0.12");
    const w = voce("Win non provata", "windows", "admin-np", "pw-np");
    riga(h, w, "winrm", 5985, 0, 0);
    ad("ad1", voce("Account AD", "windows", "dominio\\patch", "pw-ad"));
    assert.equal(loadWinrmCredentialsForHost(db, h)?.username, "admin-np");
    const s = nuove.sceltaWinrmPatchDb(db, h, { registra: false });
    assert.ok(s.ok, s.ok ? "" : s.motivo);
    assert.equal(s.candidato.source, "host_unvalidated");
    assert.equal(s.candidato.credential_id, w);
  });

  it("il binding WinRM dell'apparato collegato non entra nelle patch (come oggi)", () => {
    const h = host("10.9.0.13");
    riga(h, voce("Win dell'host", "windows", "admin-host", "pw-host"), "winrm", 5985, 0, 0);
    const app = Number(
      db
        .prepare("INSERT INTO network_devices (name, host, device_type, vendor, protocol, port, host_id) VALUES ('Server', '10.9.0.13', 'server', 'windows', 'winrm', 5985, ?)")
        .run(h).lastInsertRowid,
    );
    db.prepare(
      "INSERT INTO device_credential_bindings (device_id, credential_id, protocol_type, port, sort_order, test_status) VALUES (?, ?, 'winrm', 5985, 0, 'success')",
    ).run(app, voce("Win del binding", "windows", "admin-binding", "pw-binding"));
    assert.equal(loadWinrmCredentialsForHost(db, h)?.username, "admin-host");
    const s = nuove.sceltaWinrmPatchDb(db, h, { registra: false });
    assert.ok(s.ok && s.candidato.source === "host_unvalidated");
  });

  it("con due integrazioni AD vale la prima per id, come oggi (non la voce con l'id più basso)", () => {
    const h = host("10.9.0.14");
    const dopo = voce("Voce creata prima", "windows", "account-seconda-integrazione", "pw-b");
    const prima = voce("Voce creata dopo", "windows", "account-prima-integrazione", "pw-a");
    ad("prima", prima);
    ad("seconda", dopo);
    assert.equal(loadWinrmCredentialsForHost(db, h)?.username, "account-prima-integrazione");
  });

  it("una riga WinRM su una voce che non è Windows si salta (filtro di tipo; oggi si usa)", () => {
    const h = host("10.9.0.15");
    riga(h, voce("SSH messa su WinRM", "ssh", "root", "pw-root"), "winrm", 5985, 1, 0);
    assert.equal(loadWinrmCredentialsForHost(db, h), null);
  });
});

describe("terminale: SSH col motore", () => {
  it("la riga SSH in fermo non si usa: si passa alla riga dopo, voce ssh o linux", () => {
    const h = host("10.9.0.20");
    riga(h, voce("Linux in fermo", "linux", "root-fermo", "pw-fermo"), "ssh", 22, 1, 0, futuro());
    riga(h, voce("SSH buona", "ssh", "root-buono", "pw-buona"), "ssh", 2222, 0, 1);
    const c = loadSshCredentialsForHost(db, h);
    assert.equal(c?.username, "root-buono");
    assert.equal(c?.port, 2222);
    assert.equal(c?.host, "10.9.0.20");
  });
});

describe("hostConCredenzialeWinrmDb: le pagine patch con la regola del loader", () => {
  it("contiene esattamente gli host per cui loadWinrmCredentialsForHost dà una credenziale, con e senza AD", () => {
    const validata = host("10.9.0.30");
    riga(validata, voce("W validata", "windows", "a", "pa"), "winrm", 5985, 1, 0);
    const nonProvata = host("10.9.0.31");
    riga(nonProvata, voce("W non provata", "windows", "b", "pb"), "winrm", 5985, 0, 0);
    const inFermo = host("10.9.0.32");
    riga(inFermo, voce("W in fermo", "windows", "c", "pc"), "winrm", 5985, 1, 0, futuro());
    const tipoSbagliato = host("10.9.0.33");
    riga(tipoSbagliato, voce("SSH su WinRM", "ssh", "d", "pd"), "winrm", 5985, 1, 0);
    const senzaPassword = host("10.9.0.34");
    riga(senzaPassword, voce("W senza password", "windows", "e", null), "winrm", 5985, 1, 0);
    host("10.9.0.35"); // nessuna riga
    const voceAd = voce("Account AD", "windows", "dominio\\patch", "pw-ad");
    const adInFermo = host("10.9.0.36");
    riga(adInFermo, voceAd, "winrm", 5985, 0, 0, futuro());

    const tutti = (db.prepare("SELECT id FROM hosts ORDER BY id").all() as Array<{ id: number }>).map((r) => r.id);
    const attesi = (): number[] => tutti.filter((id) => loadWinrmCredentialsForHost(db, id) != null);
    const ordina = (s: Set<number>): number[] => [...s].sort((a, b) => a - b);

    const senzaAd = attesi();
    assert.deepEqual(senzaAd, [validata, nonProvata]);
    assert.deepEqual(ordina(nuove.hostConCredenzialeWinrmDb(db)), senzaAd);

    ad("ad1", voceAd);
    const conAd = attesi();
    assert.ok(!conAd.includes(adInFermo), "l'host con la riga dell'account AD in fermo resta fuori");
    assert.ok(conAd.includes(inFermo) && conAd.includes(tipoSbagliato), "gli altri arrivano al ripiego AD");
    assert.deepEqual(ordina(nuove.hostConCredenzialeWinrmDb(db)), conAd);
  });
});
