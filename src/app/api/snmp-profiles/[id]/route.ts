/**
 * API Routes per singolo SNMP Vendor Profile
 * GET: Dettaglio profilo
 * PUT: Aggiorna profilo
 * DELETE: Elimina profilo
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireAdmin, isAuthError } from "@/lib/api-auth";
import {
  getSnmpVendorProfileById,
  updateSnmpVendorProfile,
  deleteSnmpVendorProfile,
} from "@/lib/db";
import { invalidateSnmpVendorProfilesCache } from "@/lib/scanner/snmp-vendor-profiles";
import { z } from "zod/v4";

const UpdateProfileSchema = z.object({
  profile_id: z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/).optional(),
  name: z.string().min(1).max(128).optional(),
  category: z.string().min(1).max(32).optional(),
  enterprise_oid_prefixes: z.array(z.string()).optional(),
  sysdescr_pattern: z.string().nullable().optional(),
  fields: z.record(z.string(), z.union([z.string(), z.array(z.string())])).optional(),
  confidence: z.number().min(0).max(1).optional(),
  enabled: z.number().min(0).max(1).optional(),
  note: z.string().nullable().optional(),
});

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult;

  const { id } = await params;
  const profileId = parseInt(id, 10);

  if (isNaN(profileId)) {
    return NextResponse.json({ error: "ID profilo non valido" }, { status: 400 });
  }

  const profile = getSnmpVendorProfileById(profileId);
  if (!profile) {
    return NextResponse.json({ error: "Profilo non trovato" }, { status: 404 });
  }

  return NextResponse.json({ profile }, { status: 200 });
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const authResult = await requireAdmin();
  if (isAuthError(authResult)) return authResult;

  const { id } = await params;
  const profileId = parseInt(id, 10);

  if (isNaN(profileId)) {
    return NextResponse.json({ error: "ID profilo non valido" }, { status: 400 });
  }

  const existing = getSnmpVendorProfileById(profileId);
  if (!existing) {
    return NextResponse.json({ error: "Profilo non trovato" }, { status: 404 });
  }

  try {
    const body = await request.json();
    const parsed = UpdateProfileSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({
        error: "Dati non validi",
        issues: parsed.error.issues,
      }, { status: 400 });
    }

    const updated = updateSnmpVendorProfile(profileId, parsed.data);
    invalidateSnmpVendorProfilesCache();

    return NextResponse.json({ profile: updated }, { status: 200 });
  } catch (error) {
    return NextResponse.json({
      error: `Errore aggiornamento: ${error instanceof Error ? error.message : String(error)}`,
    }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const authResult = await requireAdmin();
  if (isAuthError(authResult)) return authResult;

  const { id } = await params;
  const profileId = parseInt(id, 10);

  if (isNaN(profileId)) {
    return NextResponse.json({ error: "ID profilo non valido" }, { status: 400 });
  }

  const existing = getSnmpVendorProfileById(profileId);
  if (!existing) {
    return NextResponse.json({ error: "Profilo non trovato" }, { status: 404 });
  }

  try {
    const body = await request.json();

    if (body.enabled !== undefined) {
      updateSnmpVendorProfile(profileId, { enabled: body.enabled ? 1 : 0 });
      invalidateSnmpVendorProfilesCache();
      const updated = getSnmpVendorProfileById(profileId);
      return NextResponse.json({ profile: updated }, { status: 200 });
    }

    return NextResponse.json({ error: "Nessun campo da aggiornare" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({
      error: `Errore aggiornamento: ${error instanceof Error ? error.message : String(error)}`,
    }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const authResult = await requireAdmin();
  if (isAuthError(authResult)) return authResult;

  const { id } = await params;
  const profileId = parseInt(id, 10);

  if (isNaN(profileId)) {
    return NextResponse.json({ error: "ID profilo non valido" }, { status: 400 });
  }

  const existing = getSnmpVendorProfileById(profileId);
  if (!existing) {
    return NextResponse.json({ error: "Profilo non trovato" }, { status: 404 });
  }

  if (existing.builtin === 1) {
    return NextResponse.json({
      error: "I profili builtin non possono essere eliminati. Puoi disabilitarli dalla lista.",
    }, { status: 403 });
  }

  const deleted = deleteSnmpVendorProfile(profileId);
  if (!deleted) {
    return NextResponse.json({ error: "Errore eliminazione profilo" }, { status: 500 });
  }

  invalidateSnmpVendorProfilesCache();

  return NextResponse.json({ success: true }, { status: 200 });
}
