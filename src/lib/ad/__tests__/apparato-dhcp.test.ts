/**
 * L'apparato «Windows DHCP» del DC dell'Active Directory nasce col binding
 * WinRM d'archivio, non con la colonna `credential_id` (tappa 2e
 * credenziali, T20, 16/10).
 *
 * Perché: `ad_sync` crea da solo l'apparato del DC per scrivere i lease DHCP
 * nella tabella unificata. Lo creava con la voce WinRM dell'AD nella colonna,
 * che la pagina dell'apparato non mostra come binding e che la 2g smetterà di
 * leggere; dopo la conversione della 2e sarebbe stato l'unico apparato con la
 * colonna piena.
 *
 * Run: DA_INVENT_DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ipam.XXXXXX")" node --import tsx --test src/lib/ad/__tests__/apparato-dhcp.test.ts
 */
import { TEST_DATA_DIR } from "@/lib/__tests__/support/data-dir-isolata";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

import { apparatoDhcpDelDc } from "../apparato-dhcp";
import { withTenant, getTenantDb, deleteTenantDatabase } from "@/lib/db-tenant";
import { encrypt } from "@/lib/crypto";

void TEST_DATA_DIR;
const T = "TESTDHCPAD";

describe("apparato DHCP del DC", () => {
  before(() => {
    withTenant(T, () => {
      getTenantDb(T)
        .prepare(`INSERT INTO credentials (id, name, credential_type, encrypted_username, encrypted_password) VALUES (5, 'dominio\\admin', 'windows', ?, ?)`)
        .run(encrypt("admin"), encrypt("pw"));
    });
  });
  after(() => deleteTenantDatabase(T));

  it("nasce col binding WinRM sulla 5985 verso la voce dell'AD, colonne vuote", () => {
    const d = getTenantDb(T);
    const id = withTenant(T, () => apparatoDhcpDelDc({ name: "Dominio", dc_host: "10.80.0.10", winrm_credential_id: 5 }));
    const colonne = d.prepare(`SELECT credential_id, snmp_credential_id, username, encrypted_password, community_string, api_token, protocol, port FROM network_devices WHERE id = ?`).get(id);
    assert.deepEqual(colonne, { credential_id: null, snmp_credential_id: null, username: null, encrypted_password: null, community_string: null, api_token: null, protocol: "winrm", port: 5985 });
    const b = d.prepare(`SELECT credential_id, protocol_type, port, test_status FROM device_credential_bindings WHERE device_id = ?`).all(id);
    assert.deepEqual(b, [{ credential_id: 5, protocol_type: "winrm", port: 5985, test_status: "untested" }]);
  });

  it("seconda volta: lo stesso apparato, nessun binding doppio", () => {
    const d = getTenantDb(T);
    const id1 = withTenant(T, () => apparatoDhcpDelDc({ name: "Dominio", dc_host: "10.80.0.10", winrm_credential_id: 5 }));
    const id2 = withTenant(T, () => apparatoDhcpDelDc({ name: "Dominio", dc_host: "10.80.0.10", winrm_credential_id: 5 }));
    assert.equal(id1, id2);
    assert.equal((d.prepare(`SELECT COUNT(*) AS n FROM device_credential_bindings WHERE device_id = ?`).get(id1) as { n: number }).n, 1);
  });

  it("senza voce WinRM: l'apparato nasce senza binding", () => {
    const d = getTenantDb(T);
    const id = withTenant(T, () => apparatoDhcpDelDc({ name: "Altro", dc_host: "10.80.0.11", winrm_credential_id: null }));
    assert.equal((d.prepare(`SELECT COUNT(*) AS n FROM device_credential_bindings WHERE device_id = ?`).get(id) as { n: number }).n, 0);
  });
});
