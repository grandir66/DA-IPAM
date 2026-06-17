import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getCurrentTenantCode, getTenantDb } from "@/lib/db-tenant";
import { encrypt } from "@/lib/crypto";
import {
  listCredentials,
  createCredential,
  updateCredential,
  logCredentialEvent,
  type CredentialKind,
  type CredentialInput,
} from "@/lib/credentials-vault";
import { setIntegrationConfig } from "@/lib/integrations/config";
import { setWazuhConfig } from "@/lib/integrations/wazuh-config";
import { installNetServices } from "@/lib/network-services/feature";
import { setFeatureEnabled, invalidateFeatureCache } from "@/lib/patch/feature";
import { applyPatchModuleMigrations } from "@/lib/patch/schema";
import { reloadTenantScheduler } from "@/lib/cron/scheduler";
import { invalidateModulesHealth } from "@/lib/modules/health";
import {
  ModuleImportSchema,
  type ModuleImportEntry,
  type ModuleImportResult,
} from "@/lib/modules/import-schema";

const VAULT_KIND: Record<ModuleImportEntry["module"], CredentialKind> = {
  edge: "edge",
  librenms: "librenms",
  graylog: "graylog",
  wazuh: "wazuh",
  network_services: "other",
  patch_management: "other",
};

const DEFAULT_LABEL: Record<ModuleImportEntry["module"], string> = {
  edge: "Scanner-Edge",
  librenms: "LibreNMS",
  graylog: "Graylog",
  wazuh: "Wazuh Dashboard",
  network_services: "Network Services",
  patch_management: "Patch Management",
};

function extraStr(e: ModuleImportEntry, key: string): string | undefined {
  const v = e.extra?.[key];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/** Upsert nel vault per (kind, label). Mai cancella secret esistenti. */
function upsertVault(e: ModuleImportEntry, label: string, actor: string): void {
  const kind = VAULT_KIND[e.module];
  const existing = listCredentials().find((c) => c.kind === kind && c.label === label);
  const base: Partial<CredentialInput> = {
    url: e.url ?? undefined,
    api_url: e.api_url ?? undefined,
    username: e.username ?? undefined,
    launch_mode: e.launch_mode ?? undefined,
  };
  if (e.password) base.password = e.password;
  if (e.api_key) base.api_token = e.api_key;
  if (existing) {
    updateCredential(existing.id, base);
    logCredentialEvent({
      credentialId: existing.id,
      action: "update",
      actorUsername: actor,
      result: "ok",
      details: { source: "module-import", module: e.module },
    });
  } else {
    const c = createCredential({
      kind,
      label,
      url: e.url ?? null,
      api_url: e.api_url ?? null,
      username: e.username ?? null,
      password: e.password ?? null,
      api_token: e.api_key ?? null,
      launch_mode: e.launch_mode ?? "copy",
    });
    logCredentialEvent({
      credentialId: c.id,
      action: "create",
      actorUsername: actor,
      result: "ok",
      details: { source: "module-import", module: e.module },
    });
  }
}

/** Scrive la config reale del modulo. Ritorna se è risultato configurato. */
function applyModuleConfig(
  e: ModuleImportEntry,
  tenantCode: string,
  userId: number | null,
): boolean {
  const apiUrl = (e.api_url ?? e.url ?? "").trim();
  switch (e.module) {
    case "edge": {
      const baseUrl = apiUrl;
      const token = (e.api_key ?? "").trim();
      if (!baseUrl || token.length < 8) {
        throw new Error("edge richiede api_url + api_key (>=8 char)");
      }
      const db = getTenantDb(tenantCode);
      db.prepare("DELETE FROM vuln_scanners").run();
      db.prepare(
        `INSERT INTO vuln_scanners (name, base_url, token_encrypted, enabled, cert_pin, cert_fingerprint)
         VALUES (?, ?, ?, 1, ?, ?)`,
      ).run(
        e.label ?? "Scanner-Edge",
        baseUrl.replace(/\/$/, ""),
        encrypt(token),
        extraStr(e, "cert_pin") ?? null,
        extraStr(e, "cert_fingerprint") ?? null,
      );
      const job = db
        .prepare(
          "SELECT id FROM scheduled_jobs WHERE job_type='vuln_sync' AND network_id IS NULL",
        )
        .get() as { id: number } | undefined;
      if (!job) {
        db.prepare(
          `INSERT INTO scheduled_jobs (network_id, job_type, interval_minutes, enabled)
           VALUES (NULL, 'vuln_sync', 30, 1)`,
        ).run();
      }
      reloadTenantScheduler(tenantCode);
      return true;
    }
    case "librenms":
    case "graylog": {
      if (!e.url && !apiUrl) throw new Error(`${e.module} richiede url o api_url`);
      setIntegrationConfig(e.module, {
        mode: "external",
        url: e.url ?? apiUrl,
        apiToken: e.api_key ?? "",
        ...(e.module === "graylog"
          ? { username: e.username ?? undefined, password: e.password ?? undefined }
          : {}),
      });
      return true;
    }
    case "wazuh": {
      if (!apiUrl) throw new Error("wazuh richiede api_url (Manager REST API)");
      setWazuhConfig({
        enabled: true,
        url: apiUrl,
        username: e.username ?? "",
        password: e.password ?? "",
        verifyTls: e.verify_tls ?? false,
        indexerUrl: extraStr(e, "indexer_url") ?? "",
        indexerUsername: extraStr(e, "indexer_username") ?? "",
        indexerPassword: extraStr(e, "indexer_password") ?? "",
      });
      return Boolean(apiUrl && e.username && e.password);
    }
    case "network_services": {
      const token = (e.api_key ?? "").trim();
      if (!apiUrl || !token) throw new Error("network_services richiede api_url + api_key");
      installNetServices(tenantCode, userId, { apiUrl, apiToken: token });
      return true;
    }
    case "patch_management": {
      applyPatchModuleMigrations(getTenantDb(tenantCode));
      setFeatureEnabled(tenantCode, "patch_management", userId);
      invalidateFeatureCache(tenantCode, "patch_management");
      return true;
    }
  }
}

export async function POST(req: Request) {
  const session = await requireAdmin();
  if (isAuthError(session)) return session;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON non valido" }, { status: 400 });
  }

  const parsed = ModuleImportSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validazione fallita", details: parsed.error.issues },
      { status: 400 },
    );
  }
  const entries = Array.isArray(parsed.data) ? parsed.data : [parsed.data];

  return withTenantFromSession(async () => {
    const tenantCode = getCurrentTenantCode() ?? "DEFAULT";
    const rawId = (session.user as { id?: string }).id;
    const numericUserId = rawId ? Number(rawId) : null;
    const userId =
      numericUserId !== null && Number.isFinite(numericUserId) ? numericUserId : null;
    const actor = session.user?.name ?? "module-import";

    const results: ModuleImportResult[] = [];
    for (const e of entries) {
      const label = e.label ?? DEFAULT_LABEL[e.module];
      try {
        const configured = applyModuleConfig(e, tenantCode, userId);
        // Vault upsert solo se c'è qualcosa da lanciare (URL).
        if (e.url || e.api_url) upsertVault(e, label, actor);
        results.push({ module: e.module, ok: true, configured });
      } catch (err) {
        results.push({
          module: e.module,
          ok: false,
          configured: false,
          error: err instanceof Error ? err.message : "Errore import",
        });
      }
    }

    invalidateModulesHealth(tenantCode);
    return NextResponse.json({ ok: results.every((r) => r.ok), results });
  });
}
