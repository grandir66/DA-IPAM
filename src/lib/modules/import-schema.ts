/**
 * Schema JSON unico per l'onboarding dei moduli.
 *
 * Ogni installer di modulo genera un file JSON con questa forma (singolo modulo
 * o array di moduli per un bundle "tutto in uno"). L'endpoint
 * POST /api/modules/import lo valida con Zod e fa doppia scrittura:
 *   (a) vault system_credentials (per il launch in launchpad)
 *   (b) storage di config reale del modulo (per renderlo funzionante)
 */
import { z } from "zod";

export const MODULE_IMPORT_KEYS = [
  "edge",
  "librenms",
  "graylog",
  "wazuh",
  "network_services",
  "patch_management",
] as const;

export const ModuleImportEntrySchema = z.object({
  module: z.enum(MODULE_IMPORT_KEYS),
  label: z.string().min(1).max(120).optional(),
  /** URL UI accessibile dal browser (opzionale per moduli nativi). */
  url: z.string().url().nullable().optional(),
  /** Endpoint API / bridge. */
  api_url: z.string().url().nullable().optional(),
  username: z.string().nullable().optional(),
  password: z.string().nullable().optional(),
  /** API token / key. */
  api_key: z.string().nullable().optional(),
  verify_tls: z.boolean().optional(),
  /** Funzionalità di integrazione abilitate (informativo). */
  capabilities: z.array(z.string()).optional(),
  /** Campi module-specific (indexer_*, cert_pin, container_name, ...). */
  extra: z.record(z.string(), z.unknown()).optional(),
  launch_mode: z.enum(["copy", "sso_form", "sso_token"]).optional(),
});

export type ModuleImportEntry = z.infer<typeof ModuleImportEntrySchema>;

/** Accetta una singola entry oppure un array (bundle multi-modulo). */
export const ModuleImportSchema = z.union([
  ModuleImportEntrySchema,
  z.array(ModuleImportEntrySchema).min(1).max(20),
]);

export interface ModuleImportResult {
  module: string;
  ok: boolean;
  configured: boolean;
  error?: string;
}
