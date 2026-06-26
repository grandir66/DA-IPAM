# DA-IPAM Tenant Transfer (Export/Import) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Esportare un tenant DA-IPAM (config, credenziali, subnet, device, integrazioni, inventario, mirror) in un bundle `.dab` cifrato e portabile, e re-importarlo su un'installazione nuova (anche con `ENCRYPTION_KEY` diversa) o su un collector.

**Architecture:** Un core puro in `src/lib/transfer/` (registry tabelle + envelope crypto + introspezione schema + export + import) usato da due superfici sottili: CLI (server spento, DR) e API/UI (admin). Il bundle è un container binario con manifest in chiaro + payload NDJSON gzip cifrato AES-256-GCM con una *transport key* derivata da passphrase. I secret cifrati con la chiave d'installazione sorgente vengono ri-cifrati con la transport key all'export e ri-cifrati con la chiave di destinazione all'import (envelope re-key). L'import è in modalità *replace* su tenant vuoto, in un'unica transazione con `foreign_keys=OFF` + `foreign_key_check`/`integrity_check`.

**Tech Stack:** TypeScript strict · better-sqlite3 12 · Node 22 (`zlib`, `crypto`, built-in test runner) · tsx · Zod v4 · Next.js App Router. **Nessuna nuova dipendenza npm** (niente tar/zip lib: container custom su `zlib`).

## Global Constraints

- **Node 22 LTS** (better-sqlite3 si rompe su Node ≥25). `node -v` deve dare v22.x.
- **TypeScript strict, no `any`.** Named export, componenti funzionali.
- **Data dir**: SEMPRE via `resolveDataDir()` ([src/lib/data-dir.ts](../../../src/lib/data-dir.ts)). Mai `path.join(process.cwd(), "data")`.
- **Cifratura at-rest**: AES-256-GCM, formato campo `ivHex:tagHex:ctHex` (compatibile con [src/lib/crypto.ts](../../../src/lib/crypto.ts)). La chiave d'installazione è `scryptSync(ENCRYPTION_KEY, "da-ipam-salt", 32)`.
- **PII**: il manifest in chiaro NON contiene IP/hostname/dominio/ragione sociale; l'identità tenant vive nel payload cifrato. Mai loggare passphrase né secret in chiaro.
- **Auth API**: `requireAdmin()` su tutte le nuove route (sono POST). Validazione Zod v4 (`.issues`), `req.json()`/`JSON.parse` in try-catch ([.claude/rules](../../../.claude/rules) equivalenti).
- **Branch**: lavoro su `dev`. Mai push diretto su `main` (governance DA-IPAM). `npm run version:release` a fine lavoro.
- **Colonne GENERATED**: mai esportate né scritte (es. `hosts.os_family`). Rilevate via `PRAGMA table_xinfo` (campo `hidden` ∈ {2,3}).
- **Re-key columns** (env-key ciphertext) rilevate per convenzione nome: `/encrypt|_enc$/i`. Colonne plaintext-sensibili (`community_string`, `api_token`) NON sono re-key: viaggiano in chiaro dentro l'envelope.
- **Test runner**: `node:test` + `node:assert/strict`, eseguito via `node --import tsx --test <file>`.

---

## File Structure

```
src/lib/transfer/
  types.ts                 # tipi condivisi (Tier, TableSpec, BundleManifest, ...)
  table-registry.ts        # classificazione di OGNI tabella (tenant + hub) in tier/scope
  schema-introspect.ts     # listTables, tableColumns (xinfo), writableColumns, rekeyColumns
  envelope.ts              # transport key, encrypt/decrypt buffer+field, container read/write
  export.ts                # exportTenant(): costruisce il Buffer .dab
  import.ts                # importTenant(): replace su tenant vuoto + re-key + integrity
  __tests__/
    registry.test.ts       # ogni tabella classificata; ogni colonna re-key coperta
    envelope.test.ts       # round-trip campo, buffer, container; chiave sbagliata fallisce
    introspect.test.ts     # generated escluse; writable corrette
    roundtrip.test.ts      # export→import su DB fresco con chiave DIVERSA (E2E core)

scripts/
  export-tenant.ts         # CLI: scrive <code>-<ts>.dab
  import-tenant.ts         # CLI: legge .dab, importa (replace), --wipe

src/app/api/tenant/export/route.ts   # POST admin → download .dab
src/app/api/tenant/import/route.ts   # POST admin → import .dab
src/app/(dashboard)/settings/transfer/page.tsx   # UI export/import

src/app/api/backup/route.ts          # FIX bug data-dir (Task 10)
```

---

## Task 1: Tipi + Registry tabelle + test di completezza

**Files:**
- Create: `src/lib/transfer/types.ts`
- Create: `src/lib/transfer/table-registry.ts`
- Test: `src/lib/transfer/__tests__/registry.test.ts`

**Interfaces:**
- Produces: `Tier`, `TableScope`, `TableSpec`, `BundleManifest`, `ExportOptions`, `ImportOptions`, `ImportResult` (types.ts); `TENANT_TABLES: TableSpec[]`, `HUB_TABLES: TableSpec[]`, `EXCLUDED_TENANT_TABLES: string[]`, `EXCLUDED_HUB_TABLES: string[]`, `tableSpec(table: string): TableSpec | undefined`, `tablesForTiers(tiers: Tier[], includeVault: boolean): TableSpec[]` (table-registry.ts)

- [ ] **Step 1: Scrivi `types.ts`**

```ts
// src/lib/transfer/types.ts
export type Tier = "config" | "asset" | "history" | "mirror";

/** Dove vive la tabella e come va filtrata/mergiata. */
export type TableScope =
  | "tenant"       // tabella del DB tenant; export integrale, import replace
  | "hub-tenant"   // tabella hub con colonna tenant; filtrata per tenant
  | "hub-global"   // tabella hub condivisa (profili); merge-by-key all'import
  | "hub-vault";   // system_credentials; merge-by-key, contiene secret

export interface TableSpec {
  table: string;
  scope: TableScope;
  tier: Tier;
  /** colonna che contiene il codice tenant (solo hub-tenant) */
  tenantColumn?: string;
  /** chiave naturale per merge (hub-global / hub-vault) */
  mergeKey?: string[];
}

export interface BundleManifest {
  format: "da-ipam-tenant-bundle";
  formatVersion: number;
  appVersion: string;
  /** ISO string iniettata dal chiamante (mai Date.now nel core) */
  exportedAt: string;
  tiers: Tier[];
  includeVault: boolean;
  /** righe per tabella effettivamente scritte */
  tables: Record<string, number>;
  encryption: {
    scheme: "envelope-aes-256-gcm";
    saltHex: string;
    sourceKeyFingerprint: string | null;
  };
  /** numero di secret non decifrabili alla sorgente (warning, non errore) */
  secretErrors: number;
}

export interface ExportOptions {
  tenantCode: string;
  tiers: Tier[];
  includeVault: boolean;
  passphrase: string;
  exportedAt: string;
  appVersion: string;
}

export interface ImportOptions {
  tenantCode: string;
  passphrase: string;
  /** se true, svuota le tabelle del tenant prima di caricare */
  wipe: boolean;
}

export interface ImportResult {
  tables: Record<string, number>;
  profilesMerged: number;
  vaultMerged: number;
  rekeyedSecrets: number;
}

export const BUNDLE_FORMAT = "da-ipam-tenant-bundle" as const;
export const BUNDLE_FORMAT_VERSION = 1;
```

- [ ] **Step 2: Scrivi `table-registry.ts`** (classificazione di tutte le tabelle)

```ts
// src/lib/transfer/table-registry.ts
import type { TableSpec, Tier } from "./types";

/** Tabelle del DB tenant. Tier: config sempre incluso; asset/mirror default ON; history default OFF. */
export const TENANT_TABLES: TableSpec[] = [
  // --- config ---
  { table: "networks", scope: "tenant", tier: "config" },
  { table: "credentials", scope: "tenant", tier: "config" },
  { table: "network_credentials", scope: "tenant", tier: "config" },
  { table: "host_credentials", scope: "tenant", tier: "config" },
  { table: "network_host_credentials", scope: "tenant", tier: "config" },
  { table: "host_detect_credential", scope: "tenant", tier: "config" },
  { table: "device_credential_bindings", scope: "tenant", tier: "config" },
  { table: "network_devices", scope: "tenant", tier: "config" },
  { table: "network_router", scope: "tenant", tier: "config" },
  { table: "ad_integrations", scope: "tenant", tier: "config" },
  { table: "vuln_scanners", scope: "tenant", tier: "config" },
  { table: "librenms_host_map", scope: "tenant", tier: "config" },
  { table: "scheduled_jobs", scope: "tenant", tier: "config" },
  { table: "tenant_settings", scope: "tenant", tier: "config" },
  { table: "excluded_ips", scope: "tenant", tier: "config" },
  { table: "physical_devices", scope: "tenant", tier: "config" },
  { table: "device_interfaces", scope: "tenant", tier: "config" },
  { table: "device_interface_addresses", scope: "tenant", tier: "config" },
  { table: "multihomed_links", scope: "tenant", tier: "config" },
  { table: "device_classifications_custom", scope: "tenant", tier: "config" },
  { table: "proxmox_hosts", scope: "tenant", tier: "config" },
  // --- asset (default ON) ---
  { table: "hosts", scope: "tenant", tier: "asset" },
  { table: "inventory_assets", scope: "tenant", tier: "asset" },
  { table: "asset_assignees", scope: "tenant", tier: "asset" },
  { table: "locations", scope: "tenant", tier: "asset" },
  { table: "services", scope: "tenant", tier: "asset" },
  { table: "service_asset_dependencies", scope: "tenant", tier: "asset" },
  { table: "licenses", scope: "tenant", tier: "asset" },
  { table: "license_seats", scope: "tenant", tier: "asset" },
  { table: "inventory_audit_log", scope: "tenant", tier: "asset" },
  // --- history (default OFF) ---
  { table: "scan_history", scope: "tenant", tier: "history" },
  { table: "status_history", scope: "tenant", tier: "history" },
  { table: "software_scans", scope: "tenant", tier: "history" },
  { table: "software_scan_logs", scope: "tenant", tier: "history" },
  { table: "anomaly_events", scope: "tenant", tier: "history" },
  { table: "classification_feedback", scope: "tenant", tier: "history" },
  { table: "arp_entries", scope: "tenant", tier: "history" },
  { table: "mac_port_entries", scope: "tenant", tier: "history" },
  { table: "mac_ip_mapping", scope: "tenant", tier: "history" },
  { table: "mac_ip_history", scope: "tenant", tier: "history" },
  { table: "switch_ports", scope: "tenant", tier: "history" },
  { table: "routing_table", scope: "tenant", tier: "history" },
  { table: "device_neighbors", scope: "tenant", tier: "history" },
  // --- mirror (default ON) ---
  { table: "software_inventory", scope: "tenant", tier: "mirror" },
  { table: "wazuh_agent", scope: "tenant", tier: "mirror" },
  { table: "wazuh_hw", scope: "tenant", tier: "mirror" },
  { table: "wazuh_os", scope: "tenant", tier: "mirror" },
  { table: "wazuh_software", scope: "tenant", tier: "mirror" },
  { table: "wazuh_vuln", scope: "tenant", tier: "mirror" },
  { table: "wazuh_ports", scope: "tenant", tier: "mirror" },
  { table: "wazuh_hotfix", scope: "tenant", tier: "mirror" },
  { table: "wazuh_netiface", scope: "tenant", tier: "mirror" },
  { table: "wazuh_netaddr", scope: "tenant", tier: "mirror" },
  { table: "wazuh_netproto", scope: "tenant", tier: "mirror" },
  { table: "wazuh_process", scope: "tenant", tier: "mirror" },
  { table: "wazuh_service", scope: "tenant", tier: "mirror" },
  { table: "ad_computers", scope: "tenant", tier: "mirror" },
  { table: "ad_users", scope: "tenant", tier: "mirror" },
  { table: "ad_groups", scope: "tenant", tier: "mirror" },
  { table: "ad_dhcp_leases", scope: "tenant", tier: "mirror" },
  { table: "dhcp_leases", scope: "tenant", tier: "mirror" },
  { table: "vuln_findings", scope: "tenant", tier: "mirror" },
  { table: "vuln_scan_runs", scope: "tenant", tier: "mirror" },
];

/** Tabelle hub incluse nel bundle per-tenant. */
export const HUB_TABLES: TableSpec[] = [
  { table: "tenants", scope: "hub-tenant", tier: "config", tenantColumn: "codice_cliente", mergeKey: ["codice_cliente"] },
  { table: "tenant_features", scope: "hub-tenant", tier: "config", tenantColumn: "tenant_code" },
  { table: "system_credentials", scope: "hub-vault", tier: "config", mergeKey: ["kind", "label"] },
  { table: "nmap_profiles", scope: "hub-global", tier: "config", mergeKey: ["name"] },
  { table: "snmp_vendor_profiles", scope: "hub-global", tier: "config", mergeKey: ["name"] },
  { table: "device_fingerprint_rules", scope: "hub-global", tier: "config", mergeKey: ["name"] },
  { table: "fingerprint_classification_map", scope: "hub-global", tier: "config", mergeKey: ["fingerprint"] },
  { table: "sysobj_lookup", scope: "hub-global", tier: "config", mergeKey: ["sys_object_id"] },
];

/** Tabelle tenant volutamente NON esportate (nessuna oggi: tutte classificate). */
export const EXCLUDED_TENANT_TABLES: string[] = [];

/** Tabelle hub install-level: identità/auth/setup, NON viaggiano col tenant. */
export const EXCLUDED_HUB_TABLES: string[] = [
  "users",
  "user_tenant_access",
  "settings",
  "inventory_ingest_tokens",
  "tenant_agents",
  "system_credential_events",
];

const BY_NAME = new Map<string, TableSpec>(
  [...TENANT_TABLES, ...HUB_TABLES].map((t) => [t.table, t]),
);

export function tableSpec(table: string): TableSpec | undefined {
  return BY_NAME.get(table);
}

/** Specs da esportare per i tier scelti. config sempre incluso; vault solo se includeVault. */
export function tablesForTiers(tiers: Tier[], includeVault: boolean): TableSpec[] {
  const wanted = new Set<Tier>(["config", ...tiers]);
  return [...TENANT_TABLES, ...HUB_TABLES].filter((t) => {
    if (t.scope === "hub-vault") return includeVault;
    return wanted.has(t.tier);
  });
}
```

- [ ] **Step 3: Scrivi il test di completezza** (introspetta i DB reali e verifica che NESSUNA tabella sia priva di classificazione)

> Il test rigenera DB vuoti applicando gli schemi reali, così resta valido all'evolvere dello schema.

```ts
// src/lib/transfer/__tests__/registry.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { TENANT_SCHEMA_SQL } from "../../db-tenant-schema";
import { HUB_SCHEMA_SQL } from "../../db-hub-schema";
import {
  TENANT_TABLES,
  HUB_TABLES,
  EXCLUDED_TENANT_TABLES,
  EXCLUDED_HUB_TABLES,
} from "../table-registry";

function realTables(schemaSql: string): string[] {
  const db = new Database(":memory:");
  db.exec(schemaSql);
  const rows = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    )
    .all() as { name: string }[];
  db.close();
  return rows.map((r) => r.name);
}

test("ogni tabella tenant è classificata o esclusa", () => {
  const real = realTables(TENANT_SCHEMA_SQL);
  const known = new Set([
    ...TENANT_TABLES.map((t) => t.table),
    ...EXCLUDED_TENANT_TABLES,
  ]);
  const missing = real.filter((t) => !known.has(t));
  assert.deepEqual(missing, [], `Tabelle tenant non classificate: ${missing.join(", ")}`);
});

test("ogni tabella hub è classificata o esclusa", () => {
  const real = realTables(HUB_SCHEMA_SQL);
  const known = new Set([
    ...HUB_TABLES.map((t) => t.table),
    ...EXCLUDED_HUB_TABLES,
  ]);
  const missing = real.filter((t) => !known.has(t));
  assert.deepEqual(missing, [], `Tabelle hub non classificate: ${missing.join(", ")}`);
});

test("registry non referenzia tabelle inesistenti", () => {
  const tReal = new Set(realTables(TENANT_SCHEMA_SQL));
  const hReal = new Set(realTables(HUB_SCHEMA_SQL));
  for (const t of TENANT_TABLES) assert.ok(tReal.has(t.table), `tenant table mancante: ${t.table}`);
  for (const t of HUB_TABLES) assert.ok(hReal.has(t.table), `hub table mancante: ${t.table}`);
});
```

- [ ] **Step 4: Verifica i nomi degli export di schema** (necessari al test)

Run: `grep -n "export const TENANT_SCHEMA_SQL\|export const HUB_SCHEMA_SQL" src/lib/db-tenant-schema.ts src/lib/db-hub-schema.ts`
Expected: entrambi gli export esistono. Se il nome reale differisce (es. `TENANT_SCHEMA`), aggiorna gli import nel test al nome reale prima di proseguire.

- [ ] **Step 5: Esegui il test — deve PASSARE o indicare tabelle non classificate**

Run: `node --import tsx --test src/lib/transfer/__tests__/registry.test.ts`
Expected: PASS. Se fallisce con "Tabelle ... non classificate: X, Y", aggiungi le tabelle mancanti a `TENANT_TABLES`/`HUB_TABLES` con il tier corretto (config/asset/history/mirror) o a `EXCLUDED_*`, poi riesegui finché PASS. **Questo è il punto in cui la classificazione viene riconciliata con lo schema reale.**

- [ ] **Step 6: Commit**

```bash
git add src/lib/transfer/types.ts src/lib/transfer/table-registry.ts src/lib/transfer/__tests__/registry.test.ts
git commit -m "feat(transfer): tipi + registry tabelle export/import con test completezza"
```

---

## Task 2: Envelope crypto (transport key, re-key campi, container)

**Files:**
- Create: `src/lib/transfer/envelope.ts`
- Test: `src/lib/transfer/__tests__/envelope.test.ts`

**Interfaces:**
- Consumes: `BundleManifest`, `BUNDLE_FORMAT_VERSION` (types.ts)
- Produces:
  - `deriveTransportKey(passphrase: string, salt: Buffer): Buffer`
  - `randomSalt(): Buffer`
  - `encryptFieldWithKey(plaintext: string, key: Buffer): string` (formato `ivHex:tagHex:ctHex`)
  - `decryptFieldWithKey(ciphertext: string, key: Buffer): string`
  - `encryptBuffer(plaintext: Buffer, key: Buffer): Buffer` (layout `iv(16)|ct|tag(16)`)
  - `decryptBuffer(blob: Buffer, key: Buffer): Buffer`
  - `writeContainer(manifest: BundleManifest, encryptedPayload: Buffer): Buffer`
  - `readContainer(buf: Buffer): { manifest: BundleManifest; encryptedPayload: Buffer }`

- [ ] **Step 1: Scrivi i test**

```ts
// src/lib/transfer/__tests__/envelope.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deriveTransportKey, randomSalt,
  encryptFieldWithKey, decryptFieldWithKey,
  encryptBuffer, decryptBuffer,
  writeContainer, readContainer,
} from "../envelope";
import type { BundleManifest } from "../types";

const salt = randomSalt();
const key = deriveTransportKey("passphrase-di-test", salt);

test("field round-trip", () => {
  const ct = encryptFieldWithKey("s3cr3t", key);
  assert.equal(ct.split(":").length, 3);
  assert.equal(decryptFieldWithKey(ct, key), "s3cr3t");
});

test("field con chiave sbagliata lancia", () => {
  const ct = encryptFieldWithKey("s3cr3t", key);
  const wrong = deriveTransportKey("altra", salt);
  assert.throws(() => decryptFieldWithKey(ct, wrong));
});

test("buffer round-trip", () => {
  const data = Buffer.from("payload-binario-àèì".repeat(1000));
  const blob = encryptBuffer(data, key);
  assert.ok(blob.length > data.length);
  assert.deepEqual(decryptBuffer(blob, key), data);
});

test("buffer con chiave sbagliata lancia (GCM tag)", () => {
  const blob = encryptBuffer(Buffer.from("x"), key);
  const wrong = deriveTransportKey("altra", salt);
  assert.throws(() => decryptBuffer(blob, wrong));
});

test("container round-trip preserva manifest e payload", () => {
  const manifest: BundleManifest = {
    format: "da-ipam-tenant-bundle", formatVersion: 1, appVersion: "0.0.0",
    exportedAt: "2026-06-25T00:00:00.000Z", tiers: ["asset"], includeVault: false,
    tables: { networks: 3 }, secretErrors: 0,
    encryption: { scheme: "envelope-aes-256-gcm", saltHex: salt.toString("hex"), sourceKeyFingerprint: "abc" },
  };
  const payload = encryptBuffer(Buffer.from("ndjson-lines"), key);
  const container = writeContainer(manifest, payload);
  const read = readContainer(container);
  assert.deepEqual(read.manifest, manifest);
  assert.deepEqual(read.encryptedPayload, payload);
  assert.deepEqual(decryptBuffer(read.encryptedPayload, key), Buffer.from("ndjson-lines"));
});

test("container con magic errato lancia", () => {
  assert.throws(() => readContainer(Buffer.from("NOTADABK-garbage")));
});
```

- [ ] **Step 2: Esegui i test — devono FALLIRE**

Run: `node --import tsx --test src/lib/transfer/__tests__/envelope.test.ts`
Expected: FAIL (modulo `../envelope` non esiste).

- [ ] **Step 3: Implementa `envelope.ts`**

```ts
// src/lib/transfer/envelope.ts
import crypto from "crypto";
import type { BundleManifest } from "./types";
import { BUNDLE_FORMAT_VERSION } from "./types";

const ALGO = "aes-256-gcm";
const IV_LEN = 16;
const TAG_LEN = 16;
const SALT_LEN = 16;
const MAGIC = Buffer.from("DABK", "ascii"); // 4 byte

export function randomSalt(): Buffer {
  return crypto.randomBytes(SALT_LEN);
}

export function deriveTransportKey(passphrase: string, salt: Buffer): Buffer {
  if (!passphrase) throw new Error("Passphrase mancante");
  return crypto.scryptSync(passphrase, salt, 32);
}

/** Campo: ivHex:tagHex:ctHex (stesso formato di crypto.ts ma con chiave esplicita). */
export function encryptFieldWithKey(plaintext: string, key: Buffer): string {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  let ct = cipher.update(plaintext, "utf8", "hex");
  ct += cipher.final("hex");
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${ct}`;
}

export function decryptFieldWithKey(ciphertext: string, key: Buffer): string {
  const parts = ciphertext.split(":");
  if (parts.length !== 3) throw new Error("Formato campo cifrato non valido");
  const iv = Buffer.from(parts[0], "hex");
  const tag = Buffer.from(parts[1], "hex");
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  let pt = decipher.update(parts[2], "hex", "utf8");
  pt += decipher.final("utf8");
  return pt;
}

/** Buffer: iv(16) | ciphertext | tag(16). */
export function encryptBuffer(plaintext: Buffer, key: Buffer): Buffer {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ct, tag]);
}

export function decryptBuffer(blob: Buffer, key: Buffer): Buffer {
  if (blob.length < IV_LEN + TAG_LEN) throw new Error("Blob cifrato troppo corto");
  const iv = blob.subarray(0, IV_LEN);
  const tag = blob.subarray(blob.length - TAG_LEN);
  const ct = blob.subarray(IV_LEN, blob.length - TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

/**
 * Container .dab:
 *   MAGIC(4) | formatVersion(1) | manifestLen(uint32 BE)(4) | manifestJSON | encryptedPayload
 * Il manifest è in CHIARO (no PII/secret): permette di ispezionare il bundle prima di decifrare.
 */
export function writeContainer(manifest: BundleManifest, encryptedPayload: Buffer): Buffer {
  const manifestBuf = Buffer.from(JSON.stringify(manifest), "utf8");
  const header = Buffer.alloc(4 + 1 + 4);
  MAGIC.copy(header, 0);
  header.writeUInt8(BUNDLE_FORMAT_VERSION, 4);
  header.writeUInt32BE(manifestBuf.length, 5);
  return Buffer.concat([header, manifestBuf, encryptedPayload]);
}

export function readContainer(buf: Buffer): { manifest: BundleManifest; encryptedPayload: Buffer } {
  if (buf.length < 9 || !buf.subarray(0, 4).equals(MAGIC)) {
    throw new Error("Non è un bundle DA-IPAM (.dab) valido");
  }
  const version = buf.readUInt8(4);
  if (version !== BUNDLE_FORMAT_VERSION) {
    throw new Error(`Versione bundle ${version} non supportata (atteso ${BUNDLE_FORMAT_VERSION})`);
  }
  const manifestLen = buf.readUInt32BE(5);
  const manifestStart = 9;
  const manifestEnd = manifestStart + manifestLen;
  const manifest = JSON.parse(buf.subarray(manifestStart, manifestEnd).toString("utf8")) as BundleManifest;
  const encryptedPayload = buf.subarray(manifestEnd);
  return { manifest, encryptedPayload };
}
```

- [ ] **Step 4: Esegui i test — devono PASSARE**

Run: `node --import tsx --test src/lib/transfer/__tests__/envelope.test.ts`
Expected: PASS (6 test).

- [ ] **Step 5: Commit**

```bash
git add src/lib/transfer/envelope.ts src/lib/transfer/__tests__/envelope.test.ts
git commit -m "feat(transfer): envelope crypto (transport key, re-key campi, container .dab)"
```

---

## Task 3: Introspezione schema (colonne, generated, re-key)

**Files:**
- Create: `src/lib/transfer/schema-introspect.ts`
- Test: `src/lib/transfer/__tests__/introspect.test.ts`

**Interfaces:**
- Produces:
  - `listTables(db: Database.Database): string[]`
  - `tableColumns(db, table): { name: string; generated: boolean; notnull: boolean; hasDefault: boolean; pk: boolean }[]`
  - `writableColumns(db, table): string[]` (esclude le generated)
  - `isRekeyColumn(name: string): boolean` (`/encrypt|_enc$/i`)
  - `rekeyColumns(db, table): string[]` (writable ∩ re-key)

- [ ] **Step 1: Scrivi i test**

```ts
// src/lib/transfer/__tests__/introspect.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { TENANT_SCHEMA_SQL } from "../../db-tenant-schema";
import { listTables, tableColumns, writableColumns, isRekeyColumn, rekeyColumns } from "../schema-introspect";

function db() { const d = new Database(":memory:"); d.exec(TENANT_SCHEMA_SQL); return d; }

test("listTables include networks e hosts", () => {
  const t = listTables(db());
  assert.ok(t.includes("networks"));
  assert.ok(t.includes("hosts"));
});

test("hosts.os_family (GENERATED) è esclusa da writableColumns", () => {
  const d = db();
  const cols = tableColumns(d, "hosts");
  const osFamily = cols.find((c) => c.name === "os_family");
  assert.ok(osFamily, "os_family deve esistere");
  assert.equal(osFamily!.generated, true);
  assert.ok(!writableColumns(d, "hosts").includes("os_family"));
  assert.ok(writableColumns(d, "hosts").includes("ip"));
});

test("isRekeyColumn riconosce le colonne env-key", () => {
  for (const c of ["encrypted_password", "inline_encrypted_password", "token_encrypted", "password_enc", "api_token_enc"]) {
    assert.equal(isRekeyColumn(c), true, c);
  }
  for (const c of ["community_string", "api_token", "api_url", "username", "agent_token_hash"]) {
    assert.equal(isRekeyColumn(c), false, c);
  }
});

test("rekeyColumns(credentials) = encrypted_username, encrypted_password", () => {
  assert.deepEqual(rekeyColumns(db(), "credentials").sort(), ["encrypted_password", "encrypted_username"]);
});
```

- [ ] **Step 2: Esegui — FALLISCE**

Run: `node --import tsx --test src/lib/transfer/__tests__/introspect.test.ts`
Expected: FAIL (modulo assente).

- [ ] **Step 3: Implementa `schema-introspect.ts`**

```ts
// src/lib/transfer/schema-introspect.ts
import type Database from "better-sqlite3";

export function listTables(db: Database.Database): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[];
  return rows.map((r) => r.name);
}

export interface ColumnInfo {
  name: string;
  generated: boolean;
  notnull: boolean;
  hasDefault: boolean;
  pk: boolean;
}

/** Usa table_xinfo: la colonna `hidden` vale 2 o 3 per le GENERATED. */
export function tableColumns(db: Database.Database, table: string): ColumnInfo[] {
  const rows = db.prepare(`PRAGMA table_xinfo(${quoteIdent(table)})`).all() as {
    name: string; notnull: number; dflt_value: unknown; pk: number; hidden: number;
  }[];
  return rows.map((r) => ({
    name: r.name,
    generated: r.hidden === 2 || r.hidden === 3,
    notnull: r.notnull === 1,
    hasDefault: r.dflt_value !== null,
    pk: r.pk > 0,
  }));
}

export function writableColumns(db: Database.Database, table: string): string[] {
  return tableColumns(db, table).filter((c) => !c.generated).map((c) => c.name);
}

/** Colonna cifrata con la chiave d'installazione (richiede re-key in export/import). */
export function isRekeyColumn(name: string): boolean {
  return /encrypt|_enc$/i.test(name);
}

export function rekeyColumns(db: Database.Database, table: string): string[] {
  return writableColumns(db, table).filter(isRekeyColumn);
}

/** Quote identificatore SQLite (i nomi tabella vengono dal registry, non da input utente). */
function quoteIdent(ident: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(ident)) throw new Error(`Identificatore non valido: ${ident}`);
  return `"${ident}"`;
}
```

- [ ] **Step 4: Esegui — PASSA**

Run: `node --import tsx --test src/lib/transfer/__tests__/introspect.test.ts`
Expected: PASS (4 test).

- [ ] **Step 5: Commit**

```bash
git add src/lib/transfer/schema-introspect.ts src/lib/transfer/__tests__/introspect.test.ts
git commit -m "feat(transfer): introspezione schema (writable/generated/re-key columns)"
```

---

## Task 4: Export core (`exportTenant`)

**Files:**
- Create: `src/lib/transfer/export.ts`

**Interfaces:**
- Consumes: registry (`tablesForTiers`), introspect (`writableColumns`, `rekeyColumns`), envelope (`randomSalt`, `deriveTransportKey`, `encryptFieldWithKey`, `encryptBuffer`, `writeContainer`), `safeDecrypt` da `@/lib/crypto`, `encryptionKeyFingerprint` da `@/lib/encryption-key-health`
- Produces: `exportTenant(args: ExportArgs): Buffer` dove
  ```ts
  interface ExportArgs { tenantDb: Database.Database; hubDb: Database.Database; options: ExportOptions; }
  ```
  Payload NDJSON: ogni riga `{ "tbl": string, "row": Record<string, unknown> }`.

- [ ] **Step 1: Implementa `export.ts`**

> Nessun test unitario isolato qui: l'export è verificato end-to-end nel round-trip (Task 6), che è il test che conta. La logica è lineare e priva di rami complessi.

```ts
// src/lib/transfer/export.ts
import zlib from "zlib";
import type Database from "better-sqlite3";
import type { BundleManifest, ExportOptions } from "./types";
import { BUNDLE_FORMAT, BUNDLE_FORMAT_VERSION } from "./types";
import { tablesForTiers } from "./table-registry";
import { writableColumns, rekeyColumns } from "./schema-introspect";
import {
  randomSalt, deriveTransportKey, encryptFieldWithKey, encryptBuffer, writeContainer,
} from "./envelope";
import { safeDecrypt } from "@/lib/crypto";
import { encryptionKeyFingerprint } from "@/lib/encryption-key-health";

export interface ExportArgs {
  tenantDb: Database.Database;
  hubDb: Database.Database;
  options: ExportOptions;
}

export function exportTenant(args: ExportArgs): Buffer {
  const { tenantDb, hubDb, options } = args;
  const salt = randomSalt();
  const transportKey = deriveTransportKey(options.passphrase, salt);

  const specs = tablesForTiers(options.tiers, options.includeVault);
  const lines: string[] = [];
  const counts: Record<string, number> = {};
  let secretErrors = 0;

  for (const spec of specs) {
    const db = spec.scope === "tenant" ? tenantDb : hubDb;
    if (!tableExists(db, spec.table)) continue; // schema più vecchio: salta

    const cols = writableColumns(db, spec.table);
    const rekeys = new Set(rekeyColumns(db, spec.table));

    let sql = `SELECT ${cols.map((c) => `"${c}"`).join(", ")} FROM "${spec.table}"`;
    const params: unknown[] = [];
    if (spec.scope === "hub-tenant" && spec.tenantColumn) {
      sql += ` WHERE "${spec.tenantColumn}" = ?`;
      params.push(options.tenantCode);
    }

    const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
    let n = 0;
    for (const row of rows) {
      for (const col of rekeys) {
        const v = row[col];
        if (typeof v === "string" && v.length > 0) {
          const pt = safeDecrypt(v); // decifra con la chiave d'installazione sorgente
          if (pt === null) {
            secretErrors++;
            row[col] = null; // secret non recuperabile: lo scartiamo
          } else {
            row[col] = encryptFieldWithKey(pt, transportKey); // ri-wrap con transport key
          }
        }
      }
      lines.push(JSON.stringify({ tbl: spec.table, row }));
      n++;
    }
    counts[spec.table] = n;
  }

  const payloadPlain = Buffer.from(lines.join("\n"), "utf8");
  const gzipped = zlib.gzipSync(payloadPlain);
  const encryptedPayload = encryptBuffer(gzipped, transportKey);

  const manifest: BundleManifest = {
    format: BUNDLE_FORMAT,
    formatVersion: BUNDLE_FORMAT_VERSION,
    appVersion: options.appVersion,
    exportedAt: options.exportedAt,
    tiers: options.tiers,
    includeVault: options.includeVault,
    tables: counts,
    secretErrors,
    encryption: {
      scheme: "envelope-aes-256-gcm",
      saltHex: salt.toString("hex"),
      sourceKeyFingerprint: encryptionKeyFingerprint(),
    },
  };

  return writeContainer(manifest, encryptedPayload);
}

function tableExists(db: Database.Database, table: string): boolean {
  return !!db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?")
    .get(table);
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: 0 errori sui file `src/lib/transfer/*` (ignora eventuali errori preesistenti in `.next/...`).

- [ ] **Step 3: Commit**

```bash
git add src/lib/transfer/export.ts
git commit -m "feat(transfer): export core exportTenant (NDJSON gzip + envelope + re-key)"
```

---

## Task 5: Import core (`importTenant`, replace + re-key + integrity)

**Files:**
- Create: `src/lib/transfer/import.ts`

**Interfaces:**
- Consumes: envelope (`readContainer`, `deriveTransportKey`, `decryptBuffer`, `decryptFieldWithKey`), registry (`tableSpec`), introspect (`writableColumns`, `rekeyColumns`), `encrypt` da `@/lib/crypto`
- Produces: `importTenant(args: ImportArgs): ImportResult` dove
  ```ts
  interface ImportArgs { bundle: Buffer; tenantDb: Database.Database; hubDb: Database.Database; options: ImportOptions; }
  ```

- [ ] **Step 1: Implementa `import.ts`**

```ts
// src/lib/transfer/import.ts
import zlib from "zlib";
import type Database from "better-sqlite3";
import type { ImportOptions, ImportResult } from "./types";
import { readContainer, deriveTransportKey, decryptBuffer, decryptFieldWithKey } from "./envelope";
import { tableSpec, TENANT_TABLES } from "./table-registry";
import { writableColumns, rekeyColumns } from "./schema-introspect";
import { encrypt } from "@/lib/crypto";

export interface ImportArgs {
  bundle: Buffer;
  tenantDb: Database.Database;
  hubDb: Database.Database;
  options: ImportOptions;
}

interface PayloadLine { tbl: string; row: Record<string, unknown> }

export function importTenant(args: ImportArgs): ImportResult {
  const { bundle, tenantDb, hubDb, options } = args;
  const { manifest, encryptedPayload } = readContainer(bundle);

  const salt = Buffer.from(manifest.encryption.saltHex, "hex");
  const transportKey = deriveTransportKey(options.passphrase, salt);

  // Decifra + decomprimi (chiave sbagliata → GCM throw qui)
  let payloadPlain: Buffer;
  try {
    payloadPlain = zlib.gunzipSync(decryptBuffer(encryptedPayload, transportKey));
  } catch {
    throw new Error("Passphrase errata o bundle corrotto");
  }

  const lines = payloadPlain.length
    ? payloadPlain.toString("utf8").split("\n").map((l) => JSON.parse(l) as PayloadLine)
    : [];

  // Raggruppa righe per tabella
  const byTable = new Map<string, Record<string, unknown>[]>();
  for (const { tbl, row } of lines) {
    if (!byTable.has(tbl)) byTable.set(tbl, []);
    byTable.get(tbl)!.push(row);
  }

  const result: ImportResult = { tables: {}, profilesMerged: 0, vaultMerged: 0, rekeyedSecrets: 0 };

  // --- Import tabelle TENANT (replace) in un'unica transazione ---
  const tenantTx = tenantDb.transaction(() => {
    tenantDb.pragma("foreign_keys = OFF");

    if (options.wipe) {
      for (const spec of [...TENANT_TABLES].reverse()) {
        if (tableExists(tenantDb, spec.table)) tenantDb.prepare(`DELETE FROM "${spec.table}"`).run();
      }
    }

    for (const [tbl, rows] of byTable) {
      const spec = tableSpec(tbl);
      if (!spec || spec.scope !== "tenant") continue;
      if (!tableExists(tenantDb, tbl)) continue; // target più vecchio: salta tabella sconosciuta
      result.tables[tbl] = insertRows(tenantDb, tbl, rows, transportKey, result);
    }

    tenantDb.pragma("foreign_keys = ON");
    const fk = tenantDb.pragma("foreign_key_check") as unknown[];
    if (fk.length > 0) throw new Error(`foreign_key_check fallito: ${JSON.stringify(fk.slice(0, 5))}`);
    const integ = tenantDb.pragma("integrity_check", { simple: true });
    if (integ !== "ok") throw new Error(`integrity_check: ${integ}`);
  });
  tenantTx();

  // --- Import tabelle HUB (merge, non distruttivo) ---
  const hubTx = hubDb.transaction(() => {
    for (const [tbl, rows] of byTable) {
      const spec = tableSpec(tbl);
      if (!spec || spec.scope === "tenant") continue;
      if (!tableExists(hubDb, tbl)) continue;

      if (spec.scope === "hub-tenant" && spec.tenantColumn) {
        // riallinea il codice tenant a quello di destinazione
        for (const row of rows) row[spec.tenantColumn] = options.tenantCode;
      }

      if (spec.mergeKey) {
        const merged = mergeRows(hubDb, tbl, rows, spec.mergeKey, transportKey, result);
        if (spec.scope === "hub-vault") result.vaultMerged += merged;
        else if (spec.scope === "hub-global") result.profilesMerged += merged;
        result.tables[tbl] = merged;
      } else {
        result.tables[tbl] = insertRows(hubDb, tbl, rows, transportKey, result);
      }
    }
  });
  hubTx();

  return result;
}

/** INSERT righe, re-keyando i campi cifrati (transport key → chiave destinazione). */
function insertRows(
  db: Database.Database, table: string, rows: Record<string, unknown>[],
  transportKey: Buffer, result: ImportResult,
): number {
  if (rows.length === 0) return 0;
  const targetCols = new Set(writableColumns(db, table));
  const rekeys = new Set(rekeyColumns(db, table));
  let n = 0;
  for (const row of rows) {
    const cols = Object.keys(row).filter((c) => targetCols.has(c));
    if (cols.length === 0) continue;
    const values = cols.map((c) => rekeyValue(row[c], rekeys.has(c), transportKey, result));
    const sql = `INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(",")}) VALUES (${cols.map(() => "?").join(",")})`;
    db.prepare(sql).run(...values);
    n++;
  }
  return n;
}

/** Merge-by-key: salta le righe già presenti (idempotente per profili/vault). */
function mergeRows(
  db: Database.Database, table: string, rows: Record<string, unknown>[],
  mergeKey: string[], transportKey: Buffer, result: ImportResult,
): number {
  if (rows.length === 0) return 0;
  const targetCols = new Set(writableColumns(db, table));
  const rekeys = new Set(rekeyColumns(db, table));
  const where = mergeKey.map((k) => `"${k}" = ?`).join(" AND ");
  const exists = db.prepare(`SELECT 1 FROM "${table}" WHERE ${where} LIMIT 1`);
  let n = 0;
  for (const row of rows) {
    const keyVals = mergeKey.map((k) => row[k] as unknown);
    if (exists.get(...keyVals)) continue; // già presente → non duplicare
    const cols = Object.keys(row).filter((c) => targetCols.has(c));
    const values = cols.map((c) => rekeyValue(row[c], rekeys.has(c), transportKey, result));
    const sql = `INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(",")}) VALUES (${cols.map(() => "?").join(",")})`;
    db.prepare(sql).run(...values);
    n++;
  }
  return n;
}

function rekeyValue(v: unknown, isSecret: boolean, transportKey: Buffer, result: ImportResult): unknown {
  if (!isSecret || typeof v !== "string" || v.length === 0) return v;
  const pt = decryptFieldWithKey(v, transportKey); // transport → plaintext
  result.rekeyedSecrets++;
  return encrypt(pt); // plaintext → chiave d'installazione destinazione
}

function tableExists(db: Database.Database, table: string): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(table);
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: 0 errori sui file transfer.

- [ ] **Step 3: Commit**

```bash
git add src/lib/transfer/import.ts
git commit -m "feat(transfer): import core importTenant (replace + merge hub + re-key + integrity)"
```

---

## Task 6: Round-trip E2E del core (export → import con chiave DIVERSA)

**Files:**
- Test: `src/lib/transfer/__tests__/roundtrip.test.ts`

**Interfaces:**
- Consumes: `exportTenant`, `importTenant`, schemi reali, `crypto` (encrypt/decrypt con env key)

- [ ] **Step 1: Scrivi il test E2E**

> Verifica il cuore del valore: un secret cifrato con la chiave A all'export torna decifrabile con la chiave B (diversa) dopo l'import. Manipola `process.env.ENCRYPTION_KEY` per simulare due installazioni.

```ts
// src/lib/transfer/__tests__/roundtrip.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { TENANT_SCHEMA_SQL } from "../../db-tenant-schema";
import { HUB_SCHEMA_SQL } from "../../db-hub-schema";

function freshTenant(): Database.Database { const d = new Database(":memory:"); d.exec(TENANT_SCHEMA_SQL); return d; }
function freshHub(): Database.Database { const d = new Database(":memory:"); d.exec(HUB_SCHEMA_SQL); return d; }

test("export con chiave A → import con chiave B: secret decifrabili, conteggi coerenti", async () => {
  // --- Installazione SORGENTE, chiave A ---
  process.env.ENCRYPTION_KEY = "A".repeat(64);
  // import dinamico DOPO aver settato la env (i moduli leggono process.env al volo)
  const { exportTenant } = await import("../export");
  const cryptoA = await import("@/lib/crypto");

  const srcTenant = freshTenant();
  const srcHub = freshHub();
  srcTenant.prepare("INSERT INTO networks (cidr, name) VALUES (?, ?)").run("10.0.0.0/24", "LAN");
  srcTenant.prepare(
    "INSERT INTO credentials (name, credential_type, encrypted_username, encrypted_password) VALUES (?,?,?,?)",
  ).run("ssh-root", "ssh", cryptoA.encrypt("root"), cryptoA.encrypt("p@ss"));

  const bundle = exportTenant({
    tenantDb: srcTenant, hubDb: srcHub,
    options: {
      tenantCode: "DEFAULT", tiers: ["asset", "mirror"], includeVault: false,
      passphrase: "trasporto-123", exportedAt: "2026-06-25T10:00:00.000Z", appVersion: "test",
    },
  });
  assert.ok(bundle.length > 0);

  // --- Installazione DESTINAZIONE, chiave B (diversa) ---
  process.env.ENCRYPTION_KEY = "B".repeat(64);
  const { importTenant } = await import("../import");
  const cryptoB = await import("@/lib/crypto");

  const dstTenant = freshTenant();
  const dstHub = freshHub();
  const res = importTenant({
    bundle, tenantDb: dstTenant, hubDb: dstHub,
    options: { tenantCode: "DEFAULT", passphrase: "trasporto-123", wipe: false },
  });

  // conteggi
  assert.equal(res.tables.networks, 1);
  assert.equal(res.tables.credentials, 1);
  assert.equal(res.rekeyedSecrets, 2);

  // il secret è ora cifrato con la chiave B e decifrabile con essa
  const cred = dstTenant.prepare("SELECT encrypted_username, encrypted_password FROM credentials").get() as {
    encrypted_username: string; encrypted_password: string;
  };
  assert.equal(cryptoB.decrypt(cred.encrypted_username), "root");
  assert.equal(cryptoB.decrypt(cred.encrypted_password), "p@ss");

  // integrità
  assert.equal(dstTenant.pragma("integrity_check", { simple: true }), "ok");
});

test("passphrase errata → import fallisce", async () => {
  process.env.ENCRYPTION_KEY = "A".repeat(64);
  const { exportTenant } = await import("../export");
  const { importTenant } = await import("../import");
  const src = freshTenant(); const srcHub = freshHub();
  src.prepare("INSERT INTO networks (cidr, name) VALUES (?, ?)").run("10.0.0.0/24", "LAN");
  const bundle = exportTenant({
    tenantDb: src, hubDb: srcHub,
    options: { tenantCode: "DEFAULT", tiers: [], includeVault: false, passphrase: "giusta", exportedAt: "2026-06-25T10:00:00.000Z", appVersion: "test" },
  });
  const dst = freshTenant(); const dstHub = freshHub();
  assert.throws(() => importTenant({
    bundle, tenantDb: dst, hubDb: dstHub,
    options: { tenantCode: "DEFAULT", passphrase: "SBAGLIATA", wipe: false },
  }), /Passphrase errata/);
});
```

- [ ] **Step 2: Verifica risoluzione alias `@/` sotto tsx**

Run: `node --import tsx --test src/lib/transfer/__tests__/roundtrip.test.ts`
Expected: PASS. Se fallisce con "Cannot find module '@/lib/crypto'", l'alias `@/*` non è risolto da tsx: aggiungi in fondo a `package.json` il campo `"tsx": { "tsconfig": "./tsconfig.json" }` NON è sufficiente — verifica che `tsconfig.json` abbia `compilerOptions.paths { "@/*": ["./src/*"] }` (DA-IPAM lo ha già per Next). tsx legge i `paths` dal tsconfig. Se ancora KO, sostituisci gli import `@/lib/...` nei file `src/lib/transfer/*.ts` con percorsi relativi `../crypto`, `../encryption-key-health` e riesegui.

- [ ] **Step 3: Esegui l'intera suite transfer**

Run: `node --import tsx --test src/lib/transfer/__tests__/registry.test.ts src/lib/transfer/__tests__/envelope.test.ts src/lib/transfer/__tests__/introspect.test.ts src/lib/transfer/__tests__/roundtrip.test.ts`
Expected: PASS (tutti).

- [ ] **Step 4: Aggiungi npm script di test**

Modifica `package.json`, sezione `scripts`, aggiungi:
```json
"test:transfer": "node --import tsx --test src/lib/transfer/__tests__/*.test.ts"
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/transfer/__tests__/roundtrip.test.ts package.json
git commit -m "test(transfer): round-trip E2E export(A)->import(B) + script test:transfer"
```

---

## Task 7: CLI export/import (DR a server spento)

**Files:**
- Create: `scripts/export-tenant.ts`
- Create: `scripts/import-tenant.ts`
- Modify: `package.json` (scripts)

**Interfaces:**
- Consumes: `exportTenant`, `importTenant`, `resolveDataDir`, registry types. Apre i DB con better-sqlite3 direttamente (server spento).

- [ ] **Step 1: Implementa `scripts/export-tenant.ts`**

```ts
// scripts/export-tenant.ts
// Uso: node --import tsx --env-file=.env.local scripts/export-tenant.ts <TENANT_CODE> [--out file.dab] [--tiers asset,mirror,history] [--vault] [--passphrase XXX]
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { resolveDataDir } from "../src/lib/data-dir";
import { exportTenant } from "../src/lib/transfer/export";
import type { Tier } from "../src/lib/transfer/types";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function flag(name: string): boolean { return process.argv.includes(`--${name}`); }

function main() {
  const tenantCode = process.argv[2];
  if (!tenantCode || tenantCode.startsWith("--")) {
    console.error("Uso: export-tenant <TENANT_CODE> [--out f.dab] [--tiers asset,mirror] [--vault] [--passphrase XXX]");
    process.exit(1);
  }
  if (!process.env.ENCRYPTION_KEY) {
    console.error("ENCRYPTION_KEY non in env. Esegui con: node --import tsx --env-file=.env.local ...");
    process.exit(1);
  }
  const passphrase = arg("passphrase") || process.env.TRANSFER_PASSPHRASE;
  if (!passphrase) { console.error("Passphrase mancante (--passphrase o TRANSFER_PASSPHRASE)"); process.exit(1); }

  const dataDir = resolveDataDir();
  const tenantPath = path.join(dataDir, "tenants", `${tenantCode}.db`);
  const hubPath = path.join(dataDir, "hub.db");
  if (!fs.existsSync(tenantPath)) { console.error(`DB tenant non trovato: ${tenantPath}`); process.exit(1); }

  const tiers = (arg("tiers")?.split(",").map((s) => s.trim()).filter(Boolean) as Tier[]) || (["asset", "mirror"] as Tier[]);
  const tenantDb = new Database(tenantPath, { readonly: true });
  const hubDb = new Database(hubPath, { readonly: true });

  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")) as { version: string };
  const exportedAt = new Date().toISOString();
  const bundle = exportTenant({
    tenantDb, hubDb,
    options: { tenantCode, tiers, includeVault: flag("vault"), passphrase, exportedAt, appVersion: pkg.version },
  });

  const outPath = arg("out") || `${tenantCode}-${exportedAt.replace(/[:.]/g, "-")}.dab`;
  fs.writeFileSync(outPath, bundle);
  tenantDb.close(); hubDb.close();
  console.log(`OK: ${outPath} (${(bundle.length / 1024).toFixed(1)} KB)`);
}
main();
```

- [ ] **Step 2: Implementa `scripts/import-tenant.ts`**

```ts
// scripts/import-tenant.ts
// Uso: node --import tsx --env-file=.env.local scripts/import-tenant.ts <FILE.dab> <TENANT_CODE> [--wipe] [--passphrase XXX]
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { resolveDataDir } from "../src/lib/data-dir";
import { importTenant } from "../src/lib/transfer/import";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function flag(name: string): boolean { return process.argv.includes(`--${name}`); }

function main() {
  const file = process.argv[2];
  const tenantCode = process.argv[3];
  if (!file || !tenantCode || file.startsWith("--") || tenantCode.startsWith("--")) {
    console.error("Uso: import-tenant <FILE.dab> <TENANT_CODE> [--wipe] [--passphrase XXX]");
    process.exit(1);
  }
  if (!process.env.ENCRYPTION_KEY) {
    console.error("ENCRYPTION_KEY non in env. Esegui con: node --import tsx --env-file=.env.local ...");
    process.exit(1);
  }
  const passphrase = arg("passphrase") || process.env.TRANSFER_PASSPHRASE;
  if (!passphrase) { console.error("Passphrase mancante (--passphrase o TRANSFER_PASSPHRASE)"); process.exit(1); }

  const dataDir = resolveDataDir();
  const tenantsDir = path.join(dataDir, "tenants");
  fs.mkdirSync(tenantsDir, { recursive: true });
  const tenantPath = path.join(tenantsDir, `${tenantCode}.db`);
  const hubPath = path.join(dataDir, "hub.db");

  // Il DB tenant DEVE esistere con lo schema già applicato. Se non esiste,
  // l'app lo crea al primo avvio: qui esigiamo che esista (DR: prima si avvia
  // l'app una volta su install pulito, poi si importa a server spento).
  if (!fs.existsSync(tenantPath)) {
    console.error(`DB tenant ${tenantPath} inesistente. Avvia l'app una volta per crearlo, poi reimporta.`);
    process.exit(1);
  }

  const bundle = fs.readFileSync(file);
  const tenantDb = new Database(tenantPath);
  const hubDb = new Database(hubPath);
  try {
    const res = importTenant({
      bundle, tenantDb, hubDb,
      options: { tenantCode, passphrase, wipe: flag("wipe") },
    });
    console.log("OK import:", JSON.stringify(res, null, 2));
  } finally {
    tenantDb.close(); hubDb.close();
  }
}
main();
```

- [ ] **Step 3: Aggiungi npm scripts**

Modifica `package.json`, sezione `scripts`, aggiungi:
```json
"transfer:export": "node --import tsx --env-file=.env.local scripts/export-tenant.ts",
"transfer:import": "node --import tsx --env-file=.env.local scripts/import-tenant.ts"
```

- [ ] **Step 4: Smoke manuale CLI** (richiede ENCRYPTION_KEY in `.env.local` e un tenant locale, es. DEFAULT)

Run:
```bash
npm run transfer:export -- DEFAULT --passphrase test123 --out /tmp/default.dab
ls -la /tmp/default.dab
```
Expected: stampa `OK: /tmp/default.dab (NN KB)` e il file esiste. (L'import su un DB reale è coperto dal test E2E del Task 6; lo smoke import si fa nel Task finale.)

- [ ] **Step 5: Commit**

```bash
git add scripts/export-tenant.ts scripts/import-tenant.ts package.json
git commit -m "feat(transfer): CLI export-tenant/import-tenant (DR a server spento)"
```

---

## Task 8: API routes (admin) export/import

**Files:**
- Create: `src/app/api/tenant/export/route.ts`
- Create: `src/app/api/tenant/import/route.ts`

**Interfaces:**
- Consumes: `exportTenant`, `importTenant`, `getTenantDb`, `getCurrentTenantCode` (`@/lib/db-tenant`), `getHubDb` (`@/lib/db-hub`), `requireAdmin` + `isAuthError` (`@/lib/api-auth`), `withTenantFromSession` (`@/lib/api-tenant`).

> **Pattern obbligatorio DA-IPAM** (verificato su route esistenti, es. net-services): ogni route che tocca il DB tenant DEVE essere avvolta in `withTenantFromSession(async () => { ... })`, e `requireAdmin()` **ritorna** una response d'errore (non lancia) → va testato con `isAuthError(auth)`. Senza il wrapper, `getCurrentTenantCode()` è null e il DB cade silenziosamente sul tenant `DEFAULT` (footgun noto).

- [ ] **Step 1: Conferma gli helper (già verificati, ricontrolla solo se il file è cambiato)**

Run: `grep -n "export async function requireAdmin\|export function isAuthError\|export async function withTenantFromSession\|export function getCurrentTenantCode\|export function getHubDb\|export function getTenantDb" src/lib/api-auth.ts src/lib/api-tenant.ts src/lib/db-hub.ts src/lib/db-tenant.ts`
Expected: trova `requireAdmin`, `isAuthError`, `withTenantFromSession`, `getCurrentTenantCode`, `getHubDb`, `getTenantDb`. Usa esattamente questi nomi.

- [ ] **Step 2: Implementa `export/route.ts`**

```ts
// src/app/api/tenant/export/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getTenantDb, getCurrentTenantCode } from "@/lib/db-tenant";
import { getHubDb } from "@/lib/db-hub";
import { exportTenant } from "@/lib/transfer/export";
import type { Tier } from "@/lib/transfer/types";
import pkg from "../../../../../package.json";

const schema = z.object({
  passphrase: z.string().min(8, "Passphrase di almeno 8 caratteri"),
  tiers: z.array(z.enum(["config", "asset", "history", "mirror"])).default(["asset", "mirror"]),
  includeVault: z.boolean().default(false),
});

export async function POST(req: Request) {
  return withTenantFromSession(async () => {
    const auth = await requireAdmin();
    if (isAuthError(auth)) return auth;

    let body: unknown;
    try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
    const parsed = schema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });

    const tenantCode = getCurrentTenantCode();
    if (!tenantCode) return NextResponse.json({ error: "Tenant non risolto" }, { status: 400 });

    const exportedAt = new Date().toISOString();
    const bundle = exportTenant({
      tenantDb: getTenantDb(tenantCode),
      hubDb: getHubDb(),
      options: {
        tenantCode,
        tiers: parsed.data.tiers as Tier[],
        includeVault: parsed.data.includeVault,
        passphrase: parsed.data.passphrase,
        exportedAt,
        appVersion: (pkg as { version: string }).version,
      },
    });

    const fname = `${tenantCode}-${exportedAt.replace(/[:.]/g, "-")}.dab`;
    return new NextResponse(new Uint8Array(bundle), {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${fname}"`,
      },
    });
  });
}
```

- [ ] **Step 3: Implementa `import/route.ts`**

```ts
// src/app/api/tenant/import/route.ts
import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getTenantDb, getCurrentTenantCode } from "@/lib/db-tenant";
import { getHubDb } from "@/lib/db-hub";
import { importTenant } from "@/lib/transfer/import";

export async function POST(req: Request) {
  return withTenantFromSession(async () => {
    const auth = await requireAdmin();
    if (isAuthError(auth)) return auth;

    let form: FormData;
    try { form = await req.formData(); } catch { return NextResponse.json({ error: "multipart/form-data atteso" }, { status: 400 }); }

    const file = form.get("bundle");
    const passphrase = form.get("passphrase");
    const wipe = form.get("wipe") === "true";
    if (!(file instanceof File)) return NextResponse.json({ error: "Campo 'bundle' mancante" }, { status: 400 });
    if (typeof passphrase !== "string" || passphrase.length < 8) {
      return NextResponse.json({ error: "Passphrase non valida" }, { status: 400 });
    }

    const tenantCode = getCurrentTenantCode();
    if (!tenantCode) return NextResponse.json({ error: "Tenant non risolto" }, { status: 400 });

    const bundle = Buffer.from(await file.arrayBuffer());
    try {
      const res = importTenant({
        bundle, tenantDb: getTenantDb(tenantCode), hubDb: getHubDb(),
        options: { tenantCode, passphrase, wipe },
      });
      return NextResponse.json({ ok: true, result: res });
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }
  });
}
```

- [ ] **Step 4: Type-check + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: 0 errori. Se `import pkg from "...package.json"` dà errore TS, verifica `resolveJsonModule: true` in tsconfig (DA-IPAM Next lo ha); altrimenti leggi la versione con `process.env.npm_package_version` o `fs.readFileSync`.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/tenant/export/route.ts src/app/api/tenant/import/route.ts
git commit -m "feat(transfer): API admin /api/tenant/export e /api/tenant/import"
```

---

## Task 9: UI pagina /settings/transfer

**Files:**
- Create: `src/app/(dashboard)/settings/transfer/page.tsx`

**Interfaces:**
- Consumes: le due API. Client component (`"use client"`), fetch + download blob / upload FormData. Italiano.

- [ ] **Step 1: Verifica il pattern delle pagine settings esistenti**

Run: `ls src/app/\(dashboard\)/settings/ && sed -n '1,30p' "src/app/(dashboard)/settings/certificate/page.tsx" 2>/dev/null || echo "vedi un'altra pagina settings per il layout/header"`
Expected: capire come le pagine settings strutturano titolo/card. Replica lo stesso wrapper/stile.

- [ ] **Step 2: Implementa `page.tsx`**

```tsx
// src/app/(dashboard)/settings/transfer/page.tsx
"use client";

import { useState } from "react";

export default function TransferPage() {
  const [expPass, setExpPass] = useState("");
  const [tiers, setTiers] = useState<string[]>(["asset", "mirror"]);
  const [includeVault, setIncludeVault] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [impPass, setImpPass] = useState("");
  const [impFile, setImpFile] = useState<File | null>(null);
  const [wipe, setWipe] = useState(false);

  function toggleTier(t: string) {
    setTiers((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));
  }

  async function doExport() {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/tenant/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passphrase: expPass, tiers, includeVault }),
      });
      if (!res.ok) { setMsg("Errore export: " + (await res.text())); return; }
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition") || "";
      const fname = cd.match(/filename="(.+?)"/)?.[1] || "tenant.dab";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = fname; a.click();
      URL.revokeObjectURL(url);
      setMsg("Export completato: " + fname);
    } finally { setBusy(false); }
  }

  async function doImport() {
    if (!impFile) { setMsg("Seleziona un file .dab"); return; }
    setBusy(true); setMsg(null);
    try {
      const fd = new FormData();
      fd.set("bundle", impFile);
      fd.set("passphrase", impPass);
      fd.set("wipe", String(wipe));
      const res = await fetch("/api/tenant/import", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) { setMsg("Errore import: " + (json.error ?? res.statusText)); return; }
      setMsg("Import completato: " + JSON.stringify(json.result));
    } finally { setBusy(false); }
  }

  return (
    <div className="p-6 space-y-8 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold">Trasferimento dati tenant</h1>
        <p className="text-sm text-muted-foreground">
          Esporta o importa la configurazione completa del tenant (credenziali cifrate,
          subnet, device, integrazioni, inventario). Il bundle è cifrato con la passphrase
          che scegli: serve per reimportarlo.
        </p>
      </div>

      <section className="space-y-3 rounded-lg border p-4">
        <h2 className="font-medium">Export</h2>
        <input type="password" placeholder="Passphrase (min 8)" value={expPass}
          onChange={(e) => setExpPass(e.target.value)} className="w-full rounded border px-3 py-2" />
        <div className="flex gap-4 text-sm">
          {["asset", "mirror", "history"].map((t) => (
            <label key={t} className="flex items-center gap-1">
              <input type="checkbox" checked={tiers.includes(t)} onChange={() => toggleTier(t)} /> {t}
            </label>
          ))}
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={includeVault} onChange={(e) => setIncludeVault(e.target.checked)} /> vault credenziali sistema
          </label>
        </div>
        <button disabled={busy || expPass.length < 8} onClick={doExport}
          className="rounded bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50">
          Esporta .dab
        </button>
      </section>

      <section className="space-y-3 rounded-lg border p-4">
        <h2 className="font-medium">Import (replace nel tenant corrente)</h2>
        <input type="file" accept=".dab" onChange={(e) => setImpFile(e.target.files?.[0] ?? null)} />
        <input type="password" placeholder="Passphrase del bundle" value={impPass}
          onChange={(e) => setImpPass(e.target.value)} className="w-full rounded border px-3 py-2" />
        <label className="flex items-center gap-1 text-sm">
          <input type="checkbox" checked={wipe} onChange={(e) => setWipe(e.target.checked)} />
          svuota le tabelle del tenant prima di importare (wipe-and-load)
        </label>
        <button disabled={busy || !impFile || impPass.length < 8} onClick={doImport}
          className="rounded bg-destructive px-4 py-2 text-destructive-foreground disabled:opacity-50">
          Importa .dab
        </button>
      </section>

      {msg && <p className="text-sm">{msg}</p>}
    </div>
  );
}
```

- [ ] **Step 3: Type-check + lint + build**

Run: `npx tsc --noEmit && npm run lint`
Expected: 0 errori. Adatta classi/utility CSS al design system reale se differiscono (controlla un'altra pagina settings).

- [ ] **Step 4: Commit**

```bash
git add "src/app/(dashboard)/settings/transfer/page.tsx"
git commit -m "feat(transfer): UI /settings/transfer export/import bundle .dab"
```

---

## Task 10: Fix bug data-dir in /api/backup

**Files:**
- Modify: `src/app/api/backup/route.ts`

**Interfaces:** nessuna nuova.

- [ ] **Step 1: Leggi la route e individua il path hard-coded**

Run: `cat src/app/api/backup/route.ts`
Expected: vedi `path.join(process.cwd(), "data", "ipam.db")` (o simile) che ignora `DA_INVENT_DATA_DIR`.

- [ ] **Step 2: Sostituisci con `resolveDataDir()`**

Sostituisci la riga del path con (adatta al nome variabile reale):
```ts
import { resolveDataDir } from "@/lib/data-dir";
// ...
const dbPath = path.join(resolveDataDir(), "hub.db");
```
> Nota: nel mondo multi-tenant `ipam.db` non esiste più; il backup raw sensato è `hub.db` + i file in `tenants/`. Se la route deve restare "single file", punta a `hub.db`; in alternativa documenta che il backup completo si fa col nuovo export per-tenant. Mantieni `requireAdmin()`.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: 0 errori.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/backup/route.ts
git commit -m "fix(backup): usa resolveDataDir() invece del path hard-coded (rispetta DA_INVENT_DATA_DIR)"
```

---

## Task 11: Verifica finale + release

- [ ] **Step 1: Suite completa**

Run: `npm run test:transfer && npx tsc --noEmit && npm run lint`
Expected: tutti i test transfer PASS, 0 errori tsc/lint.

- [ ] **Step 2: Build production**

Run: `rm -rf .next && npm run build`
Expected: build OK (le nuove route e la pagina compilano).

- [ ] **Step 3: Smoke E2E reale CLI** (su un tenant locale, es. DEFAULT)

Run:
```bash
npm run transfer:export -- DEFAULT --passphrase smoke123 --tiers asset,mirror --out /tmp/smoke.dab
# import su una COPIA per non toccare i dati reali:
cp -r data /tmp/data-restore-test
DA_INVENT_DATA_DIR=/tmp/data-restore-test npm run transfer:import -- /tmp/smoke.dab DEFAULT --wipe --passphrase smoke123
```
Expected: `OK import: { tables: {...}, rekeyedSecrets: N, ... }`. Verifica che `rekeyedSecrets` rifletta le credenziali presenti e che non ci siano errori di integrità.

- [ ] **Step 4: Release (DA-IPAM, branch dev)**

Run: `npm run version:release`
Expected: bump patch + commit `release: vX.Y.Z`. **Non** fare push su `main` (governance DA-IPAM: avanza solo via promote esplicito).

---

## Self-Review (compilato in fase di scrittura piano)

**Spec coverage:**
- Bundle unico 3-usi → formato `.dab` con manifest + payload (Task 2,4) ✓
- Per-tenant unit → registry scope tenant/hub-tenant + filtro tenantColumn (Task 1,4) ✓
- Tier config/asset/mirror ON, history OFF → `tablesForTiers` + default CLI/API (Task 1,7,8) ✓
- Envelope re-key (chiave diversa) → Task 2 + test E2E Task 6 ✓
- Import replace su tenant vuoto + FK off + integrity → Task 5 ✓
- Profili hub merge-by-name, vault merge-by-key → Task 5 (`mergeRows`) ✓
- CLI server-spento + API/UI → Task 7,8,9 ✓
- GENERATED escluse (os_family) → introspect `table_xinfo` Task 3 + test ✓
- Compatibilità schema senza user_version → intersezione colonne in import (Task 5) + `tableExists` skip ✓
- Fix /api/backup data-dir → Task 10 ✓
- system_credentials scope risolto → hub-vault opzionale merge-by (kind,label), `includeVault` flag (Task 1,4,5) ✓
- Test "ogni tabella classificata" → Task 1 ✓

**Placeholder scan:** nessun TBD/TODO; ogni step ha codice o comando con output atteso. I punti "verifica il nome reale" (Task 1 step 4, Task 8 step 1, Task 9 step 1, Task 10 step 1) sono verifiche esplicite con comando e azione di fallback, non placeholder.

**Type consistency:** `exportTenant(ExportArgs)`/`importTenant(ImportArgs)` coerenti tra core, CLI, API. `ImportResult` (tables/profilesMerged/vaultMerged/rekeyedSecrets) usato uniforme. `Tier`/`TableSpec`/`BundleManifest` da `types.ts` ovunque. `deriveTransportKey`/`encryptBuffer`/`decryptBuffer`/`readContainer`/`writeContainer` firme coerenti tra envelope e consumer.

**Note aperte (non bloccanti, decise durante implementazione):**
- Risoluzione alias `@/` sotto `tsx --test` (Task 6 step 2 ha il fallback a path relativi).
- Nome reale dell'helper tenant nelle API (`getCurrentTenantCode` vs `withTenantFromSession`) — Task 8 step 1 lo verifica.
