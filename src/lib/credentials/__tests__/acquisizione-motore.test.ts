/**
 * L'acquisizione degli apparati sceglie le credenziali col motore unico
 * (tappa 2 credenziali, T8, 16/10).
 *
 * Prima l'acquisizione sceglieva fuori dal motore, ognuno a modo suo:
 * - getDeviceCredentials prendeva il primo binding in ordine anche se la sua
 *   prova era fallita: l'apparato riprovava ogni giro una credenziale che non
 *   funziona (un accesso fallito vero, su un account di dominio per WinRM);
 * - il piano di acquisizione guardava solo `community_string` e
 *   `snmp_credential_id`: una stampante con l'SNMP in un binding finiva nel
 *   piano degli switch;
 * - LibreNMS riceveva `community_string` com'è nel DB, cioè il testo cifrato
 *   (`librenms-sync.ts`, aggiornamento e `addDevice`);
 * - la prova di connessione di un Proxmox apriva l'SSH su `device.port`, che
 *   per un Proxmox è la porta dell'API (8006);
 * - una v3 in un binding non arrivava alla sessione: getDeviceSnmpV3Credentials
 *   leggeva solo le due colonne dell'apparato.
 *
 * Ogni lettore nuovo si prova sulle due gemelle (db-tenant e facciata db.ts),
 * sullo stesso DB.
 *
 * Run: DA_INVENT_DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ipam.XXXXXX")" node --import tsx --test src/lib/credentials/__tests__/acquisizione-motore.test.ts
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";

process.env.ENCRYPTION_KEY ||= "test-encryption-key-acquisizione-motore";

import * as netSnmp from "net-snmp";
import { encrypt } from "@/lib/crypto";
import * as tenant from "@/lib/db-tenant";
import * as facciata from "@/lib/db";
import { resolveDeviceAcquisition } from "@/lib/devices/device-acquisition-resolve";
import * as librenms from "@/lib/integrations/librenms-sync";
import { runDeviceConnectionTest } from "@/lib/devices/device-connection-test";
import { apriSessioneSnmpApparato } from "@/lib/devices/switch-client";
import type { NetworkDevice } from "@/types";

const T = "TESTACQUISIZIONEMOTORE";
const { withTenant, getTenantDb, deleteTenantDatabase } = tenant;

/** I lettori nuovi, presi per nome: prima del T8 non esistono e la prova cade lì, non all'import. */
type Lettori = {
  getDeviceCredentials: (d: NetworkDevice) => { username: string; password: string } | null;
  credenzialeSnmpApparato: (d: NetworkDevice) =>
    | { ok: true; cred: { forma: "community"; community: string } | { forma: "v3"; record: Record<string, unknown> }; port: number; fonte: string }
    | { ok: false; motivo: string };
  haSnmpApparato: (d: NetworkDevice) => boolean;
  portaSshApparato: (d: NetworkDevice) => number;
  getNetworkDeviceById: (id: number) => NetworkDevice | undefined;
};
const GEMELLE: Array<[string, Lettori]> = [
  ["db-tenant", tenant as unknown as Lettori],
  ["facciata db.ts", facciata as unknown as Lettori],
];

const id: Record<string, number> = {};
let server: net.Server;
let portaSsh = 0;
const connessioniSsh: number[] = [];

function apparato(l: Lettori, chiave: string): NetworkDevice {
  const d = l.getNetworkDeviceById(id[chiave]);
  assert.ok(d, `manca l'apparato ${chiave}`);
  return d;
}

describe("acquisizione degli apparati sul motore", () => {
  before(async () => {
    server = net.createServer((s) => {
      connessioniSsh.push(s.localPort ?? 0);
      s.destroy();
    });
    await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
    portaSsh = (server.address() as net.AddressInfo).port;

    withTenant(T, () => {
      const d = getTenantDb(T);
      const voce = d.prepare(
        `INSERT INTO credentials (name, credential_type, encrypted_username, encrypted_password, security_level, auth_protocol, encrypted_auth_key, priv_protocol, encrypted_priv_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const v = (nome: string, tipo: string, utente: string | null, segreto: string | null, v3: [string, string, string, string, string] | null = null) =>
        Number(
          voce.run(
            nome, tipo, utente != null ? encrypt(utente) : null, segreto != null ? encrypt(segreto) : null,
            v3?.[0] ?? null, v3?.[1] ?? null, v3 ? encrypt(v3[2]) : null, v3?.[3] ?? null, v3 ? encrypt(v3[4]) : null,
          ).lastInsertRowid,
        );
      const sshFallita = v("SSH fallita", "ssh", "utente-fallito", "pw-fallita");
      const sshBuona = v("SSH riuscita", "ssh", "utente-buono", "pw-buona");
      const comStampante = v("Community stampante", "snmp", null, "comm-stampante");
      const comCatena = v("Community della catena", "snmp", null, "comm-catena");
      const apiProxmox = v("API Proxmox", "api", "root@pam", "pw-api");
      const sshProxmox = v("SSH Proxmox", "ssh", "root", "pw-ssh");
      const v3 = v("V3 nel binding", "snmp", "monitor", null, ["authPriv", "SHA", "chiave-auth", "AES", "chiave-priv"]);

      const rete = Number(d.prepare("INSERT INTO networks (cidr, name) VALUES ('10.77.0.0/24', 'Rete stampanti')").run().lastInsertRowid);
      d.prepare("INSERT INTO network_credentials (network_id, credential_id, sort_order) VALUES (?, ?, 0)").run(rete, comCatena);
      const host = Number(d.prepare("INSERT INTO hosts (network_id, ip) VALUES (?, '10.77.0.20')").run(rete).lastInsertRowid);

      const app = d.prepare(
        `INSERT INTO network_devices (name, host, device_type, vendor, protocol, port, classification, community_string, scan_target, api_url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const crea = (nome: string, ip: string, tipo: string, vendor: string, proto: string, porta: number, cls: string | null = null, com: string | null = null, scan: string | null = null, api: string | null = null) =>
        Number(app.run(nome, ip, tipo, vendor, proto, porta, cls, com, scan, api).lastInsertRowid);
      const bind = d.prepare(
        "INSERT INTO device_credential_bindings (device_id, credential_id, protocol_type, port, sort_order, test_status) VALUES (?, ?, ?, ?, ?, ?)",
      );

      // Primo binding fallito, secondo riuscito: oggi vince il primo.
      id.fallito = crea("Switch col primo binding fallito", "10.77.0.2", "switch", "hp", "ssh", 22);
      bind.run(id.fallito, sshFallita, "ssh", 22, 0, "failed");
      bind.run(id.fallito, sshBuona, "ssh", 22, 1, "success");

      // Stampanti: una con l'SNMP in un binding, una senza SNMP proprio ma in una rete con una voce SNMP in catena.
      id.stampanteBinding = crea("Stampante col binding SNMP", "10.77.0.3", "switch", "hp", "ssh", 22, "stampante");
      bind.run(id.stampanteBinding, comStampante, "snmp", 161, 0, "untested");
      id.stampanteNuda = crea("Stampante senza SNMP proprio", "10.77.0.20", "switch", "hp", "ssh", 22, "stampante");
      d.prepare("UPDATE network_devices SET host_id = ? WHERE id = ?").run(host, id.stampanteNuda);

      // LibreNMS: community nella colonna, cifrata come la scrive l'API.
      id.apColonna = crea("AP con la community in colonna", "10.77.0.4", "access_point", "ubiquiti", "api", 443, "access_point", encrypt("comm-colonna"));

      // Proxmox: porta dell'API 8006, binding SSH su un'altra porta (qui quella del server finto).
      id.proxmox = crea("Proxmox di prova", "127.0.0.1", "hypervisor", "proxmox", "api", 8006, null, null, "proxmox", "https://127.0.0.1:1");
      bind.run(id.proxmox, apiProxmox, "api", 8006, 0, "success");
      bind.run(id.proxmox, sshProxmox, "ssh", portaSsh, 1, "untested");

      // Apparati SNMP con la community in colonna, senza una porta loro: SNMP sulla 161 (D11 = (a)), qualunque sia
      // device.port (1161, o la 22 rimasta di F3).
      id.snmp1161 = crea("Switch SNMP sulla 1161", "10.77.0.6", "switch", "hp", "snmp_v2", 1161, null, encrypt("comm-1161"));
      id.snmp22 = crea("Switch SNMP con la porta SSH", "10.77.0.7", "switch", "hp", "snmp_v2", 22, null, encrypt("comm-22"));

      // v3 in un binding, su una porta sua.
      id.v3 = crea("Switch v3 col binding", "10.77.0.5", "switch", "hp", "snmp_v3", 161);
      bind.run(id.v3, v3, "snmp", 1161, 0, "untested");

      // NAS salvato come SNMP ma con scan_target linux (prova SSH), senza credenziali sue; l'host con lo stesso
      // indirizzo ha una riga SSH validata. Prima del T8 il ripiego sull'host cercava righe 'snmp': niente login.
      id.nasSnmp = crea("NAS salvato come SNMP", "127.0.0.1", "nas", "synology", "snmp_v2", portaSsh, null, null, "linux");
      const hostNas = Number(d.prepare("INSERT INTO hosts (network_id, ip) VALUES (?, '127.0.0.1')").run(rete).lastInsertRowid);
      d.prepare("INSERT INTO host_credentials (host_id, credential_id, protocol_type, port, validated) VALUES (?, ?, 'ssh', ?, 1)").run(hostNas, sshBuona, portaSsh);
    });
  });

  after(async () => {
    deleteTenantDatabase(T);
    await new Promise<void>((ok) => server.close(() => ok()));
  });

  for (const [nome, l] of GEMELLE) {
    it(`${nome}: getDeviceCredentials salta il binding fallito e usa il riuscito (oggi il primo in ordine)`, () => {
      withTenant(T, () => {
        assert.deepEqual(l.getDeviceCredentials(apparato(l, "fallito")), { username: "utente-buono", password: "pw-buona" });
      });
    });

    it(`${nome}: stampante con l'SNMP solo in un binding → ha SNMP e piano snmp_peripheral (oggi switch_mac)`, () => {
      withTenant(T, () => {
        const d = apparato(l, "stampanteBinding");
        assert.equal(l.haSnmpApparato(d), true);
        assert.equal(resolveDeviceAcquisition(d, l.haSnmpApparato(d)).module, "snmp_peripheral");
      });
    });

    it(`${nome}: stampante senza SNMP proprio, voce SNMP nella catena della rete → non ha SNMP, piano invariato`, () => {
      withTenant(T, () => {
        const d = apparato(l, "stampanteNuda");
        assert.equal(l.haSnmpApparato(d), false);
        assert.equal(resolveDeviceAcquisition(d, l.haSnmpApparato(d)).module, "switch_mac");
        // L'acquisizione non arriva alla catena (D1b = (a)): «public» dichiarato, non la community della catena.
        const c = l.credenzialeSnmpApparato(d);
        assert.equal(c.ok, true);
        if (c.ok) {
          assert.equal(c.fonte, "snmp_ripiego");
          assert.deepEqual(c.cred, { forma: "community", community: "public" });
        }
      });
    });

    it(`${nome}: Proxmox con port = 8006 e binding SSH su un'altra porta → la porta SSH è quella del binding`, () => {
      withTenant(T, () => {
        assert.equal(l.portaSshApparato(apparato(l, "proxmox")), portaSsh);
      });
    });

    it(`${nome}: apparato SNMP con la community in colonna e senza una porta sua → 161, non device.port (D11 = (a), F3)`, () => {
      withTenant(T, () => {
        const a = l.credenzialeSnmpApparato(apparato(l, "snmp1161"));
        const b = l.credenzialeSnmpApparato(apparato(l, "snmp22"));
        assert.deepEqual(a.ok && [a.port, a.fonte, a.cred], [161, "device_column_inline", { forma: "community", community: "comm-1161" }]);
        assert.deepEqual(b.ok && [b.port, b.fonte], [161, "device_column_inline"]);
      });
    });

    it(`${nome}: apparato v3 con la voce in un binding → v3 coi protocolli della voce, sulla porta del binding`, () => {
      withTenant(T, () => {
        const c = l.credenzialeSnmpApparato(apparato(l, "v3"));
        assert.equal(c.ok, true, c.ok ? "" : c.motivo);
        if (!c.ok) return;
        assert.equal(c.port, 1161);
        assert.equal(c.fonte, "device_binding");
        assert.equal(c.cred.forma, "v3");
        if (c.cred.forma === "v3") {
          assert.equal(c.cred.record.authProtocol, "SHA");
          assert.equal(c.cred.record.privProtocol, "AES");
          assert.equal(c.cred.record.authKey, "chiave-auth");
        }
      });
    });
  }

  it("la sessione di un apparato v3 si apre coi protocolli e la porta della voce scelta", () => {
    const aperte: Array<{ user: { authProtocol: unknown; privProtocol: unknown; name: string }; opts: { port: number } }> = [];
    const finto = Object.assign(Object.create(null), netSnmp, {
      createV3Session: (_host: string, user: { authProtocol: unknown; privProtocol: unknown; name: string }, opts: { port: number }) => {
        aperte.push({ user, opts });
        return { close() {} };
      },
    }) as typeof netSnmp;
    withTenant(T, () => {
      const d = (tenant as unknown as Lettori).getNetworkDeviceById(id.v3);
      assert.ok(d);
      apriSessioneSnmpApparato(finto, d);
    });
    assert.equal(aperte.length, 1);
    assert.equal(aperte[0].user.name, "monitor");
    assert.equal(aperte[0].user.authProtocol, netSnmp.AuthProtocols.sha);
    assert.equal(aperte[0].user.privProtocol, netSnmp.PrivProtocols.aes);
    assert.equal(aperte[0].opts.port, 1161);
  });

  it("LibreNMS riceve la community decifrata, e niente SNMP per chi non ne ha uno suo (mai «public»)", () => {
    const campi = (librenms as unknown as { campiSnmpPerLibreNms: (d: NetworkDevice) => Record<string, unknown> }).campiSnmpPerLibreNms;
    withTenant(T, () => {
      const l = tenant as unknown as Lettori;
      assert.deepEqual(campi(apparato(l, "apColonna")), { community: "comm-colonna", snmpver: "v2c", port: 161, snmp_disable: false });
      assert.deepEqual(campi(apparato(l, "stampanteBinding")), { community: "comm-stampante", snmpver: "v2c", port: 161, snmp_disable: false });
      assert.deepEqual(campi(apparato(l, "stampanteNuda")), { snmp_disable: true });
    });
  });

  it("prova di connessione di un Proxmox con port = 8006: l'SSH va sulla porta del binding SSH (oggi sulla 8006)", async () => {
    connessioniSsh.length = 0;
    const d = withTenant(T, () => (tenant as unknown as Lettori).getNetworkDeviceById(id.proxmox));
    assert.ok(d);
    await withTenant(T, () => runDeviceConnectionTest(d, 10_000));
    assert.deepEqual(connessioniSsh, [portaSsh], "l'SSH della prova non è arrivato alla porta del binding");
  });

  it("prova di connessione di un apparato SNMP senza credenziali sue: nessun ripiego sulla riga SSH dell'host (come prima del T8)", async () => {
    connessioniSsh.length = 0;
    const d = withTenant(T, () => (tenant as unknown as Lettori).getNetworkDeviceById(id.nasSnmp));
    assert.ok(d);
    await assert.rejects(withTenant(T, () => runDeviceConnectionTest(d, 10_000)), /Credenziali mancanti/);
    assert.deepEqual(connessioniSsh, [], "la prova ha tentato un login SSH con la credenziale dell'host");
  });
});
