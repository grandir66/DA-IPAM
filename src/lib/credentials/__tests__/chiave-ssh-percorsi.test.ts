/**
 * Una voce SSH a chiave nei percorsi che usano l'SSH (tappa 2 credenziali,
 * T14, D6 = (a), 16/10).
 *
 * Prima, con una voce `ssh` di metodo `chiave` (nata nella 2c):
 * - l'acquisizione (`getDeviceCredentials`) la scartava, «per ora accede solo
 *   con utente e password»: l'apparato restava senza credenziale;
 * - la prova di connessione di un Proxmox rispondeva «Configura le
 *   credenziali…» anche se l'SSH a chiave avrebbe funzionato;
 * - la prova di un binding SSH diceva «Password mancante»;
 * - l'anteprima verso lo scanner la mostrava non selezionata senza dire perché;
 * - il ponte paramiko (inventario software, installazione via SSH) e il
 *   terminale la scartavano con «non ha utente e password» o «credenziali SSH
 *   non disponibili», senza dire che il problema è la chiave.
 *
 * Con D6 = (a) la chiave vale nel trasporto ssh2 (acquisizione, prove,
 * discovery, SSH di Proxmox); paramiko e terminale la rifiutano dicendolo,
 * senza ripiegare su un'altra voce.
 *
 * Le funzioni nuove si prendono per nome: prima del T14 non esistono e la
 * prova cade alla chiamata, non all'import. Server ssh2 in memoria su
 * 127.0.0.1 (devices/__tests__/support/server-ssh-chiave), niente rete.
 *
 * Run: DA_INVENT_DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ipam.XXXXXX")" node --import tsx --test src/lib/credentials/__tests__/chiave-ssh-percorsi.test.ts
 */
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type Database from "better-sqlite3";
import { utils } from "ssh2";

import { encrypt } from "@/lib/crypto";
import { closeHubDb } from "@/lib/db-hub";
import * as tenant from "@/lib/db-tenant";
import * as facciata from "@/lib/db";
import { runDeviceConnectionTest } from "@/lib/devices/device-connection-test";
import { createSwitchClient } from "@/lib/devices/switch-client";
import { opzioniSshDiApparato } from "@/lib/devices/router-client";
import { provaBinding } from "@/lib/devices/prova-binding";
import { collectEdgeCredentialsForNetwork } from "@/lib/vuln/edge-credentials-bridge";
import { runSoftwareScan } from "@/lib/probes/software-runner";
import * as patch from "@/lib/patch/credentials";
import type { NetworkDevice } from "@/types";
import { serverSshProva, type ServerSshProva } from "@/lib/devices/__tests__/support/server-ssh-chiave";

const T = "TESTCHIAVESSH";
const { withTenant, getTenantDb, deleteTenantDatabase } = tenant;

type Accesso = { username: string; password?: string; privateKey?: string; passphrase?: string };
type EsitoAccesso = { ok: true; accesso: Accesso; port: number | null } | { ok: false; motivo: string };
type Lettori = {
  getDeviceCredentials: (d: NetworkDevice) => Accesso | null;
  accessoSshCredenziale: (id: number) => EsitoAccesso;
  getNetworkDeviceById: (id: number) => NetworkDevice | undefined;
};
const GEMELLE: Array<[string, Lettori]> = [
  ["db-tenant", tenant as unknown as Lettori],
  ["facciata db.ts", facciata as unknown as Lettori],
];
type EsitoSshHost = { ok: true; creds: { host: string; port: number; username: string; password: string } } | { ok: false; motivo: string };
const caricaSshPerHost = (dbh: Database.Database, hostId: number, percorso: string): EsitoSshHost =>
  (patch as unknown as { caricaSshPerHost: (d: Database.Database, h: number, p: string) => EsitoSshHost }).caricaSshPerHost(dbh, hostId, percorso);

const chiave = utils.generateKeyPairSync("ed25519");
const chiaveCifrata = utils.generateKeyPairSync("ed25519", { passphrase: "frase", cipher: "aes256-cbc", rounds: 16 });
const id: Record<string, number> = {};
let srv: ServerSshProva;

const apparato = (l: Lettori, nome: string): NetworkDevice => {
  const d = l.getNetworkDeviceById(id[nome]);
  assert.ok(d, `manca l'apparato ${nome}`);
  return d;
};

describe("voce SSH a chiave nei percorsi SSH", () => {
  before(async () => {
    srv = await serverSshProva({
      chiavi: [chiave.public, chiaveCifrata.public],
      password: "pw-password",
      risposta: (cmd) => (cmd.startsWith("pveversion") ? "pve-manager/8.2.4\n" : "ok\n"),
    });
    withTenant(T, () => {
      const d = getTenantDb(T);
      const conChiave = (nome: string, privata: string, passphrase: string | null): number =>
        Number(
          d
            .prepare(
              `INSERT INTO credentials (name, credential_type, auth_method, encrypted_username, encrypted_private_key, encrypted_key_passphrase, port)
               VALUES (?, 'ssh', 'chiave', ?, ?, ?, ?)`,
            )
            .run(nome, encrypt("root"), encrypt(privata), passphrase != null ? encrypt(passphrase) : null, srv.porta).lastInsertRowid,
        );
      id.chiave = conChiave("Chiave root", chiave.private, null);
      id.chiaveCifrata = conChiave("Chiave root cifrata", chiaveCifrata.private, "frase");
      const conPassword = (nome: string, utente: string, pw: string): number =>
        Number(
          d
            .prepare("INSERT INTO credentials (name, credential_type, encrypted_username, encrypted_password, port) VALUES (?, 'ssh', ?, ?, ?)")
            .run(nome, encrypt(utente), encrypt(pw), srv.porta).lastInsertRowid,
        );
      id.password = conPassword("Password root", "root", "pw-password");
      id.passwordSpazi = conPassword("Password con spazi", " root ", " pw-password ");

      const crea = d.prepare(
        `INSERT INTO network_devices (name, host, device_type, vendor, protocol, port, credential_id, scan_target, api_url)
         VALUES (?, '127.0.0.1', ?, ?, ?, ?, ?, ?, ?)`,
      );
      const bind = d.prepare(
        "INSERT INTO device_credential_bindings (device_id, credential_id, protocol_type, port, sort_order, test_status) VALUES (?, ?, ?, ?, ?, 'untested')",
      );
      id.serverChiave = Number(crea.run("Server a chiave", "server", "linux", "ssh", srv.porta, null, null, null).lastInsertRowid);
      bind.run(id.serverChiave, id.chiave, "ssh", srv.porta, 0);
      // Proxmox: l'API sulla 8006, la voce SSH della colonna con la sua porta (quella del server finto).
      id.proxmoxChiave = Number(
        crea.run("Proxmox a chiave", "hypervisor", "proxmox", "api", 8006, id.chiave, "proxmox", "https://127.0.0.1:1").lastInsertRowid,
      );
      id.proxmoxMisto = Number(crea.run("Proxmox misto", "hypervisor", "proxmox", "api", 8006, null, "proxmox", "https://127.0.0.1:1").lastInsertRowid);
      bind.run(id.proxmoxMisto, id.chiave, "api", 8006, 0);
      bind.run(id.proxmoxMisto, id.password, "api", 8006, 1);

      id.rete = Number(d.prepare("INSERT INTO networks (cidr, name) VALUES ('127.0.0.0/24', 'Rete locale')").run().lastInsertRowid);
      d.prepare("INSERT INTO network_credentials (network_id, credential_id, sort_order) VALUES (?, ?, 0)").run(id.rete, id.chiave);
      d.prepare("INSERT INTO network_credentials (network_id, credential_id, sort_order) VALUES (?, ?, 1)").run(id.rete, id.password);

      id.hostChiave = Number(d.prepare("INSERT INTO hosts (network_id, ip) VALUES (?, '127.0.0.1')").run(id.rete).lastInsertRowid);
      d.prepare(
        "INSERT INTO host_credentials (host_id, credential_id, protocol_type, port, validated, sort_order) VALUES (?, ?, 'ssh', ?, 1, 0)",
      ).run(id.hostChiave, id.chiave, srv.porta);
      // Una seconda riga con password: chi rifiuta la chiave non ripiega su questa.
      d.prepare(
        "INSERT INTO host_credentials (host_id, credential_id, protocol_type, port, validated, sort_order) VALUES (?, ?, 'ssh', ?, 0, 1)",
      ).run(id.hostChiave, id.password, srv.porta);
      const rete2 = Number(d.prepare("INSERT INTO networks (cidr, name) VALUES ('127.0.1.0/24', 'Seconda rete')").run().lastInsertRowid);
      id.hostPassword = Number(d.prepare("INSERT INTO hosts (network_id, ip) VALUES (?, '127.0.0.1')").run(rete2).lastInsertRowid);
      d.prepare(
        "INSERT INTO host_credentials (host_id, credential_id, protocol_type, port, validated, sort_order) VALUES (?, ?, 'ssh', ?, 1, 0)",
      ).run(id.hostPassword, id.password, srv.porta);
    });
  });

  after(async () => {
    deleteTenantDatabase(T);
    closeHubDb();
    removeTestHubDb();
    await srv.chiudi();
  });

  for (const [nome, l] of GEMELLE) {
    it(`${nome}: accessoSshCredenziale dà utente e chiave (con la passphrase) o utente e password, ripuliti come prima`, () => {
      withTenant(T, () => {
        assert.deepEqual(l.accessoSshCredenziale(id.chiave), { ok: true, accesso: { username: "root", privateKey: chiave.private }, port: srv.porta });
        assert.deepEqual(l.accessoSshCredenziale(id.chiaveCifrata), {
          ok: true,
          accesso: { username: "root", privateKey: chiaveCifrata.private, passphrase: "frase" },
          port: srv.porta,
        });
        assert.deepEqual(l.accessoSshCredenziale(id.passwordSpazi), { ok: true, accesso: { username: "root", password: "pw-password" }, port: srv.porta });
        const finta = l.accessoSshCredenziale(999_999);
        assert.equal(finta.ok, false);
        assert.match(finta.ok ? "" : finta.motivo, /non esiste/);
      });
    });

    it(`${nome}: getDeviceCredentials di un apparato SSH con la voce a chiave dà la chiave (oggi null)`, () => {
      withTenant(T, () => {
        assert.deepEqual(l.getDeviceCredentials(apparato(l, "serverChiave")), { username: "root", privateKey: chiave.private });
      });
    });

    it(`${nome}: Proxmox con l'API: la voce con la password vince sulla chiave (l'API la vuole); con la sola chiave arriva la chiave per l'SSH`, () => {
      withTenant(T, () => {
        assert.deepEqual(l.getDeviceCredentials(apparato(l, "proxmoxMisto")), { username: "root", password: "pw-password" });
        assert.deepEqual(l.getDeviceCredentials(apparato(l, "proxmoxChiave")), { username: "root", privateKey: chiave.private });
      });
    });
  }

  it("acquisizione: il client SSH dell'apparato entra con la chiave (oggi «Credenziali SSH mancanti»)", async () => {
    await withTenant(T, async () => {
      const d = apparato(GEMELLE[1][1], "serverChiave");
      const client = await createSwitchClient(d);
      assert.equal(await client.testConnection(), true);
      const opz = opzioniSshDiApparato(d);
      assert.equal(opz?.privateKey, chiave.private);
      assert.equal(opz?.password, undefined);
    });
  });

  it("prova di connessione di un Proxmox con la sola voce a chiave: SSH provata e riuscita, l'API dichiarata non provata (oggi «Configura le credenziali…»)", async () => {
    await withTenant(T, async () => {
      const r = await runDeviceConnectionTest(apparato(GEMELLE[1][1], "proxmoxChiave"), 20_000);
      assert.equal(r.success, true, r.error ?? r.message);
      assert.equal(r.proxmox_ssh_ok, true);
      assert.equal(r.proxmox_api_ok, false);
      assert.match(r.message ?? "", /API non provata/);
    });
  });

  it("prova di un binding SSH a chiave: entra (oggi «Password mancante»)", async () => {
    await withTenant(T, async () => {
      const r = await provaBinding(
        "127.0.0.1",
        { protocol_type: "ssh", port: srv.porta, credential_id: id.chiaveCifrata, inline_username: null, inline_encrypted_password: null },
        "2c",
      );
      assert.equal(r.success, true, r.message);
    });
  });

  it("anteprima verso lo scanner: la voce a chiave c'è, non selezionata, col motivo; quella a password parte", () => {
    withTenant(T, () => {
      const { preview, transfer } = collectEdgeCredentialsForNetwork(id.rete, { registra: false });
      const voce = preview.find((p) => p.credential_id === id.chiave);
      assert.ok(voce, "la voce a chiave compare nell'anteprima");
      assert.equal(voce.selected_for_scan, false);
      assert.equal(voce.motivo, "Non inviata allo scanner: chiave SSH");
      assert.ok(!transfer.some((t) => t.ipam_credential_id === id.chiave), "la chiave non parte verso lo scanner");
      assert.ok(transfer.some((t) => t.ipam_credential_id === id.password && t.slot === "ssh"), "la voce a password parte");
      assert.equal(preview.find((p) => p.credential_id === id.password)?.selected_for_scan, true);
    });
  });

  it("ponte paramiko (inventario software): la voce a chiave scelta dal motore dà il messaggio, senza ripiegare sulla riga a password", async () => {
    await withTenant(T, async () => {
      const prima = (getTenantDb(T).prepare("SELECT COUNT(*) AS n FROM software_scans").get() as { n: number }).n;
      await assert.rejects(
        runSoftwareScan({ target: { kind: "host", hostId: id.hostChiave }, timeoutMs: 5000 }),
        /Credenziale a chiave non supportata dall'inventario software \(ponte paramiko\): usa una credenziale con password/,
      );
      const dopo = (getTenantDb(T).prepare("SELECT COUNT(*) AS n FROM software_scans").get() as { n: number }).n;
      assert.equal(dopo, prima, "nessuno scan registrato");
    });
  });

  it("terminale e installazione via SSH: la voce a chiave dà il messaggio col percorso, senza ripiego; con la password la credenziale", () => {
    withTenant(T, () => {
      const db = getTenantDb(T);
      const r = caricaSshPerHost(db, id.hostChiave, "dal terminale SSH");
      assert.equal(r.ok, false);
      assert.match(r.ok ? "" : r.motivo, /^Credenziale a chiave non supportata dal terminale SSH: usa una credenziale con password/);
      assert.match(r.ok ? "" : r.motivo, /Chiave root/);
      assert.deepEqual(caricaSshPerHost(db, id.hostPassword, "dal terminale SSH"), {
        ok: true,
        creds: { host: "127.0.0.1", port: srv.porta, username: "root", password: "pw-password" },
      });
    });
  });
});
