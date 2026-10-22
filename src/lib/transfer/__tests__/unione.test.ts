// src/lib/transfer/__tests__/unione.test.ts
/**
 * Import per unione (wipe:false) — analisi del 19/10, F01.
 *
 * Incidente: un bundle con una chiave di `tenant_settings` già presente nella
 * destinazione (le migrazioni ne scrivono 4 anche su un tenant nuovo) faceva
 * fallire l'import con «UNIQUE constraint failed: tenant_settings.key» e la
 * transazione annullava tutto: l'unione, il default della pagina, non andava
 * mai a buon fine su un'installazione vera.
 *
 * Regola decisa da Riccardo il 19/10: nell'unione VINCE LA DESTINAZIONE. Sulle
 * tabelle a chiave naturale la riga del bundle si salta e il riepilogo lo dice.
 * Sulle tabelle a id numerico un id già presente non si salta (le righe figlie
 * del bundle si attaccherebbero alla riga sbagliata) e non si rinumera: l'import
 * si ferma prima di scrivere e dice dove.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { TENANT_SCHEMA_SQL, TENANT_INDEXES_SQL } from "../../db-tenant-schema";
import { HUB_SCHEMA_SQL } from "../../db-hub-schema";

const PASS = "unione-1910";

function freshTenant(): Database.Database {
  const d = new Database(":memory:");
  d.exec(TENANT_SCHEMA_SQL);
  d.exec(TENANT_INDEXES_SQL);
  return d;
}

function freshHub(): Database.Database {
  const d = new Database(":memory:");
  d.exec(HUB_SCHEMA_SQL);
  return d;
}

async function bundleDi(src: Database.Database): Promise<Buffer> {
  process.env.ENCRYPTION_KEY = "A".repeat(64);
  const { exportTenant } = await import("../export");
  return exportTenant({
    tenantDb: src, hubDb: freshHub(),
    options: { tenantCode: "DEFAULT", tiers: [], includeVault: false, passphrase: PASS, exportedAt: "2026-10-19T10:00:00.000Z", appVersion: "test" },
  });
}

function impostazione(db: Database.Database, chiave: string): string | undefined {
  return (db.prepare("SELECT value FROM tenant_settings WHERE key = ?").get(chiave) as { value: string } | undefined)?.value;
}

test("unione: una chiave di tenant_settings già presente resta quella della destinazione, le nuove entrano", async () => {
  const src = freshTenant();
  src.prepare("INSERT INTO tenant_settings (key, value) VALUES (?, ?)").run("audit-key", "dal-bundle");
  src.prepare("INSERT INTO tenant_settings (key, value) VALUES (?, ?)").run("solo-nel-bundle", "nuova");
  src.prepare("INSERT INTO networks (cidr, name) VALUES (?, ?)").run("10.0.0.0/24", "LAN");
  const bundle = await bundleDi(src);

  const { importTenant } = await import("../import");
  const dst = freshTenant();
  dst.prepare("INSERT INTO tenant_settings (key, value) VALUES (?, ?)").run("audit-key", "della-destinazione");

  const res = importTenant({ bundle, tenantDb: dst, hubDb: freshHub(), options: { tenantCode: "DEFAULT", passphrase: PASS, wipe: false } });

  assert.equal(impostazione(dst, "audit-key"), "della-destinazione");
  assert.equal(impostazione(dst, "solo-nel-bundle"), "nuova");
  assert.equal(res.tables.networks, 1);
  assert.deepEqual(res.saltate.tenant_settings, ["audit-key"]);
});

test("unione: un id già presente in una tabella a id numerico ferma l'import prima di scrivere", async () => {
  const src = freshTenant();
  src.prepare("INSERT INTO networks (id, cidr, name) VALUES (1, ?, ?)").run("10.0.0.0/24", "LAN del bundle");
  src.prepare("INSERT INTO tenant_settings (key, value) VALUES (?, ?)").run("solo-nel-bundle", "nuova");
  const bundle = await bundleDi(src);

  const { importTenant } = await import("../import");
  const dst = freshTenant();
  dst.prepare("INSERT INTO networks (id, cidr, name) VALUES (1, ?, ?)").run("192.168.1.0/24", "LAN della destinazione");

  assert.throws(
    () => importTenant({ bundle, tenantDb: dst, hubDb: freshHub(), options: { tenantCode: "DEFAULT", passphrase: PASS, wipe: false } }),
    (e: Error) => /networks: 1/.test(e.message) && /Svuota/.test(e.message),
  );
  // Niente scritto: né la rete né l'impostazione del bundle.
  assert.equal((dst.prepare("SELECT name FROM networks WHERE id = 1").get() as { name: string }).name, "LAN della destinazione");
  assert.equal((dst.prepare("SELECT count(*) n FROM networks").get() as { n: number }).n, 1);
  assert.equal(impostazione(dst, "solo-nel-bundle"), undefined);
});

test("unione: un vincolo UNIQUE oltre all'id (stessa rete con un altro id) ferma l'import", async () => {
  const src = freshTenant();
  src.prepare("INSERT INTO networks (id, cidr, name) VALUES (7, ?, ?)").run("10.0.0.0/24", "LAN");
  const bundle = await bundleDi(src);

  const { importTenant } = await import("../import");
  const dst = freshTenant();
  dst.prepare("INSERT INTO networks (id, cidr, name) VALUES (1, ?, ?)").run("10.0.0.0/24", "LAN");

  assert.throws(
    () => importTenant({ bundle, tenantDb: dst, hubDb: freshHub(), options: { tenantCode: "DEFAULT", passphrase: PASS, wipe: false } }),
    /networks: 1/,
  );
});

test("con lo svuotamento le stesse righe entrano senza conflitti e niente si salta", async () => {
  const src = freshTenant();
  src.prepare("INSERT INTO networks (id, cidr, name) VALUES (1, ?, ?)").run("10.0.0.0/24", "LAN del bundle");
  src.prepare("INSERT INTO tenant_settings (key, value) VALUES (?, ?)").run("audit-key", "dal-bundle");
  const bundle = await bundleDi(src);

  const { importTenant } = await import("../import");
  const dst = freshTenant();
  dst.prepare("INSERT INTO networks (id, cidr, name) VALUES (1, ?, ?)").run("192.168.1.0/24", "LAN della destinazione");
  dst.prepare("INSERT INTO tenant_settings (key, value) VALUES (?, ?)").run("audit-key", "della-destinazione");

  const res = importTenant({ bundle, tenantDb: dst, hubDb: freshHub(), options: { tenantCode: "DEFAULT", passphrase: PASS, wipe: true } });

  assert.equal((dst.prepare("SELECT name FROM networks WHERE id = 1").get() as { name: string }).name, "LAN del bundle");
  assert.equal(impostazione(dst, "audit-key"), "dal-bundle");
  assert.deepEqual(res.saltate, {});
});

// Revisione del 19/10: nell'unione il segno della sorgente non entra in tenant_settings
// (vince la destinazione), e le conversioni giravano sempre. Una sorgente già convertita
// (segno chiuso) non si riconverte, come con lo svuotamento.
test("unione: con il segno delle catene chiuso nel bundle non si riconverte", async () => {
  const { SEGNO_CATENE } = await import("@/lib/credentials/segni-t2");
  const src = freshTenant();
  src.prepare("INSERT INTO tenant_settings (key, value) VALUES (?, ?)").run(SEGNO_CATENE, "done:2026-10-16T10:00:00Z:reti=0");
  const bundle = await bundleDi(src);

  const { importTenant } = await import("../import");
  const dst = freshTenant();
  const res = importTenant({ bundle, tenantDb: dst, hubDb: freshHub(), options: { tenantCode: "DEFAULT", passphrase: PASS, wipe: false } });

  assert.equal(res.conversioni[SEGNO_CATENE].segno, "done:2026-10-16T10:00:00Z:reti=0");
  assert.match(res.conversioni[SEGNO_CATENE].dettaglio, /già nella sorgente/);
});

// Revisione del 19/10: un indice UNIQUE su espressione (o parziale) non si vede col
// controllo per colonne, e l'INSERT dava un errore grezzo che annullava tutto l'import.
test("unione: un indice UNIQUE su espressione (etichetta senza maiuscole) segue la regola: vince la destinazione", async () => {
  const src = freshTenant();
  src.prepare("INSERT INTO device_classifications_custom (slug, label, parent_slug) VALUES ('nas-bundle', 'nas', 'storage')").run();
  src.prepare("INSERT INTO tenant_settings (key, value) VALUES (?, ?)").run("solo-nel-bundle", "nuova");
  const bundle = await bundleDi(src);

  const { importTenant } = await import("../import");
  const dst = freshTenant();
  dst.prepare("INSERT INTO device_classifications_custom (slug, label, parent_slug) VALUES ('nas', 'NAS', 'storage')").run();

  const res = importTenant({ bundle, tenantDb: dst, hubDb: freshHub(), options: { tenantCode: "DEFAULT", passphrase: PASS, wipe: false } });
  assert.deepEqual(res.saltate.device_classifications_custom, ["nas-bundle"]);
  assert.equal((dst.prepare("SELECT count(*) n FROM device_classifications_custom").get() as { n: number }).n, 1);
  assert.equal(impostazione(dst, "solo-nel-bundle"), "nuova");
});
