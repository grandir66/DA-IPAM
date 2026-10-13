/**
 * Parità del dominio «inventario e licenze» (NUC-2 gruppo 1b, T3-06).
 *
 * Le cinque funzioni con testo diverso nelle due copie (a capo, valori
 * calcolati in linea invece che in una variabile, campi in più nel tipo del
 * risultato Proxmox letto) sono confrontate con la copia congelata della
 * vecchia facciata: stesso valore, stesse tabelle. Le altre avevano lo stesso
 * testo: vale la prova d'identità.
 */
import { TEST_DATA_DIR } from "../support/data-dir-isolata";

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import type Database from "better-sqlite3";
import type { Host, NetworkDevice } from "@/types";
import * as facciata from "@/lib/db";
import * as tenant from "@/lib/db-tenant";
import { closeHubDb } from "@/lib/db-hub";
import * as vecchia from "./gruppo1b/inventario-vecchia-facciata";
import { APPARATO, HOST, retiHostCredenziali, stessoEsito } from "./gruppo1b/fixture";

after(() => {
  facciata.closeDb();
  tenant.closeAllTenantDbs();
  closeHubDb();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

const HYPERVISOR = 3;

/** Risultato di una scansione Proxmox come lo salva il job (forma ridotta, valori inventati). */
const SCANSIONE_PROXMOX = JSON.stringify({
  hosts: [
    {
      hostname: "pve-01",
      cpu_model: "Intel Xeon Silver 4210",
      cpu_mhz: 2200,
      cpu_sockets: 2,
      cpu_cores: 10,
      memory_total_gb: 128,
      proxmox_version: "8.2.4",
      kernel_version: "6.8.12-1-pve",
      rootfs_total_gb: 94,
      hardware_serial: "SN-INVENTATO-01",
      hardware_model: "PowerEdge R640",
      hardware_manufacturer: "Dell Inc.",
      subscription: { status: "active", productname: "Proxmox VE Basic", nextduedate: "2027-01-01" },
    },
  ],
  vms: [],
  scanned_at: "2026-10-12T22:00:00.000Z",
});

/** Apparati con scheda d'inventario, un hypervisor con l'ultima scansione, licenze con posti. */
function conInventario(db: Database.Database): void {
  retiHostCredenziali(db);
  db.prepare(
    `UPDATE network_devices SET sysname = 'sw-core', sysdescr = 'HP J9772A 2530-48G-PoEP', model = '2530-48G', firmware = 'YA.16.11', serial_number = 'CN-INV-01', classification = 'switch' WHERE id = ?`,
  ).run(APPARATO.switchCore);
  db.prepare(
    `INSERT INTO network_devices (id, name, host, device_type, vendor, protocol, last_proxmox_scan_result)
     VALUES (?, 'pve-01', '10.41.0.5', 'hypervisor', 'proxmox', 'api', ?)`,
  ).run(HYPERVISOR, SCANSIONE_PROXMOX);
  db.prepare("UPDATE hosts SET classification = 'server', model = 'PowerEdge R450', os_info = 'Ubuntu 24.04' WHERE id = ?").run(HOST.server);
  const asset = db.prepare(
    "INSERT INTO inventory_assets (asset_id, network_device_id, host_id, hostname, categoria, marca, stato) VALUES (?, ?, ?, ?, ?, ?, 'Attivo')",
  );
  asset.run("a-0001", APPARATO.switchCore, null, "sw-core", "Switch", null);
  asset.run("a-0002", HYPERVISOR, null, "pve-01", "Server", null);
  asset.run("a-0003", null, HOST.server, "srv-file", null, "HPE");
  const lic = db.prepare("INSERT INTO licenses (name, seats, category) VALUES (?, ?, ?)");
  lic.run("Office 365 E3", 3, "Produttività");
  lic.run("Antivirus", 1, "Sicurezza");
  lic.run("Backup", 2, null);
  const posto = db.prepare("INSERT INTO license_seats (license_id, asset_type, asset_id) VALUES (?, ?, ?)");
  posto.run(1, "host", HOST.pcAmmin);
  posto.run(1, "inventory_asset", 1);
  posto.run(2, "host", HOST.server);
  posto.run(2, "host", HOST.srvDb);
}

const TABELLE = ["inventory_assets", "inventory_audit_log", "licenses", "license_seats"];
const ORA = ["created_at", "updated_at", "assigned_at", "last_sync_at", "timestamp", "changed_at"];

test("syncInventoryFromDevice: switch con dati SNMP, hypervisor con la scansione Proxmox, apparato senza scheda", () => {
  for (const id of [APPARATO.switchCore, HYPERVISOR, APPARATO.router]) {
    const leggi = () => tenant.getNetworkDeviceById(id) as NetworkDevice;
    const e = stessoEsito({
      nome: `sifd${id}`,
      fixture: conInventario,
      facciata: () => vecchia.syncInventoryFromDevice(leggi()),
      tenant: () => tenant.syncInventoryFromDevice(leggi()),
      funzioni: [vecchia.syncInventoryFromDevice, tenant.syncInventoryFromDevice],
      tabelle: TABELLE,
      colonneOra: ORA,
    });
    if (id === HYPERVISOR) {
      assert.match(String((e.valoreTenant as { technical_data?: string } | null)?.technical_data), /proxmox|pve-01/i);
    }
    if (id === APPARATO.router) assert.equal(e.valoreTenant, null);
  }
});

test("syncInventoryFromHost: host con scheda e host senza", () => {
  for (const id of [HOST.server, HOST.nas]) {
    const leggi = () => tenant.getTenantDb(tenant.getCurrentTenantCode()!).prepare("SELECT * FROM hosts WHERE id = ?").get(id) as Host;
    stessoEsito({
      nome: `sifh${id}`,
      fixture: conInventario,
      facciata: () => vecchia.syncInventoryFromHost(leggi()),
      tenant: () => tenant.syncInventoryFromHost(leggi()),
      funzioni: [vecchia.syncInventoryFromHost, tenant.syncInventoryFromHost],
      tabelle: TABELLE,
      colonneOra: ORA,
    });
  }
});

test("createInventoryAsset: stessa riga (l'identificativo casuale si confronta solo come presente)", () => {
  const input = {
    hostname: "nas-01",
    nome_prodotto: "DS920+",
    categoria: "NAS" as const,
    marca: "Synology",
    host_id: HOST.nas,
    stato: "Attivo" as const,
    ram_gb: 4,
    backup_configurato: 1,
    mfa_admin: 0,
    in_scope_nis2: 1,
  };
  stessoEsito({
    nome: "cia",
    fixture: conInventario,
    facciata: () => vecchia.createInventoryAsset(input),
    tenant: () => tenant.createInventoryAsset(input),
    funzioni: [vecchia.createInventoryAsset, tenant.createInventoryAsset],
    tabelle: TABELLE,
    colonneOra: ORA,
    colonneCasuali: ["asset_id"],
  });
});

test("getLicenses e getLicenseById: stessi posti usati e liberi", () => {
  const e = stessoEsito({
    nome: "gl",
    fixture: conInventario,
    facciata: () => vecchia.getLicenses(),
    tenant: () => tenant.getLicenses(),
    funzioni: [vecchia.getLicenses, tenant.getLicenses],
    tabelle: [],
    colonneOra: ORA,
  });
  assert.equal(e.valoreTenant.length, 3);
  for (const id of [1, 2, 3, 99]) {
    stessoEsito({
      nome: `glbi${id}`,
      fixture: conInventario,
      facciata: () => vecchia.getLicenseById(id),
      tenant: () => tenant.getLicenseById(id),
      funzioni: [vecchia.getLicenseById, tenant.getLicenseById],
      tabelle: [],
      colonneOra: ORA,
    });
  }
});
