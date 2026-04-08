import { NextResponse, type NextRequest } from "next/server";
import { requireAuth, requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import {
  insertClassificationFeedback,
  getClassificationFeedback,
} from "@/lib/analytics/classification-feedback-db";
import { z } from "zod";

const PostSchema = z.object({
  host_id: z.number().int().positive(),
  corrected_classification: z.string().min(1),
  previous_classification: z.string().nullable().optional(),
  feature_snapshot_json: z.string().nullable().optional(),
  fingerprint_device_label: z.string().nullable().optional(),
  fingerprint_confidence: z.number().min(0).max(1).nullable().optional(),
});

export async function GET(req: NextRequest) {
  const session = await requireAuth();
  if (isAuthError(session)) return session;

  return withTenantFromSession(async () => {
    const p = req.nextUrl.searchParams;
    const host_id = p.get("host_id") ? Number(p.get("host_id")) : undefined;
    const limit = Math.min(Number(p.get("limit") ?? 50), 200);

    const feedback = getClassificationFeedback({ host_id, limit });
    return NextResponse.json(feedback);
  });
}

export async function POST(req: NextRequest) {
  const session = await requireAdmin();
  if (isAuthError(session)) return session;

  return withTenantFromSession(async () => {
    const body = await req.json();
    const parsed = PostSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dati non validi" }, { status: 400 });
    }

    const username = (session as { user?: { name?: string } }).user?.name ?? null;
    const id = insertClassificationFeedback({
      host_id: parsed.data.host_id,
      corrected_classification: parsed.data.corrected_classification,
      previous_classification: parsed.data.previous_classification ?? null,
      feature_snapshot_json: parsed.data.feature_snapshot_json ?? null,
      fingerprint_device_label: parsed.data.fingerprint_device_label ?? null,
      fingerprint_confidence: parsed.data.fingerprint_confidence ?? null,
      corrected_by: username,
    });
    return NextResponse.json({ id }, { status: 201 });
  });
}
