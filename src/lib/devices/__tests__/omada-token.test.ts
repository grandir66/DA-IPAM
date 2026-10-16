/**
 * Il token dell'API di Omada viene dall'archivio (tappa 2e credenziali, T20,
 * riga 18 del piano), non dalla colonna `api_token` dell'apparato.
 *
 * Perché: la conversione della 2e (T19) porta il token in una voce `api` a
 * token legata all'apparato e svuota la colonna. Il client Omada leggeva solo
 * la colonna: dopo la conversione avrebbe mandato «Bearer » vuoto. Senza
 * nessun token la ragione si dice (errore col motivo), non diventa un 401.
 *
 * Run: DA_INVENT_DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ipam.XXXXXX")" node --import tsx --test src/lib/devices/__tests__/omada-token.test.ts
 */
import { TEST_DATA_DIR } from "@/lib/__tests__/support/data-dir-isolata";
import { describe, it, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";

import { withTenant, getTenantDb, deleteTenantDatabase, getNetworkDeviceById } from "@/lib/db-tenant";
import { encrypt } from "@/lib/crypto";
import { createRouterClient } from "../router-client";
import type { NetworkDevice } from "@/types";

void TEST_DATA_DIR;
const T = "TESTOMADATOKEN";
const fetchVero = globalThis.fetch;
let intestazioni: string[] = [];

function finto(): void {
  intestazioni = [];
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const h = (init?.headers ?? {}) as Record<string, string>;
    intestazioni.push(h.Authorization ?? "");
    return new Response(JSON.stringify({ result: { data: [] } }), { status: 200 });
  }) as typeof fetch;
}

function apparato(nome: string, ip: string, colonne: { api_token?: string } = {}): NetworkDevice {
  const d = getTenantDb(T);
  const id = Number(
    d
      .prepare(`INSERT INTO network_devices (name, host, device_type, vendor, protocol, port, api_url, api_token) VALUES (?, ?, 'router', 'omada', 'api', 443, ?, ?)`)
      .run(nome, ip, `https://${ip}`, colonne.api_token ?? null).lastInsertRowid,
  );
  return withTenant(T, () => getNetworkDeviceById(id)) as NetworkDevice;
}

describe("token di Omada dall'archivio", () => {
  before(() => {
    withTenant(T, () => getTenantDb(T));
  });
  afterEach(() => {
    globalThis.fetch = fetchVero;
  });
  after(() => deleteTenantDatabase(T));

  it("voce API a token legata all'apparato: l'intestazione porta quel token", async () => {
    const d = getTenantDb(T);
    const voce = Number(
      d.prepare(`INSERT INTO credentials (name, credential_type, auth_method, encrypted_password) VALUES ('gw · API', 'api', 'token', ?)`).run(encrypt("tok-archivio")).lastInsertRowid,
    );
    const dev = apparato("gw", "10.90.0.1");
    d.prepare(`INSERT INTO device_credential_bindings (device_id, credential_id, protocol_type, port) VALUES (?, ?, 'api', 443)`).run(dev.id, voce);
    finto();
    const ok = await withTenant(T, async () => (await createRouterClient(dev)).testConnection());
    assert.equal(ok, true);
    assert.deepEqual(intestazioni, ["Bearer tok-archivio"]);
  });

  it("nessun token: niente richiesta col «Bearer » vuoto, e l'errore dice perché", async () => {
    const dev = apparato("gw senza", "10.90.0.2");
    finto();
    const client = await withTenant(T, () => createRouterClient(dev));
    assert.equal(await withTenant(T, () => client.testConnection()), false);
    await assert.rejects(() => withTenant(T, () => client.getArpTable()), /token/i);
    assert.deepEqual(intestazioni, []);
  });

  it("apparato lasciato dalla conversione (token ancora in colonna): dalla 2g (T26) la colonna non si legge, nessuna richiesta", async () => {
    const dev = apparato("gw vecchio", "10.90.0.3", { api_token: encrypt("tok-colonna") });
    finto();
    const client = await withTenant(T, () => createRouterClient(dev));
    assert.equal(await withTenant(T, () => client.testConnection()), false);
    assert.deepEqual(intestazioni, []);
  });
});
