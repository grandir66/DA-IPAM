/**
 * La tabella `accesso_windows_esiti` (revisione finale, piano accesso Windows).
 *
 * Incidente 72729, 04/11/2026: `.207` non compariva da nessuna parte e la voce diceva «Nessun host provato» dopo una
 * scansione. Il motore prova ogni voce della rete, ma una riga in `host_credentials` la crea solo se l'esito vale un
 * fallimento: una riga lì mette la voce fra i candidati dell'host. Gli esiti senza riga si perdevano. Ora stanno in una
 * tabella loro, e pagina e conteggi leggono da lì; `host_credentials` resta il ripiego per i dati vecchi.
 *
 * Su SQLite vero: chiave esterna, transazione e unione stanno nel database, un doppio non le proverebbe.
 *
 * Run: node --import tsx --test src/lib/__tests__/accesso-windows-esiti.test.ts
 */
import { TEST_DATA_DIR } from "@/lib/__tests__/support/data-dir-isolata";
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import type Database from "better-sqlite3";
import { closeHubDb } from "@/lib/db-hub";
import {
  deleteTenantDatabase,
  getAccessoWindowsPaginated,
  getEsitiAccessoPerVoce,
  getTenantDb,
  recordCredentialPasswordErrata,
  recordEsitiAccessoWindows,
  withTenant,
} from "@/lib/db-tenant";

void TEST_DATA_DIR;
const T = "TESTESITIACCESSO";

after(() => {
  deleteTenantDatabase(T);
  closeHubDb();
});

interface Scena {
  d: Database.Database;
  voce: number;
  host: number[];
}

function scena(): Scena {
  deleteTenantDatabase(T);
  return withTenant(T, () => {
    const d = getTenantDb(T);
    const rete = Number(d.prepare("INSERT INTO networks (cidr, name) VALUES ('10.66.0.0/24', 'Clienti')").run().lastInsertRowid);
    const host = [1, 2, 3].map((n) => Number(d.prepare("INSERT INTO hosts (network_id, ip, status) VALUES (?, ?, 'online')").run(rete, `10.66.0.${n}`).lastInsertRowid));
    const voce = Number(d.prepare("INSERT INTO credentials (name, credential_type, encrypted_username, encrypted_password) VALUES ('A', 'windows', 'x', 'y')").run().lastInsertRowid);
    return { d, voce, host };
  });
}

const righeEsiti = (s: Scena): Array<{ host_id: number; strada: string; motivo: string }> =>
  s.d.prepare("SELECT host_id, strada, motivo FROM accesso_windows_esiti ORDER BY host_id, strada").all() as Array<{ host_id: number; strada: string; motivo: string }>;

function rigaHc(s: Scena, host: number, proto: string, motivo: string | null, port = proto === "wmi" ? 135 : 5985): void {
  s.d.prepare("INSERT INTO host_credentials (host_id, credential_id, protocol_type, port, motivo, last_attempt_at, sort_order) VALUES (?, ?, ?, ?, ?, '2026-11-04T08:00:00.000Z', 0)")
    .run(host, s.voce, proto, port, motivo);
}

describe("recordEsitiAccessoWindows", () => {
  it("scrive un esito senza riga in host_credentials, e la voce non diventa candidata dell'host", () => {
    const s = scena();
    withTenant(T, () => recordEsitiAccessoWindows([{ hostId: s.host[0], credentialId: s.voce, strada: "winrm", motivo: "porte_chiuse" }]));
    assert.deepEqual(righeEsiti(s), [{ host_id: s.host[0], strada: "winrm", motivo: "porte_chiuse" }]);
    assert.equal((s.d.prepare("SELECT COUNT(*) AS n FROM host_credentials").get() as { n: number }).n, 0);
  });

  it("host, voce e strada sono la chiave: il giro dopo sostituisce, non accumula", () => {
    const s = scena();
    const riga = { hostId: s.host[0], credentialId: s.voce, strada: "wmi" as const };
    withTenant(T, () => {
      recordEsitiAccessoWindows([{ ...riga, motivo: "firewall" }]);
      recordEsitiAccessoWindows([{ ...riga, motivo: "ok" }]);
    });
    assert.deepEqual(righeEsiti(s), [{ host_id: s.host[0], strada: "wmi", motivo: "ok" }]);
  });

  it("tutto in una transazione: una riga che non vale non ne lascia scritta nessuna", () => {
    const s = scena();
    assert.throws(() =>
      withTenant(T, () =>
        recordEsitiAccessoWindows([
          { hostId: s.host[0], credentialId: s.voce, strada: "winrm", motivo: "password_errata" },
          { hostId: 999_999, credentialId: s.voce, strada: "winrm", motivo: "password_errata" },
        ]),
      ),
    );
    assert.deepEqual(righeEsiti(s), []);
  });

  it("host o voce cancellati si portano via i loro esiti", () => {
    const s = scena();
    withTenant(T, () =>
      recordEsitiAccessoWindows([
        { hostId: s.host[0], credentialId: s.voce, strada: "winrm", motivo: "ok" },
        { hostId: s.host[1], credentialId: s.voce, strada: "winrm", motivo: "ok" },
      ]),
    );
    s.d.prepare("DELETE FROM hosts WHERE id = ?").run(s.host[0]);
    assert.deepEqual(righeEsiti(s).map((r) => r.host_id), [s.host[1]]);
    s.d.prepare("DELETE FROM credentials WHERE id = ?").run(s.voce);
    assert.deepEqual(righeEsiti(s), []);
  });
});

describe("pagina e conteggi leggono dalla tabella, col ripiego su host_credentials", () => {
  it("un host senza riga in host_credentials compare nella pagina e nei conteggi", () => {
    const s = scena();
    withTenant(T, () => recordEsitiAccessoWindows([{ hostId: s.host[0], credentialId: s.voce, strada: "winrm", motivo: "diritti_mancanti" }]));
    const pagina = withTenant(T, () => getAccessoWindowsPaginated({ limit: 10, offset: 0, credentialId: s.voce }));
    assert.equal(pagina.totale, 1);
    assert.equal(pagina.righe[0].winrm.motivo, "diritti_mancanti");
    const conteggi = withTenant(T, () => getEsitiAccessoPerVoce(s.voce));
    assert.deepEqual(conteggi.map((e) => [e.strada, e.provati, e.riusciti]), [["winrm", 1, 0]]);
  });

  it("per lo stesso host, voce e strada vince l'esito della tabella, più recente della riga vecchia", () => {
    const s = scena();
    rigaHc(s, s.host[0], "winrm", "errore");
    withTenant(T, () => recordEsitiAccessoWindows([{ hostId: s.host[0], credentialId: s.voce, strada: "winrm", motivo: "ok" }]));
    const pagina = withTenant(T, () => getAccessoWindowsPaginated({ limit: 10, offset: 0 }));
    assert.equal(pagina.righe[0].winrm.motivo, "ok");
    assert.deepEqual(withTenant(T, () => getEsitiAccessoPerVoce(s.voce)).map((e) => [e.provati, e.riusciti]), [[1, 1]]);
  });

  it("dati vecchi: senza esito nella tabella si legge host_credentials", () => {
    const s = scena();
    rigaHc(s, s.host[0], "wmi", "firewall");
    withTenant(T, () => recordEsitiAccessoWindows([{ hostId: s.host[1], credentialId: s.voce, strada: "winrm", motivo: "ok" }]));
    const pagina = withTenant(T, () => getAccessoWindowsPaginated({ limit: 10, offset: 0, credentialId: s.voce }));
    assert.equal(pagina.totale, 2);
    assert.deepEqual(pagina.righe.map((r) => [r.wmi.motivo, r.winrm.motivo]), [["firewall", null], [null, "ok"]]);
    assert.ok(pagina.righe[0].wmi.ultimoTentativo);
  });

  it("un host con due porte WinRM vale un host, non due", () => {
    const s = scena();
    rigaHc(s, s.host[0], "winrm", "diritti_mancanti", 5985);
    rigaHc(s, s.host[0], "winrm", "diritti_mancanti", 5986);
    rigaHc(s, s.host[1], "winrm", "ok", 5985);
    assert.deepEqual(withTenant(T, () => getEsitiAccessoPerVoce(s.voce)).map((e) => [e.provati, e.riusciti]), [[2, 1]]);
  });
});

describe("password errata", () => {
  it("è un fatto della voce: anche gli esiti di host non toccati da questo giro lo dicono", () => {
    const s = scena();
    withTenant(T, () => {
      recordEsitiAccessoWindows([{ hostId: s.host[0], credentialId: s.voce, strada: "winrm", motivo: "ok" }]);
      recordCredentialPasswordErrata(s.voce);
    });
    assert.deepEqual(righeEsiti(s), [{ host_id: s.host[0], strada: "winrm", motivo: "password_errata" }]);
  });
});
