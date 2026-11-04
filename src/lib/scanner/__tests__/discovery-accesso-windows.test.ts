/**
 * La scansione usa il motore di accesso Windows nei due punti: tipo `windows` e `credential_validate` (piano accesso
 * Windows, Task 5).
 *
 * Incidente: 72729, 04/11/2026. 12 PC rifiutano un account di dominio con password giusta: la scansione deve provarli
 * tutti, dire «diritti mancanti» e non fermarsi dopo 3. E una porta chiusa contava come un fallimento senza nessun login,
 * cioè escludeva la voce dopo tre host spenti.
 *
 * Gira il vero `discoverNetwork` su SQLite vero: motivo, porta 135 e CHECK non hanno doppi. Finte sono solo le uscite verso
 * le macchine e verso il DC, dalla porta delle prove, e gettano le classi d'errore vere.
 *
 * Run: node --import tsx --test src/lib/scanner/__tests__/discovery-accesso-windows.test.ts
 */
import { TEST_DATA_DIR } from "@/lib/__tests__/support/data-dir-isolata";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { after, afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type Database from "better-sqlite3";

import { encrypt } from "@/lib/crypto";
import * as facade from "@/lib/db";
import { closeHubDb } from "@/lib/db-hub";
import * as tenantDb from "@/lib/db-tenant";
import { deleteTenantDatabase, getNetworkDeviceById, getTenantDb, withTenant } from "@/lib/db-tenant";
import { accountLegameWmiValidato, getDeviceInfo } from "@/lib/devices/device-info";
import type { WinrmErrorCode } from "@/lib/devices/winrm-errors";
import { WinrmError, type DipendenzeWinrm } from "@/lib/devices/winrm-run";
import { WmiError } from "@/lib/devices/wmi-run";
import { CHIAVE_PROVE_ACCESSO_WINDOWS, discoverNetwork, provaWinrmConTetto, type ProveAccessoWindows } from "@/lib/scanner/discovery";
import type { EsitoPassword } from "@/lib/scanner/verifica-password-run";
import type { NetworkDevice } from "@/types";
import { resolveCredentialsForDb } from "@/lib/credentials/resolve";
import { creaEsecutoreFinto, installaEsecutoreFinto, togliEsecutoreFinto } from "./support/esecutore-finto";

const UTENTE = "CLIENTE\\scansioni";
const PASSWORD = "S3greta!mai-nel-log";
const FUTURO = "2099-01-01T00:00:00.000Z";

type TipoGiro = "windows" | "credential_validate";
const TIPI: readonly TipoGiro[] = ["windows", "credential_validate"];

interface Host {
  ip: string;
  porte: number[];
  classification?: string;
}

interface Tenant {
  code: string;
  d: Database.Database;
  rete: number;
  host: Map<string, number>;
  ips: string[];
}

interface RigaCredenziale {
  credential_id: number;
  protocol_type: string;
  port: number;
  validated: number;
  fail_count: number;
  backoff_until: string | null;
  motivo: string | null;
  last_error: string | null;
  last_attempt_at: string | null;
}

const creati = new Set<string>();

function tenant(code: string, host: Host[]): Tenant {
  deleteTenantDatabase(code);
  creati.add(code);
  return withTenant(code, () => {
    const d = getTenantDb(code);
    const rete = Number(d.prepare("INSERT INTO networks (cidr, name) VALUES ('10.77.0.0/24', 'Clienti')").run().lastInsertRowid);
    const ins = d.prepare("INSERT INTO hosts (network_id, ip, status, open_ports, classification) VALUES (?, ?, 'online', ?, ?)");
    const mappa = new Map<string, number>();
    for (const h of host) {
      const json = h.porte.length ? JSON.stringify(h.porte.map((port) => ({ port, protocol: "tcp" }))) : null;
      mappa.set(h.ip, Number(ins.run(rete, h.ip, json, h.classification ?? null).lastInsertRowid));
    }
    return { code, d, rete, host: mappa, ips: host.map((h) => h.ip) };
  });
}

function voce(t: Tenant, nome: string, tipo = "windows", utente = UTENTE, password = PASSWORD): number {
  const id = Number(
    t.d.prepare("INSERT INTO credentials (name, credential_type, encrypted_username, encrypted_password) VALUES (?, ?, ?, ?)")
      .run(nome, tipo, encrypt(utente), encrypt(password)).lastInsertRowid,
  );
  t.d.prepare("INSERT INTO network_credentials (network_id, credential_id, sort_order) VALUES (?, ?, ?)").run(t.rete, id, id);
  return id;
}

function righe(t: Tenant, ip: string): RigaCredenziale[] {
  return t.d
    .prepare(
      `SELECT credential_id, protocol_type, port, validated, fail_count, backoff_until, motivo, last_error, last_attempt_at
       FROM host_credentials WHERE host_id = ? ORDER BY credential_id, protocol_type`,
    )
    .all(t.host.get(ip)) as RigaCredenziale[];
}

const ipDi = (n: number): string => `10.77.0.${n}`;
const hostUguali = (quanti: number, porte: number[]): Host[] =>
  Array.from({ length: quanti }, (_, i) => ({ ip: ipDi(i + 1), porte }));

/** Forma vera: `TCP_CLOSED` e `TCP_TIMEOUT` qui sono del controllo fatto prima del bridge. */
const dalControllo = (code: WinrmErrorCode): boolean => code === "TCP_CLOSED" || code === "TCP_TIMEOUT";
const rifiutoWinrm = (code: WinrmErrorCode = "AUTH_REJECTED") => new WinrmError({ code, message: `rifiuto ${code}`, primaDelBridge: dalControllo(code) });
const rifiutoWmi = (code: WinrmErrorCode = "AUTH_REJECTED") => new WmiError({ code, message: `rifiuto ${code}`, primaDelBridge: dalControllo(code) });

interface ScenaProve {
  password?: EsitoPassword;
  /** Il nome che dà la macchina, o l'errore che dà. Di serie rifiuta. */
  winrm?: (ip: string, username: string) => string | Error;
  wmi?: (ip: string, username: string) => string | Error;
  /** Le porte che il controllo TCP trova aperte su un host senza porte note. Di serie nessuna. */
  porte?: number[];
}

interface Banco {
  prove: ProveAccessoWindows;
  chiamate: { winrm: string[]; wmi: string[]; ldap: number[]; smb: string[]; sonde: string[] };
  /** Le fasi viste dalle prove durante il giro. */
  fasi: string[];
  leggiFase: { fn: () => string | undefined };
}

function banco(s: ScenaProve = {}): Banco {
  const chiamate: Banco["chiamate"] = { winrm: [], wmi: [], ldap: [], smb: [], sonde: [] };
  const fasi: string[] = [];
  const leggiFase: Banco["leggiFase"] = { fn: () => undefined };
  const annota = (): void => {
    const fase = leggiFase.fn();
    if (fase) fasi.push(fase);
  };
  const prove: ProveAccessoWindows = {
    async winrm(ip, _porta, username) {
      annota();
      chiamate.winrm.push(ip);
      const r = s.winrm ? s.winrm(ip, username) : rifiutoWinrm();
      if (r instanceof Error) throw r;
      return r;
    },
    async wmi(ip, username) {
      annota();
      chiamate.wmi.push(ip);
      const r = s.wmi ? s.wmi(ip, username) : rifiutoWmi();
      if (r instanceof Error) throw r;
      return { hostname: r };
    },
    async ldap(credId) {
      chiamate.ldap.push(credId);
      return s.password ?? "non_so";
    },
    async smb(_credId, ip) {
      chiamate.smb.push(ip);
      return "non_so";
    },
    async porteAperte(ip) {
      chiamate.sonde.push(ip);
      return s.porte ?? [];
    },
  };
  return { prove, chiamate, fasi, leggiFase };
}

function installaProve(b: Banco): void {
  (globalThis as Record<symbol, unknown>)[CHIAVE_PROVE_ACCESSO_WINDOWS] = b.prove;
}

afterEach(() => {
  delete (globalThis as Record<symbol, unknown>)[CHIAVE_PROVE_ACCESSO_WINDOWS];
  togliEsecutoreFinto();
});

after(() => {
  for (const c of creati) deleteTenantDatabase(c);
  closeHubDb();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

async function giro(t: Tenant, tipo: TipoGiro, b: Banco): Promise<string> {
  installaProve(b);
  installaEsecutoreFinto(creaEsecutoreFinto({ vivi: t.ips }).override);
  const avvio = await withTenant(t.code, () => discoverNetwork(t.rete, tipo, undefined, null, { targetIps: t.ips }));
  b.leggiFase.fn = () => avvio.progress.phase;
  const esito = await avvio.done;
  const log = (avvio.progress.logs ?? []).join("\n");
  assert.equal(esito.status, "completed", `${JSON.stringify(esito)}\n${log}`);
  return log;
}

/** Una riga già esistente su `host_credentials`. */
function riga(t: Tenant, ip: string, id: number, protocollo: string, porta: number, campi: { validated?: number; fail_count?: number } = {}): void {
  t.d.prepare("INSERT INTO host_credentials (host_id, credential_id, protocol_type, port, validated, fail_count) VALUES (?, ?, ?, ?, ?, ?)")
    .run(t.host.get(ip), id, protocollo, porta, campi.validated ?? 0, campi.fail_count ?? 0);
}

function apparato(t: Tenant, ip: string): number {
  return Number(
    t.d.prepare("INSERT INTO network_devices (name, host, device_type, vendor, protocol, port) VALUES ('pc', ?, 'server', 'windows', 'winrm', 5985)").run(ip).lastInsertRowid,
  );
}

function legame(t: Tenant, apparatoId: number, id: number, protocollo: string, porta: number): void {
  t.d.prepare("INSERT INTO device_credential_bindings (device_id, credential_id, protocol_type, port, test_status) VALUES (?, ?, ?, ?, 'success')")
    .run(apparatoId, id, protocollo, porta);
}

function statoLegame(t: Tenant, apparatoId: number, id: number, protocollo = "winrm"): string | undefined {
  const r = t.d.prepare("SELECT test_status FROM device_credential_bindings WHERE device_id = ? AND credential_id = ? AND protocol_type = ?").get(apparatoId, id, protocollo) as
    | { test_status: string }
    | undefined;
  return r?.test_status;
}

const riepilogo = (log: string): string => log.split("\n").find((r) => r.includes("Accesso Windows:")) ?? "";

let progressivo = 0;
const codice = (radice: string): string => `TESTDAW${radice}${++progressivo}`;

for (const tipo of TIPI) {
  describe(`${tipo}: i casi del piano`, () => {
    it("20 host con password valida, 17 rifiuti e 3 riusciti: nessuna esclusione", { timeout: 120_000 }, async () => {
      const t = tenant(codice("VENTI"), hostUguali(20, [5985]));
      const id = voce(t, "Scansioni");
      const b = banco({
        password: "valida",
        winrm: (ip) => (Number(ip.split(".")[3]) > 17 ? `PC-${ip.split(".")[3]}` : rifiutoWinrm()),
      });

      const log = await giro(t, tipo, b);

      assert.equal(b.chiamate.winrm.length, 20, "ogni host va provato");
      assert.equal(b.chiamate.ldap.length, 1, "la verifica è una per voce");
      assert.ok(!log.includes("esclusa"), `una voce è stata esclusa:\n${log}`);
      assert.match(riepilogo(log), /20 host/);
      assert.match(riepilogo(log), /3 accesso riuscito/);
      assert.match(riepilogo(log), /17 diritti mancanti/);
      assert.equal(righe(t, ipDi(1))[0].motivo, "diritti_mancanti");
      assert.deepEqual(
        { voce: righe(t, ipDi(20))[0].credential_id, validata: righe(t, ipDi(20))[0].validated, motivo: righe(t, ipDi(20))[0].motivo },
        { voce: id, validata: 1, motivo: "ok" },
      );
    });

    it("password errata: zero chiamate sulle macchine, nessun fallimento né fermo, nessuna riga nuova", async () => {
      const t = tenant(codice("ERRATA"), hostUguali(5, [135, 5985]));
      voce(t, "Scansioni");
      const b = banco({ password: "errata" });

      const log = await giro(t, tipo, b);

      assert.deepEqual([b.chiamate.winrm, b.chiamate.wmi], [[], []]);
      assert.equal(b.chiamate.ldap.length, 1);
      for (const ip of t.ips) assert.deepEqual(righe(t, ip), [], ip);
      assert.match(riepilogo(log), /5 password errata/);
    });

    it("password errata certa: tutte le righe e i legami della voce perdono la validazione, in una scrittura sola", async () => {
      const t = tenant(codice("ERRATARIGHE"), hostUguali(3, [5985]));
      const id = voce(t, "Scansioni");
      const altra = voce(t, "Altra", "windows", "CLIENTE\\altro");
      riga(t, ipDi(1), id, "winrm", 5985, { validated: 1, fail_count: 2 });
      riga(t, ipDi(2), id, "wmi", 135, { validated: 1 });
      riga(t, ipDi(1), altra, "winrm", 5985, { validated: 1 });
      const pc = apparato(t, ipDi(1));
      legame(t, pc, id, "winrm", 5985);
      legame(t, pc, altra, "winrm", 5985);
      t.d.exec(`
        CREATE TABLE scritture_prova (n INTEGER);
        CREATE TRIGGER conta_scritture AFTER UPDATE ON host_credentials WHEN NEW.credential_id = ${id}
        BEGIN INSERT INTO scritture_prova VALUES (1); END;
      `);
      const b = banco({ winrm: () => "PC" });
      b.prove.ldap = async (credId) => (credId === id ? "errata" : "valida");

      await giro(t, tipo, b);

      const stato = (ip: string, voceId: number) => righe(t, ip).filter((r) => r.credential_id === voceId).map((r) => [r.protocol_type, r.validated, r.fail_count, r.backoff_until, r.motivo]);
      assert.deepEqual(stato(ipDi(1), id), [["winrm", 0, 2, null, "password_errata"]]);
      assert.deepEqual(stato(ipDi(2), id), [["wmi", 0, 0, null, "password_errata"]]);
      assert.equal(statoLegame(t, pc, id), "failed");
      assert.equal(statoLegame(t, pc, altra), "success");
      assert.equal(righe(t, ipDi(1)).find((r) => r.credential_id === altra)?.validated, 1, "l'altra voce non c'entra");
      const scritture = t.d.prepare("SELECT COUNT(*) AS n FROM scritture_prova").get() as { n: number };
      assert.equal(scritture.n, 2, "due righe della voce, una scrittura: non una per host");
    });

    it("errata: il giro dopo non rifà il bind, e con una password nuova sì", async () => {
      const t = tenant(codice("ERRATADOPO"), hostUguali(2, [5985]));
      const id = voce(t, "Scansioni");
      const primo = banco({ password: "errata" });
      await giro(t, tipo, primo);
      assert.equal(primo.chiamate.ldap.length, 1);

      const secondo = banco({ password: "valida", winrm: () => "PC" });
      await giro(t, tipo, secondo);
      assert.deepEqual([secondo.chiamate.ldap, secondo.chiamate.winrm], [[], []], "la risposta certa vale fra i giri");

      t.d.prepare("UPDATE credentials SET encrypted_password = ? WHERE id = ?").run(encrypt("Password-nuova!1"), id);
      const terzo = banco({ password: "valida", winrm: () => "PC" });
      await giro(t, tipo, terzo);
      assert.equal(terzo.chiamate.ldap.length, 1, "un'altra password è un'altra domanda");
    });

    it("5985 e 135 chiuse: zero chiamate e budget intatto, l'host dopo si prova ancora", async () => {
      const t = tenant(codice("CHIUSE"), [...hostUguali(5, [445]), { ip: ipDi(6), porte: [5985] }]);
      voce(t, "Scansioni");
      const b = banco({ winrm: () => "PC-6" });

      const log = await giro(t, tipo, b);

      assert.deepEqual(b.chiamate.winrm, [ipDi(6)], "solo l'host con la porta aperta");
      assert.deepEqual(b.chiamate.wmi, []);
      assert.deepEqual(b.chiamate.ldap.length, 1, "la verifica è partita solo per l'host aperto");
      assert.ok(!log.includes("esclusa"), log);
      for (const ip of t.ips.slice(0, 5)) assert.deepEqual(righe(t, ip), [], `${ip}: un motivo non crea righe`);
      assert.match(riepilogo(log), /5 porte chiuse/);
    });

    it("una porta scoperta chiusa durante la prova non tocca né fail_count né validated", async () => {
      const t = tenant(codice("RST"), hostUguali(1, [5985]));
      const id = voce(t, "Scansioni");
      t.d.prepare(
        "INSERT INTO host_credentials (host_id, credential_id, protocol_type, port, validated, fail_count) VALUES (?, ?, 'winrm', 5985, 1, 2)",
      ).run(t.host.get(ipDi(1)), id);

      await giro(t, tipo, banco({ winrm: () => rifiutoWinrm("TCP_CLOSED") }));

      const [r] = righe(t, ipDi(1));
      assert.deepEqual([r.fail_count, r.backoff_until, r.validated, r.motivo], [2, null, 1, "porte_chiuse"]);
    });

    it("password non verificabile: dopo 3 rifiuti si ferma, gli host dopo non contano fallimenti", async () => {
      const t = tenant(codice("LIMITE"), hostUguali(5, [5985]));
      voce(t, "Scansioni");
      const b = banco();

      const log = await giro(t, tipo, b);

      assert.equal(b.chiamate.winrm.length, 3);
      assert.match(log, /esclusa/);
      for (const ip of t.ips.slice(0, 3)) {
        const [r] = righe(t, ip);
        assert.equal(r.fail_count, 1, ip);
        assert.ok(r.backoff_until, ip);
        assert.equal(r.motivo, "errore", ip);
      }
      for (const ip of t.ips.slice(3)) assert.deepEqual(righe(t, ip), [], `${ip}: un motivo non crea righe`);
      assert.match(riepilogo(log), /2 budget esaurito/);
    });

    it("WMI riuscito: riga wmi sulla 135, motivo ok, legame dell'apparato sulla 135", async () => {
      const t = tenant(codice("WMIOK"), hostUguali(1, [135, 445]));
      const id = voce(t, "Scansioni");
      const apparato = Number(
        t.d.prepare("INSERT INTO network_devices (name, host, device_type, vendor, protocol, port) VALUES ('pc', ?, 'server', 'windows', 'winrm', 5985)")
          .run(ipDi(1)).lastInsertRowid,
      );
      const b = banco({ password: "valida", wmi: () => "PC-WMI" });

      const log = await giro(t, tipo, b);

      assert.deepEqual(b.chiamate.winrm, [], "con la sola 135 WinRM non si prova");
      const [r] = righe(t, ipDi(1));
      assert.deepEqual([r.credential_id, r.protocol_type, r.port, r.validated, r.motivo], [id, "wmi", 135, 1, "ok"]);
      const legame = t.d.prepare("SELECT protocol_type, port, test_status FROM device_credential_bindings WHERE device_id = ?").get(apparato);
      assert.deepEqual({ ...(legame as object) }, { protocol_type: "wmi", port: 135, test_status: "success" });
      assert.match(log, /WMI/);
    });

    it("WMI rifiutato dopo WinRM rifiutato, password valida: due tentativi, un fallimento per strada", async () => {
      const t = tenant(codice("DUE"), hostUguali(1, [135, 5985]));
      voce(t, "Scansioni");
      const b = banco({ password: "valida" });

      await giro(t, tipo, b);

      assert.equal(b.chiamate.winrm.length, 1);
      assert.equal(b.chiamate.wmi.length, 1);
      assert.deepEqual(righe(t, ipDi(1)).map((r) => [r.protocol_type, r.port, r.fail_count, r.motivo]), [
        ["winrm", 5985, 1, "diritti_mancanti"],
        ["wmi", 135, 1, "diritti_mancanti"],
      ]);
    });

    it("WinRM rifiutato e WMI riuscito: fallimento sulla riga e sul legame winrm, il login passa a wmi, il giro dopo non riprova WinRM", async () => {
      const t = tenant(codice("PASSAGGIO"), hostUguali(1, [135, 5985]));
      const id = voce(t, "Scansioni");
      const pc = apparato(t, ipDi(1));
      riga(t, ipDi(1), id, "winrm", 5985, { validated: 1 });
      legame(t, pc, id, "winrm", 5985);
      const b = banco({ password: "valida", wmi: () => "PC-WMI" });

      await giro(t, tipo, b);

      assert.deepEqual(righe(t, ipDi(1)).map((r) => [r.protocol_type, r.validated, r.fail_count, r.motivo]), [
        ["winrm", 0, 1, "diritti_mancanti"],
        ["wmi", 1, 0, "ok"],
      ]);
      assert.equal(statoLegame(t, pc, id, "winrm"), "failed");
      assert.equal(statoLegame(t, pc, id, "wmi"), "success");
      const device = withTenant(t.code, () => getNetworkDeviceById(pc));
      assert.ok(device);
      assert.equal(withTenant(t.code, () => facade.getDeviceCredentials(device))?.protocollo, "wmi");

      const dopo = banco({ password: "valida", wmi: () => "PC-WMI" });
      await giro(t, tipo, dopo);
      assert.deepEqual([dopo.chiamate.winrm.length, dopo.chiamate.wmi.length], [0, 1]);
    });

    it("la strada già validata si prova per prima: con WMI validata WinRM non parte", async () => {
      const t = tenant(codice("PRIMAWMI"), hostUguali(1, [135, 5985]));
      const id = voce(t, "Scansioni");
      riga(t, ipDi(1), id, "wmi", 135, { validated: 1 });
      const b = banco({ password: "valida", wmi: () => "PC-WMI", winrm: () => "PC-WINRM" });

      await giro(t, tipo, b);

      assert.deepEqual([b.chiamate.winrm.length, b.chiamate.wmi.length], [0, 1]);
    });

    it("firewall: validated e legame restano, solo ultimo errore e motivo, nessun fallimento, le altre voci non si provano", async () => {
      const t = tenant(codice("FIREWALL"), hostUguali(1, [135, 5985]));
      const id = voce(t, "Prima");
      const seconda = voce(t, "Seconda", "windows", "CLIENTE\\altro");
      const pc = apparato(t, ipDi(1));
      riga(t, ipDi(1), id, "winrm", 5985, { validated: 1 });
      riga(t, ipDi(1), id, "wmi", 135, { validated: 1 });
      legame(t, pc, id, "winrm", 5985);
      const b = banco({ password: "valida", winrm: () => rifiutoWinrm("TCP_TIMEOUT"), wmi: () => rifiutoWmi("TCP_TIMEOUT") });

      const log = await giro(t, tipo, b);

      assert.deepEqual([b.chiamate.winrm.length, b.chiamate.wmi.length], [1, 1], "un host muto non si riprova con la voce dopo");
      assert.deepEqual(righe(t, ipDi(1)).filter((r) => r.credential_id === seconda), []);
      for (const r of righe(t, ipDi(1))) {
        assert.deepEqual([r.validated, r.fail_count, r.backoff_until, r.motivo], [1, 0, null, "firewall"], r.protocol_type);
        assert.match(r.last_error ?? "", /firewall/);
        assert.ok(r.last_attempt_at);
      }
      assert.equal(statoLegame(t, pc, id), "success");
      assert.ok(!log.includes("esclusa"), log);
    });

    it("errore non di autenticazione: validated e legame restano, e c'è il fermo", async () => {
      const t = tenant(codice("GUASTO"), hostUguali(1, [5985]));
      const id = voce(t, "Scansioni");
      const pc = apparato(t, ipDi(1));
      riga(t, ipDi(1), id, "winrm", 5985, { validated: 1 });
      legame(t, pc, id, "winrm", 5985);

      await giro(t, tipo, banco({ password: "valida", winrm: () => rifiutoWinrm("UNKNOWN") }));

      const [r] = righe(t, ipDi(1));
      assert.deepEqual([r.validated, r.fail_count, r.motivo], [1, 1, "errore"]);
      assert.ok(r.backoff_until);
      assert.match(r.last_error ?? "", /rifiuto UNKNOWN/);
      assert.equal(statoLegame(t, pc, id), "success");
    });

    it("BRIDGE_TIMEOUT con la password non verificata: conta sul limite, ma non è un rifiuto vero", async () => {
      const t = tenant(codice("BRIDGE"), hostUguali(5, [5985]));
      const id = voce(t, "Scansioni");
      const pc = apparato(t, ipDi(1));
      riga(t, ipDi(1), id, "winrm", 5985, { validated: 1 });
      legame(t, pc, id, "winrm", 5985);
      const b = banco({ winrm: () => rifiutoWinrm("BRIDGE_TIMEOUT") });

      const log = await giro(t, tipo, b);

      assert.equal(b.chiamate.winrm.length, 3);
      assert.match(log, /esclusa/);
      const [r] = righe(t, ipDi(1));
      assert.deepEqual([r.validated, r.fail_count, r.motivo], [1, 1, "errore"]);
      assert.equal(statoLegame(t, pc, id), "success");
    });

    it("rifiuto con la catena completa: la riga e il legame perdono la validazione", async () => {
      const t = tenant(codice("VERO"), hostUguali(1, [5985]));
      const id = voce(t, "Scansioni");
      const pc = apparato(t, ipDi(1));
      riga(t, ipDi(1), id, "winrm", 5985, { validated: 1 });
      legame(t, pc, id, "winrm", 5985);

      await giro(t, tipo, banco({ password: "valida" }));

      const [r] = righe(t, ipDi(1));
      assert.deepEqual([r.validated, r.fail_count, r.motivo], [0, 1, "diritti_mancanti"]);
      assert.equal(statoLegame(t, pc, id), "failed");
    });

    it("due voci con lo stesso account: una verifica, tre logon in tutto il giro", async () => {
      const t = tenant(codice("STESSO"), hostUguali(6, [5985]));
      voce(t, "Una");
      voce(t, "Due");
      const b = banco();

      await giro(t, tipo, b);

      assert.equal(b.chiamate.ldap.length, 1);
      assert.equal(b.chiamate.winrm.length, 3);
    });

    it("rifiuto registrato sulla porta vera: la 135, con solo WMI", async () => {
      const t = tenant(codice("P135"), hostUguali(1, [135]));
      voce(t, "Scansioni");

      await giro(t, tipo, banco({ password: "valida" }));

      const [r] = righe(t, ipDi(1));
      assert.deepEqual([r.protocol_type, r.port, r.fail_count, r.motivo], ["wmi", 135, 1, "diritti_mancanti"]);
      assert.ok(r.backoff_until);
    });

    it("una voce riuscita via WMI ferma le voci dopo, su tutte e due le strade", async () => {
      const t = tenant(codice("STOPWMI"), hostUguali(1, [135, 5985]));
      voce(t, "Prima");
      voce(t, "Seconda", "windows", "CLIENTE\\altro");
      const b = banco({ password: "valida", winrm: () => rifiutoWinrm("TCP_TIMEOUT"), wmi: () => "PC-WMI" });

      await giro(t, tipo, b);

      assert.equal(b.chiamate.wmi.length, 1, "la seconda voce non va provata via WMI");
      assert.equal(b.chiamate.winrm.length, 1, "la seconda voce non va provata via WinRM");
    });

    it("backoff di WMI: WMI non parte, WinRM sì", async () => {
      const t = tenant(codice("FERMOWMI"), hostUguali(1, [135, 5985]));
      const id = voce(t, "Scansioni");
      t.d.prepare(
        "INSERT INTO host_credentials (host_id, credential_id, protocol_type, port, fail_count, backoff_until) VALUES (?, ?, 'wmi', 135, 1, ?)",
      ).run(t.host.get(ipDi(1)), id, FUTURO);
      const b = banco({ password: "valida" });

      await giro(t, tipo, b);

      assert.equal(b.chiamate.winrm.length, 1);
      assert.deepEqual(b.chiamate.wmi, []);
    });

    it("tutte le strade in backoff: nessun login, e l'ultimo motivo vero resta com'era", async () => {
      const t = tenant(codice("FERMO"), hostUguali(1, [135, 5985]));
      const id = voce(t, "Scansioni");
      const ins = t.d.prepare(
        "INSERT INTO host_credentials (host_id, credential_id, protocol_type, port, fail_count, backoff_until, motivo) VALUES (?, ?, ?, ?, 2, ?, 'diritti_mancanti')",
      );
      ins.run(t.host.get(ipDi(1)), id, "winrm", 5985, FUTURO);
      ins.run(t.host.get(ipDi(1)), id, "wmi", 135, FUTURO);
      const b = banco({ password: "valida" });

      const log = await giro(t, tipo, b);

      assert.deepEqual([b.chiamate.winrm, b.chiamate.wmi], [[], []]);
      for (const r of righe(t, ipDi(1))) assert.deepEqual([r.fail_count, r.motivo], [2, "diritti_mancanti"]);
      assert.match(log, /backoff/);
      assert.deepEqual(b.chiamate.ldap, [], "con tutte le strade in fermo niente bind");
      assert.ok(!riepilogo(log).includes("errore"), `una voce in fermo non è un errore: ${riepilogo(log)}`);
    });

    it("colonna motivo assente: un errore solo nel log, la scansione finisce", async () => {
      const t = tenant(codice("NOMOTIVO"), hostUguali(3, [5985]));
      const id = voce(t, "Scansioni");
      riga(t, ipDi(1), id, "winrm", 5985, { validated: 1 });
      t.d.exec("ALTER TABLE host_credentials DROP COLUMN motivo");
      const b = banco({ password: "valida", winrm: (ip) => (ip === ipDi(2) ? rifiutoWinrm() : "PC") });

      const log = await giro(t, tipo, b);

      assert.equal(b.chiamate.winrm.length, 3, "un tenant guasto non ferma le prove");
      assert.equal(log.split("\n").filter((r) => r.includes("colonna motivo")).length, 1, log);
    });

    it("nel log né utente né password, anche se l'errore li riporta", async () => {
      const t = tenant(codice("LOG"), hostUguali(1, [5985]));
      voce(t, "Scansioni");
      const messaggio = `impossibile accedere come ${UTENTE} con ${PASSWORD}`;

      const log = await giro(t, tipo, banco({ password: "valida", winrm: () => new WinrmError({ code: "UNKNOWN", message: messaggio }) }));

      assert.ok(!log.includes(PASSWORD), log);
      assert.ok(!log.includes("scansioni"), log);
      assert.ok(!riepilogo(log).includes("#"), `il riepilogo non nomina le voci: ${riepilogo(log)}`);
      const [r] = righe(t, ipDi(1));
      assert.ok(!(r.last_error ?? "").includes(PASSWORD));
    });

    it("le fasi e il log dicono la strada e il motivo", async () => {
      const t = tenant(codice("FASE"), hostUguali(3, [135]));
      voce(t, "Scansioni");
      const b = banco({ password: "valida" });

      const log = await giro(t, tipo, b);

      assert.ok(b.fasi.some((f) => f.includes("WMI") && f.includes("diritti mancanti")), `fasi: ${b.fasi.join(" | ")}`);
      assert.match(log, /WMI: password giusta, accesso negato/);
    });

    it("tenant non migrato: un errore solo nel log, la scansione finisce, gli altri esiti restano, nessun fermo", async () => {
      const t = tenant(codice("CHECK"), [
        { ip: ipDi(1), porte: [5985] },
        { ip: ipDi(2), porte: [135, 443] },
        { ip: ipDi(3), porte: [135] },
        { ip: ipDi(4), porte: [135] },
      ]);
      t.d.exec(`
        DROP TABLE host_credentials;
        CREATE TABLE host_credentials (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
          credential_id INTEGER NOT NULL REFERENCES credentials(id) ON DELETE CASCADE,
          protocol_type TEXT NOT NULL CHECK(protocol_type IN ('ssh', 'snmp', 'winrm', 'api', 'redfish', 'onvif')),
          port INTEGER NOT NULL,
          validated INTEGER NOT NULL DEFAULT 0,
          validated_at TEXT,
          sort_order INTEGER NOT NULL DEFAULT 0,
          auto_detected INTEGER NOT NULL DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now')),
          fail_count INTEGER NOT NULL DEFAULT 0,
          last_error TEXT,
          last_attempt_at TEXT,
          backoff_until TEXT,
          motivo TEXT,
          UNIQUE(host_id, credential_id, protocol_type, port)
        );
      `);
      const id = voce(t, "Scansioni");
      const api = tipo === "credential_validate" ? voce(t, "Api", "api") : null;
      const b = banco({
        password: "valida",
        winrm: () => "PC-1",
        wmi: (ip) => (ip === ipDi(4) ? rifiutoWmi() : "PC-WMI"),
      });

      const log = await giro(t, tipo, b);

      assert.equal(b.chiamate.wmi.length, 3, "un tenant guasto non ferma le prove");
      assert.equal(log.split("\n").filter((r) => r.includes("non accetta il protocollo wmi")).length, 1, log);
      assert.equal(righe(t, ipDi(1)).find((r) => r.credential_id === id)?.validated, 1, "l'esito WinRM è perso");
      if (api != null) {
        assert.ok(righe(t, ipDi(2)).some((r) => r.credential_id === api && r.protocol_type === "api"), "l'esito di un altro protocollo è perso");
      }
      assert.deepEqual(righe(t, ipDi(3)), [], "nessun fermo su un host dove la riga non si può scrivere");
      assert.deepEqual(righe(t, ipDi(4)), []);
      assert.match(riepilogo(log), /3 accesso riuscito/);
    });
  });
}

describe("windows: il nome host e la catena", () => {
  it("il nome che la macchina dà va sull'host; se WMI, la 135 entra fra le porte", async () => {
    const t = tenant(codice("NOME"), hostUguali(1, [135, 445]));
    voce(t, "Scansioni");

    await giro(t, "windows", banco({ password: "valida", wmi: () => "PC-CONTAB" }));

    const h = t.d.prepare("SELECT hostname, open_ports FROM hosts WHERE ip = ?").get(ipDi(1)) as { hostname: string; open_ports: string };
    assert.equal(h.hostname, "PC-CONTAB");
    const porte = (JSON.parse(h.open_ports) as Array<{ port: number }>).map((p) => p.port);
    assert.ok(porte.includes(135) && porte.includes(445), `porte perse: ${porte.join(",")}`);
  });

  it("un output che non è un nome (stderr nello stdout) non è un accesso: niente nome, ma il logon è passato", async () => {
    const t = tenant(codice("NONOME"), hostUguali(1, [5985]));
    voce(t, "Scansioni");

    const log = await giro(t, "windows", banco({ password: "valida", winrm: () => "bad command name hostname (line 1 column 1)" }));

    const [r] = righe(t, ipDi(1));
    assert.deepEqual([r.validated, r.fail_count, r.backoff_until, r.motivo], [0, 0, null, "errore"]);
    assert.match(r.last_error ?? "", /non è un nome host/);
    const h = t.d.prepare("SELECT hostname FROM hosts WHERE ip = ?").get(ipDi(1)) as { hostname: string | null };
    assert.equal(h.hostname, null);
    assert.match(riepilogo(log), /1 errore/);
  });

  it("nome non valido su una riga validata: validated e legame restano, niente budget", async () => {
    const t = tenant(codice("NONOMEV"), hostUguali(4, [5985]));
    const id = voce(t, "Scansioni");
    const pc = apparato(t, ipDi(1));
    riga(t, ipDi(1), id, "winrm", 5985, { validated: 1 });
    legame(t, pc, id, "winrm", 5985);
    const b = banco({ winrm: () => "bad command name" });

    const log = await giro(t, "windows", b);

    const [r] = righe(t, ipDi(1));
    assert.deepEqual([r.validated, r.fail_count, r.backoff_until, r.motivo], [1, 0, null, "errore"]);
    assert.equal(statoLegame(t, pc, id), "success");
    assert.equal(b.chiamate.winrm.length, 4, "non è un logon errato: non consuma il limite");
    assert.ok(!log.includes("esclusa"), log);
  });

  it("la voce validata via WMI si prova per prima, prima di quella che su quell'host non è mai entrata", async () => {
    const t = tenant(codice("PRIMA"), hostUguali(1, [135]));
    voce(t, "Prima della lista", "windows", "CLIENTE\\primo");
    const giusta = voce(t, "Seconda della lista", "windows", "CLIENTE\\secondo");
    t.d.prepare(
      "INSERT INTO host_credentials (host_id, credential_id, protocol_type, port, validated, validated_at) VALUES (?, ?, 'wmi', 135, 1, datetime('now'))",
    ).run(t.host.get(ipDi(1)), giusta);
    const utenti: string[] = [];
    const b = banco({
      password: "valida",
      wmi: (_ip, username) => {
        utenti.push(username);
        return "PC-WMI";
      },
    });

    await giro(t, "windows", b);

    assert.deepEqual(utenti, ["CLIENTE\\secondo"]);
  });

  it("un host con due voci conta una volta, col motivo più utile, non con l'ultimo", async () => {
    const t = tenant(codice("DUEVOCI"), hostUguali(1, [5985]));
    const sbagliata = voce(t, "Password sbagliata", "windows", "CLIENTE\\primo");
    voce(t, "Senza diritti", "windows", "CLIENTE\\secondo");
    const b = banco();
    b.prove.ldap = async (credId) => (credId === sbagliata ? "errata" : "valida");

    const log = await giro(t, "windows", b);

    assert.match(riepilogo(log), /1 host — 1 password errata$/);
  });

  it("un host senza voci dice «nessuna voce» nel riepilogo", async () => {
    const t = tenant(codice("NOVOCE"), hostUguali(2, [5985]));

    const log = await giro(t, "windows", banco());

    assert.match(riepilogo(log), /2 nessuna voce/);
  });
});

describe("credential_validate: evidenze e host non Windows", () => {
  const evidenze = (t: Tenant) =>
    t.d.prepare("SELECT source, dimension, claim FROM attribution_evidence WHERE host_id = ? AND phase = 'credential_validate'").all(t.host.get(ipDi(1)));

  it("accesso riuscito via WMI: l'host è Windows, come via WinRM", async () => {
    const t = tenant(codice("EVWMI"), hostUguali(1, [135]));
    voce(t, "Scansioni");

    await giro(t, "credential_validate", banco({ password: "valida", wmi: () => "PC-WMI" }));

    assert.deepEqual(evidenze(t).map((e) => ({ ...(e as object) })), [{ source: "winrm", dimension: "os", claim: "windows" }]);
  });

  it("WinRM rifiutato: il servizio c'è, evidenza debole; timeout: nessuna evidenza", async () => {
    const rifiutato = tenant(codice("EVNO"), hostUguali(1, [5985]));
    voce(rifiutato, "Scansioni");
    await giro(rifiutato, "credential_validate", banco({ password: "valida" }));
    assert.deepEqual(evidenze(rifiutato).map((e) => ({ ...(e as object) })), [{ source: "winrm", dimension: "category", claim: "compute" }]);

    const muto = tenant(codice("EVTO"), hostUguali(1, [5985]));
    voce(muto, "Scansioni");
    await giro(muto, "credential_validate", banco({ password: "valida", winrm: () => rifiutoWinrm("TCP_TIMEOUT") }));
    assert.deepEqual(evidenze(muto), []);
  });

  it("host senza alcun segno di Windows: nessuna riga e nessuna chiamata, il no si legge nel log", async () => {
    const t = tenant(codice("LINUX"), [{ ip: ipDi(1), porte: [22] }]);
    voce(t, "Scansioni");
    const b = banco();

    const log = await giro(t, "credential_validate", b);

    assert.deepEqual([b.chiamate.winrm, b.chiamate.wmi, b.chiamate.ldap], [[], [], []]);
    assert.deepEqual(righe(t, ipDi(1)), []);
    assert.match(log, new RegExp(`⏭ ${ipDi(1).replaceAll(".", "\\.")} cred#`));
    assert.equal(riepilogo(log), "");
  });

  it("host Windows senza porte note e macchina spenta: porte chiuse nel riepilogo, nessuna riga fra le credenziali", async () => {
    const t = tenant(codice("CLASSE"), [{ ip: ipDi(1), porte: [], classification: "workstation" }]);
    voce(t, "Scansioni");
    const b = banco({ winrm: () => rifiutoWinrm("TCP_CLOSED"), wmi: () => rifiutoWmi("TCP_CLOSED") });

    const log = await giro(t, "credential_validate", b);

    assert.deepEqual(righe(t, ipDi(1)), []);
    assert.match(riepilogo(log), /1 porte chiuse/);
  });

  it("host Windows e nessuna voce Windows nella rete: «nessuna voce» nel riepilogo", async () => {
    const t = tenant(codice("SOLOAPI"), hostUguali(1, [5985]));
    voce(t, "Api", "api");

    const log = await giro(t, "credential_validate", banco());

    assert.match(riepilogo(log), /1 nessuna voce/);
  });
});

describe("gli esiti senza riga in host_credentials", () => {
  const esiti = (t: Tenant, ip: string): Array<{ strada: string; motivo: string }> =>
    t.d.prepare("SELECT strada, motivo FROM accesso_windows_esiti WHERE host_id = ? ORDER BY strada").all(t.host.get(ip)) as Array<{ strada: string; motivo: string }>;

  for (const tipo of TIPI) {
    it(`${tipo}: porte chiuse su tutte e due le strade, nessuna riga fra le credenziali dell'host`, async () => {
      const t = tenant(codice("ESITOCHIUSO"), hostUguali(1, [445]));
      voce(t, "Scansioni");
      await giro(t, tipo, banco({ password: "non_so" }));
      assert.deepEqual(esiti(t, ipDi(1)), [{ strada: "winrm", motivo: "porte_chiuse" }, { strada: "wmi", motivo: "porte_chiuse" }]);
      assert.deepEqual(righe(t, ipDi(1)), []);
    });

    it(`${tipo}: ogni strada provata ha il suo esito`, async () => {
      const t = tenant(codice("ESITOSTRADE"), hostUguali(1, [5985, 135]));
      voce(t, "Scansioni");
      await giro(t, tipo, banco({ password: "valida", wmi: () => "PC-1" }));
      assert.deepEqual(esiti(t, ipDi(1)), [{ strada: "winrm", motivo: "diritti_mancanti" }, { strada: "wmi", motivo: "ok" }]);
    });

    it(`${tipo}: password errata, una riga per host provato, anche senza righe in host_credentials`, async () => {
      const t = tenant(codice("ESITOERRATA"), hostUguali(3, [5985, 135]));
      voce(t, "Scansioni");
      const b = banco({ password: "errata" });
      await giro(t, tipo, b);
      assert.equal(b.chiamate.ldap.length, 1);
      for (const n of [1, 2, 3]) assert.deepEqual(esiti(t, ipDi(n)), [{ strada: "winrm", motivo: "password_errata" }], ipDi(n));
    });
  }

  it("una voce in fermo non è stata provata: niente esito", async () => {
    const t = tenant(codice("ESITOFERMO"), hostUguali(1, [5985]));
    const id = voce(t, "Scansioni");
    t.d.prepare("INSERT INTO host_credentials (host_id, credential_id, protocol_type, port, backoff_until) VALUES (?, ?, 'winrm', 5985, ?)").run(t.host.get(ipDi(1)), id, FUTURO);
    await giro(t, "credential_validate", banco({ password: "valida", winrm: () => "PC" }));
    assert.deepEqual(esiti(t, ipDi(1)), []);
  });
});

describe("il fermo illeggibile: nessun logon, e il giro va avanti", () => {
  const guastoSu = (ip: string, protocollo: string): NonNullable<ProveAccessoWindows["candidati"]> => (dbh, target, proto, opzioni) => {
    if (target.ip === ip && proto === protocollo) throw new Error("database guasto");
    return resolveCredentialsForDb(dbh, target, proto, opzioni);
  };

  it("credential_validate: un guasto del database su tutto: un errore per host, nessun logon, il giro finisce", async () => {
    const t = tenant(codice("RIGOROSO"), hostUguali(2, [5985]));
    voce(t, "Scansioni");
    t.d.exec("DROP TABLE host_credentials");
    const b = banco({ password: "valida", winrm: () => "PC" });
    const log = await giro(t, "credential_validate", b);
    assert.deepEqual(b.chiamate.winrm, [], "con il fermo illeggibile non si fa nessun logon");
    assert.equal(log.split("\n").filter((r) => r.includes("credenziali dell'host non leggibili")).length, 2, log);
  });

  it("credential_validate: il guasto su un host non ferma gli altri", async () => {
    const t = tenant(codice("GUASTOHOST"), hostUguali(2, [5985]));
    const id = voce(t, "Scansioni");
    const b = banco({ password: "valida", winrm: () => "PC" });
    b.prove = { ...b.prove, candidati: guastoSu(ipDi(1), "wmi") };
    const log = await giro(t, "credential_validate", b);
    assert.deepEqual(b.chiamate.winrm, [ipDi(2)]);
    assert.deepEqual(righe(t, ipDi(2)).map((r) => [r.credential_id, r.motivo]), [[id, "ok"]]);
    assert.match(log, new RegExp(`${ipDi(1).replaceAll(".", "\\.")}.*credenziali dell'host non leggibili`));
  });

  it("credential_validate: il guasto sui candidati Windows non ferma SSH sullo stesso host", async () => {
    const t = tenant(codice("GUASTOSSH"), [{ ip: "127.0.0.1", porte: [22, 5985] }]);
    t.d.prepare("UPDATE networks SET cidr = '127.0.0.0/24'").run();
    voce(t, "Scansioni");
    const ssh = voce(t, "Accesso SSH", "ssh", "utente-prova", "password-finta-di-prova");
    const b = banco({ password: "valida", winrm: () => "PC" });
    b.prove = { ...b.prove, candidati: guastoSu("127.0.0.1", "winrm") };
    await giro(t, "credential_validate", b);
    assert.deepEqual(b.chiamate.winrm, []);
    assert.deepEqual(righe(t, "127.0.0.1").map((r) => [r.credential_id, r.protocol_type]), [[ssh, "ssh"]], "la prova SSH è partita");
  });

  it("windows: il guasto su un host non ferma gli altri", async () => {
    const t = tenant(codice("GUASTOWIN"), hostUguali(2, [5985]));
    voce(t, "Scansioni");
    const b = banco({ password: "valida", winrm: () => "PC" });
    b.prove = { ...b.prove, candidati: guastoSu(ipDi(1), "wmi") };
    const log = await giro(t, "windows", b);
    assert.deepEqual(b.chiamate.winrm, [ipDi(2)]);
    assert.match(log, /credenziali dell'host non leggibili/);
  });
});

describe("un host Windows senza porte note", () => {
  const scena = (): Tenant => tenant(codice("SENZAPORTE"), [{ ip: ipDi(1), porte: [], classification: "windows_server" }]);

  it("il controllo TCP chiude il caso prima di tutto: niente logon, LDAP né SMB, porte chiuse su tutte e due le strade", async () => {
    const t = scena();
    voce(t, "Scansioni");
    const b = banco({ password: "non_so" });
    await giro(t, "credential_validate", b);
    assert.deepEqual([b.chiamate.winrm, b.chiamate.wmi, b.chiamate.ldap, b.chiamate.smb], [[], [], [], []]);
    assert.deepEqual(b.chiamate.sonde, [ipDi(1)]);
    const esiti = t.d.prepare("SELECT strada, motivo FROM accesso_windows_esiti ORDER BY strada").all();
    assert.deepEqual(esiti, [{ strada: "winrm", motivo: "porte_chiuse" }, { strada: "wmi", motivo: "porte_chiuse" }]);
    assert.deepEqual(righe(t, ipDi(1)), []);
  });

  it("il controllo si fa una volta per host, non una per voce", async () => {
    const t = scena();
    voce(t, "Prima");
    voce(t, "Seconda", "windows", "CLIENTE\\altra");
    const b = banco({ password: "non_so" });
    await giro(t, "credential_validate", b);
    assert.deepEqual(b.chiamate.sonde, [ipDi(1)]);
  });

  it("al motore arrivano le porte vere: con la sola 5986 si prova WinRM su quella, e WMI no", async () => {
    const t = scena();
    const id = voce(t, "Scansioni");
    const b = banco({ password: "valida", winrm: () => "PC-1", porte: [5986] });
    await giro(t, "credential_validate", b);
    assert.deepEqual(b.chiamate.wmi, []);
    assert.deepEqual(righe(t, ipDi(1)).map((r) => [r.credential_id, r.port, r.motivo, r.validated]), [[id, 5986, "ok", 1]]);
  });

  it("se la macchina risponde si entra: prima diceva «porte chiuse» senza provare", async () => {
    const t = scena();
    const id = voce(t, "Scansioni");
    await giro(t, "credential_validate", banco({ password: "valida", winrm: () => "PC-1", porte: [5985, 135] }));
    assert.deepEqual(righe(t, ipDi(1)).map((r) => [r.credential_id, r.motivo, r.validated]), [[id, "ok", 1]]);
  });
});

describe("il riepilogo di fine giro", () => {
  it("una scrittura che fallisce non fa fallire un giro finito: lo dice nel registro", async () => {
    const t = tenant(codice("RIEPILOGO"), hostUguali(2, [5985]));
    voce(t, "Scansioni");
    t.d.exec("CREATE TRIGGER guasto_esiti BEFORE INSERT ON accesso_windows_esiti BEGIN SELECT RAISE(ABORT, 'guasto di prova'); END");
    const log = await giro(t, "credential_validate", banco({ password: "errata" }));
    assert.match(log, /Accesso Windows: riepilogo non scritto/);
  });
});

describe("un rifiuto con il solo NTLM", () => {
  for (const tipo of TIPI) {
    it(`${tipo}: password non verificata, riga già validata: la validazione resta, sale solo il fermo`, async () => {
      const t = tenant(codice("NTLMVALID"), hostUguali(1, [5985]));
      const id = voce(t, "Scansioni");
      riga(t, ipDi(1), id, "winrm", 5985, { validated: 1 });
      const pc = apparato(t, ipDi(1));
      legame(t, pc, id, "winrm", 5985);
      await giro(t, tipo, banco({ password: "non_so" }));
      const [r] = righe(t, ipDi(1));
      assert.deepEqual([r.validated, r.fail_count, r.motivo], [1, 1, "errore"]);
      assert.ok(r.backoff_until, "il fermo c'è");
      assert.equal(statoLegame(t, pc, id), "success", "una macchina solo Kerberos non perde il legame");
    });

    it(`${tipo}: password non verificata, riga non validata: fallimento pieno`, async () => {
      const t = tenant(codice("NTLMNUOVA"), hostUguali(1, [5985]));
      const id = voce(t, "Scansioni");
      const pc = apparato(t, ipDi(1));
      legame(t, pc, id, "winrm", 5985);
      await giro(t, tipo, banco({ password: "non_so" }));
      const [r] = righe(t, ipDi(1));
      assert.deepEqual([r.validated, r.fail_count], [0, 1]);
      assert.equal(statoLegame(t, pc, id), "failed");
    });

    it(`${tipo}: password valida, riga validata: fallimento pieno, la catena completa ha detto no`, async () => {
      const t = tenant(codice("VALIDAPIENO"), hostUguali(1, [5985]));
      const id = voce(t, "Scansioni");
      riga(t, ipDi(1), id, "winrm", 5985, { validated: 1 });
      await giro(t, tipo, banco({ password: "valida" }));
      const [r] = righe(t, ipDi(1));
      assert.deepEqual([r.validated, r.fail_count, r.motivo], [0, 1, "diritti_mancanti"]);
    });
  }
});

describe("il tetto della prova WinRM", () => {
  it("il motore arriva al bridge con 20 secondi", async () => {
    const tetti: Array<number | undefined> = [];
    const deps: DipendenzeWinrm = {
      checkWinrmReachability: async () => ({ reachable: true, summary: "open", results: [] }),
      trovaPython: () => "/finto/python3",
      execFile(_file, _args, opts, cb) {
        tetti.push(opts.timeout);
        setImmediate(() => cb(null, JSON.stringify({ stdout: "PC-PROVA" }), ""));
        return { stdin: { write: () => true, end: () => {} } };
      },
    };
    assert.equal(await provaWinrmConTetto(deps)("10.77.0.1", 5985, UTENTE, PASSWORD, "hostname", false, "cliente.local"), "PC-PROVA");
    assert.deepEqual(tetti, [20_000]);
  });
});

/* -------------------------------------------- valori al limite su SQLite vero */

for (const [nome, m] of [["db-tenant", tenantDb], ["facade db", facade]] as const) {
  describe(`motivo nelle scritture delle credenziali (${nome})`, () => {
    function preparato(): { t: Tenant; id: number; hostId: number } {
      const t = tenant(codice("REC"), hostUguali(1, [135]));
      return { t, id: voce(t, "Scansioni"), hostId: t.host.get(ipDi(1)) as number };
    }

    it("fallimento e riuscita scrivono il motivo, sulla porta 135 del protocollo wmi", () => {
      const { t, id, hostId } = preparato();
      withTenant(t.code, () => m.recordCredentialFailure(hostId, id, "wmi", 135, "rifiuto", "diritti_mancanti"));
      assert.deepEqual([righe(t, ipDi(1))[0].port, righe(t, ipDi(1))[0].motivo], [135, "diritti_mancanti"]);
      withTenant(t.code, () => m.recordCredentialSuccess(hostId, id, "wmi", 135, "ok"));
      assert.equal(righe(t, ipDi(1))[0].motivo, "ok");
    });

    it("senza motivo la riga non ne tiene uno vecchio: un esito di un altro percorso lo azzera", () => {
      const { t, id, hostId } = preparato();
      withTenant(t.code, () => m.recordCredentialFailure(hostId, id, "winrm", 5985, "rifiuto", "diritti_mancanti"));
      withTenant(t.code, () => m.recordCredentialFailure(hostId, id, "winrm", 5985, "rifiuto"));
      assert.equal(righe(t, ipDi(1))[0].motivo, null);
      withTenant(t.code, () => m.recordCredentialFailure(hostId, id, "winrm", 5985, "rifiuto", "errore"));
      withTenant(t.code, () => m.recordCredentialSuccess(hostId, id, "winrm", 5985));
      assert.equal(righe(t, ipDi(1))[0].motivo, null);
    });

    it("il fallimento di una riga nuova nasce col motivo", () => {
      const { t, id, hostId } = preparato();
      withTenant(t.code, () => m.recordCredentialFailure(hostId, id, "winrm", 5985, "rifiuto", "firewall"));
      assert.deepEqual([righe(t, ipDi(1))[0].fail_count, righe(t, ipDi(1))[0].motivo], [1, "firewall"]);
    });

    it("il solo motivo senza una riga: non ne crea", () => {
      const { t, id, hostId } = preparato();
      withTenant(t.code, () => m.recordCredentialMotivo(hostId, id, "wmi", 135, "porte_chiuse"));
      assert.deepEqual(righe(t, ipDi(1)), []);
    });

    it("il solo motivo su una riga esistente non tocca validated, fail_count, backoff e ultimo errore", () => {
      const { t, id, hostId } = preparato();
      t.d.prepare(
        "INSERT INTO host_credentials (host_id, credential_id, protocol_type, port, validated, fail_count, backoff_until, last_error) VALUES (?, ?, 'winrm', 5985, 1, 3, ?, 'vecchio')",
      ).run(hostId, id, FUTURO);
      withTenant(t.code, () => m.recordCredentialMotivo(hostId, id, "winrm", 5985, "porte_chiuse"));
      const [r] = righe(t, ipDi(1));
      assert.deepEqual([r.validated, r.fail_count, r.backoff_until, r.last_error, r.motivo], [1, 3, FUTURO, "vecchio", "porte_chiuse"]);
      assert.ok(r.last_attempt_at, "l'ora dell'ultima prova si aggiorna");
    });

    it("problema senza fermo: motivo, ultimo errore e ora; validated, conti e backoff restano", () => {
      const { t, id, hostId } = preparato();
      riga(t, ipDi(1), id, "winrm", 5985, { validated: 1, fail_count: 2 });
      withTenant(t.code, () => m.recordCredentialProblema(hostId, id, "winrm", 5985, "muto", "firewall", false));
      const [r] = righe(t, ipDi(1));
      assert.deepEqual([r.validated, r.fail_count, r.backoff_until, r.last_error, r.motivo], [1, 2, null, "muto", "firewall"]);
      assert.ok(r.last_attempt_at);
    });

    it("problema col fermo: fail_count e backoff salgono, validated resta", () => {
      const { t, id, hostId } = preparato();
      riga(t, ipDi(1), id, "winrm", 5985, { validated: 1, fail_count: 2 });
      withTenant(t.code, () => m.recordCredentialProblema(hostId, id, "winrm", 5985, "guasto", "errore", true));
      const [r] = righe(t, ipDi(1));
      assert.deepEqual([r.validated, r.fail_count, r.last_error, r.motivo], [1, 3, "guasto", "errore"]);
      assert.ok(r.backoff_until);
    });

    it("problema su una riga nuova: nasce non validata", () => {
      const { t, id, hostId } = preparato();
      withTenant(t.code, () => m.recordCredentialProblema(hostId, id, "wmi", 135, "muto", "firewall", false));
      const [r] = righe(t, ipDi(1));
      assert.deepEqual([r.protocol_type, r.port, r.validated, r.fail_count, r.backoff_until, r.last_error, r.motivo], ["wmi", 135, 0, 0, null, "muto", "firewall"]);
    });

    it("problema col fermo su una riga nuova: fail_count 1", () => {
      const { t, id, hostId } = preparato();
      withTenant(t.code, () => m.recordCredentialProblema(hostId, id, "wmi", 135, "guasto", "errore", true));
      const [r] = righe(t, ipDi(1));
      assert.deepEqual([r.validated, r.fail_count, r.motivo], [0, 1, "errore"]);
      assert.ok(r.backoff_until);
    });

    it("password errata: ogni riga e ogni legame della voce, senza toccare i conti né le altre voci", () => {
      const { t, id, hostId } = preparato();
      const altra = voce(t, "Altra");
      riga(t, ipDi(1), id, "winrm", 5985, { validated: 1, fail_count: 2 });
      riga(t, ipDi(1), id, "wmi", 135, { validated: 1 });
      riga(t, ipDi(1), altra, "winrm", 5985, { validated: 1 });
      const pc = apparato(t, ipDi(1));
      legame(t, pc, id, "winrm", 5985);
      legame(t, pc, altra, "winrm", 5985);
      withTenant(t.code, () => m.recordCredentialPasswordErrata(id));
      assert.deepEqual(righe(t, ipDi(1)).map((r) => [r.credential_id, r.protocol_type, r.validated, r.fail_count, r.backoff_until, r.motivo]), [
        [id, "winrm", 0, 2, null, "password_errata"],
        [id, "wmi", 0, 0, null, "password_errata"],
        [altra, "winrm", 1, 0, null, null],
      ]);
      assert.equal(hostId, t.host.get(ipDi(1)));
      assert.equal(statoLegame(t, pc, id), "failed");
      assert.equal(statoLegame(t, pc, altra), "success");
    });
  });
}

/* --------------------------------------------------------------- device-info */

describe("getDeviceInfo: WinRM rifiutato e un legame wmi validato", () => {
  // Il bridge WinRM è un eseguibile vero che risponde come il bridge: nessun pywinrm, nessuna rete. La 5986 di 127.0.0.1
  // ascolta solo per la prova TCP. La 135 di 127.0.0.1 è chiusa: l'errore che ne esce basta a dire che WMI è stato provato.
  const cartella = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-finto-"));
  const bridge = (codiceErrore: string): string => {
    const file = path.join(cartella, `bridge-${codiceErrore}.sh`);
    fs.writeFileSync(file, `#!/bin/sh\ncat > /dev/null\nprintf '%s' '{"error":"accesso negato","errorCode":"${codiceErrore}"}'\n`, { mode: 0o755 });
    return file;
  };
  const server = net.createServer((s) => s.destroy());
  const salvato = process.env.WINRM_PYTHON;

  after(async () => {
    if (salvato === undefined) delete process.env.WINRM_PYTHON;
    else process.env.WINRM_PYTHON = salvato;
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    fs.rmSync(cartella, { recursive: true, force: true });
  });

  async function apparato(legami: Array<{ protocollo: string; porta: number; stato: string; utente?: string }>): Promise<{ code: string; device: NetworkDevice }> {
    if (!server.listening) {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(5986, "127.0.0.1", resolve);
      });
    }
    const code = codice("DEV");
    deleteTenantDatabase(code);
    creati.add(code);
    const d = getTenantDb(code);
    const id = Number(
      d.prepare("INSERT INTO network_devices (name, host, device_type, vendor, protocol, port) VALUES ('pc-prova', '127.0.0.1', 'server', 'windows', 'winrm', 5986)")
        .run().lastInsertRowid,
    );
    for (const l of legami) {
      const credId = Number(
        d.prepare("INSERT INTO credentials (name, credential_type, encrypted_username, encrypted_password) VALUES (?, 'windows', ?, ?)")
          .run(`voce-${l.protocollo}`, encrypt(l.utente ?? UTENTE), encrypt(PASSWORD)).lastInsertRowid,
      );
      d.prepare("INSERT INTO device_credential_bindings (device_id, credential_id, protocol_type, port, test_status) VALUES (?, ?, ?, ?, ?)")
        .run(id, credId, l.protocollo, l.porta, l.stato);
    }
    const device = withTenant(code, () => getNetworkDeviceById(id));
    assert.ok(device);
    return { code, device };
  }

  const WINRM_BUONO = { protocollo: "winrm", porta: 5986, stato: "success" };

  it("AUTH_REJECTED con il legame wmi validato: si prova WMI, i diritti delle due strade sono diversi", async () => {
    process.env.WINRM_PYTHON = bridge("AUTH_REJECTED");
    const { code, device } = await apparato([WINRM_BUONO, { protocollo: "wmi", porta: 135, stato: "success" }]);
    await assert.rejects(
      withTenant(code, () => getDeviceInfo(device)),
      (e: unknown) => e instanceof Error && e.message.includes("[Fallback WMI fallito]") && e.message.includes("135"),
    );
  });

  for (const stato of ["failed", "untested"]) {
    it(`AUTH_REJECTED con un legame wmi ${stato}: WMI non si prova`, async () => {
      process.env.WINRM_PYTHON = bridge("AUTH_REJECTED");
      const { code, device } = await apparato([WINRM_BUONO, { protocollo: "wmi", porta: 135, stato }]);
      await assert.rejects(
        withTenant(code, () => getDeviceInfo(device)),
        (e: unknown) => e instanceof Error && !e.message.includes("Fallback WMI"),
      );
    });
  }

  it("AUTH_REJECTED senza legame wmi: WMI non si prova", async () => {
    process.env.WINRM_PYTHON = bridge("AUTH_REJECTED");
    const { code, device } = await apparato([WINRM_BUONO]);
    await assert.rejects(
      withTenant(code, () => getDeviceInfo(device)),
      (e: unknown) => e instanceof Error && !e.message.includes("Fallback WMI"),
    );
  });

  it("un altro rifiuto col legame wmi validato: WMI non si prova", async () => {
    process.env.WINRM_PYTHON = bridge("KERBEROS_FAILED");
    const { code, device } = await apparato([WINRM_BUONO, { protocollo: "wmi", porta: 135, stato: "success" }]);
    await assert.rejects(
      withTenant(code, () => getDeviceInfo(device)),
      (e: unknown) => e instanceof Error && !e.message.includes("Fallback WMI"),
    );
  });

  it("l'account del legame wmi esce ripulito, come il login", async () => {
    const { code, device } = await apparato([{ protocollo: "wmi", porta: 135, stato: "success", utente: "  CLIENTE\\wmi " }]);
    assert.equal(withTenant(code, () => accountLegameWmiValidato(device))?.username, "CLIENTE\\wmi");
  });

  it("l'account che va a WMI è quello del legame wmi, non quello appena rifiutato da WinRM", async () => {
    const { code, device } = await apparato([
      { ...WINRM_BUONO, utente: "CLIENTE\\winrm" },
      { protocollo: "wmi", porta: 135, stato: "success", utente: "CLIENTE\\wmi" },
    ]);
    assert.equal(withTenant(code, () => accountLegameWmiValidato(device))?.username, "CLIENTE\\wmi");
  });
});
