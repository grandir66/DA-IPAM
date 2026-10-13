/**
 * Parità del dominio «AD» (NUC-2 gruppo 1b, T3-06).
 *
 * Le tre funzioni del dominio con testo diverso nelle due copie (a capo, un
 * valore restituito in linea invece che da una variabile) sono confrontate con
 * la copia congelata della vecchia facciata: stesso valore, stesse tabelle. Le
 * altre avevano lo stesso testo: vale la prova d'identità.
 */
import { TEST_DATA_DIR } from "../support/data-dir-isolata";

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import type Database from "better-sqlite3";
import * as facciata from "@/lib/db";
import * as tenant from "@/lib/db-tenant";
import { closeHubDb } from "@/lib/db-hub";
import * as vecchia from "./gruppo1b/ad-vecchia-facciata";
import { RETE_SERVER, RETE_UFFICI, retiHostCredenziali, stessoEsito } from "./gruppo1b/fixture";

after(() => {
  facciata.closeDb();
  tenant.closeAllTenantDbs();
  closeHubDb();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

/** Un'integrazione AD con i computer come li scrive la sincronizzazione LDAP. */
function conAd(db: Database.Database): void {
  retiHostCredenziali(db);
  db.prepare(
    `INSERT INTO ad_integrations (name, dc_host, domain, base_dn, encrypted_username, encrypted_password)
     VALUES ('Dominio sede', 'dc01.sede.local', 'sede.local', 'DC=sede,DC=local', 'u-cifrato', 'p-cifrata')`,
  ).run();
  const pc = db.prepare(
    `INSERT INTO ad_computers (integration_id, object_guid, sam_account_name, dns_host_name, distinguished_name, operating_system, ip_address, host_id)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?)`,
  );
  // per nome (host senza sistema operativo), per IP, senza corrispondenza, già legato a un host della rete
  pc.run("guid-1", "PC-AMMIN$", "pc-ammin", "CN=PC-AMMIN,DC=sede,DC=local", "Windows 11 Pro", null, null);
  pc.run("guid-2", "SRVDB$", null, "CN=SRVDB,DC=sede,DC=local", "Windows Server 2022", "10.41.0.10", null);
  pc.run("guid-3", "PORTATILE$", "portatile.sede.local", "CN=PORTATILE,DC=sede,DC=local", "Windows 10", "10.99.0.5", null);
  pc.run("guid-4", "NAS-01$", "nas-01", "CN=NAS-01,DC=sede,DC=local", null, null, 1);
}

const TABELLE = ["ad_integrations", "ad_computers", "hosts"];
const ORA = ["created_at", "updated_at", "last_sync_at", "last_synced", "synced_at", "last_seen", "first_seen"];

test("createAdIntegration: stessa riga e stesso oggetto restituito", () => {
  const input = {
    name: "Dominio filiale",
    dc_host: "dc02.filiale.local",
    domain: "filiale.local",
    base_dn: "DC=filiale,DC=local",
    encrypted_username: "u-cifrato",
    encrypted_password: "p-cifrata",
    use_ssl: 0,
    port: 389,
    winrm_credential_id: 3,
  };
  for (const [nome, dati] of [["cai1", input], ["cai2", { ...input, use_ssl: undefined, port: undefined, winrm_credential_id: undefined }]] as const) {
    stessoEsito({
      nome,
      fixture: conAd,
      facciata: () => vecchia.createAdIntegration(dati),
      tenant: () => tenant.createAdIntegration(dati),
      funzioni: [vecchia.createAdIntegration, tenant.createAdIntegration],
      tabelle: TABELLE,
      colonneOra: ORA,
    });
  }
});

test("deleteAdIntegration: integrazione presente e assente", () => {
  for (const [nome, id, atteso] of [["dai1", 1, true], ["dai2", 99, false]] as const) {
    const e = stessoEsito({
      nome,
      fixture: conAd,
      facciata: () => vecchia.deleteAdIntegration(id),
      tenant: () => tenant.deleteAdIntegration(id),
      funzioni: [vecchia.deleteAdIntegration, tenant.deleteAdIntegration],
      tabelle: TABELLE,
      colonneOra: ORA,
    });
    assert.equal(e.valoreTenant, atteso);
  }
});

test("relinkAdComputersForNetwork: stessi legami e stessi host arricchiti", () => {
  for (const rete of [RETE_UFFICI, RETE_SERVER]) {
    const e = stessoEsito({
      nome: `rac${rete}`,
      fixture: conAd,
      facciata: () => vecchia.relinkAdComputersForNetwork(rete),
      tenant: () => tenant.relinkAdComputersForNetwork(rete),
      funzioni: [vecchia.relinkAdComputersForNetwork, tenant.relinkAdComputersForNetwork],
      tabelle: TABELLE,
      colonneOra: ORA,
    });
    assert.ok(e.valoreTenant.linked > 0, "la fixture lega almeno un computer in ogni rete");
  }
});
