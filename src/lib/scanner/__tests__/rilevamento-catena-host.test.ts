/**
 * Rilevamento Windows e SSH della discovery sul motore (tappa 2 credenziali,
 * T17 del piano `plans/2026-10-15-tappa2-archivio-credenziali.md`, D2 = (a)).
 *
 * Perché:
 * - con un pin (`host_detect_credential`) i rilevamenti `windows`, `ssh` e la
 *   fase 4 di `ipam_full` provavano SOLO quella voce: se la password era
 *   cambiata, l'host restava non rilevato per sempre e la catena della rete
 *   non si riprovava mai. Ora la catena di ogni host è quella del motore
 *   (righe validate dell'host, poi binding dell'apparato, poi la lista della
 *   rete): la voce che funzionava si prova per prima, se fallisce va in fermo
 *   e si passa alle altre, entro il tetto per credenziale del giro;
 * - il giro non scrive più pin: la voce che entra diventa una riga validata
 *   dell'host, come già faceva;
 * - `ipam_full` saltava la fase SSH di tutta la rete quando la lista della
 *   rete era vuota, anche per gli host che hanno una credenziale propria.
 *
 * WinRM su 127.0.0.1 (5985/5986 chiuse: ogni prova fallisce subito, senza
 * bridge Python); SSH su un server ssh2 in memoria su 127.0.0.1; ping e nmap
 * di `ipam_full` dall'esecutore finto. La fase SNMP di `ipam_full` interroga
 * 127.0.0.1:161 (nessun agente: nessuna risposta), senza la CLI snmpwalk.
 *
 * Run: DA_INVENT_DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ipam.XXXXXX")" node --import tsx --test src/lib/scanner/__tests__/rilevamento-catena-host.test.ts
 */
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type Database from "better-sqlite3";

import { encrypt } from "@/lib/crypto";
import { closeHubDb } from "@/lib/db-hub";
import { deleteTenantDatabase, getTenantDb, withTenant } from "@/lib/db-tenant";
import { discoverNetwork } from "@/lib/scanner/discovery";
import { serverSshProva, type ServerSshProva } from "@/lib/devices/__tests__/support/server-ssh-chiave";
import { creaEsecutoreFinto, installaEsecutoreFinto, togliEsecutoreFinto } from "./support/esecutore-finto";

process.env.DA_INVENT_SNMPWALK_CLI = "false";

const IP = "127.0.0.1";

interface Tenant {
  code: string;
  d: Database.Database;
  rete: number;
  host: number;
}

function tenant(code: string, porte: number[]): Tenant {
  return withTenant(code, () => {
    const d = getTenantDb(code);
    const rete = Number(d.prepare("INSERT INTO networks (cidr, name) VALUES ('127.0.0.0/30', 'Loopback')").run().lastInsertRowid);
    const host = Number(
      d.prepare("INSERT INTO hosts (network_id, ip, status, open_ports) VALUES (?, ?, 'online', ?)")
        .run(rete, IP, JSON.stringify(porte.map((port) => ({ port, protocol: "tcp" }))))
        .lastInsertRowid
    );
    return { code, d, rete, host };
  });
}

function voce(t: Tenant, nome: string, tipo: string, utente: string, password: string, port: number | null = null): number {
  return Number(
    t.d.prepare("INSERT INTO credentials (name, credential_type, encrypted_username, encrypted_password, port) VALUES (?, ?, ?, ?, ?)")
      .run(nome, tipo, encrypt(utente), encrypt(password), port).lastInsertRowid
  );
}

function lista(t: Tenant, ids: number[]): void {
  const ins = t.d.prepare("INSERT INTO network_credentials (network_id, credential_id, sort_order) VALUES (?, ?, ?)");
  ids.forEach((id, i) => ins.run(t.rete, id, i));
}

function rigaValidata(t: Tenant, credId: number, proto: string, port: number): void {
  t.d.prepare(
    "INSERT INTO host_credentials (host_id, credential_id, protocol_type, port, validated, validated_at, sort_order) VALUES (?, ?, ?, ?, 1, datetime('now'), 0)"
  ).run(t.host, credId, proto, port);
}

function pin(t: Tenant, ruolo: string, credId: number): void {
  t.d.prepare("INSERT INTO host_detect_credential (host_id, role, credential_id) VALUES (?, ?, ?)").run(t.host, ruolo, credId);
}

function pinDi(t: Tenant): Array<{ role: string; credential_id: number }> {
  return t.d.prepare("SELECT role, credential_id FROM host_detect_credential WHERE host_id = ? ORDER BY role").all(t.host) as Array<{
    role: string;
    credential_id: number;
  }>;
}

async function giro(t: Tenant, tipo: "windows" | "ssh" | "ipam_full"): Promise<string> {
  const avvio = await withTenant(t.code, () => discoverNetwork(t.rete, tipo, undefined, null, { targetIps: [IP] }));
  const esito = await avvio.done;
  const log = (avvio.progress.logs ?? []).join("\n");
  assert.equal(esito.status, "completed", `${JSON.stringify(esito)}\n${log}`);
  return log;
}

const TENANT = { win: "TESTRILEVAWIN", ssh: "TESTRILEVASSH", full: "TESTRILEVAFULL" };

let server: ServerSshProva;

before(async () => {
  server = await serverSshProva({
    password: "giusta",
    risposta: () => 'srv-prova\nLinux 6.1.0\nPRETTY_NAME="Debian GNU/Linux 12 (bookworm)"\n',
  });
});

after(async () => {
  await server.chiudi();
  togliEsecutoreFinto();
  for (const code of Object.values(TENANT)) deleteTenantDatabase(code);
  closeHubDb();
  removeTestHubDb();
});

describe("rilevamento Windows: la validata che fallisce non ferma la catena (D2 = (a))", () => {
  it("si prova per prima la voce validata, poi la successiva della lista; nessun pin scritto", { timeout: 60_000 }, async () => {
    const { override } = creaEsecutoreFinto({ vivi: [IP] });
    installaEsecutoreFinto(override);
    const t = tenant(TENANT.win, [5985]);
    const A = voce(t, "Validata che ora fallisce", "windows", "DOM\\op-a", "vecchia");
    const B = voce(t, "Seconda della lista", "windows", "DOM\\op-b", "altra");
    lista(t, [A, B]);
    rigaValidata(t, A, "winrm", 5985);
    pin(t, "windows", A);

    const log = await giro(t, "windows");

    const provaA = log.indexOf(`cred#${A}`);
    const provaB = log.indexOf(`cred#${B}`);
    assert.ok(provaA >= 0, `la validata #${A} non è stata provata:\n${log}`);
    assert.ok(provaB >= 0, `dopo il fallimento della validata la catena si è fermata (#${B} mai provata):\n${log}`);
    assert.ok(provaA < provaB, `la validata non è stata provata per prima:\n${log}`);
    const rigaA = t.d.prepare("SELECT validated, fail_count, backoff_until FROM host_credentials WHERE host_id = ? AND credential_id = ?").get(t.host, A) as {
      validated: number;
      fail_count: number;
      backoff_until: string | null;
    };
    assert.equal(rigaA.validated, 0, "la validata che ha fallito resta validata");
    assert.ok(rigaA.fail_count >= 1 && rigaA.backoff_until, "la validata che ha fallito non è in fermo");
    assert.deepEqual(pinDi(t), [{ role: "windows", credential_id: A }], "il pin congelato è cambiato");
  });
});

describe("rilevamento SSH: la validata che fallisce non ferma la catena (D2 = (a))", () => {
  it("la seconda voce entra e diventa la riga validata dell'host; i pin restano come erano", { timeout: 60_000 }, async () => {
    const { override } = creaEsecutoreFinto({ vivi: [IP] });
    installaEsecutoreFinto(override);
    const t = tenant(TENANT.ssh, [22]);
    const A = voce(t, "Password cambiata", "ssh", "op", "sbagliata", server.porta);
    const B = voce(t, "Password giusta", "ssh", "op", "giusta", server.porta);
    lista(t, [A, B]);
    rigaValidata(t, A, "ssh", server.porta);
    pin(t, "linux", A);
    pin(t, "ssh", A);

    const log = await giro(t, "ssh");

    const righe = t.d
      .prepare("SELECT credential_id, validated FROM host_credentials WHERE host_id = ? AND protocol_type = 'ssh' ORDER BY credential_id")
      .all(t.host) as Array<{ credential_id: number; validated: number }>;
    assert.deepEqual(righe, [
      { credential_id: A, validated: 0 },
      { credential_id: B, validated: 1 },
    ], `righe dell'host dopo il giro:\n${log}`);
    assert.ok(log.indexOf(`cred#${A}`) < log.indexOf(`cred#${B}`), `ordine delle prove:\n${log}`);
    assert.deepEqual(pinDi(t), [
      { role: "linux", credential_id: A },
      { role: "ssh", credential_id: A },
    ], "il giro ha scritto un pin");
  });
});

describe("ipam_full: lista della rete vuota, host con una credenziale propria", () => {
  it("la fase SSH prova l'host (prima la saltava per tutta la rete)", { timeout: 120_000 }, async () => {
    const { override } = creaEsecutoreFinto({ vivi: [IP], porte: { [IP]: [22] } });
    installaEsecutoreFinto(override);
    const t = tenant(TENANT.full, [22]);
    const X = voce(t, "Credenziale dell'host", "ssh", "op", "giusta", server.porta);
    rigaValidata(t, X, "ssh", server.porta);
    const connessioniPrima = server.connessioni;

    const log = await giro(t, "ipam_full");

    assert.ok(server.connessioni > connessioniPrima, `nessuna connessione SSH all'host:\n${log}`);
    assert.match(log, new RegExp(`SSH ✓ ${IP.replace(/\./g, "\\.")}`));
    assert.deepEqual(pinDi(t), [], "il giro ha scritto un pin");
  });
});
