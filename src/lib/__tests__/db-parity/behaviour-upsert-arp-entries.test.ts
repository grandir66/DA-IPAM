/**
 * `upsertArpEntries` (NUC-2 gruppo 2, T3-07): una copia sola, quella tenant.
 *
 * La copia della facciata scriveva solo `arp_entries` e i legami MAC-IP; la
 * copia tenant porta anche il MAC e il vendor all'host già esistente con
 * quell'IP (incidente del 2026-06-21: host senza MAC pur essendo nella tabella
 * ARP del gateway). Dalla facciata arriva la pulizia dei riferimenti orfani
 * prima della scrittura.
 *
 * Misura sulla copia del DB DTS (13/10): rigiocando le 1.653 voci ARP, la copia
 * tenant di allora cambiava il MAC a 11 host che ne avevano già uno, e 13 dei 14
 * host candidati avevano il loro MAC confermato da un'altra voce ARP dello
 * stesso IP. Era un dato buono perso: l'ARP ora RIEMPIE un MAC mancante e non
 * sovrascrive quello che c'è. Attenzione: la misura è di upsertArpEntries da
 * sola. Nel giro arp_poll il MAC lo scrive prima updateHostIfExists, che lo
 * sovrascrive come sempre: vedi l'ultima prova di questo file.
 */
import { TEST_DATA_DIR } from "../support/data-dir-isolata";

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import type Database from "better-sqlite3";
import * as facciata from "@/lib/db";
import * as tenant from "@/lib/db-tenant";
import { closeHubDb } from "@/lib/db-hub";
import { lookupVendorSync } from "@/lib/scanner/mac-vendor";
import { APPARATO, HOST, RETE_UFFICI, retiHostCredenziali } from "./gruppo1b/fixture";
import { nelTenant } from "./comportamento";

after(() => {
  facciata.closeDb();
  tenant.closeAllTenantDbs();
  closeHubDb();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

/** Il MAC di una scheda VMware: un OUI che la base dei produttori conosce. */
const MAC_VMWARE = "00:50:56:9A:10:30";
const reteUffici = (ip: string) => (ip.startsWith("10.40.0.") ? RETE_UFFICI : null);

function host(db: Database.Database, id: number) {
  return db.prepare("SELECT mac, vendor FROM hosts WHERE id = ?").get(id) as { mac: string | null; vendor: string | null };
}

test("upsertArpEntries: un host senza MAC prende MAC e vendor dalla tabella ARP", () => {
  const vendorAtteso = lookupVendorSync(MAC_VMWARE);
  assert.ok(vendorAtteso, "la base dei produttori deve conoscere l'OUI della prova");
  const h = nelTenant("arpriempie", retiHostCredenziali, (db) => {
    facciata.upsertArpEntries(APPARATO.router, [{ mac: MAC_VMWARE, ip: "10.40.0.30", interface_name: "bridge" }], reteUffici);
    return host(db, HOST.server);
  });
  assert.equal(h.mac, MAC_VMWARE);
  assert.equal(h.vendor, vendorAtteso);
});

test("upsertArpEntries: un host con il suo MAC lo tiene anche se l'ARP dice altro", () => {
  const h = nelTenant("arpnonsovrascrive", retiHostCredenziali, (db) => {
    facciata.upsertArpEntries(APPARATO.router, [{ mac: MAC_VMWARE, ip: "10.40.0.20", interface_name: "bridge" }], reteUffici);
    return host(db, HOST.pcAmmin);
  });
  assert.deepEqual(h, { mac: "00:1A:2B:3C:4D:02", vendor: "Dell" });
});

test("upsertArpEntries: senza rete per l'IP non tocca gli host, scrive comunque le voci ARP", () => {
  const r = nelTenant("arpsenzarete", retiHostCredenziali, (db) => {
    facciata.upsertArpEntries(APPARATO.router, [{ mac: MAC_VMWARE, ip: "10.40.0.30", interface_name: null }]);
    return { h: host(db, HOST.server), voci: (db.prepare("SELECT COUNT(*) c FROM arp_entries").get() as { c: number }).c };
  });
  assert.deepEqual(r, { h: { mac: null, vendor: null }, voci: 1 });
});

test("upsertArpEntries: prima di scrivere pulisce i riferimenti orfani dei legami MAC-IP", () => {
  const orfani = nelTenant(
    "arporfani",
    (db) => {
      retiHostCredenziali(db);
      db.pragma("foreign_keys = OFF");
      db.prepare(
        "INSERT INTO mac_ip_mapping (mac_normalized, mac_display, ip, source, source_device_id, network_id, host_id, first_seen, last_seen) VALUES (?, ?, ?, 'arp', ?, ?, ?, '2026-10-01T08:00:00.000Z', '2026-10-01T08:00:00.000Z')",
      ).run("001a2b3c4d77", "00:1A:2B:3C:4D:77", "10.40.0.77", 99, 98, 97);
      db.pragma("foreign_keys = ON");
    },
    (db) => {
      facciata.upsertArpEntries(APPARATO.router, [{ mac: MAC_VMWARE, ip: "10.40.0.30", interface_name: null }], reteUffici);
      return db.prepare("SELECT source_device_id, network_id, host_id FROM mac_ip_mapping WHERE mac_normalized = '001a2b3c4d77'").get();
    },
  );
  assert.deepEqual(orfani, { source_device_id: null, network_id: null, host_id: null });
});

/**
 * Il giro arp_poll (cron/jobs.ts) NON è upsertArpEntries da sola: per ogni voce
 * chiama prima updateHostIfExists → upsertHost, che scrive il MAC dell'host
 * senza condizioni, e poi upsertArpEntries. La regola «l'ARP riempie, non
 * sovrascrive» vale solo per upsertArpEntries; nel giro il MAC lo cambia
 * comunque upsertHost, come prima di T3-07. Misura sulla copia del DB DTS
 * (13/10, revisione della parte 3b), rigiocando il corpo del giro su 3 router:
 * 11 host cambiano MAC con il codice di prima e con quello di adesso, e per 10
 * host il MAC finale dipende dall'ordine in cui si leggono i router. Se
 * applicare la stessa regola anche a upsertHost per le fonti passive è una
 * decisione aperta (passa da Riccardo): questa prova fissa il comportamento di
 * oggi, così una modifica non passa senza che il testo qui e nel CHANGELOG la
 * racconti.
 */
test("giro arp_poll: updateHostIfExists sovrascrive il MAC prima di upsertArpEntries (comportamento invariato)", () => {
  const h = nelTenant("arpgiro", retiHostCredenziali, (db) => {
    const voci = [{ mac: MAC_VMWARE, ip: "10.40.0.20", interface_name: "bridge" }];
    for (const v of voci) {
      facciata.updateHostIfExists({ network_id: RETE_UFFICI, ip: v.ip, mac: v.mac, hostname_source: "arp" });
    }
    facciata.upsertArpEntries(APPARATO.router, voci, reteUffici);
    return host(db, HOST.pcAmmin);
  });
  assert.equal(h.mac, MAC_VMWARE);
});
