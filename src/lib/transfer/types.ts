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
  fkViolations: number;
}

export const BUNDLE_FORMAT = "da-ipam-tenant-bundle" as const;
export const BUNDLE_FORMAT_VERSION = 1;
