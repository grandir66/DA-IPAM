/**
 * Parità delle ultime tre funzioni dati della facciata (NUC-2 gruppo 3, T3-08).
 *
 * `resolveMacToNetworkDevice`, `resolveMacToDevice` e `updateHostIfExists`
 * avevano nelle due copie lo stesso testo, salvo `getDb()` contro `db()`. Qui
 * si prova, contro la copia congelata della vecchia facciata, che nel contesto
 * di un tenant danno lo stesso valore e lasciano le stesse tabelle, in tutti i
 * rami: host col MAC, solo ARP, solo legame MAC-IP, niente; apparato escluso;
 * host esistente e no. Fuori contesto la copia tenant lancia invece di
 * ripiegare: è il comportamento già voluto dal gruppo 1a.
 */
import { TEST_DATA_DIR } from "../support/data-dir-isolata";

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import * as facciata from "@/lib/db";
import * as tenant from "@/lib/db-tenant";
import { closeHubDb } from "@/lib/db-hub";
import * as vecchia from "./gruppo3-vecchia-facciata";
import { APPARATO, HOST, RETE_SERVER, RETE_UFFICI, retiHostCredenziali, stessoEsito } from "./gruppo1b/fixture";

after(() => {
  facciata.closeDb();
  tenant.closeAllTenantDbs();
  closeHubDb();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

/** Reti, host e apparati del banco, più quel che lasciano un giro ARP e i legami MAC-IP. */
function conArp(db: Database.Database): void {
  retiHostCredenziali(db);
  const arp = db.prepare("INSERT INTO arp_entries (device_id, host_id, mac, ip, interface_name, timestamp) VALUES (?, ?, ?, ?, ?, ?)");
  // Un MAC senza host: due voci, vince la più recente.
  arp.run(APPARATO.router, null, "00:1a:2b:3c:4d:a1", "10.40.0.1", "ether1", "2026-10-11 08:00:00");
  arp.run(APPARATO.router, null, "00-1A-2B-3C-4D-A1", "10.40.0.2", "ether1", "2026-10-12 08:00:00");
  // Un MAC senza host con IP che non è un apparato.
  arp.run(APPARATO.router, null, "001a.2b3c.4da2", "10.40.0.77", "ether1", "2026-10-12 09:00:00");
  // Un MAC senza IP: non conta.
  arp.run(APPARATO.router, null, "00:1A:2B:3C:4D:A3", null, "ether1", "2026-10-12 09:00:00");
  db.prepare(
    `INSERT INTO mac_ip_mapping (mac_normalized, mac_display, ip, source, source_device_id, network_id, host_id, vendor, hostname, first_seen, last_seen)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '2026-10-01T08:00:00.000Z', '2026-10-12T08:00:00.000Z')`,
  ).run("001A2B3C4DA3", "00:1A:2B:3C:4D:A3", "10.41.0.99", "dhcp", APPARATO.router, RETE_SERVER, null, "Acme", "stampante-2");
}

const MAC = [
  ["host", "00:1A:2B:3C:4D:01"], // host sw-core, apparato 1
  ["host-senza-apparato", "00-1a-2b-3c-4d-02"], // pc-ammin
  ["solo-arp-apparato", "00:1A:2B:3C:4D:A1"], // ARP -> 10.40.0.2 = sw-core
  ["solo-arp", "00:1A:2B:3C:4D:A2"],
  ["solo-legame", "00:1A:2B:3C:4D:A3"],
  ["sconosciuto", "00:1A:2B:3C:4D:FF"],
] as const;

test("resolveMacToNetworkDevice: stesso apparato in ogni ramo, anche con l'apparato escluso", () => {
  for (const [nome, mac] of MAC) {
    for (const escludi of [undefined, APPARATO.switchCore]) {
      stessoEsito({
        nome: `rmnd-${nome}-${escludi ?? "no"}`,
        fixture: conArp,
        facciata: () => vecchia.resolveMacToNetworkDevice(mac, escludi),
        tenant: () => tenant.resolveMacToNetworkDevice(mac, escludi),
        funzioni: [vecchia.resolveMacToNetworkDevice, tenant.resolveMacToNetworkDevice],
        tabelle: ["arp_entries", "network_devices"],
      });
    }
  }
});

test("resolveMacToDevice: stesso host, ARP o legame MAC-IP in ogni ramo", () => {
  for (const [nome, mac] of MAC) {
    stessoEsito({
      nome: `rmd-${nome}`,
      fixture: conArp,
      facciata: () => vecchia.resolveMacToDevice(mac),
      tenant: () => tenant.resolveMacToDevice(mac),
      funzioni: [vecchia.resolveMacToDevice, tenant.resolveMacToDevice],
      tabelle: ["hosts", "mac_ip_mapping"],
    });
  }
});

test("updateHostIfExists: aggiorna l'host che c'è, non crea quello che manca", () => {
  const ORA = ["first_seen", "last_seen", "updated_at", "created_at", "attr_at", "changed_at", "discovered_at", "timestamp"];
  const casi = [
    ["esiste", { network_id: RETE_UFFICI, ip: "10.40.0.20", hostname: "pc-ammin-nuovo", hostname_source: "dns", status: "online" as const }],
    ["esiste-mac", { network_id: RETE_SERVER, ip: "10.41.0.11", mac: "00:1a:2b:3c:4d:06", vendor: "Dell" }],
    ["manca", { network_id: RETE_UFFICI, ip: "10.40.0.250", hostname: "fantasma" }],
    ["altra-rete", { network_id: RETE_SERVER, ip: "10.40.0.20", hostname: "rete-sbagliata" }],
  ] as const;
  for (const [nome, input] of casi) {
    const e = stessoEsito({
      nome: `uhie-${nome}`,
      fixture: conArp,
      facciata: () => vecchia.updateHostIfExists({ ...input }),
      tenant: () => tenant.updateHostIfExists({ ...input }),
      funzioni: [vecchia.updateHostIfExists, tenant.updateHostIfExists],
      tabelle: ["hosts", "mac_ip_mapping", "mac_ip_history"],
      colonneOra: ORA,
    });
    if (nome === "manca" || nome === "altra-rete") assert.equal(e.valoreTenant, null);
    else assert.equal((e.valoreTenant as { id: number } | null)?.id, nome === "esiste" ? HOST.pcAmmin : HOST.srvWeb);
  }
});

test("fuori contesto la copia tenant lancia e non apre DEFAULT né ipam.db", () => {
  const defaultDb = path.join(TEST_DATA_DIR, "tenants", "DEFAULT.db");
  const legacyDb = path.join(TEST_DATA_DIR, "ipam.db");
  assert.equal(tenant.getCurrentTenantCode(), null);
  assert.throws(() => facciata.resolveMacToDevice("00:1A:2B:3C:4D:01"), /Nessun contesto tenant/);
  assert.throws(() => facciata.resolveMacToNetworkDevice("00:1A:2B:3C:4D:01"), /Nessun contesto tenant/);
  assert.throws(() => facciata.updateHostIfExists({ network_id: 1, ip: "10.40.0.20" }), /Nessun contesto tenant/);
  assert.ok(!fs.existsSync(defaultDb), "ha aperto DEFAULT.db");
  assert.ok(!fs.existsSync(legacyDb), "ha aperto il vecchio ipam.db");
});
