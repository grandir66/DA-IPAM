/**
 * Parità del dominio «apparati, job e Proxmox» (NUC-2 gruppo 1b, T3-06).
 *
 * Le 14 funzioni del dominio avevano lo stesso testo nelle due copie: per
 * loro vale la prova d'identità. L'unica differenza era nel tipo d'ingresso di
 * `createNetworkDevice`: la copia tenant accetta anche `physical_device_id`,
 * che la funzione non scrive. Qui si prova che la creazione di un apparato
 * resta la stessa, con e senza host collegato, contro la copia congelata della
 * vecchia facciata.
 */
import { TEST_DATA_DIR } from "../support/data-dir-isolata";

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as facciata from "@/lib/db";
import * as tenant from "@/lib/db-tenant";
import { closeHubDb } from "@/lib/db-hub";
import * as vecchia from "./gruppo1b/dispositivi-vecchia-facciata";
import { CRED, HOST, retiHostCredenziali, stessoEsito } from "./gruppo1b/fixture";

after(() => {
  facciata.closeDb();
  tenant.closeAllTenantDbs();
  closeHubDb();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

const BASE = {
  vendor_subtype: null,
  credential_id: null,
  snmp_credential_id: null,
  username: null,
  encrypted_password: null,
  community_string: null,
  api_token: null,
  api_url: null,
  enabled: 1,
} as const;

const ORA = ["created_at", "updated_at"];

test("createNetworkDevice: host trovato dall'IP, host esplicito, nessun host, interruttore ARP", () => {
  const casi = [
    ["cnd1", { ...BASE, name: "nas-01", host: "10.40.0.40", device_type: "nas", vendor: "synology", protocol: "snmp_v2", port: 161, snmp_credential_id: CRED.snmp }],
    ["cnd2", { ...BASE, name: "fw-sede", host: "10.40.0.254", device_type: "firewall", vendor: "stormshield", protocol: "ssh", port: 22, credential_id: CRED.ssh, host_id: HOST.server }],
    ["cnd3", { ...BASE, name: "ap-piano1", host: "10.40.0.200", device_type: "access_point", vendor: "ubiquiti", protocol: "api", port: 443, api_url: "https://10.40.0.200", classification: "access_point" }],
    ["cnd4", { ...BASE, name: "rt-filiale", host: "10.41.0.1", device_type: "router", vendor: "mikrotik", vendor_subtype: null, protocol: "api", port: 8728, use_for_arp_poll: false, scan_target: null }],
  ] as const;
  for (const [nome, input] of casi) {
    const e = stessoEsito({
      nome,
      fixture: retiHostCredenziali,
      facciata: () => vecchia.createNetworkDevice(input),
      tenant: () => tenant.createNetworkDevice(input),
      funzioni: [vecchia.createNetworkDevice, tenant.createNetworkDevice],
      tabelle: ["network_devices"],
      colonneOra: ORA,
    });
    if (nome === "cnd1") assert.equal(e.valoreTenant.host_id, HOST.nas, "l'host si trova dall'IP");
  }
});
