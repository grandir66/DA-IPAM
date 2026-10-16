/**
 * Test resolver credenziali (fase 1b, Task 1). Due stili di setup nello stesso file:
 * - resolveCredentialsForDb: DB in-memory puro (pattern di
 *   src/lib/attribution/__tests__/recompute.test.ts) — nessun contesto tenant richiesto.
 * - recordCredentialFailure/recordCredentialSuccess (db-tenant.ts, usano l'AsyncLocalStorage
 *   `db()`): tenant di test reale via withTenant()+getTenantDb() (pattern di
 *   src/lib/integrations/meshcentral/__tests__/db.test.ts), ripulito in `after()`.
 *
 * Run: node --import tsx --test src/lib/credentials/__tests__/resolve.test.ts
 */
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

process.env.ENCRYPTION_KEY ||= "test-encryption-key-motore";

import { encrypt } from "@/lib/crypto";
import { TENANT_SCHEMA_SQL, TENANT_INDEXES_SQL } from "@/lib/db-tenant-schema";
import { creaCateneVecchie } from "@/lib/__tests__/support/catene-vecchie";
import {
  resolveCredentialsForDb,
  resolveCredentialForDb,
  resolveCredentialsFor,
  resolveCredentialFor,
  portaCredenziale,
  credenzialiApparatoDb,
  scegliSegretoApparatoDb,
  scegliSegretoHostDb,
  communitySnmpDb,
  FONTI_ACQUISIZIONE,
  FONTI_APPARATO,
} from "../resolve";
import {
  withTenant,
  getTenantDb,
  deleteTenantDatabase,
  recordCredentialFailure,
  recordCredentialSuccess,
  getOrderedDetectCredentialIds as catenaDetectTenant,
  getOrderedSshLinuxCredentialIds as catenaSshTenant,
  buildSnmpCommunitiesForNetwork as communityReteTenant,
  buildSnmpCommunitiesForHost as communityHostTenant,
} from "@/lib/db-tenant";
import {
  getOrderedDetectCredentialIds as catenaDetectFacciata,
  getOrderedSshLinuxCredentialIds as catenaSshFacciata,
  buildSnmpCommunitiesForNetwork as communityReteFacciata,
  buildSnmpCommunitiesForHost as communityHostFacciata,
} from "@/lib/db";
import { getSetting as leggiHub, setSetting as scriviHub } from "@/lib/db-hub";
import { riepilogoRipieghi } from "@/lib/db-maintenance/ripieghi";

// ─────────────────────────────────────────────────────────────────────────
// resolveCredentialsForDb / resolveCredentialForDb — DB in-memory puro
// ─────────────────────────────────────────────────────────────────────────

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(TENANT_SCHEMA_SQL);
  db.exec(TENANT_INDEXES_SQL);
  // Un DB di prima della pulizia della 2g (T27): le tabelle vecchie ci sono ancora, e il motore non le legge.
  creaCateneVecchie(db);
  // Colonne aggiunte via ALTER in getTenantDb (non nel CREATE TABLE base): le
  // replichiamo qui come farebbe la migrazione, stesso pattern di recompute.test.ts.
  for (const c of ["fail_count INTEGER NOT NULL DEFAULT 0", "last_error TEXT", "last_attempt_at TEXT", "backoff_until TEXT"]) {
    try { db.exec(`ALTER TABLE host_credentials ADD COLUMN ${c}`); } catch { /* già presente */ }
  }
  try { db.exec("ALTER TABLE network_devices ADD COLUMN host_id INTEGER REFERENCES hosts(id) ON DELETE SET NULL"); } catch { /* già presente */ }
});

function seedNetwork(id: number, cidr: string) {
  db.prepare(`INSERT INTO networks (id, cidr, name) VALUES (?, ?, ?)`).run(id, cidr, `net${id}`);
}

function seedHost(id: number, networkId: number, ip: string) {
  db.prepare(`INSERT INTO hosts (id, network_id, ip) VALUES (?, ?, ?)`).run(id, networkId, ip);
}

function seedDevice(id: number, hostId: number | null, ip: string) {
  db.prepare(
    `INSERT INTO network_devices (id, name, host, device_type, vendor, protocol, host_id) VALUES (?, ?, ?, 'server', 'other', 'snmp_v2', ?)`
  ).run(id, `dev${id}`, ip, hostId);
}

function seedCredential(id: number, type: "ssh" | "snmp" | "api" | "windows" | "linux") {
  db.prepare(`INSERT INTO credentials (id, name, credential_type) VALUES (?, ?, ?)`).run(id, `cred${id}`, type);
}

describe("resolveCredentialsForDb — ordine di precedenza completo", () => {
  it("host validate → binding success → host non validate → binding untested → rete; niente catene vecchie (2g, T26)", () => {
    seedNetwork(1, "10.1.0.0/24");
    seedHost(1, 1, "10.1.0.1");
    seedDevice(1, 1, "10.1.0.1");
    for (const id of [10, 20, 30, 40, 50, 60, 70]) seedCredential(id, "snmp");

    db.prepare(`INSERT INTO host_credentials (host_id, credential_id, protocol_type, port, validated, sort_order) VALUES (1, 10, 'snmp', 161, 1, 0)`).run();
    db.prepare(`INSERT INTO host_credentials (host_id, credential_id, protocol_type, port, validated, sort_order) VALUES (1, 30, 'snmp', 161, 0, 1)`).run();

    db.prepare(`INSERT INTO device_credential_bindings (device_id, credential_id, protocol_type, port, test_status, sort_order) VALUES (1, 20, 'snmp', 161, 'success', 0)`).run();
    db.prepare(`INSERT INTO device_credential_bindings (device_id, credential_id, protocol_type, port, test_status, sort_order) VALUES (1, 40, 'snmp', 161, 'untested', 1)`).run();
    // binding 'failed' non deve mai comparire
    seedCredential(999, "snmp");
    db.prepare(`INSERT INTO device_credential_bindings (device_id, credential_id, protocol_type, port, test_status, sort_order) VALUES (1, 999, 'snmp', 161, 'failed', 2)`).run();

    db.prepare(`INSERT INTO network_credentials (network_id, credential_id, sort_order) VALUES (1, 50, 0)`).run();
    db.prepare(`INSERT INTO network_host_credentials (network_id, credential_id, role, sort_order) VALUES (1, 60, 'snmp', 0)`).run();
    db.prepare(`INSERT INTO host_detect_credential (host_id, role, credential_id) VALUES (1, 'snmp', 70)`).run();

    const result = resolveCredentialsForDb(db, { hostId: 1, networkId: 1 }, "snmp");
    // Pin (70) e catena vecchia (60) non si leggono più dalla 2g, anche senza il segno della 2d.
    assert.deepEqual(result.map((r) => r.credential_id), [10, 20, 30, 40, 50]);
    assert.deepEqual(result.map((r) => r.source), [
      "host_validated", "device_binding", "host_unvalidated", "device_binding", "network_chain",
    ]);
    assert.equal(result[0].validated, true);
    assert.equal(result[2].validated, false);
    assert.ok(!result.some((r) => r.credential_id === 999), "binding failed non deve mai comparire");
  });
});

describe("resolveCredentialsForDb — backoff", () => {
  it("esclude una credenziale con backoff_until futuro, la include con includeBackoff:true", () => {
    seedNetwork(2, "10.2.0.0/24");
    seedHost(2, 2, "10.2.0.1");
    seedCredential(80, "ssh");
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    db.prepare(
      `INSERT INTO host_credentials (host_id, credential_id, protocol_type, port, validated, sort_order, backoff_until) VALUES (2, 80, 'ssh', 22, 1, 0, ?)`
    ).run(future);

    const excluded = resolveCredentialsForDb(db, { hostId: 2, networkId: 2 }, "ssh");
    assert.deepEqual(excluded, []);

    const included = resolveCredentialsForDb(db, { hostId: 2, networkId: 2 }, "ssh", { includeBackoff: true });
    assert.equal(included.length, 1);
    assert.equal(included[0].credential_id, 80);
    assert.equal(included[0].backoff_until, future);
  });

  it("una credenziale con backoff_until passato NON viene esclusa", () => {
    seedNetwork(21, "10.21.0.0/24");
    seedHost(21, 21, "10.21.0.1");
    seedCredential(81, "ssh");
    const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    db.prepare(
      `INSERT INTO host_credentials (host_id, credential_id, protocol_type, port, validated, sort_order, backoff_until) VALUES (21, 81, 'ssh', 22, 1, 0, ?)`
    ).run(past);

    const result = resolveCredentialsForDb(db, { hostId: 21, networkId: 21 }, "ssh");
    assert.equal(result.length, 1);
    assert.equal(result[0].credential_id, 81);
  });
});

describe("resolveCredentialsForDb — ponte host↔device", () => {
  it("hostId dato, deviceId assente: risolve il device via FK e ne usa i binding", () => {
    seedNetwork(3, "10.3.0.0/24");
    seedHost(3, 3, "10.3.0.1");
    seedDevice(3, 3, "10.3.0.1");
    seedCredential(600, "windows");
    db.prepare(`INSERT INTO device_credential_bindings (device_id, credential_id, protocol_type, port, test_status, sort_order) VALUES (3, 600, 'winrm', 5985, 'success', 0)`).run();

    const result = resolveCredentialsForDb(db, { hostId: 3, networkId: 3 }, "winrm");
    assert.deepEqual(result.map((r) => r.credential_id), [600]);
    assert.equal(result[0].source, "device_binding");
  });

  it("deviceId dato, hostId assente: risolve l'host via FK e ne usa host_credentials", () => {
    seedNetwork(4, "10.4.0.0/24");
    seedHost(4, 4, "10.4.0.1");
    seedDevice(4, 4, "10.4.0.1");
    seedCredential(500, "ssh");
    db.prepare(`INSERT INTO host_credentials (host_id, credential_id, protocol_type, port, validated, sort_order) VALUES (4, 500, 'ssh', 22, 1, 0)`).run();

    const result = resolveCredentialsForDb(db, { deviceId: 4, networkId: 4 }, "ssh");
    assert.deepEqual(result.map((r) => r.credential_id), [500]);
    assert.equal(result[0].source, "host_validated");
  });
});

describe("resolveCredentialsForDb / resolveCredentialForDb — nessun risultato", () => {
  it("nessuna sorgente per il protocollo → array vuoto, mai eccezione", () => {
    seedNetwork(5, "10.5.0.0/24");
    seedHost(5, 5, "10.5.0.1");
    assert.deepEqual(resolveCredentialsForDb(db, { hostId: 5, networkId: 5 }, "api"), []);
    assert.equal(resolveCredentialForDb(db, { hostId: 5, networkId: 5 }, "api"), null);
  });

  it("networkId senza rete esistente → array vuoto (non lancia)", () => {
    assert.deepEqual(resolveCredentialsForDb(db, { networkId: 999999 }, "snmp"), []);
  });
});

// Tappa 1 credenziali (15/10): una credenziale con porta propria (SSH sulla
// 2022) veniva proposta dalle catene sulla porta standard, quindi la prova
// falliva sempre e la credenziale sembrava sbagliata.
describe("resolveCredentialsForDb — porta propria della credenziale", () => {
  it("catena di rete v2: la porta della credenziale, senza porta lo standard; le catene vecchie non entrano (2g)", () => {
    seedNetwork(6, "10.6.0.0/24");
    seedHost(6, 6, "10.6.0.1");
    seedCredential(601, "ssh");
    seedCredential(602, "linux");
    seedCredential(603, "ssh");
    seedCredential(604, "linux");
    db.prepare(`UPDATE credentials SET port = 2022 WHERE id IN (601, 602)`).run();
    db.prepare(`INSERT INTO network_credentials (network_id, credential_id, sort_order) VALUES (6, 601, 0)`).run();
    db.prepare(`INSERT INTO network_credentials (network_id, credential_id, sort_order) VALUES (6, 603, 1)`).run();
    db.prepare(`INSERT INTO network_host_credentials (network_id, credential_id, role, sort_order) VALUES (6, 602, 'linux', 0)`).run();
    db.prepare(`INSERT INTO host_detect_credential (host_id, role, credential_id) VALUES (6, 'ssh', 604)`).run();

    const result = resolveCredentialsForDb(db, { hostId: 6, networkId: 6 }, "ssh");
    const porta = new Map(result.map((r) => [r.credential_id, r.port]));
    assert.equal(porta.get(601), 2022, "catena di rete v2");
    assert.equal(porta.get(603), 22, "catena di rete v2 senza porta");
    assert.equal(porta.has(602), false, "catena vecchia per rete: non letta dalla 2g");
    assert.equal(porta.has(604), false, "pin vecchio: non letto dalla 2g");
  });

  it("SNMP su porta fuori standard dalla catena di rete", () => {
    seedNetwork(7, "10.7.0.0/24");
    seedCredential(701, "snmp");
    db.prepare(`UPDATE credentials SET port = 1161 WHERE id = 701`).run();
    db.prepare(`INSERT INTO network_credentials (network_id, credential_id, sort_order) VALUES (7, 701, 0)`).run();
    const [r] = resolveCredentialsForDb(db, { networkId: 7 }, "snmp");
    assert.equal(r.port, 1161);
  });

  it("portaCredenziale: porta propria, altrimenti lo standard del protocollo", () => {
    assert.equal(portaCredenziale({ port: 2022 }, "ssh"), 2022);
    assert.equal(portaCredenziale({ port: null }, "ssh"), 22);
    assert.equal(portaCredenziale({ port: null }, "snmp"), 161);
    assert.equal(portaCredenziale({ port: null }, "winrm"), 5985);
    assert.equal(portaCredenziale({ port: null }, "onvif"), 80);
  });
});

// Tappa 2 (T2, 15/10): il livello 5 usa la regola unica `tipiPerProtocollo`.
// Prima aveva una sua copia che per `api` ammetteva solo voci `api`, mentre le
// tendine (regola della tappa 1) offrivano anche le `ssh` (Proxmox con root).
describe("resolveCredentialsForDb — livello 5 con la regola unica tipo ↔ protocollo", () => {
  it("livello 5 per API: propone anche una voce SSH della catena di rete", () => {
    seedNetwork(8, "10.8.0.0/24");
    seedCredential(801, "api");
    seedCredential(802, "ssh");
    seedCredential(803, "windows");
    db.prepare(`INSERT INTO network_credentials (network_id, credential_id, sort_order) VALUES (8, 801, 0)`).run();
    db.prepare(`INSERT INTO network_credentials (network_id, credential_id, sort_order) VALUES (8, 802, 1)`).run();
    db.prepare(`INSERT INTO network_credentials (network_id, credential_id, sort_order) VALUES (8, 803, 2)`).run();
    const result = resolveCredentialsForDb(db, { networkId: 8 }, "api");
    assert.deepEqual(result.map((r) => r.credential_id), [801, 802]);
    assert.ok(result.every((r) => r.source === "network_chain" && r.protocol === "api"));
  });

  it("livello 5 per Redfish e ONVIF: solo voci API, mai SSH", () => {
    seedNetwork(9, "10.9.0.0/24");
    seedCredential(901, "api");
    seedCredential(902, "ssh");
    db.prepare(`INSERT INTO network_credentials (network_id, credential_id, sort_order) VALUES (9, 901, 0)`).run();
    db.prepare(`INSERT INTO network_credentials (network_id, credential_id, sort_order) VALUES (9, 902, 1)`).run();
    assert.deepEqual(resolveCredentialsForDb(db, { networkId: 9 }, "redfish").map((r) => r.credential_id), [901]);
    assert.deepEqual(resolveCredentialsForDb(db, { networkId: 9 }, "onvif").map((r) => r.credential_id), [901]);
  });

  // Revisione della 2a: la voce SSH ammessa per API portava la sua porta (22,
  // 2222), cioè un candidato API sulla porta SSH. La porta propria vale solo per
  // il protocollo della voce; per un altro protocollo vale lo standard di quello.
  it("livello 5 per API: la voce SSH (porta 2222) è candidata sulla porta API standard, non sulla sua", () => {
    seedNetwork(10, "10.10.0.0/24");
    seedCredential(1001, "ssh");
    seedCredential(1002, "api");
    seedCredential(1003, "linux");
    db.prepare(`UPDATE credentials SET port = 2222 WHERE id = 1001`).run();
    db.prepare(`UPDATE credentials SET port = 8006 WHERE id = 1002`).run();
    db.prepare(`UPDATE credentials SET port = 22 WHERE id = 1003`).run();
    for (const [i, c] of [1001, 1002, 1003].entries()) {
      db.prepare(`INSERT INTO network_credentials (network_id, credential_id, sort_order) VALUES (10, ?, ?)`).run(c, i);
    }
    const api = resolveCredentialsForDb(db, { networkId: 10 }, "api");
    // La voce `linux` (1003) per API non c'è: la tabella del piano ammette `ssh`, e dalla 2c `linux` non esiste più.
    assert.deepEqual(api.map((r) => [r.credential_id, r.port]), [[1001, 443], [1002, 8006]]);
    // Per SSH la stessa voce tiene la sua porta.
    const ssh = resolveCredentialsForDb(db, { networkId: 10 }, "ssh");
    assert.deepEqual(ssh.map((r) => [r.credential_id, r.port]), [[1001, 2222], [1003, 22]]);
  });
});

describe("resolveCredentialsFor / resolveCredentialFor — wrapper pubblico mai lancia", () => {
  it("senza contesto tenant attivo ritorna [] / null", () => {
    assert.deepEqual(resolveCredentialsFor({ networkId: 1 }, "ssh"), []);
    assert.equal(resolveCredentialFor({ networkId: 1 }, "ssh"), null);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Tappa 2 credenziali, T7 (16/10): il motore allargato. Prima l'acquisizione
// degli apparati sceglieva fuori dal motore: il primo binding in ordine anche
// se fallito, poi le colonne di network_devices senza guardare il tipo (una
// voce `windows` diventava il login SSH di un apparato snmp_v2), e «public» in
// silenzio. Le fonti vecchie restano, ma dichiarate (`source`) e registrate.
// ─────────────────────────────────────────────────────────────────────────

const FUTURO = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();

interface CampiVoce { utente?: string; password?: string; port?: number; livello?: string; authKey?: string }

function voce(id: number, tipo: "ssh" | "snmp" | "api" | "windows" | "linux", c: CampiVoce = {}) {
  db.prepare(
    `INSERT INTO credentials (id, name, credential_type, encrypted_username, encrypted_password, port, security_level, encrypted_auth_key, auth_protocol)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    `voce${id}`,
    tipo,
    c.utente != null ? encrypt(c.utente) : null,
    c.password != null ? encrypt(c.password) : null,
    c.port ?? null,
    c.livello ?? null,
    c.authKey != null ? encrypt(c.authKey) : null,
    c.authKey != null ? "SHA" : null
  );
}

interface CampiApparato {
  port?: number;
  credential_id?: number;
  snmp_credential_id?: number;
  username?: string;
  password?: string;
  community?: string;
}

function apparato(id: number, hostId: number | null, protocol: "ssh" | "snmp_v2" | "snmp_v3" | "api" | "winrm", c: CampiApparato = {}) {
  db.prepare(
    `INSERT INTO network_devices (id, name, host, device_type, vendor, protocol, host_id, port, credential_id, snmp_credential_id, username, encrypted_password, community_string)
     VALUES (?, ?, ?, 'server', 'other', ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    `apparato${id}`,
    `10.200.0.${id}`,
    protocol,
    hostId,
    c.port ?? 22,
    c.credential_id ?? null,
    c.snmp_credential_id ?? null,
    c.username ?? null,
    c.password != null ? encrypt(c.password) : null,
    c.community != null ? encrypt(c.community) : null
  );
}

function binding(
  deviceId: number,
  protocollo: string,
  port: number,
  stato: "success" | "failed" | "untested",
  voceOInline: number | { utente: string; password: string },
  ordine = 0
): number {
  const inline = typeof voceOInline === "number" ? null : voceOInline;
  const r = db
    .prepare(
      `INSERT INTO device_credential_bindings (device_id, credential_id, protocol_type, port, test_status, sort_order, inline_username, inline_encrypted_password)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      deviceId,
      typeof voceOInline === "number" ? voceOInline : null,
      protocollo,
      port,
      stato,
      ordine,
      inline?.utente ?? null,
      inline ? encrypt(inline.password) : null
    );
  return Number(r.lastInsertRowid);
}

function rigaHost(hostId: number, credId: number, protocollo: string, port: number, validata: boolean, backoff: string | null = null) {
  db.prepare(
    `INSERT INTO host_credentials (host_id, credential_id, protocol_type, port, validated, sort_order, backoff_until) VALUES (?, ?, ?, ?, ?, 0, ?)`
  ).run(hostId, credId, protocollo, port, validata ? 1 : 0, backoff);
}

function contaCaso(caso: string): number {
  return (riepilogoRipieghi(500).per_caso as Record<string, number | undefined>)[caso] ?? 0;
}

describe("motore per un apparato — ordine D1 e fonti dichiarate", () => {
  it("binding riusciti, non provati, host validate, host non validate, rete; niente inline, colonne, catene vecchie né chiave dell'hub (2g)", () => {
    seedNetwork(30, "10.30.0.0/24");
    seedHost(30, 30, "10.30.0.1");
    for (let id = 3001; id <= 3010; id++) voce(id, "ssh", { utente: `u${id}`, password: `p${id}` });
    apparato(30, 30, "ssh", { credential_id: 3004, username: "root", password: "colonna" });
    binding(30, "ssh", 22, "untested", 3002, 0);
    binding(30, "ssh", 22, "success", 3001, 1);
    binding(30, "ssh", 22, "failed", 3010, 2);
    binding(30, "ssh", 22, "untested", { utente: "admin", password: "inline" }, 3);
    rigaHost(30, 3006, "ssh", 22, true);
    rigaHost(30, 3007, "ssh", 22, false);
    db.prepare(`INSERT INTO network_credentials (network_id, credential_id, sort_order) VALUES (30, 3008, 0)`).run();
    db.prepare(`INSERT INTO network_host_credentials (network_id, credential_id, role, sort_order) VALUES (30, 3009, 'linux', 0)`).run();

    const r = credenzialiApparatoDb(db, 30, "ssh");
    assert.deepEqual(
      r.map((c) => [c.source, c.credential_id]),
      [
        ["device_binding", 3001],
        ["device_binding", 3002],
        ["host_validated", 3006],
        ["host_unvalidated", 3007],
        ["network_chain", 3008],
      ]
    );
    assert.ok(!r.some((c) => c.credential_id === 3010), "il binding fallito è saltato (D10)");
    assert.ok(r.every((c) => c.device_id === 30 && c.protocol === "ssh"));
    assert.equal(r[0].validated, true, "binding riuscito = validato");
    assert.equal(r[1].validated, false);
    assert.equal(r[0].tipo, "ssh");
  });

  it("primo binding fallito e secondo riuscito → il secondo", () => {
    apparato(31, null, "winrm", { port: 5985 });
    voce(3101, "windows", { utente: "primo", password: "uno" });
    voce(3102, "windows", { utente: "secondo", password: "due" });
    binding(31, "winrm", 5985, "failed", 3101, 0);
    binding(31, "winrm", 5985, "success", 3102, 1);
    const s = scegliSegretoApparatoDb(db, 31, "winrm", { registra: false });
    assert.ok(s.ok, s.ok ? "" : s.motivo);
    assert.equal(s.candidato.credential_id, 3102);
    assert.equal(s.candidato.source, "device_binding");
    assert.equal(s.candidato.port, 5985);
    assert.deepEqual(s.segreto, { forma: "utente", username: "secondo", password: "due" });
  });

  it("binding non provato contro una validata sull'host → il binding (D1); per l'host l'ordine resta quello di oggi", () => {
    seedNetwork(32, "10.32.0.0/24");
    seedHost(32, 32, "10.32.0.1");
    apparato(32, 32, "ssh");
    voce(3201, "ssh", { utente: "host", password: "h" });
    voce(3202, "ssh", { utente: "binding", password: "b" });
    rigaHost(32, 3201, "ssh", 22, true);
    binding(32, "ssh", 22, "untested", 3202);
    const r = credenzialiApparatoDb(db, 32, "ssh");
    assert.deepEqual(r.map((c) => [c.source, c.credential_id]), [["device_binding", 3202], ["host_validated", 3201]]);
    const perHost = resolveCredentialsForDb(db, { hostId: 32, networkId: 32 }, "ssh");
    assert.deepEqual(perHost.map((c) => [c.source, c.credential_id]), [["host_validated", 3201], ["device_binding", 3202]]);
  });

  it("binding inline → non si legge più (2g): nessuna credenziale, col motivo", () => {
    apparato(33, null, "ssh");
    binding(33, "ssh", 22, "untested", { utente: "admin", password: "segreto" });
    const s = scegliSegretoApparatoDb(db, 33, "ssh", { registra: false });
    assert.equal(s.ok, false);
    assert.match(s.ok ? "" : s.motivo, /Nessuna credenziale SSH per l'apparato «apparato33»/);
  });

  it("apparato snmp_v2 con porta 22 e un binding SNMP sulla 161 → candidato sulla 161, mai su device.port (F3); la sola colonna non conta (2g)", () => {
    voce(3401, "snmp", { password: "comunita" });
    apparato(34, null, "snmp_v2", { port: 22, credential_id: 3401 });
    assert.deepEqual(credenzialiApparatoDb(db, 34, "snmp").map((c) => c.source), ["snmp_ripiego"], "la colonna non si legge più");
    binding(34, "snmp", 161, "untested", 3401);
    const [c] = credenzialiApparatoDb(db, 34, "snmp");
    assert.equal(c.source, "device_binding");
    assert.equal(c.credential_id, 3401);
    assert.equal(c.port, 161);
  });

  it("voce windows nella colonna di un apparato snmp_v2 → non proposta per SSH (F2)", () => {
    voce(3501, "windows", { utente: "dominio", password: "x" });
    apparato(35, null, "snmp_v2", { credential_id: 3501 });
    assert.deepEqual(credenzialiApparatoDb(db, 35, "ssh"), []);
    const s = scegliSegretoApparatoDb(db, 35, "ssh", { registra: false });
    assert.equal(s.ok, false);
    assert.match(s.ok ? "" : s.motivo, /apparato35/);
  });

  it("API con un binding verso una voce SSH → ammessa, sulla porta dell'apparato (F1, D11)", () => {
    voce(3601, "ssh", { utente: "root", password: "pve", port: 22 });
    apparato(36, null, "api", { port: 8006 });
    binding(36, "api", 443, "untested", 3601);
    const s = scegliSegretoApparatoDb(db, 36, "api", { registra: false });
    assert.ok(s.ok, s.ok ? "" : s.motivo);
    assert.equal(s.candidato.source, "device_binding");
    assert.equal(s.candidato.credential_id, 3601);
    assert.equal(s.candidato.port, 8006);
    assert.equal(s.candidato.tipo, "ssh");
    assert.deepEqual(s.segreto, { forma: "utente", username: "root", password: "pve" });
  });

  it("con FONTI_ACQUISIZIONE un apparato API senza binding né colonne, in una rete con una voce SSH in catena → nessun candidato", () => {
    seedNetwork(40, "10.40.0.0/24");
    seedHost(40, 40, "10.40.0.1");
    apparato(40, 40, "api");
    voce(4001, "ssh", { utente: "root", password: "x" });
    db.prepare(`INSERT INTO network_credentials (network_id, credential_id, sort_order) VALUES (40, 4001, 0)`).run();
    assert.deepEqual(credenzialiApparatoDb(db, 40, "api", { fonti: FONTI_ACQUISIZIONE }), []);
    assert.equal(scegliSegretoApparatoDb(db, 40, "api", { fonti: FONTI_ACQUISIZIONE, registra: false }).ok, false);
    // Senza limite di fonti la catena della rete c'è (livello 8).
    assert.deepEqual(credenzialiApparatoDb(db, 40, "api").map((c) => [c.source, c.credential_id]), [["network_chain", 4001]]);
  });

  it("apparato SNMP senza fonti proprie, con una voce SNMP nella catena della rete → con FONTI_ACQUISIZIONE «public», non la catena", () => {
    seedNetwork(41, "10.41.0.0/24");
    seedHost(41, 41, "10.41.0.1");
    apparato(41, 41, "snmp_v2");
    voce(4101, "snmp", { password: "catena" });
    db.prepare(`INSERT INTO network_credentials (network_id, credential_id, sort_order) VALUES (41, 4101, 0)`).run();
    const s = scegliSegretoApparatoDb(db, 41, "snmp", { fonti: FONTI_ACQUISIZIONE, registra: false });
    assert.ok(s.ok, s.ok ? "" : s.motivo);
    assert.equal(s.candidato.source, "snmp_ripiego");
    assert.deepEqual(s.segreto, { forma: "community", community: "public" });
    assert.equal(s.candidato.port, 161);
  });

  it("apparato senza host_id → nessun livello di host, di rete o dell'hub, nessun errore", () => {
    seedNetwork(42, "10.42.0.0/24");
    voce(4201, "ssh", { utente: "u", password: "p" });
    db.prepare(`INSERT INTO network_credentials (network_id, credential_id, sort_order) VALUES (42, 4201, 0)`).run();
    apparato(42, null, "ssh");
    assert.deepEqual(credenzialiApparatoDb(db, 42, "ssh"), []);
    const snmp = credenzialiApparatoDb(db, 42, "snmp");
    assert.deepEqual(snmp.map((c) => c.source), ["snmp_ripiego"]);
  });

  it("apparato inesistente → nessun candidato e un motivo, mai un'eccezione", () => {
    assert.deepEqual(credenzialiApparatoDb(db, 987654, "ssh"), []);
    const s = scegliSegretoApparatoDb(db, 987654, "ssh", { registra: false });
    assert.equal(s.ok, false);
    assert.match(s.ok ? "" : s.motivo, /987654/);
  });

  it("FONTI_APPARATO sono i binding d'archivio (2g), FONTI_ACQUISIZIONE in più il solo ripiego SNMP", () => {
    assert.deepEqual([...FONTI_APPARATO], ["device_binding"]);
    assert.deepEqual([...FONTI_ACQUISIZIONE], [...FONTI_APPARATO, "snmp_ripiego"]);
  });

  it("un apparato con una voce SNMPv3 non riceve «public» (D5)", () => {
    voce(4301, "snmp", { utente: "monitor", livello: "authNoPriv", authKey: "chiave-auth" });
    apparato(43, null, "snmp_v3");
    binding(43, "snmp", 161, "untested", 4301);
    const r = credenzialiApparatoDb(db, 43, "snmp", { fonti: FONTI_ACQUISIZIONE });
    assert.deepEqual(r.map((c) => c.source), ["device_binding"]);
  });
});

describe("motore — filtro di tipo su ogni livello e ripiego AD", () => {
  it("righe host e catene vecchie con una voce del tipo sbagliato → saltate", () => {
    seedNetwork(45, "10.45.0.0/24");
    seedHost(45, 45, "10.45.0.1");
    voce(4501, "windows", { utente: "w", password: "w" });
    rigaHost(45, 4501, "ssh", 22, true);
    db.prepare(`INSERT INTO network_host_credentials (network_id, credential_id, role, sort_order) VALUES (45, 4501, 'ssh', 0)`).run();
    db.prepare(`INSERT INTO host_detect_credential (host_id, role, credential_id) VALUES (45, 'linux', 4501)`).run();
    assert.deepEqual(resolveCredentialsForDb(db, { hostId: 45, networkId: 45 }, "ssh"), []);
  });

  // La chiave «di default» dell'hub non si accoda più dalla 2g (T26): il motore
  // non ha più l'opzione `globaliHub`. La copia nelle liste la fa la 2d
  // (converti-catene.test.ts), e via-il-vecchio.test.ts prova che il motore
  // non legge più le fonti vecchie.

  it("ripiego AD solo per WinRM, solo con l'opzione, ultimo, e mai con la sua riga in fermo sull'host (D4)", () => {
    seedNetwork(37, "10.37.0.0/24");
    seedHost(37, 37, "10.37.0.1");
    voce(3701, "windows", { utente: "DOM\\patch", password: "ad" });
    voce(3702, "windows", { utente: "locale", password: "l" });
    db.prepare(
      `INSERT INTO ad_integrations (name, dc_host, domain, base_dn, encrypted_username, encrypted_password, enabled, winrm_credential_id)
       VALUES ('AD', 'dc.dom.local', 'dom.local', 'DC=dom,DC=local', 'x', 'x', 1, 3701)`
    ).run();
    rigaHost(37, 3702, "winrm", 5985, false, FUTURO());
    const t = { hostId: 37, networkId: 37 };

    assert.deepEqual(resolveCredentialsForDb(db, t, "winrm"), [], "senza opzione niente AD (e la riga host è in fermo)");
    assert.deepEqual(resolveCredentialsForDb(db, t, "ssh", { conAdFallback: true }), [], "solo WinRM");
    const conAd = resolveCredentialsForDb(db, t, "winrm", { conAdFallback: true });
    assert.deepEqual(conAd.map((c) => [c.source, c.credential_id, c.port]), [["ad_fallback", 3701, 5985]]);

    const s = scegliSegretoHostDb(db, t, "winrm", { conAdFallback: true, registra: false });
    assert.ok(s.ok, s.ok ? "" : s.motivo);
    assert.equal(s.candidato.source, "ad_fallback");
    assert.deepEqual(s.segreto, { forma: "utente", username: "DOM\\patch", password: "ad" });

    rigaHost(37, 3701, "winrm", 5985, false, FUTURO());
    assert.deepEqual(resolveCredentialsForDb(db, t, "winrm", { conAdFallback: true }), [], "AD in fermo sull'host");
    const no = scegliSegretoHostDb(db, t, "winrm", { conAdFallback: true, registra: false });
    assert.equal(no.ok, false);
  });

  it("fonti: limita i livelli (le patch non leggono la catena della rete)", () => {
    seedNetwork(46, "10.46.0.0/24");
    seedHost(46, 46, "10.46.0.1");
    voce(4601, "windows", { utente: "h", password: "h" });
    voce(4602, "windows", { utente: "n", password: "n" });
    rigaHost(46, 4601, "winrm", 5985, false);
    db.prepare(`INSERT INTO network_credentials (network_id, credential_id, sort_order) VALUES (46, 4602, 0)`).run();
    const r = resolveCredentialsForDb(db, { hostId: 46, networkId: 46 }, "winrm", { fonti: ["host_validated", "host_unvalidated", "ad_fallback"] });
    assert.deepEqual(r.map((c) => c.credential_id), [4601]);
  });
});

describe("motore — community SNMP e registro dei ripieghi", () => {
  it("communitySnmpDb: voci della catena, poi override, community della rete, public e private come snmp_ripiego", () => {
    seedNetwork(39, "10.39.0.0/24");
    db.prepare(`UPDATE networks SET snmp_community = 'dellarete' WHERE id = 39`).run();
    voce(3901, "snmp", { password: "catena" });
    voce(3902, "snmp", { utente: "v3", livello: "authNoPriv", authKey: "k" });
    db.prepare(`INSERT INTO network_credentials (network_id, credential_id, sort_order) VALUES (39, 3901, 0)`).run();
    db.prepare(`INSERT INTO network_credentials (network_id, credential_id, sort_order) VALUES (39, 3902, 1)`).run();
    const c = communitySnmpDb(db, { networkId: 39 }, "prof1, catena ,prof2", { registra: false });
    assert.deepEqual(c, [
      { community: "catena", fonte: "network_chain" },
      { community: "prof1", fonte: "snmp_ripiego" },
      { community: "prof2", fonte: "snmp_ripiego" },
      { community: "dellarete", fonte: "snmp_ripiego" },
      { community: "public", fonte: "snmp_ripiego" },
      { community: "private", fonte: "snmp_ripiego" },
    ]);
  });

  it("«public» scelto per un apparato: fonte snmp_ripiego e registrato come cred_public, con la firma di chi chiama (D5)", () => {
    apparato(38, null, "snmp_v2");
    const prima = contaCaso("cred_public");
    const s = scegliSegretoApparatoDb(db, 38, "snmp", { fonti: FONTI_ACQUISIZIONE });
    assert.ok(s.ok, s.ok ? "" : s.motivo);
    assert.equal(s.candidato.source, "snmp_ripiego");
    assert.deepEqual(s.segreto, { forma: "community", community: "public" });
    assert.equal(contaCaso("cred_public"), prima + 1);
    const chi = riepilogoRipieghi(500).chiamanti.find((c) => (c.caso as string) === "cred_public");
    assert.ok(chi, "il chiamante è nel registro");
    assert.match(chi.firma, /resolve\.test\.ts/, "la firma è di chi chiama il motore, non del motore");
  });

  it("community nella colonna: non si legge più (2g), resta il «public» dichiarato; cred_colonna_apparato non scatta più; registra:false non scrive", () => {
    apparato(47, null, "snmp_v2", { community: "dellacolonna" });
    const totale = riepilogoRipieghi(500).totale;
    const muto = scegliSegretoApparatoDb(db, 47, "snmp", { registra: false });
    assert.ok(muto.ok, muto.ok ? "" : muto.motivo);
    assert.equal(muto.candidato.source, "snmp_ripiego");
    assert.deepEqual(muto.segreto, { forma: "community", community: "public" });
    assert.equal(riepilogoRipieghi(500).totale, totale, "registra:false non scrive");
    assert.equal(communitySnmpDb(db, { networkId: 47 }, null, { registra: false }).length, 2);
    assert.equal(riepilogoRipieghi(500).totale, totale, "registra:false non scrive nemmeno per le community");

    const colonna = contaCaso("cred_colonna_apparato");
    const pub = contaCaso("cred_public");
    scegliSegretoApparatoDb(db, 47, "snmp");
    assert.equal(contaCaso("cred_colonna_apparato"), colonna);
    assert.equal(contaCaso("cred_public"), pub + 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// recordCredentialFailure / recordCredentialSuccess (db-tenant.ts) — tenant reale di test
// ─────────────────────────────────────────────────────────────────────────

const T = "TESTCREDRESOLVE";

function readHostCred(hostId: number, credentialId: number, protocol: string, port: number) {
  return getTenantDb(T)
    .prepare(
      `SELECT * FROM host_credentials WHERE host_id = ? AND credential_id = ? AND protocol_type = ? AND port = ?`
    )
    .get(hostId, credentialId, protocol, port) as
    | { validated: number; validated_at: string | null; fail_count: number; last_error: string | null; last_attempt_at: string | null; backoff_until: string | null }
    | undefined;
}

describe("recordCredentialFailure / recordCredentialSuccess", () => {
  before(() => {
    withTenant(T, () => {
      const d = getTenantDb(T);
      d.prepare(`INSERT OR IGNORE INTO networks (id, cidr, name) VALUES (1, '10.9.0.0/24', 'n')`).run();
      d.prepare(`INSERT OR IGNORE INTO hosts (id, network_id, ip) VALUES (1, 1, '10.9.0.1')`).run();
      d.prepare(`INSERT OR IGNORE INTO credentials (id, name, credential_type) VALUES (1, 'c1', 'ssh')`).run();
      d.prepare(`INSERT OR IGNORE INTO network_devices (id, name, host, device_type, vendor, protocol, host_id) VALUES (1, 'dev1', '10.9.0.1', 'server', 'other', 'ssh', 1)`).run();
      d.prepare(
        `INSERT OR IGNORE INTO device_credential_bindings (device_id, credential_id, protocol_type, port, test_status, sort_order) VALUES (1, 1, 'ssh', 22, 'untested', 0)`
      ).run();
    });
  });
  after(() => deleteTenantDatabase(T));

  it("registra un fallimento su una riga inesistente: upsert, mai eccezione, fail_count=1 e backoff coerente", () => {
    withTenant(T, () => {
      recordCredentialFailure(1, 1, "ssh", 22, "auth fallita: password errata");
    });
    const row = readHostCred(1, 1, "ssh", 22)!;
    assert.equal(row.fail_count, 1);
    assert.equal(row.last_error, "auth fallita: password errata");
    assert.equal(row.validated, 0);
    assert.ok(row.last_attempt_at?.includes("T"), "last_attempt_at deve essere ISO-8601");
    assert.ok(row.backoff_until?.includes("T"), "backoff_until deve essere ISO-8601");
    const expectedMs = Math.min(2 ** 1 * 5 * 60 * 1000, 24 * 60 * 60 * 1000);
    const deltaMs = new Date(row.backoff_until!).getTime() - new Date(row.last_attempt_at!).getTime();
    assert.ok(Math.abs(deltaMs - expectedMs) < 2000, `backoff atteso ~${expectedMs}ms, trovato ${deltaMs}ms`);

    const binding = getTenantDb(T).prepare(`SELECT test_status, test_message FROM device_credential_bindings WHERE device_id = 1 AND credential_id = 1`).get() as { test_status: string; test_message: string | null };
    assert.equal(binding.test_status, "failed");
    assert.equal(binding.test_message, "auth fallita: password errata");
  });

  it("un secondo fallimento incrementa fail_count e allunga il backoff, e invalida validated se era 1", () => {
    withTenant(T, () => {
      // porta la riga a validated=1 come se fosse stata validata in precedenza
      getTenantDb(T).prepare(`UPDATE host_credentials SET validated = 1, validated_at = datetime('now') WHERE host_id=1 AND credential_id=1 AND protocol_type='ssh' AND port=22`).run();
      recordCredentialFailure(1, 1, "ssh", 22, "auth fallita di nuovo");
    });
    const row = readHostCred(1, 1, "ssh", 22)!;
    assert.equal(row.fail_count, 2);
    assert.equal(row.validated, 0, "validated deve essere invalidato al fallimento");
    assert.equal(row.validated_at, null);
  });

  it("recordCredentialSuccess azzera fail_count/last_error/backoff e marca validated=1, propaga al binding", () => {
    withTenant(T, () => {
      recordCredentialSuccess(1, 1, "ssh", 22);
    });
    const row = readHostCred(1, 1, "ssh", 22)!;
    assert.equal(row.fail_count, 0);
    assert.equal(row.last_error, null);
    assert.equal(row.backoff_until, null);
    assert.equal(row.validated, 1);
    assert.ok(row.validated_at, "validated_at deve essere valorizzato");

    const binding = getTenantDb(T).prepare(`SELECT test_status FROM device_credential_bindings WHERE device_id = 1 AND credential_id = 1`).get() as { test_status: string };
    assert.equal(binding.test_status, "success");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Gemelle (regola 12): catene e community di db-tenant.ts e db.ts sono
// involucri dello stesso motore. Prima la chiave globale dell'hub si accodava
// senza controllo (id di un altro tenant, o di una voce che non c'è) e le
// catene vecchie non guardavano il tipo della voce.
// ─────────────────────────────────────────────────────────────────────────

const TG = "TESTCREDMOTOREGEMELLE";

describe("involucri del motore in db-tenant.ts e db.ts", () => {
  let windowsPrima: string | null = null;
  let linuxPrima: string | null = null;
  before(() => {
    windowsPrima = leggiHub("host_windows_credential_id");
    linuxPrima = leggiHub("host_linux_credential_id");
    scriviHub("host_windows_credential_id", "999999");
    scriviHub("host_linux_credential_id", "3");
    withTenant(TG, () => {
      const d = getTenantDb(TG);
      creaCateneVecchie(d);
      d.prepare(`INSERT INTO networks (id, cidr, name, snmp_community) VALUES (1, '10.77.0.0/24', 'g', 'dellarete')`).run();
      d.prepare(`INSERT INTO hosts (id, network_id, ip) VALUES (1, 1, '10.77.0.1')`).run();
      const ins = d.prepare(`INSERT INTO credentials (id, name, credential_type, encrypted_username, encrypted_password) VALUES (?, ?, ?, ?, ?)`);
      ins.run(1, "win", "windows", encrypt("w"), encrypt("w"));
      ins.run(2, "ssh", "ssh", encrypt("s"), encrypt("s"));
      ins.run(3, "snmp", "snmp", null, encrypt("catena"));
      for (const [i, id] of [1, 2, 3].entries()) {
        d.prepare(`INSERT INTO network_credentials (network_id, credential_id, sort_order) VALUES (1, ?, ?)`).run(id, i);
      }
      // Catena vecchia del ruolo windows che punta a una voce SSH: oggi entra nella catena WinRM.
      d.prepare(`INSERT INTO network_host_credentials (network_id, credential_id, role, sort_order) VALUES (1, 2, 'windows', 0)`).run();
    });
  });
  after(() => {
    scriviHub("host_windows_credential_id", windowsPrima ?? "");
    scriviHub("host_linux_credential_id", linuxPrima ?? "");
    deleteTenantDatabase(TG);
  });

  it("stesse catene e community dalle due gemelle, col filtro di tipo su catene vecchie e chiavi dell'hub", () => {
    withTenant(TG, () => {
      for (const [nome, detect, ssh, rete, host] of [
        ["db-tenant", catenaDetectTenant, catenaSshTenant, communityReteTenant, communityHostTenant],
        ["db", catenaDetectFacciata, catenaSshFacciata, communityReteFacciata, communityHostFacciata],
      ] as const) {
        assert.deepEqual(detect(1, "windows"), [1], `${nome}: WinRM senza la voce SSH della catena vecchia né la chiave dell'hub che non esiste`);
        assert.deepEqual(ssh(1), [2], `${nome}: SSH senza la voce SNMP indicata dalla chiave dell'hub`);
        assert.deepEqual(detect(1, "linux"), [2], `${nome}: ruolo linux`);
        assert.deepEqual(rete(1, "extra"), ["catena", "extra", "dellarete", "public", "private"], `${nome}: community della rete`);
        assert.deepEqual(host(1, 1, null), ["catena", "dellarete", "public", "private"], `${nome}: community dell'host`);
      }
    });
  });
});
