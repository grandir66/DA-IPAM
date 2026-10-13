/**
 * Parità del dominio «DHCP» (NUC-2 gruppo 1b, T3-06).
 *
 * Le tre funzioni con testo diverso nelle due copie (a capo, valore restituito
 * in linea) sono confrontate con la copia congelata della vecchia facciata:
 * stesso valore, stesse tabelle. Il tipo `DhcpLease` della copia tenant ha in
 * più il campo `last_seen`, che la tabella ha già: la facciata lo ottiene ora
 * anche nel tipo. Le altre funzioni avevano lo stesso testo: vale la prova
 * d'identità.
 */
import { TEST_DATA_DIR } from "../support/data-dir-isolata";

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import type Database from "better-sqlite3";
import * as facciata from "@/lib/db";
import * as tenant from "@/lib/db-tenant";
import { closeHubDb } from "@/lib/db-hub";
import * as vecchia from "./gruppo1b/dhcp-vecchia-facciata";
import { APPARATO, HOST, RETE_SERVER, RETE_UFFICI, retiHostCredenziali, stessoEsito } from "./gruppo1b/fixture";

after(() => {
  facciata.closeDb();
  tenant.closeAllTenantDbs();
  closeHubDb();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

/** Lease letti dal router (MikroTik) e dal DHCP di Windows via AD. */
function conLease(db: Database.Database): void {
  retiHostCredenziali(db);
  const lease = db.prepare(
    `INSERT INTO dhcp_leases (source_type, source_device_id, ip_address, mac_address, hostname, status, dynamic_lease, host_id, network_id, last_synced)
     VALUES ('mikrotik', ?, ?, ?, ?, 'bound', ?, ?, ?, '2026-10-01 08:00:00')`,
  );
  lease.run(APPARATO.router, "10.40.0.20", "00:1A:2B:3C:4D:02", "pc-ammin", 1, HOST.pcAmmin, RETE_UFFICI);
  lease.run(APPARATO.router, "10.40.0.40", "00:1A:2B:3C:4D:04", "nas-01", 0, HOST.nas, RETE_UFFICI);
  lease.run(APPARATO.switchCore, "10.40.0.50", "00:1A:2B:3C:4D:09", null, null, null, RETE_UFFICI);
  db.prepare(
    `INSERT INTO ad_integrations (name, dc_host, domain, base_dn, encrypted_username, encrypted_password)
     VALUES ('Dominio sede', 'dc01.sede.local', 'sede.local', 'DC=sede,DC=local', 'u-cifrato', 'p-cifrata')`,
  ).run();
  const ad = db.prepare(
    `INSERT INTO ad_dhcp_leases (integration_id, scope_id, ip_address, mac_address, hostname, address_state)
     VALUES (1, ?, ?, ?, ?, ?)`,
  );
  ad.run("10.41.0.0", "10.41.0.10", "00-1a-2b-3c-4d-05", "srv-db.sede.local", "ActiveReservation");
  ad.run("10.41.0.0", "10.41.0.77", "00-1a-2b-3c-4d-06", "srv-web.sede.local", "Active");
}

const TABELLE = ["dhcp_leases", "hosts"];
const ORA = ["last_synced", "updated_at", "created_at"];

test("upsertDhcpLease: lease nuovo, lease esistente aggiornato, MAC normalizzato", () => {
  const nuovo = {
    source_type: "mikrotik" as const,
    source_device_id: APPARATO.router,
    ip_address: "10.40.0.60",
    mac_address: "00-1a-2b-3c-4d-0a",
    hostname: "stampante",
    status: "bound",
    dynamic_lease: 1,
    network_id: RETE_UFFICI,
  };
  const esistente = {
    source_type: "mikrotik" as const,
    source_device_id: APPARATO.router,
    ip_address: "10.40.0.20",
    mac_address: "00:1a:2b:3c:4d:02",
    hostname: "pc-ammin-nuovo",
    status: "bound",
    lease_expires: "2026-10-14 08:00:00",
    last_seen: "2026-10-13 07:00:00",
  };
  for (const [nome, input] of [["udl1", nuovo], ["udl2", esistente]] as const) {
    stessoEsito({
      nome,
      fixture: conLease,
      facciata: () => vecchia.upsertDhcpLease(input),
      tenant: () => tenant.upsertDhcpLease(input),
      funzioni: [vecchia.upsertDhcpLease, tenant.upsertDhcpLease],
      tabelle: TABELLE,
      colonneOra: ORA,
    });
  }
});

test("syncIpAssignmentsForNetwork: stessa assegnazione per host, da lease del router e da AD", () => {
  for (const rete of [RETE_UFFICI, RETE_SERVER]) {
    const e = stessoEsito({
      nome: `sia${rete}`,
      fixture: conLease,
      facciata: () => vecchia.syncIpAssignmentsForNetwork(rete),
      tenant: () => tenant.syncIpAssignmentsForNetwork(rete),
      funzioni: [vecchia.syncIpAssignmentsForNetwork, tenant.syncIpAssignmentsForNetwork],
      tabelle: TABELLE,
      colonneOra: ORA,
    });
    assert.ok(e.valoreTenant > 0, "la rete ha host da classificare");
  }
});

test("deleteDhcpLeasesByDevice: stesso conteggio, stesse righe rimaste", () => {
  for (const [nome, apparato, attesi] of [["ddl1", APPARATO.router, 2], ["ddl2", 99, 0]] as const) {
    const e = stessoEsito({
      nome,
      fixture: conLease,
      facciata: () => vecchia.deleteDhcpLeasesByDevice(apparato),
      tenant: () => tenant.deleteDhcpLeasesByDevice(apparato),
      funzioni: [vecchia.deleteDhcpLeasesByDevice, tenant.deleteDhcpLeasesByDevice],
      tabelle: TABELLE,
      colonneOra: ORA,
    });
    assert.equal(e.valoreTenant, attesi);
  }
});
