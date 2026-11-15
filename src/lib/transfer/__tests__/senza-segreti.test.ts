/**
 * Riccardo, 15/11/2026: «le password non devono uscire… neppure di fronte ad una compromissione». Il pacchetto di
 * trasferimento portava ogni segreto, ricifrato con una passphrase scelta da chi esporta: bastava una sessione di
 * amministratore. Con `senzaSegreti` nel pacchetto non c'è nessun segreto, nemmeno conoscendo la passphrase.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import Database from "better-sqlite3";
import { TENANT_SCHEMA_SQL, TENANT_INDEXES_SQL } from "../../db-tenant-schema";
import { HUB_SCHEMA_SQL } from "../../db-hub-schema";
import { decryptBuffer, deriveTransportKey, readContainer } from "../envelope";

test("senzaSegreti: le righe restano, i segreti no, e il vault di sistema non entra nemmeno se chiesto", async () => {
  process.env.ENCRYPTION_KEY = "A".repeat(64);
  const { exportTenant } = await import("../export");
  const { importTenant } = await import("../import");
  const c = await import("@/lib/crypto");
  const src = new Database(":memory:");
  src.exec(TENANT_SCHEMA_SQL);
  src.exec(TENANT_INDEXES_SQL);
  const hub = new Database(":memory:");
  hub.exec(HUB_SCHEMA_SQL);
  src.prepare("INSERT INTO networks (cidr, name) VALUES (?, ?)").run("10.0.0.0/24", "LAN");
  src.prepare("INSERT INTO credentials (name, credential_type, encrypted_username, encrypted_password) VALUES (?,?,?,?)")
    .run("ssh-root", "ssh", c.encrypt("root"), c.encrypt("p@ss-da-non-far-uscire"));
  const opzioni = { tenantCode: "DEFAULT", tiers: ["config" as const], passphrase: "trasporto-123", exportedAt: "2026-11-15T10:00:00.000Z", appVersion: "test" };

  const bundle = exportTenant({ tenantDb: src, hubDb: hub, options: { ...opzioni, includeVault: true, senzaSegreti: true } });
  const { manifest, encryptedPayload } = readContainer(bundle);
  assert.equal(manifest.includeVault, false);
  assert.equal(manifest.tables.system_credentials, undefined);
  const k = deriveTransportKey("trasporto-123", Buffer.from(manifest.encryption.saltHex, "hex"));
  const righe = zlib.gunzipSync(decryptBuffer(encryptedPayload, k)).toString("utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { tbl: string; row: Record<string, unknown> });
  const cred = righe.find((r) => r.tbl === "credentials");
  assert.ok(cred, "la riga della credenziale c'è");
  assert.equal(cred.row.name, "ssh-root");
  assert.equal(cred.row.encrypted_password, null);
  assert.equal(cred.row.encrypted_username, null);

  const dst = new Database(":memory:");
  dst.exec(TENANT_SCHEMA_SQL);
  dst.exec(TENANT_INDEXES_SQL);
  const dstHub = new Database(":memory:");
  dstHub.exec(HUB_SCHEMA_SQL);
  const res = importTenant({ bundle, tenantDb: dst, hubDb: dstHub, options: { tenantCode: "DEFAULT", passphrase: "trasporto-123", wipe: false } });
  assert.equal(res.tables.credentials, 1);
  assert.deepEqual(dst.prepare("SELECT name, encrypted_password FROM credentials").get(), { name: "ssh-root", encrypted_password: null });

  // Senza l'opzione la libreria fa come prima (lo usano le prove di andata e ritorno): la rotta la passa sempre.
  const conSegreti = exportTenant({ tenantDb: src, hubDb: hub, options: { ...opzioni, includeVault: false } });
  const m2 = readContainer(conSegreti);
  const k2 = deriveTransportKey("trasporto-123", Buffer.from(m2.manifest.encryption.saltHex, "hex"));
  assert.match(zlib.gunzipSync(decryptBuffer(m2.encryptedPayload, k2)).toString("utf8"), /"encrypted_password":"[^"]+"/);
});

test("la rotta dell'esportazione passa sempre senzaSegreti e rifiuta il vault", async () => {
  const fs = await import("node:fs");
  const testo = fs.readFileSync(new URL("../../../app/api/tenant/export/route.ts", import.meta.url), "utf8");
  assert.match(testo, /senzaSegreti:\s*true/);
  assert.doesNotMatch(testo, /includeVault:\s*parsed\.data\.includeVault/);
});
