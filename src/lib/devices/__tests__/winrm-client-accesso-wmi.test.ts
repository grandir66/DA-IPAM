/**
 * Un account arrivato col legame `wmi` non arriva a WinRM (piano 2026-11-04 accesso Windows).
 *
 * Difetto: con un legame `winrm` fallito e uno `wmi` buono, `sceltaLoginApparatoDb` dava l'account WMI a chi poi faceva un
 * login WinRM vero: un login errato a ogni acquisizione, cioè il blocco dell'account di dominio. Il motore ha ragione a
 * darlo a chi legge via WMI; il rifiuto sta in `createWinrmClient`, e `getDeviceInfo` va direttamente a WMI.
 *
 * Qui si ascolta davvero sulla 5985 di 127.0.0.1: «nessun login WinRM» vuol dire zero connessioni, non un messaggio. La 135
 * di 127.0.0.1 è chiusa, quindi la lettura WMI finisce sul suo errore: basta a dire che ci è arrivata.
 *
 * Run: node --import tsx --test src/lib/devices/__tests__/winrm-client-accesso-wmi.test.ts
 */
import { TEST_DATA_DIR } from "@/lib/__tests__/support/data-dir-isolata";
import fs from "node:fs";
import net from "node:net";
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { encrypt } from "@/lib/crypto";
import { closeHubDb } from "@/lib/db-hub";
import { deleteTenantDatabase, getNetworkDeviceById, getTenantDb, withTenant } from "@/lib/db-tenant";
import { loginApparatoDb } from "@/lib/credentials/resolve";
import { getDeviceInfo } from "@/lib/devices/device-info";
import { AccessoSoloWmiError, createWinrmClient } from "@/lib/devices/winrm-client";
import type { NetworkDevice } from "@/types";

const creati: string[] = [];

after(() => {
  for (const c of creati) deleteTenantDatabase(c);
  closeHubDb();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

/** Un apparato `winrm` su 127.0.0.1 con una voce Windows, legata come dice `legami`. */
function apparatoCon(code: string, legami: Array<{ protocollo: "winrm" | "wmi"; porta: number; stato: "success" | "failed" | "untested" }>): NetworkDevice {
  deleteTenantDatabase(code);
  creati.push(code);
  const d = getTenantDb(code);
  const voce = Number(
    d.prepare("INSERT INTO credentials (name, credential_type, encrypted_username, encrypted_password) VALUES ('voce-windows', 'windows', ?, ?)")
      .run(encrypt("CLIENTE\\scansioni"), encrypt("segreto-di-prova")).lastInsertRowid,
  );
  const id = Number(
    d.prepare("INSERT INTO network_devices (name, host, device_type, vendor, protocol, port) VALUES ('pc-prova', '127.0.0.1', 'server', 'windows', 'winrm', 5985)")
      .run().lastInsertRowid,
  );
  const lega = d.prepare("INSERT INTO device_credential_bindings (device_id, credential_id, protocol_type, port, test_status) VALUES (?, ?, ?, ?, ?)");
  for (const l of legami) lega.run(id, voce, l.protocollo, l.porta, l.stato);
  const device = withTenant(code, () => getNetworkDeviceById(id));
  assert.ok(device);
  return device;
}

/** Conta le connessioni alla 5985 di 127.0.0.1 mentre gira `fn`, e le chiude subito: nessun bridge resta appeso. */
async function contaConnessioniWinrm(fn: () => Promise<void>): Promise<number> {
  let connessioni = 0;
  const server = net.createServer((s) => {
    connessioni += 1;
    s.destroy();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(5985, "127.0.0.1", resolve);
  });
  try {
    await fn();
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  return connessioni;
}

const SOLO_WMI = [{ protocollo: "wmi", porta: 135, stato: "success" }] as const;
const WINRM_FALLITO_E_WMI = [
  { protocollo: "winrm", porta: 5985, stato: "failed" },
  { protocollo: "wmi", porta: 135, stato: "success" },
] as const;

describe("l'accesso dice da quale legame viene", () => {
  it("col legame wmi porta il protocollo; col legame winrm resta la forma di sempre", () => {
    const wmi = apparatoCon("TESTACCWMI1", [...SOLO_WMI]);
    assert.equal(loginApparatoDb(getTenantDb("TESTACCWMI1"), wmi)?.protocollo, "wmi");
    const winrm = apparatoCon("TESTACCWMI2", [{ protocollo: "winrm", porta: 5985, stato: "success" }]);
    assert.deepEqual(loginApparatoDb(getTenantDb("TESTACCWMI2"), winrm), { username: "CLIENTE\\scansioni", password: "segreto-di-prova" });
  });
});

describe("createWinrmClient", () => {
  for (const [nome, legami] of [["col solo legame wmi", SOLO_WMI], ["col legame winrm fallito e quello wmi", WINRM_FALLITO_E_WMI]] as const) {
    it(`${nome}: rifiuta con l'errore tipizzato, senza contattare la macchina`, async () => {
      const code = nome.includes("solo") ? "TESTACCWMI3" : "TESTACCWMI4";
      const device = apparatoCon(code, [...legami]);
      const connessioni = await contaConnessioniWinrm(async () => {
        await assert.rejects(
          withTenant(code, () => createWinrmClient(device)),
          (e: unknown) => e instanceof AccessoSoloWmiError && /WMI/.test(e.message) && !e.message.includes("segreto-di-prova"),
        );
      });
      assert.equal(connessioni, 0);
    });
  }

  it("col legame winrm il client nasce come prima", async () => {
    const device = apparatoCon("TESTACCWMI5", [{ protocollo: "winrm", porta: 5985, stato: "success" }]);
    const client = await withTenant("TESTACCWMI5", () => createWinrmClient(device));
    assert.equal(typeof client.runCommand, "function");
  });
});

describe("getDeviceInfo su un apparato con l'accesso WMI", () => {
  for (const [nome, legami] of [["solo wmi", SOLO_WMI], ["winrm fallito e wmi", WINRM_FALLITO_E_WMI]] as const) {
    it(`${nome}: va direttamente a WMI, nessun login WinRM`, async () => {
      const code = nome.startsWith("solo") ? "TESTACCWMI6" : "TESTACCWMI7";
      const device = apparatoCon(code, [...legami]);
      const connessioni = await contaConnessioniWinrm(async () => {
        await assert.rejects(
          withTenant(code, () => getDeviceInfo(device)),
          // L'errore è quello di WMI, da solo: di un WinRM mai provato non c'è niente da dire.
          (e: unknown) => e instanceof Error && e.message.includes("135") && !e.message.includes("Fallback WMI") && !e.message.includes("5985"),
        );
      });
      assert.equal(connessioni, 0);
    });
  }

  it("con un legame winrm buono e le porte chiuse il ripiego resta quello di prima", async () => {
    const device = apparatoCon("TESTACCWMI8", [{ protocollo: "winrm", porta: 5985, stato: "success" }]);
    await assert.rejects(
      withTenant("TESTACCWMI8", () => getDeviceInfo(device)),
      (e: unknown) => e instanceof Error && e.message.includes("5985") && e.message.includes("[Fallback WMI fallito]"),
    );
  });
});
