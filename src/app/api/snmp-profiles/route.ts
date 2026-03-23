/**
 * API Routes per gestione SNMP Vendor Profiles
 * GET: Lista tutti i profili
 * POST: Crea nuovo profilo
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireAdmin, isAuthError } from "@/lib/api-auth";
import {
  getSnmpVendorProfiles,
  createSnmpVendorProfile,
  getSnmpVendorProfileByProfileId,
  importSnmpVendorProfiles,
  exportSnmpVendorProfiles,
  resetBuiltinSnmpVendorProfiles,
} from "@/lib/db";
import { invalidateSnmpVendorProfilesCache } from "@/lib/scanner/snmp-vendor-profiles";
import { mergeProfileFieldsWithOidLibrary } from "@/lib/scanner/snmp-oid-library";
import { exportSnmpProfilesFromDbToFiles } from "@/lib/scanner/snmp-oid-export";
import { z } from "zod/v4";
import fs from "fs";
import path from "path";

const ProfileSchema = z.object({
  profile_id: z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/),
  name: z.string().min(1).max(128),
  category: z.string().min(1).max(32),
  enterprise_oid_prefixes: z.array(z.string()).default([]),
  sysdescr_pattern: z.string().nullable().optional(),
  fields: z.record(z.string(), z.union([z.string(), z.array(z.string())])).default({}),
  confidence: z.number().min(0).max(1).default(0.9),
  enabled: z.number().min(0).max(1).default(1),
  note: z.string().nullable().optional(),
});

export async function GET(request: NextRequest) {
  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult;

  const url = new URL(request.url);
  const action = url.searchParams.get("action");

  if (action === "export") {
    const profiles = exportSnmpVendorProfiles();
    return NextResponse.json({ profiles }, { status: 200 });
  }

  const merged = url.searchParams.get("merged") === "1";
  const profiles = getSnmpVendorProfiles();
  if (!merged) {
    return NextResponse.json({ profiles }, { status: 200 });
  }

  const enriched = profiles.map((p) => {
    let dbFields: Record<string, string | string[] | undefined> = {};
    try {
      dbFields = JSON.parse(p.fields || "{}") as Record<string, string | string[] | undefined>;
    } catch {
      /* ignore */
    }
    const mergedFields = mergeProfileFieldsWithOidLibrary(p.profile_id, p.category, dbFields);
    return {
      ...p,
      fields_merged: JSON.stringify(mergedFields),
    };
  });

  return NextResponse.json({ profiles: enriched }, { status: 200 });
}

export async function POST(request: NextRequest) {
  const authResult = await requireAdmin();
  if (isAuthError(authResult)) return authResult;

  const url = new URL(request.url);
  const action = url.searchParams.get("action");

  if (action === "import") {
    try {
      const body = await request.json();
      const profiles = body.profiles;
      const replaceExisting = body.replaceExisting === true;

      if (!Array.isArray(profiles)) {
        return NextResponse.json({ error: "Il campo profiles deve essere un array" }, { status: 400 });
      }

      const result = importSnmpVendorProfiles(profiles, replaceExisting);
      invalidateSnmpVendorProfilesCache();
      return NextResponse.json({
        success: true,
        imported: result.imported,
        skipped: result.skipped,
        errors: result.errors,
      }, { status: 200 });
    } catch (error) {
      return NextResponse.json({
        error: `Errore importazione: ${error instanceof Error ? error.message : String(error)}`,
      }, { status: 400 });
    }
  }

  if (action === "reset-builtin") {
    try {
      resetBuiltinSnmpVendorProfiles();
      invalidateSnmpVendorProfilesCache();
      return NextResponse.json({ success: true, message: "Profili builtin ripristinati" }, { status: 200 });
    } catch (error) {
      return NextResponse.json({
        error: `Errore reset: ${error instanceof Error ? error.message : String(error)}`,
      }, { status: 500 });
    }
  }

  if (action === "export-to-files") {
    try {
      const dataDir = path.join(process.cwd(), "data");
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      const profiles = getSnmpVendorProfiles();
      const result = exportSnmpProfilesFromDbToFiles(dataDir, profiles);
      return NextResponse.json(
        {
          success: true,
          message: `Esportati ${result.manifest.profile_count} profili in ${result.rootRelative}`,
          rootRelative: result.rootRelative,
          manifest: result.manifest,
          filesWritten: result.filesWritten,
        },
        { status: 200 }
      );
    } catch (error) {
      return NextResponse.json(
        {
          error: `Errore esportazione file: ${error instanceof Error ? error.message : String(error)}`,
        },
        { status: 500 }
      );
    }
  }

  try {
    const body = await request.json();
    const parsed = ProfileSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({
        error: "Dati non validi",
        issues: parsed.error.issues,
      }, { status: 400 });
    }

    const data = parsed.data;

    const existing = getSnmpVendorProfileByProfileId(data.profile_id);
    if (existing) {
      return NextResponse.json({
        error: `Il profilo con ID '${data.profile_id}' esiste già`,
      }, { status: 409 });
    }

    const profile = createSnmpVendorProfile({
      profile_id: data.profile_id,
      name: data.name,
      category: data.category,
      enterprise_oid_prefixes: data.enterprise_oid_prefixes,
      sysdescr_pattern: data.sysdescr_pattern ?? null,
      fields: data.fields,
      confidence: data.confidence,
      enabled: data.enabled,
      builtin: 0,
      note: data.note ?? null,
    });

    invalidateSnmpVendorProfilesCache();

    return NextResponse.json({ profile }, { status: 201 });
  } catch (error) {
    return NextResponse.json({
      error: `Errore creazione: ${error instanceof Error ? error.message : String(error)}`,
    }, { status: 500 });
  }
}
