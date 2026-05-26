/**
 * /api/classifications/custom/[slug]
 *
 * Single-record management for tenant custom classifications.
 * GET → fetch
 * PUT → update label e/o parent_slug (slug immutabile: PK referenziata da hosts.classification)
 * DELETE → rimuove. Bloccato (409) se almeno un host la usa.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import {
  getCustomClassificationBySlug,
  updateCustomClassification,
  deleteCustomClassification,
  countHostsByClassification,
  getCurrentTenantCode,
} from "@/lib/db-tenant";
import { DEVICE_CLASSIFICATIONS } from "@/lib/device-classifications";
import { invalidateCustomClassificationsCache } from "@/lib/device-classifications-runtime";

const BUILTIN_SET = new Set<string>(DEVICE_CLASSIFICATIONS);

const UpdateSchema = z.object({
  label: z.string().min(1).max(80).trim().optional(),
  parent_slug: z.string().min(1).optional(),
});

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  return withTenantFromSession(async () => {
    const auth = await requireAuth();
    if (isAuthError(auth)) return auth;
    const { slug } = await params;
    const item = getCustomClassificationBySlug(slug);
    if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ item });
  });
}

export async function PUT(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  return withTenantFromSession(async () => {
    const auth = await requireAdmin();
    if (isAuthError(auth)) return auth;
    const { slug } = await params;

    let body;
    try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON non valido" }, { status: 400 }); }
    const parsed = UpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    if (parsed.data.parent_slug !== undefined && !BUILTIN_SET.has(parsed.data.parent_slug)) {
      return NextResponse.json({ error: `parent_slug "${parsed.data.parent_slug}" non è una classification built-in valida` }, { status: 400 });
    }

    if (!getCustomClassificationBySlug(slug)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    try {
      const item = updateCustomClassification(slug, parsed.data);
      invalidateCustomClassificationsCache(getCurrentTenantCode());
      return NextResponse.json({ item });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.toLowerCase().includes("unique") && msg.includes("label")) {
        return NextResponse.json({ error: "Esiste già una classification custom con questa label" }, { status: 409 });
      }
      console.error("[/api/classifications/custom/[slug]] PUT failed:", e);
      return NextResponse.json({ error: "Errore aggiornamento" }, { status: 500 });
    }
  });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  return withTenantFromSession(async () => {
    const auth = await requireAdmin();
    if (isAuthError(auth)) return auth;
    const { slug } = await params;

    const item = getCustomClassificationBySlug(slug);
    if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const refs = countHostsByClassification(slug);
    if (refs > 0) {
      return NextResponse.json(
        { error: `Impossibile cancellare: ${refs} host usano questa classification. Riassegnali prima di cancellare.`, references_count: refs },
        { status: 409 }
      );
    }

    try {
      deleteCustomClassification(slug);
      invalidateCustomClassificationsCache(getCurrentTenantCode());
      return new NextResponse(null, { status: 204 });
    } catch (e) {
      console.error("[/api/classifications/custom/[slug]] DELETE failed:", e);
      return NextResponse.json({ error: "Errore cancellazione" }, { status: 500 });
    }
  });
}
