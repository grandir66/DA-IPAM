/**
 * Letture della pagina «Accesso Windows per host» (piano accesso Windows, Task 9) e del conteggio per voce (Task 8).
 *
 * Su SQLite vero: la classifica fra più voci, la paginazione e il conteggio stanno nella query, e un doppio non le
 * proverebbe. Regola 6 di CLAUDE.md: una query sola con JOIN, mai una lettura per host.
 *
 * Run: node --import tsx --test src/lib/__tests__/accesso-windows-per-host.test.ts
 */
import { TEST_DATA_DIR } from "@/lib/__tests__/support/data-dir-isolata";
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import type Database from "better-sqlite3";
import { closeHubDb } from "@/lib/db-hub";
import { deleteTenantDatabase, getAccessoWindowsPaginated, getEsitiAccessoPerVoce, getTenantDb, withTenant } from "@/lib/db-tenant";

void TEST_DATA_DIR;
const T = "TESTACCWINHOST";

after(() => {
  deleteTenantDatabase(T);
  closeHubDb();
});

interface Scena {
  d: Database.Database;
  rete: number;
  voceA: number;
  voceB: number;
  host: Record<string, number>;
}

function scena(): Scena {
  deleteTenantDatabase(T);
  return withTenant(T, () => {
    const d = getTenantDb(T);
    const rete = Number(d.prepare("INSERT INTO networks (cidr, name) VALUES ('10.88.0.0/24', 'Clienti')").run().lastInsertRowid);
    const voce = (nome: string) =>
      Number(d.prepare("INSERT INTO credentials (name, credential_type, encrypted_username, encrypted_password) VALUES (?, 'windows', 'x', 'y')").run(nome).lastInsertRowid);
    const host: Record<string, number> = {};
    for (const n of ["h1", "h2", "h3", "h4", "h5", "h6", "h7"]) {
      host[n] = Number(d.prepare("INSERT INTO hosts (network_id, ip, hostname, status) VALUES (?, ?, ?, 'online')").run(rete, `10.88.0.${n.slice(1)}`, `pc-${n}`).lastInsertRowid);
    }
    return { d, rete, voceA: voce("A"), voceB: voce("B"), host };
  });
}

function riga(s: Scena, host: string, voce: number, proto: string, motivo: string | null, quando: string | null = null, port = proto === "wmi" ? 135 : 5985): void {
  s.d.prepare(
    "INSERT INTO host_credentials (host_id, credential_id, protocol_type, port, motivo, last_attempt_at, sort_order) VALUES (?, ?, ?, ?, ?, ?, 0)",
  ).run(s.host[host], voce, proto, port, motivo, quando);
}

function popola(s: Scena): void {
  riga(s, "h1", s.voceA, "winrm", "ok", "2026-11-04T09:00:00.000Z");
  riga(s, "h2", s.voceA, "winrm", "diritti_mancanti", "2026-11-04T09:01:00.000Z");
  riga(s, "h2", s.voceA, "wmi", "ok", "2026-11-04T09:02:00.000Z");
  riga(s, "h3", s.voceA, "winrm", "porte_chiuse", "2026-11-04T09:03:00.000Z");
  riga(s, "h4", s.voceA, "winrm", null);
  riga(s, "h5", s.voceA, "winrm", "errore", "2026-11-04T09:04:00.000Z");
  riga(s, "h5", s.voceB, "winrm", "ok", "2026-11-04T09:05:00.000Z");
  riga(s, "h6", s.voceA, "ssh", "ok", "2026-11-04T09:06:00.000Z", 22); // non è Windows
  riga(s, "h7", s.voceA, "winrm", "motivo-che-non-esiste", "2026-11-04T09:07:00.000Z");
}

describe("getAccessoWindowsPaginated", () => {
  it("una riga per host, con una colonna per strada: la stessa voce entra da una e non dall'altra", () => {
    const s = scena();
    popola(s);
    const { righe, totale } = withTenant(T, () => getAccessoWindowsPaginated({ limit: 50, offset: 0, credentialId: s.voceA }));
    const h2 = righe.find((r) => r.ip === "10.88.0.2");
    assert.equal(h2?.winrm.motivo, "diritti_mancanti");
    assert.equal(h2?.wmi.motivo, "ok");
    assert.equal(h2?.nome, "pc-h2");
    assert.equal(totale, 6, "h6 ha solo SSH e non c'è");
    assert.ok(!righe.some((r) => r.ip === "10.88.0.6"));
  });

  it("una strada senza riga, o con motivo vuoto o sconosciuto, è «nessun esito»: non si inventa", () => {
    const s = scena();
    popola(s);
    const { righe } = withTenant(T, () => getAccessoWindowsPaginated({ limit: 50, offset: 0, credentialId: s.voceA }));
    const per = (ip: string) => righe.find((r) => r.ip === ip);
    assert.deepEqual(per("10.88.0.1")?.wmi, { motivo: null, ultimoTentativo: null });
    assert.equal(per("10.88.0.4")?.winrm.motivo, null);
    assert.equal(per("10.88.0.7")?.winrm.motivo, null);
  });

  it("con una voce sola conta quella; senza voce vince il motivo più utile fra tutte le voci", () => {
    const s = scena();
    popola(s);
    const conA = withTenant(T, () => getAccessoWindowsPaginated({ limit: 50, offset: 0, credentialId: s.voceA }));
    assert.equal(conA.righe.find((r) => r.ip === "10.88.0.5")?.winrm.motivo, "errore");
    const tutte = withTenant(T, () => getAccessoWindowsPaginated({ limit: 50, offset: 0 }));
    const h5 = tutte.righe.find((r) => r.ip === "10.88.0.5");
    assert.equal(h5?.winrm.motivo, "ok", "una voce che entra basta: la copertura è quella dell'host");
    assert.equal(h5?.winrm.ultimoTentativo, "2026-11-04T09:05:00.000Z", "l'ultimo tentativo è il più recente fra le voci");
    assert.equal(tutte.righe.filter((r) => r.ip === "10.88.0.5").length, 1, "un host è una riga anche con due voci");
  });

  it("la voce di un'altra non entra nel conteggio di questa", () => {
    const s = scena();
    popola(s);
    const soloB = withTenant(T, () => getAccessoWindowsPaginated({ limit: 50, offset: 0, credentialId: s.voceB }));
    assert.equal(soloB.totale, 1);
    assert.equal(soloB.righe[0].ip, "10.88.0.5");
  });

  it("paginata dal server: LIMIT e OFFSET, e il totale resta quello intero", () => {
    const s = scena();
    popola(s);
    const p1 = withTenant(T, () => getAccessoWindowsPaginated({ limit: 2, offset: 0, credentialId: s.voceA }));
    const p2 = withTenant(T, () => getAccessoWindowsPaginated({ limit: 2, offset: 2, credentialId: s.voceA }));
    assert.equal(p1.righe.length, 2);
    assert.equal(p2.righe.length, 2);
    assert.equal(p1.totale, 6);
    assert.equal(p2.totale, 6);
    const ips = [...p1.righe, ...p2.righe].map((r) => r.ip);
    assert.equal(new Set(ips).size, 4, "nessuna riga ripetuta fra le pagine");
  });

  it("ordine per indirizzo: .2 prima di .10, non per testo", () => {
    const s = scena();
    s.d.prepare("UPDATE hosts SET ip = '10.88.0.10' WHERE id = ?").run(s.host.h1);
    riga(s, "h1", s.voceA, "winrm", "ok");
    riga(s, "h2", s.voceA, "winrm", "ok");
    const { righe } = withTenant(T, () => getAccessoWindowsPaginated({ limit: 50, offset: 0 }));
    assert.deepEqual(righe.map((r) => r.ip), ["10.88.0.2", "10.88.0.10"]);
  });

  it("nessuna riga Windows: lista vuota e totale 0, non un errore", () => {
    const s = scena();
    void s;
    assert.deepEqual(withTenant(T, () => getAccessoWindowsPaginated({ limit: 50, offset: 0 })), { righe: [], totale: 0 });
  });
});

describe("getEsitiAccessoPerVoce: «N su M» conta gli host provati", () => {
  it("porte chiuse, budget esaurito e senza esito non sono provati", () => {
    const s = scena();
    popola(s);
    riga(s, "h4", s.voceB, "wmi", "budget_esaurito", "2026-11-04T09:08:00.000Z");
    const esiti = withTenant(T, () => getEsitiAccessoPerVoce(s.voceA));
    // winrm di A: h1 ok, h2 diritti, h5 errore provati; h3 porte chiuse, h4 vuoto, h7 sconosciuto no.
    const nessuno = { diritti: 0, firewall: 0, errori: 0, password: 0 };
    assert.deepEqual(esiti.find((e) => e.strada === "winrm"), { strada: "winrm", provati: 3, riusciti: 1, ...nessuno, diritti: 1, errori: 1 });
    assert.deepEqual(esiti.find((e) => e.strada === "wmi"), { strada: "wmi", provati: 1, riusciti: 1, ...nessuno });
    assert.deepEqual(withTenant(T, () => getEsitiAccessoPerVoce(s.voceB)), [{ strada: "winrm", provati: 1, riusciti: 1, ...nessuno }]);
  });

  it("una voce senza righe non ha esiti", () => {
    const s = scena();
    assert.deepEqual(withTenant(T, () => getEsitiAccessoPerVoce(s.voceA)), []);
  });

  it("SSH non conta", () => {
    const s = scena();
    riga(s, "h1", s.voceA, "ssh", "ok", null, 22);
    assert.deepEqual(withTenant(T, () => getEsitiAccessoPerVoce(s.voceA)), []);
  });
});
