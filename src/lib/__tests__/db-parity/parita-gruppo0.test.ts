/**
 * Parità delle quattro funzioni dati che esistevano solo in `db.ts` (NUC-2,
 * gruppo 0): la copia tenant deve fare quello che faceva la facciata, sul
 * valore restituito e sulle tabelle toccate.
 * Lanciare con DA_INVENT_DATA_DIR di prova.
 */
process.env.ENCRYPTION_KEY ||= "test-encryption-key-parita-gruppo0";

import { test } from "node:test";
import assert from "node:assert/strict";
import type Database from "better-sqlite3";
import * as facciata from "@/lib/db";
import * as tenant from "@/lib/db-tenant";
import { eseguiParita, type CasoParita, type EsitoParita } from "./harness";

const sqlOra = (msFa: number) => new Date(Date.now() - msFa).toISOString().replace("T", " ").slice(0, 19);

/** Reti, host e storico stati come li scrivono discovery e ping. */
function storicoStati(db: Database.Database): void {
  const rete = Number(db.prepare("INSERT INTO networks (cidr, name) VALUES ('10.20.0.0/24', 'Uffici')").run().lastInsertRowid);
  const host = db.prepare("INSERT INTO hosts (network_id, ip, hostname) VALUES (?, ?, ?)");
  const ids = [1, 2, 3].map((n) => Number(host.run(rete, `10.20.0.${n}`, `pc-${n}`).lastInsertRowid));
  const stato = db.prepare("INSERT INTO status_history (host_id, status, checked_at) VALUES (?, ?, ?)");
  ids.forEach((id, i) => {
    stato.run(id, "online", sqlOra((30 + i) * 3_600_000));
    stato.run(id, i === 0 ? "offline" : "online", sqlOra(5 * 3_600_000));
    stato.run(id, "online", sqlOra(40 * 60_000));
  });
}

/** Riferimenti orfani in mac_ip_mapping e dhcp_leases, come li lasciavano le migrazioni con foreign_keys OFF. */
function riferimentiOrfani(db: Database.Database): void {
  const rete = Number(db.prepare("INSERT INTO networks (cidr, name) VALUES ('10.30.0.0/24', 'Server')").run().lastInsertRowid);
  const host = Number(db.prepare("INSERT INTO hosts (network_id, ip) VALUES (?, '10.30.0.5')").run(rete).lastInsertRowid);
  db.pragma("foreign_keys = OFF");
  const mappa = db.prepare(
    "INSERT INTO mac_ip_mapping (mac_normalized, mac_display, ip, source, source_device_id, network_id, host_id) VALUES (?, ?, ?, 'arp', ?, ?, ?)",
  );
  mappa.run("aabbcc000001", "AA:BB:CC:00:00:01", "10.30.0.5", null, rete, host);
  mappa.run("aabbcc000002", "AA:BB:CC:00:00:02", "10.30.0.6", 999, 998, 997);
  const lease = db.prepare(
    "INSERT INTO dhcp_leases (source_type, ip_address, mac_address, host_id, network_id) VALUES ('mikrotik', ?, ?, ?, ?)",
  );
  lease.run("10.30.0.5", "AA:BB:CC:00:00:01", host, rete);
  lease.run("10.30.0.7", "AA:BB:CC:00:00:03", 996, 995);
  db.pragma("foreign_keys = ON");
}

function stessoEsito<R>(caso: CasoParita<R>): EsitoParita<R> {
  const e = eseguiParita(caso);
  assert.deepEqual(e.valoreTenant, e.valoreFacciata, "valore restituito diverso");
  assert.deepEqual(e.tabelleTenant, e.tabelleFacciata, "tabelle diverse dopo la chiamata");
  return e;
}

test("getStatusOverTime: stessa serie", () => {
  for (const ore of [24, 168]) {
    stessoEsito({
      nome: `sot${ore}`,
      fixture: storicoStati,
      facciata: () => facciata.getStatusOverTime(ore),
      tenant: () => tenant.getStatusOverTime(ore),
      tabelle: [],
    });
  }
});

test("getRecentStatusChanges: stesse transizioni", () => {
  stessoEsito({
    nome: "rsc",
    fixture: storicoStati,
    facciata: () => facciata.getRecentStatusChanges(10, 48),
    tenant: () => tenant.getRecentStatusChanges(10, 48),
    tabelle: [],
  });
});

test("updateScheduledJobInterval: stessa riga del job", () => {
  const job = (db: Database.Database) => {
    db.prepare("INSERT INTO scheduled_jobs (job_type, interval_minutes, config) VALUES ('cleanup', 60, '{}')").run();
  };
  stessoEsito({
    nome: "usji",
    fixture: job,
    facciata: () => facciata.updateScheduledJobInterval(1, 180),
    tenant: () => tenant.updateScheduledJobInterval(1, 180),
    tabelle: ["scheduled_jobs"],
    colonneOra: ["next_run", "updated_at", "created_at"],
  });
});

test("cleanOrphanedForeignKeys: stessi riferimenti azzerati", () => {
  const e = stessoEsito({
    nome: "cofk",
    fixture: riferimentiOrfani,
    facciata: () => facciata.cleanOrphanedForeignKeys(),
    tenant: () => tenant.cleanOrphanedForeignKeys(),
    tabelle: ["mac_ip_mapping", "dhcp_leases"],
    colonneOra: ["first_seen", "last_seen", "last_synced"],
  });
  // La parità vale solo se la pulizia è avvenuta: gli orfani azzerati, il resto intatto.
  const [buona, orfana] = e.tabelleTenant.mac_ip_mapping as Record<string, unknown>[];
  assert.deepEqual([orfana.source_device_id, orfana.network_id, orfana.host_id], [null, null, null]);
  assert.notEqual(buona.network_id, null);
  assert.notEqual(buona.host_id, null);
  const [leaseBuono, leaseOrfano] = e.tabelleTenant.dhcp_leases as Record<string, unknown>[];
  assert.deepEqual([leaseOrfano.host_id, leaseOrfano.network_id], [null, null]);
  assert.notEqual(leaseBuono.host_id, null);
});
