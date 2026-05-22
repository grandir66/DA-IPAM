/**
 * Configurazione singleton scanner-edge per il tenant corrente.
 *
 *  GET    — ritorna config attuale o null
 *  POST   — crea/sostituisce (409 se esiste già senza ?replace=1)
 *  DELETE — rimuove e azzera findings collegate via cascade
 *
 * Vincolo 1:1: applicato a livello applicativo. Schema DB consente più
 * righe ma la POST rifiuta. Per cambiare token: DELETE → POST.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, requireAuth } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getTenantDb, getCurrentTenantCode } from "@/lib/db-tenant";
import { encrypt } from "@/lib/crypto";
import { validateBaseUrl } from "@/lib/vuln/scanner-edge-client";
import { reloadTenantScheduler } from "@/lib/cron/scheduler";

const PostSchema = z.object({
  name: z.string().min(1).max(120).default("Scanner-Edge"),
  base_url: z.string().min(1),
  token: z.string().min(8),
  // SPKI pin (TOFU) — opzionale: se l'edge è HTTPS lo si passa al Salva
  // dopo averlo confermato nel Test connessione. NULL = legacy HTTP o
  // edge senza /api/v1/cert/info (pre-v0.1.176).
  cert_pin: z.string().nullable().optional(),
  cert_fingerprint: z.string().nullable().optional(),
});

interface ScannerRowRedacted {
  id: number;
  name: string;
  base_url: string;
  enabled: number;
  last_sync_at: string | null;
  last_error: string | null;
  created_at: string;
  finding_count: number;
  cert_pin: string | null;
  cert_fingerprint: string | null;
}

function readScanner(): ScannerRowRedacted | null {
  const code = getCurrentTenantCode() ?? "DEFAULT";
  const db = getTenantDb(code);
  const row = db
    .prepare(
      `SELECT s.id, s.name, s.base_url, s.enabled, s.last_sync_at,
              s.last_error, s.created_at, s.cert_pin, s.cert_fingerprint,
              (SELECT COUNT(*) FROM vuln_findings f
                 JOIN vuln_scan_runs r ON r.id = f.scan_run_id
                 WHERE r.scanner_id = s.id) AS finding_count
         FROM vuln_scanners s WHERE s.enabled = 1 LIMIT 1`,
    )
    .get() as ScannerRowRedacted | undefined;
  return row ?? null;
}

export async function GET() {
  const session = await requireAuth();
  if (session instanceof NextResponse) return session;
  return await withTenantFromSession(() => {
    return NextResponse.json({ scanner: readScanner() });
  });
}

export async function POST(req: Request) {
  const session = await requireAdmin();
  if (session instanceof NextResponse) return session;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON non valido" }, { status: 400 });
  }
  const parsed = PostSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validazione fallita", details: parsed.error.issues },
      { status: 400 },
    );
  }
  const urlCheck = validateBaseUrl(parsed.data.base_url);
  if (!urlCheck.ok) {
    return NextResponse.json({ error: urlCheck.error }, { status: 400 });
  }

  return await withTenantFromSession(() => {
    const code = getCurrentTenantCode() ?? "DEFAULT";
    const db = getTenantDb(code);
    const existing = db
      .prepare("SELECT id FROM vuln_scanners")
      .get() as { id: number } | undefined;
    const url = new URL(req.url);
    const replace = url.searchParams.get("replace") === "1";
    if (existing && !replace) {
      return NextResponse.json(
        { error: "Scanner-edge già configurato. Usa DELETE o ?replace=1." },
        { status: 409 },
      );
    }
    if (existing) {
      db.prepare("DELETE FROM vuln_scanners WHERE id = ?").run(existing.id);
    }
    const enc = encrypt(parsed.data.token);
    db.prepare(
      `INSERT INTO vuln_scanners
         (name, base_url, token_encrypted, enabled, cert_pin, cert_fingerprint)
       VALUES (?, ?, ?, 1, ?, ?)`,
    ).run(
      parsed.data.name,
      parsed.data.base_url.replace(/\/$/, ""),
      enc,
      parsed.data.cert_pin ?? null,
      parsed.data.cert_fingerprint ?? null,
    );

    // Registra il job vuln_sync se non esiste (30 min default).
    const existingJob = db
      .prepare(
        "SELECT id FROM scheduled_jobs WHERE job_type = 'vuln_sync' AND network_id IS NULL",
      )
      .get() as { id: number } | undefined;
    if (!existingJob) {
      db.prepare(
        `INSERT INTO scheduled_jobs (network_id, job_type, interval_minutes, enabled)
         VALUES (NULL, 'vuln_sync', 30, 1)`,
      ).run();
    }
    reloadTenantScheduler(code);

    return NextResponse.json({ scanner: readScanner() }, { status: 201 });
  });
}

export async function DELETE() {
  const session = await requireAdmin();
  if (session instanceof NextResponse) return session;
  return await withTenantFromSession(() => {
    const code = getCurrentTenantCode() ?? "DEFAULT";
    const db = getTenantDb(code);
    db.prepare("DELETE FROM vuln_scanners").run();
    db.prepare(
      "DELETE FROM scheduled_jobs WHERE job_type = 'vuln_sync' AND network_id IS NULL",
    ).run();
    reloadTenantScheduler(code);
    return NextResponse.json({ ok: true });
  });
}
