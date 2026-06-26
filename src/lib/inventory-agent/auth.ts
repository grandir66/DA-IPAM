/**
 * Hub: token ingest → tenant lookup.
 */
import { createHash } from "node:crypto";
import { getHubDb } from "@/lib/db-hub";

export function hashIngestToken(plaintext: string): string {
  return createHash("sha256").update(plaintext, "utf8").digest("hex");
}

export function registerIngestToken(tenantCode: string, plaintext: string): void {
  const sha = hashIngestToken(plaintext);
  getHubDb()
    .prepare(
      `INSERT INTO inventory_ingest_tokens (token_sha256, tenant_code, created_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(token_sha256) DO UPDATE SET tenant_code = excluded.tenant_code`,
    )
    .run(sha, tenantCode);
}

export function revokeIngestTokensForTenant(tenantCode: string): number {
  const r = getHubDb()
    .prepare("DELETE FROM inventory_ingest_tokens WHERE tenant_code = ?")
    .run(tenantCode);
  return r.changes;
}

export function resolveTenantFromIngestToken(plaintext: string): string | null {
  const sha = hashIngestToken(plaintext.trim());
  const row = getHubDb()
    .prepare("SELECT tenant_code FROM inventory_ingest_tokens WHERE token_sha256 = ?")
    .get(sha) as { tenant_code: string } | undefined;
  return row?.tenant_code ?? null;
}

export function extractIngestToken(request: Request): string | null {
  const auth = request.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) {
    const t = auth.slice(7).trim();
    if (t) return t;
  }
  const header = request.headers.get("x-domarc-ingest-token");
  if (header?.trim()) return header.trim();
  return null;
}
