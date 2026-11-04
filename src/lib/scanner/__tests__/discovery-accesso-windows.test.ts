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
      `SELECT credential_id, protocol_type, port, validated, fail_count, backoff_until, motivo, last_error
       FROM host_credentials WHERE host_id = ? ORDER BY credential_id, protocol_type`,
    )
    .all(t.host.get(ip)) as RigaCredenziale[];
}

const ipDi = (n: number): string => `10.77.0.${n}`;
const hostUguali = (quanti: number, porte: number[]): Host[] =>
  Array.from({ length: quanti }, (_, i) => ({ ip: ipDi(i + 1), porte }));

const rifiutoWinrm = (code: WinrmErrorCode = "AUTH_REJECTED") => new WinrmError({ code, message: `rifiuto ${code}` });
const rifiutoWmi = (code: WinrmErrorCode = "AUTH_REJECTED") => new WmiError({ code, message: `rifiuto ${code}` });

interface ScenaProve {
  password?: EsitoPassword;
  /** Il nome che dà la macchina, o l'errore che dà. Di serie rifiuta. */
  winrm?: (ip: string, username: string) => string | Error;
  wmi?: (ip: string, username: string) => string | Error;
}

interface Banco {
  prove: ProveAccessoWindows;
  chiamate: { winrm: string[]; wmi: string[]; ldap: number[]; smb: string[] };
  /** Le fasi viste dalle prove durante il giro. */
  fasi: string[];
  leggiFase: { fn: () => string | undefined };
}

function banco(s: ScenaProve = {}): Banco {
  const chiamate: Banco["chiamate"] = { winrm: [], wmi: [], ldap: [], smb: [] };
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

    it("password errata: zero chiamate sulle macchine, nessun fallimento né fermo, il motivo sulla riga", async () => {
      const t = tenant(codice("ERRATA"), hostUguali(5, [135, 5985]));
      voce(t, "Scansioni");
      const b = banco({ password: "errata" });

      const log = await giro(t, tipo, b);

      assert.deepEqual([b.chiamate.winrm, b.chiamate.wmi], [[], []]);
      assert.equal(b.chiamate.ldap.length, 1);
      for (const ip of t.ips) {
        const [r] = righe(t, ip);
        assert.deepEqual([r.fail_count, r.backoff_until, r.motivo], [0, null, "password_errata"], ip);
      }
      assert.match(riepilogo(log), /5 password errata/);
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
      for (const ip of t.ips.slice(0, 5)) {
        const [r] = righe(t, ip);
        assert.deepEqual([r.fail_count, r.backoff_until, r.validated, r.motivo], [0, null, 0, "porte_chiuse"], ip);
      }
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
      for (const ip of t.ips.slice(3)) {
        const [r] = righe(t, ip);
        assert.deepEqual([r.fail_count, r.backoff_until, r.motivo], [0, null, "budget_esaurito"], ip);
      }
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

    it("WMI rifiutato dopo WinRM rifiutato, password valida: due tentativi, un fallimento sulla strada del motivo", async () => {
      const t = tenant(codice("DUE"), hostUguali(1, [135, 5985]));
      voce(t, "Scansioni");
      const b = banco({ password: "valida" });

      await giro(t, tipo, b);

      assert.equal(b.chiamate.winrm.length, 1);
      assert.equal(b.chiamate.wmi.length, 1);
      const r = righe(t, ipDi(1));
      assert.equal(r.length, 1);
      assert.deepEqual([r[0].protocol_type, r[0].port, r[0].fail_count, r[0].motivo], ["winrm", 5985, 1, "diritti_mancanti"]);
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

  it("un output che non è un nome (stderr nello stdout) non è un accesso: fallimento, niente nome, niente riga validata", async () => {
    const t = tenant(codice("NONOME"), hostUguali(1, [5985]));
    voce(t, "Scansioni");

    const log = await giro(t, "windows", banco({ password: "valida", winrm: () => "bad command name hostname (line 1 column 1)" }));

    const [r] = righe(t, ipDi(1));
    assert.deepEqual([r.validated, r.fail_count, r.motivo], [0, 1, "errore"]);
    const h = t.d.prepare("SELECT hostname FROM hosts WHERE ip = ?").get(ipDi(1)) as { hostname: string | null };
    assert.equal(h.hostname, null);
    assert.match(riepilogo(log), /1 errore/);
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

  it("host Windows senza porte note: porte chiuse, nessuna chiamata", async () => {
    const t = tenant(codice("CLASSE"), [{ ip: ipDi(1), porte: [], classification: "workstation" }]);
    voce(t, "Scansioni");
    const b = banco();

    const log = await giro(t, "credential_validate", b);

    assert.deepEqual([b.chiamate.winrm, b.chiamate.wmi, b.chiamate.ldap], [[], [], []]);
    assert.equal(righe(t, ipDi(1))[0].motivo, "porte_chiuse");
    assert.match(riepilogo(log), /1 porte chiuse/);
  });

  it("host Windows e nessuna voce Windows nella rete: «nessuna voce» nel riepilogo", async () => {
    const t = tenant(codice("SOLOAPI"), hostUguali(1, [5985]));
    voce(t, "Api", "api");

    const log = await giro(t, "credential_validate", banco());

    assert.match(riepilogo(log), /1 nessuna voce/);
  });
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

    it("il solo motivo su una riga nuova: nessun fallimento, nessun fermo, non validata", () => {
      const { t, id, hostId } = preparato();
      withTenant(t.code, () => m.recordCredentialMotivo(hostId, id, "wmi", 135, "password_errata"));
      const [r] = righe(t, ipDi(1));
      assert.deepEqual([r.protocol_type, r.port, r.validated, r.fail_count, r.backoff_until, r.last_error, r.motivo], ["wmi", 135, 0, 0, null, null, "password_errata"]);
    });

    it("il solo motivo su una riga esistente non tocca validated, fail_count, backoff e ultimo errore", () => {
      const { t, id, hostId } = preparato();
      t.d.prepare(
        "INSERT INTO host_credentials (host_id, credential_id, protocol_type, port, validated, fail_count, backoff_until, last_error) VALUES (?, ?, 'winrm', 5985, 1, 3, ?, 'vecchio')",
      ).run(hostId, id, FUTURO);
      withTenant(t.code, () => m.recordCredentialMotivo(hostId, id, "winrm", 5985, "porte_chiuse"));
      const [r] = righe(t, ipDi(1));
      assert.deepEqual([r.validated, r.fail_count, r.backoff_until, r.last_error, r.motivo], [1, 3, FUTURO, "vecchio", "porte_chiuse"]);
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

  it("l'account che va a WMI è quello del legame wmi, non quello appena rifiutato da WinRM", async () => {
    const { code, device } = await apparato([
      { ...WINRM_BUONO, utente: "CLIENTE\\winrm" },
      { protocollo: "wmi", porta: 135, stato: "success", utente: "CLIENTE\\wmi" },
    ]);
    assert.equal(withTenant(code, () => accountLegameWmiValidato(device))?.username, "CLIENTE\\wmi");
  });
});
