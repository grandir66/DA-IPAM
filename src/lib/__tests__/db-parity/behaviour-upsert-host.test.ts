/**
 * `upsertHost` (NUC-2 gruppo 2, T3-07): una copia sola, quella tenant, e INV-4.
 *
 * È la funzione più calda: la chiamano la discovery, il giro ARP (attraverso
 * `updateHostIfExists`), le lease MikroTik, l'MDM e la creazione a mano.
 * Differenze fra le due copie:
 * - la fonte del nome «glpi_agent» (l'agente d'inventario) vale 5 come il
 *   DHCP; nella facciata valeva 0 e qualunque scansione la sovrascriveva;
 * - il ricalcolo dell'attribuzione: la facciata passava il database già aperto
 *   e scriveva un avviso se il ricalcolo non riusciva; la copia tenant ora fa
 *   lo stesso (prima risolveva di nuovo il tenant e taceva).
 * INV-4: un MAC presente ma non valido diventava NULL e cancellava un MAC
 * buono, in tutte e due le copie. Ora un MAC non valido non tocca quello che c'è.
 *
 * Misura sulla copia del DB DTS (13/10): nessun host con nome da «glpi_agent»;
 * 947 host su 965 hanno un MAC, che un MAC non valido non può più cancellare.
 */
import { TEST_DATA_DIR } from "../support/data-dir-isolata";

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import type Database from "better-sqlite3";
import * as facciata from "@/lib/db";
import * as tenant from "@/lib/db-tenant";
import { closeHubDb } from "@/lib/db-hub";
import { HOST, RETE_UFFICI, retiHostCredenziali } from "./gruppo1b/fixture";
import { nelTenant } from "./comportamento";

after(() => {
  facciata.closeDb();
  tenant.closeAllTenantDbs();
  closeHubDb();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

function riga(db: Database.Database, id: number) {
  return db.prepare("SELECT mac, hostname, hostname_source FROM hosts WHERE id = ?").get(id) as { mac: string | null; hostname: string | null; hostname_source: string | null };
}

test("upsertHost (INV-4): un host con MAC buono aggiornato con un MAC non valido mantiene il suo", () => {
  const r = nelTenant("uhinv4", retiHostCredenziali, (db) =>
    ["zz:zz:zz:zz:zz:zz", "", "00:1A"].map((mac) => {
      facciata.upsertHost({ network_id: RETE_UFFICI, ip: "10.40.0.20", mac, status: "online" });
      return riga(db, HOST.pcAmmin).mac;
    }),
  );
  assert.deepEqual(r, ["00:1A:2B:3C:4D:02", "00:1A:2B:3C:4D:02", "00:1A:2B:3C:4D:02"]);
});

test("upsertHost: un MAC valido si scrive, anche al posto di uno diverso, nella forma normalizzata", () => {
  const r = nelTenant("uhmac", retiHostCredenziali, (db) => {
    facciata.upsertHost({ network_id: RETE_UFFICI, ip: "10.40.0.30", mac: "00-50-56-9a-10-30" });
    facciata.upsertHost({ network_id: RETE_UFFICI, ip: "10.40.0.20", mac: "001a.2b3c.4d99" });
    return [riga(db, HOST.server).mac, riga(db, HOST.pcAmmin).mac];
  });
  assert.deepEqual(r, ["00:50:56:9A:10:30", "00:1A:2B:3C:4D:99"]);
});

test("upsertHost: il nome dato dall'agente d'inventario non lo sovrascrive una scansione", () => {
  const r = nelTenant("uhglpi", retiHostCredenziali, (db) => {
    facciata.upsertHost({ network_id: RETE_UFFICI, ip: "10.40.0.40", hostname: "nas-01.dominio.local", hostname_source: "glpi_agent" });
    facciata.upsertHost({ network_id: RETE_UFFICI, ip: "10.40.0.40", hostname: "nas", hostname_source: "nmap" });
    const dopoNmap = riga(db, HOST.nas);
    facciata.upsertHost({ network_id: RETE_UFFICI, ip: "10.40.0.40", hostname: "nas-01", hostname_source: "dhcp" });
    return { dopoNmap, dopoDhcp: riga(db, HOST.nas) };
  });
  assert.deepEqual(r.dopoNmap, { mac: "00:1A:2B:3C:4D:04", hostname: "nas-01.dominio.local", hostname_source: "glpi_agent" });
  // Il DHCP ha la stessa priorità: a parità vince l'ultimo, come per le altre fonti.
  assert.equal(r.dopoDhcp.hostname_source, "dhcp");
});

test("upsertHost: un host nuovo con un MAC non valido nasce senza MAC", () => {
  const r = nelTenant("uhnuovo", retiHostCredenziali, (db) => {
    const h = facciata.upsertHost({ network_id: RETE_UFFICI, ip: "10.40.0.60", mac: "non-un-mac", status: "online" });
    return h ? riga(db, h.id) : null;
  });
  assert.deepEqual(r, { mac: null, hostname: null, hostname_source: null });
});
