/**
 * Perimetro dell'import (piano di sicurezza 14/11, P0-1): un pacchetto non scrive utenti né impostazioni
 * dell'installazione, e sul profilo tecnico le risorse comuni le tocca solo il superadmin.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import zlib from "zlib";
import Database from "better-sqlite3";
import { TENANT_SCHEMA_SQL, TENANT_INDEXES_SQL } from "@/lib/db-tenant-schema";
import { HUB_SCHEMA_SQL } from "@/lib/db-hub-schema";
import { readContainer, writeContainer, deriveTransportKey, decryptBuffer, encryptBuffer } from "../envelope";

process.env.ENCRYPTION_KEY = "A".repeat(64);
const PASS = "perimetro-prova";

function tenant() { const d = new Database(":memory:"); d.exec(TENANT_SCHEMA_SQL); d.exec(TENANT_INDEXES_SQL); return d; }
function hub() { const d = new Database(":memory:"); d.exec(HUB_SCHEMA_SQL); return d; }

async function pacchetto(extra: { tbl: string; row: Record<string, unknown> }[]): Promise<Buffer> {
  const { exportTenant } = await import("../export");
  const src = tenant();
  src.prepare("INSERT INTO networks (cidr, name) VALUES ('10.7.0.0/24', 'LAN')").run();
  const b = exportTenant({
    tenantDb: src, hubDb: hub(),
    options: { tenantCode: "DEFAULT", tiers: ["asset"], includeVault: false, passphrase: PASS, exportedAt: "2026-11-14T10:00:00.000Z", appVersion: "test" },
  });
  const { manifest, encryptedPayload } = readContainer(b);
  const k = deriveTransportKey(PASS, Buffer.from(manifest.encryption.saltHex, "hex"));
  const righe = zlib.gunzipSync(decryptBuffer(encryptedPayload, k)).toString("utf8").split("\n").filter((l) => l.length > 0);
  for (const e of extra) righe.push(JSON.stringify(e));
  return writeContainer(manifest, encryptBuffer(zlib.gzipSync(Buffer.from(righe.join("\n"), "utf8")), k));
}

test("un pacchetto che porta utenti si rifiuta intero, prima di scrivere", async () => {
  const { importTenant } = await import("../import");
  const bundle = await pacchetto([{ tbl: "users", row: { username: "intruso", role: "superadmin" } }]);
  const dst = tenant(); const dstHub = hub();
  assert.throws(
    () => importTenant({ bundle, tenantDb: dst, hubDb: dstHub, options: { tenantCode: "DEFAULT", passphrase: PASS, wipe: true } }),
    /users/,
  );
  assert.equal((dst.prepare("SELECT COUNT(*) AS n FROM networks").get() as { n: number }).n, 0);
  assert.equal((dstHub.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n, 0);
});

test("le risorse comuni non si scrivono quando non sono permesse, e l'esito lo dice", async () => {
  const { importTenant } = await import("../import");
  const extra = [
    { tbl: "nmap_profiles", row: { name: "profilo-del-pacchetto", args: "-sn" } },
    { tbl: "tabella_di_domani", row: { a: 1 } },
  ];
  const quanti = (h: Database.Database) =>
    (h.prepare("SELECT COUNT(*) AS n FROM nmap_profiles WHERE name = 'profilo-del-pacchetto'").get() as { n: number }).n;

  const hubNo = hub();
  const no = importTenant({ bundle: await pacchetto(extra), tenantDb: tenant(), hubDb: hubNo, options: { tenantCode: "DEFAULT", passphrase: PASS, wipe: true, risorseGlobali: false } });
  assert.equal(quanti(hubNo), 0);
  assert.match(no.ignorate?.nmap_profiles ?? "", /superadmin/);
  assert.match(no.ignorate?.tabella_di_domani ?? "", /non conosciuta/);
  assert.equal(no.tables.networks, 1);

  const hubSi = hub();
  const si = importTenant({ bundle: await pacchetto(extra), tenantDb: tenant(), hubDb: hubSi, options: { tenantCode: "DEFAULT", passphrase: PASS, wipe: true } });
  assert.equal(quanti(hubSi), 1);
  assert.equal(si.ignorate?.nmap_profiles, undefined);
});
