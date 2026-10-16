/**
 * Via le letture del vecchio (tappa 2g credenziali, T26 del piano
 * `plans/2026-10-15-tappa2-archivio-credenziali.md`, D9 rivista da Riccardo il
 * 16/10: niente attesa di 14 giorni).
 *
 * Perché: dalla 2e e dalla 2f le credenziali stanno nell'archivio (binding
 * d'archivio, lista della rete, voce di controller e AD), ma il motore e i
 * lettori leggevano ancora, come ripiego, i posti vecchi: binding inline,
 * colonne di `network_devices`, catene vecchie e pin, chiavi «di default»
 * dell'hub, colonne di controller e AD. Finché li leggono, la pulizia della 2g
 * (T27) non si può fare senza cambiare in silenzio la credenziale di qualcuno.
 * Rischi coperti:
 *   1. il motore non ha più quelle fonti, per apparati, host e reti, anche
 *      senza il segno della 2d (un tenant mai convertito non le riprende);
 *   2. la conversione della 2e, che gira ancora su dati vecchi (bundle di
 *      prima, appliance che arrivano da prima della 2e), ricostruisce lei la
 *      scelta di prima: senza, ogni apparato con le sole colonne finirebbe fra
 *      i lasciati e perderebbe l'accesso; il caso dei due apparati di H1
 *      accettati da Riccardo (binding fallito verso la voce della colonna)
 *      resta un lasciato e la scelta diventa «nessuna», voluto;
 *   3. l'apparato provvisorio della prova dalla finestra porta la voce scelta,
 *      non più le colonne;
 *   4. controller e AD senza voce dicono «Credenziale mancante», qualunque
 *      sia il segno: le colonne della riga non si leggono più;
 *   5. gli usi di una voce (D8) non contano colonne e catene vecchie;
 *   6. `resetConfiguration` (le due gemelle) riesce su un DB senza le due
 *      tabelle vecchie, e su uno che le ha le svuota con la cascata;
 *   7. un bundle di prima della 2d si importa in un DB senza le tabelle
 *      vecchie e la lista della rete le contiene; l'export non le porta più.
 *
 * Run: DA_INVENT_DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ipam.XXXXXX")" node --import tsx --test src/lib/credentials/__tests__/via-il-vecchio.test.ts
 */
import { TEST_DATA_DIR } from "@/lib/__tests__/support/data-dir-isolata";
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import Database from "better-sqlite3";

import { encrypt } from "@/lib/crypto";
import { TENANT_SCHEMA_SQL, TENANT_INDEXES_SQL } from "@/lib/db-tenant-schema";
import { HUB_SCHEMA_SQL } from "@/lib/db-hub-schema";
import { closeTenantDb, deleteTenantDatabase, getTenantDb, resetConfiguration as resetTenant, withTenant } from "@/lib/db-tenant";
import { getDb, resetConfiguration as resetFacciata } from "@/lib/db";
import { closeHubDb } from "@/lib/db-hub";
import {
  credenzialeSnmpApparatoDb,
  credenzialiApparatoDb,
  haSnmpApparatoDb,
  resolveCredentialsForDb,
  sceltaLoginApparatoDb,
  tokenApiApparatoDb,
} from "@/lib/credentials/resolve";
import { convertiCateneVecchie, segnoCatene } from "@/lib/credentials/converti-catene";
import { convertiCredenzialiApparati } from "@/lib/credentials/converti-apparati";
import { SEGNO_CATENE, SEGNO_INTEGRAZIONI, scriviSegno } from "@/lib/credentials/segni-t2";
import { totaleUsi, usiCredenzialeDb, usiTotaliDb } from "@/lib/credentials/usi";
import { CREDENZIALE_MANCANTE, credenzialeControllerDb, statoCredenzialeController } from "@/lib/controllers/credenziale";
import { credenzialeLdapDb, statoAccountLdap } from "@/lib/ad/credenziale-ldap";
import { exportTenant } from "@/lib/transfer/export";
import { importTenant } from "@/lib/transfer/import";
import { deriveTransportKey, encryptBuffer, randomSalt, writeContainer } from "@/lib/transfer/envelope";
import { BUNDLE_FORMAT, BUNDLE_FORMAT_VERSION } from "@/lib/transfer/types";
import type { NetworkControllerRow } from "@/lib/controllers/types";

void TEST_DATA_DIR;

// ── Appoggio ────────────────────────────────────────────────────────────────

function nuovoDb(): Database.Database {
  const d = new Database(":memory:");
  d.pragma("foreign_keys = ON");
  d.exec(TENANT_SCHEMA_SQL);
  d.exec(TENANT_INDEXES_SQL);
  for (const c of ["fail_count INTEGER NOT NULL DEFAULT 0", "last_error TEXT", "last_attempt_at TEXT", "backoff_until TEXT"]) {
    try { d.exec(`ALTER TABLE host_credentials ADD COLUMN ${c}`); } catch { /* già presente */ }
  }
  try { d.exec("ALTER TABLE network_devices ADD COLUMN host_id INTEGER REFERENCES hosts(id) ON DELETE SET NULL"); } catch { /* già presente */ }
  return d;
}

function voce(d: Database.Database, nome: string, tipo: string, o: { utente?: string; segreto?: string; metodo?: string } = {}): number {
  return Number(
    d
      .prepare("INSERT INTO credentials (name, credential_type, auth_method, encrypted_username, encrypted_password) VALUES (?, ?, ?, ?, ?)")
      .run(nome, tipo, o.metodo ?? null, o.utente != null ? encrypt(o.utente) : null, o.segreto != null ? encrypt(o.segreto) : null).lastInsertRowid
  );
}

let indirizzo = 0;

/** Un apparato con le colonne vecchie scritte in SQL, come le ha lasciate il codice di prima della 2e. */
function apparato(d: Database.Database, nome: string, c: Record<string, string | number | null>): number {
  indirizzo++;
  const campi = { name: nome, host: `10.80.0.${indirizzo}`, device_type: "switch", vendor: "hp", port: 22, ...c };
  const chiavi = Object.keys(campi);
  return Number(
    d
      .prepare(`INSERT INTO network_devices (${chiavi.join(", ")}) VALUES (${chiavi.map(() => "?").join(", ")})`)
      .run(...Object.values(campi)).lastInsertRowid
  );
}

function riga(d: Database.Database, id: number) {
  return d.prepare("SELECT * FROM network_devices WHERE id = ?").get(id) as { id: number; name: string; protocol: "ssh" | "snmp_v2" | "snmp_v3" | "api" | "winrm"; port: number };
}

// ── 1. Il motore non ha più le fonti vecchie ────────────────────────────────

describe("motore della 2g: niente binding inline, colonne, catene vecchie né chiave dell'hub", () => {
  it("un apparato con le sole colonne e un binding inline non ha login, ha SNMP solo col «public» dichiarato, e «ha SNMP?» è falso", () => {
    const d = nuovoDb();
    const S = voce(d, "Root", "ssh", { utente: "root", segreto: "pw-col" });
    const id = apparato(d, "Switch vecchio", {
      protocol: "ssh",
      credential_id: S,
      username: "admin",
      encrypted_password: encrypt("pw-colonna"),
      community_string: encrypt("c-colonna"),
    });
    d.prepare(
      "INSERT INTO device_credential_bindings (device_id, credential_id, protocol_type, port, sort_order, inline_username, inline_encrypted_password) VALUES (?, NULL, 'ssh', 22, 0, 'admin', ?)"
    ).run(id, encrypt("pw-inline"));
    const dev = riga(d, id);

    assert.deepEqual(credenzialiApparatoDb(d, id, "ssh"), []);
    const login = sceltaLoginApparatoDb(d, dev, { registra: false });
    assert.equal(login.ok, false);
    const snmp = credenzialeSnmpApparatoDb(d, dev, { registra: false });
    assert.ok(snmp.ok);
    if (snmp.ok) {
      assert.equal(snmp.fonte, "snmp_ripiego");
      assert.deepEqual(snmp.cred, { forma: "community", community: "public" });
    }
    assert.equal(haSnmpApparatoDb(d, dev), false);
  });

  it("il token API nella colonna non si legge più", () => {
    const d = nuovoDb();
    const id = apparato(d, "Router Omada", { protocol: "api", vendor: "omada", device_type: "router", port: 443, api_token: encrypt("tok-colonna") });
    const t = tokenApiApparatoDb(d, riga(d, id), { registra: false });
    assert.equal(t.ok, false);
  });

  it("un host con catena vecchia e pin, senza il segno della 2d: solo la lista della rete", () => {
    const d = nuovoDb();
    const rete = Number(d.prepare("INSERT INTO networks (cidr, name) VALUES ('10.81.0.0/24', 'Rete')").run().lastInsertRowid);
    const host = Number(d.prepare("INSERT INTO hosts (network_id, ip) VALUES (?, '10.81.0.5')").run(rete).lastInsertRowid);
    const N = voce(d, "N della lista", "ssh");
    const V = voce(d, "V della catena vecchia", "ssh");
    const P = voce(d, "P del pin", "ssh");
    d.prepare("INSERT INTO network_credentials (network_id, credential_id, sort_order) VALUES (?, ?, 0)").run(rete, N);
    d.prepare("INSERT INTO network_host_credentials (network_id, credential_id, role, sort_order) VALUES (?, ?, 'ssh', 0)").run(rete, V);
    d.prepare("INSERT INTO host_detect_credential (host_id, role, credential_id) VALUES (?, 'ssh', ?)").run(host, P);

    const r = resolveCredentialsForDb(d, { hostId: host, networkId: rete }, "ssh");
    assert.deepEqual(r.map((c) => [c.source, c.credential_id]), [["network_chain", N]]);
  });

  it("l'apparato provvisorio (prova dalla finestra, id 0) usa la voce scelta, per il login e per SNMP", () => {
    const d = nuovoDb();
    const S = voce(d, "Admin switch", "ssh", { utente: "admin", segreto: "pw" });
    const C = voce(d, "Community sede", "snmp", { segreto: "c-sede" });
    const login = sceltaLoginApparatoDb(
      d,
      { id: 0, name: "10.82.0.1", protocol: "ssh", port: 2222, voci_provvisorie: { principale: S, snmp: C } },
      { registra: false }
    );
    assert.ok(login.ok, login.ok ? "" : login.motivo);
    if (login.ok) {
      assert.equal(login.candidato.credential_id, S);
      assert.equal(login.candidato.port, 2222, "la porta dell'apparato per il protocollo principale (D11)");
    }
    const snmp = credenzialeSnmpApparatoDb(d, { id: 0, name: "10.82.0.2", protocol: "snmp_v2", port: 22, voci_provvisorie: { principale: C, snmp: null } }, { registra: false });
    assert.ok(snmp.ok, snmp.ok ? "" : snmp.motivo);
    if (snmp.ok) {
      assert.equal(snmp.credential_id, C);
      assert.equal(snmp.port, 161, "SNMP mai sulla porta dell'apparato (F3)");
    }
  });
});

// ── 2. La conversione della 2e ricostruisce lei la scelta di prima ─────────

describe("conversione della 2e col motore della 2g", () => {
  it("un apparato con la sola colonna si converte (la scelta di prima la ricostruisce la conversione)", () => {
    const d = nuovoDb();
    const S = voce(d, "Root", "ssh", { utente: "root", segreto: "pw" });
    const id = apparato(d, "Server colonna", { protocol: "ssh", port: 22, credential_id: S });

    const e = convertiCredenzialiApparati(d, { aVuoto: false });

    assert.deepEqual(e.lasciati, []);
    const login = sceltaLoginApparatoDb(d, riga(d, id), { registra: false });
    assert.ok(login.ok);
    if (login.ok) assert.equal(login.candidato.credential_id, S);
  });

  it("binding fallito verso la voce della colonna (i due apparati di H1 accettati il 16/10) → lasciato; la scelta della 2g è «nessuna»", () => {
    const d = nuovoDb();
    const S = voce(d, "Server lasciato · SSH", "ssh", { utente: "root", segreto: "pw" });
    const id = apparato(d, "Server lasciato", { protocol: "ssh", port: 22, credential_id: S });
    d.prepare("INSERT INTO device_credential_bindings (device_id, credential_id, protocol_type, port, sort_order, test_status) VALUES (?, ?, 'ssh', 22, 0, 'failed')").run(id, S);

    const e = convertiCredenzialiApparati(d, { aVuoto: true });

    assert.equal(e.lasciati.length, 1);
    assert.equal(e.lasciati[0].device_id, id);
    assert.match(e.lasciati[0].motivo, new RegExp(`^la scelta SSH cambierebbe: prima colonna con la voce #${S} porta 22, dopo nessuna$`));
    assert.equal(sceltaLoginApparatoDb(d, riga(d, id), { registra: false }).ok, false, "effetto accettato: nessuna credenziale finché una Prova non riesce");
  });
});

// ── 4. Controller e AD senza voce ───────────────────────────────────────────

describe("controller e AD: senza voce «Credenziale mancante», qualunque sia il segno", () => {
  for (const segno of ["parziale:2026-10-16T10:00:00.000Z:lasciati=1", "errore:qualcosa", null]) {
    it(`controller con le colonne piene e segno ${segno ? segno.split(":")[0] : "assente"} → mancante, nessuna connessione`, () => {
      const d = nuovoDb();
      if (segno) scriviSegno(d, SEGNO_INTEGRAZIONI, segno);
      const row = {
        kind: "udm",
        credential_id: null,
        username: "",
        password_enc: "",
        api_key_enc: encrypt("chiave-vecchia"),
      } as unknown as NetworkControllerRow;
      const c = credenzialeControllerDb(d, row);
      assert.equal(c.ok, false);
      if (!c.ok) assert.equal(c.motivo, CREDENZIALE_MANCANTE);
      assert.equal(statoCredenzialeController(row), "mancante");
    });

    it(`AD con le colonne piene e segno ${segno ? segno.split(":")[0] : "assente"} → mancante, nessun bind`, () => {
      const d = nuovoDb();
      if (segno) scriviSegno(d, SEGNO_INTEGRAZIONI, segno);
      const r = { credential_id: null, encrypted_username: encrypt("ldap"), encrypted_password: encrypt("pw-ldap") };
      const c = credenzialeLdapDb(d, r);
      assert.equal(c.ok, false);
      if (!c.ok) assert.equal(c.mancante, true);
      assert.equal(statoAccountLdap(r), "mancante");
    });
  }
});

// ── 5. Usi di una voce ──────────────────────────────────────────────────────

describe("usi di una voce: colonne dell'apparato e catene vecchie non contano più", () => {
  it("voce della sola colonna, della sola catena vecchia e del solo pin, senza segno: nessun uso", () => {
    const d = nuovoDb();
    const rete = Number(d.prepare("INSERT INTO networks (cidr, name) VALUES ('10.83.0.0/24', 'Rete')").run().lastInsertRowid);
    const host = Number(d.prepare("INSERT INTO hosts (network_id, ip) VALUES (?, '10.83.0.5')").run(rete).lastInsertRowid);
    const C = voce(d, "Colonna", "ssh");
    const V = voce(d, "Catena vecchia", "ssh");
    const P = voce(d, "Pin", "ssh");
    apparato(d, "Switch", { protocol: "ssh", credential_id: C });
    d.prepare("INSERT INTO network_host_credentials (network_id, credential_id, role, sort_order) VALUES (?, ?, 'ssh', 0)").run(rete, V);
    d.prepare("INSERT INTO host_detect_credential (host_id, role, credential_id) VALUES (?, 'ssh', ?)").run(host, P);
    const totali = usiTotaliDb(d);
    for (const id of [C, V, P]) {
      assert.equal(totaleUsi(usiCredenzialeDb(d, id)), 0, `voce #${id} ancora in uso`);
      assert.equal(totali.get(id) ?? 0, 0, `voce #${id} ancora in uso nell'elenco`);
    }
  });
});

// ── 6. resetConfiguration, le due gemelle ──────────────────────────────────
// La gemella del facade lavora sul DB vecchio (ipam.db) senza contesto: è il
// suo schema (`users`, `settings`), che un DB tenant non ha.

describe("resetConfiguration senza le tabelle vecchie e con le tabelle piene", () => {
  const riempi = (d: Database.Database, quale: string): void => {
    const rete = Number(d.prepare("INSERT INTO networks (cidr, name) VALUES (?, ?)").run(`10.84.${quale.length}.0/24`, `Rete ${quale}`).lastInsertRowid);
    const host = Number(d.prepare("INSERT INTO hosts (network_id, ip) VALUES (?, ?)").run(rete, `10.84.${quale.length}.5`).lastInsertRowid);
    const v = Number(d.prepare("INSERT INTO credentials (name, credential_type) VALUES (?, 'ssh')").run(`Voce ${quale}`).lastInsertRowid);
    d.prepare("INSERT INTO network_host_credentials (network_id, credential_id, role, sort_order) VALUES (?, ?, 'ssh', 0)").run(rete, v);
    d.prepare("INSERT INTO host_detect_credential (host_id, role, credential_id) VALUES (?, 'ssh', ?)").run(host, v);
  };
  const conta = (d: Database.Database, t: string): number => (d.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;

  it("gemella del facade (DB vecchio): con le tabelle piene le svuota; senza le tabelle riesce", () => {
    const d = getDb();
    riempi(d, "facciata");
    resetFacciata();
    assert.equal(conta(d, "network_host_credentials"), 0);
    assert.equal(conta(d, "host_detect_credential"), 0);
    d.exec("DROP TABLE host_detect_credential; DROP TABLE network_host_credentials;");
    riempi2(d);
    assert.doesNotThrow(() => resetFacciata());
    assert.equal(conta(d, "networks"), 0);
  });

  /** Senza le tabelle vecchie: solo una rete, che il reset deve togliere. */
  function riempi2(d: Database.Database): void {
    d.prepare("INSERT INTO networks (cidr, name) VALUES ('10.85.0.0/24', 'Rete sola')").run();
  }

  const T1 = "T26RESETPIENO";
  const T2 = "T26RESETSENZA";
  after(() => {
    for (const t of [T1, T2]) {
      try { closeTenantDb(t); deleteTenantDatabase(t); } catch { /* già tolto */ }
    }
    closeHubDb();
  });

  it("gemella del tenant: con le tabelle piene le svuota (cascata)", () => {
    withTenant(T1, () => {
      const d = getTenantDb(T1);
      riempi(d, "tenant");
      resetTenant();
      assert.equal(conta(d, "network_host_credentials"), 0);
      assert.equal(conta(d, "host_detect_credential"), 0);
    });
  });

  it("gemella del tenant: senza le due tabelle riesce", () => {
    withTenant(T2, () => {
      const d = getTenantDb(T2);
      d.exec("DROP TABLE host_detect_credential; DROP TABLE network_host_credentials;");
      riempi2(d);
      assert.doesNotThrow(() => resetTenant());
      assert.equal(conta(d, "networks"), 0);
    });
  });
});

// ── 7. Bundle di prima della 2d ─────────────────────────────────────────────

const PASS = "trasporto-t26";

function hub(): Database.Database {
  const d = new Database(":memory:");
  d.exec(HUB_SCHEMA_SQL);
  return d;
}

/** Un bundle come lo scriveva l'export di prima della 2g, con catene vecchie e pin. */
function bundleVecchio(righe: Array<{ tbl: string; row: Record<string, unknown> }>): Buffer {
  const salt = randomSalt();
  const k = deriveTransportKey(PASS, salt);
  const payload = encryptBuffer(zlib.gzipSync(Buffer.from(righe.map((r) => JSON.stringify(r)).join("\n"), "utf8")), k);
  const tables: Record<string, number> = {};
  for (const r of righe) tables[r.tbl] = (tables[r.tbl] ?? 0) + 1;
  return writeContainer(
    {
      format: BUNDLE_FORMAT,
      formatVersion: BUNDLE_FORMAT_VERSION,
      appVersion: "0.3.290",
      exportedAt: "2026-10-01T10:00:00.000Z",
      tiers: [],
      includeVault: false,
      tables,
      secretErrors: 0,
      encryption: { scheme: "envelope-aes-256-gcm", saltHex: salt.toString("hex"), sourceKeyFingerprint: null },
    },
    payload
  );
}

const RIGHE_VECCHIE = [
  { tbl: "networks", row: { id: 1, cidr: "10.86.0.0/24", name: "Sede" } },
  { tbl: "credentials", row: { id: 5, name: "Admin Linux", credential_type: "ssh" } },
  { tbl: "credentials", row: { id: 6, name: "Dominio", credential_type: "windows" } },
  { tbl: "hosts", row: { id: 3, network_id: 1, ip: "10.86.0.5" } },
  { tbl: "network_host_credentials", row: { id: 1, network_id: 1, credential_id: 5, role: "ssh", sort_order: 0 } },
  { tbl: "host_detect_credential", row: { host_id: 3, role: "windows", credential_id: 6, updated_at: "2026-09-01 10:00:00" } },
];

describe("import di un bundle di prima della 2d", () => {
  for (const conTabelle of [false, true]) {
    it(`${conTabelle ? "in un DB che ha ancora" : "in un DB senza"} le tabelle vecchie: catena e pin nella lista e nelle righe host, tabelle vecchie non toccate`, () => {
      const d = nuovoDb();
      if (!conTabelle) d.exec("DROP TABLE host_detect_credential; DROP TABLE network_host_credentials;");
      const r = importTenant({ bundle: bundleVecchio(RIGHE_VECCHIE), tenantDb: d, hubDb: hub(), options: { tenantCode: "DEFAULT", passphrase: PASS, wipe: true } });

      assert.deepEqual(d.prepare("SELECT network_id, credential_id FROM network_credentials ORDER BY sort_order").all(), [{ network_id: 1, credential_id: 5 }]);
      assert.deepEqual(d.prepare("SELECT host_id, credential_id, protocol_type, validated FROM host_credentials").all(), [
        { host_id: 3, credential_id: 6, protocol_type: "winrm", validated: 1 },
      ]);
      assert.match(r.conversioni[SEGNO_CATENE]?.segno ?? "", /^done:/);
      assert.deepEqual(d.prepare("SELECT name FROM sqlite_temp_master WHERE type = 'table'").all(), [], "niente tabelle temporanee rimaste");
      if (conTabelle) {
        assert.equal((d.prepare("SELECT COUNT(*) AS n FROM network_host_credentials").get() as { n: number }).n, 0);
        assert.equal((d.prepare("SELECT COUNT(*) AS n FROM host_detect_credential").get() as { n: number }).n, 0);
      }
    });
  }

  it("l'export non porta più catene vecchie e pin", () => {
    const d = nuovoDb();
    const rete = Number(d.prepare("INSERT INTO networks (cidr, name) VALUES ('10.87.0.0/24', 'Rete')").run().lastInsertRowid);
    const v = voce(d, "V", "ssh");
    d.prepare("INSERT INTO network_host_credentials (network_id, credential_id, role, sort_order) VALUES (?, ?, 'ssh', 0)").run(rete, v);
    const bundle = exportTenant({
      tenantDb: d,
      hubDb: hub(),
      options: { tenantCode: "DEFAULT", tiers: [], includeVault: false, passphrase: PASS, exportedAt: "2026-10-16T10:00:00.000Z", appVersion: "test" },
    });
    const dst = nuovoDb();
    const r = importTenant({ bundle, tenantDb: dst, hubDb: hub(), options: { tenantCode: "DEFAULT", passphrase: PASS, wipe: true } });
    assert.equal(r.tables.network_host_credentials, undefined);
    assert.equal(r.tables.host_detect_credential, undefined);
  });
});

// ── La conversione della 2d senza le tabelle vecchie ───────────────────────

describe("conversione della 2d su un DB senza le tabelle vecchie (tenant nato dopo la 2g)", () => {
  it("niente da convertire: esito vuoto, segno done:", () => {
    const d = nuovoDb();
    d.exec("DROP TABLE host_detect_credential; DROP TABLE network_host_credentials;");
    d.prepare("INSERT INTO networks (cidr, name) VALUES ('10.88.0.0/24', 'Rete')").run();
    const e = convertiCateneVecchie(d, null, { aVuoto: false });
    assert.deepEqual(e, { aggiunteLista: [], righeHostDaPin: 0, pinGiaPresenti: 0, saltate: [] });
    assert.match(segnoCatene(e), /^done:/);
  });
});
