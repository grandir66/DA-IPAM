/**
 * /api/classifications/custom
 *
 * Catalog tenant delle classification custom (sotto-categorie utente di un
 * built-in). Vedi [docs/.../custom-classifications.md] e
 * [src/lib/db-tenant.ts] sezione "CUSTOM CLASSIFICATIONS".
 *
 * GET  → lista tenant
 * POST → crea { slug, label, parent_slug }
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import {
  listCustomClassifications,
  createCustomClassification,
  getCustomClassificationBySlug,
} from "@/lib/db-tenant";
import { DEVICE_CLASSIFICATIONS } from "@/lib/device-classifications";
import { invalidateCustomClassificationsCache } from "@/lib/device-classifications-runtime";
import { getCurrentTenantCode } from "@/lib/db-tenant";

const SLUG_RE = /^[a-z][a-z0-9_]{1,63}$/;
const BUILTIN_SET = new Set<string>(DEVICE_CLASSIFICATIONS);
// Sentinel slug riservati: 'unknown' è usato come fallback "nessuna classification";
// 'user'/'group' sono namespace prefix dei preset chip (vedi preset-types.ts).
// Permettere uno di questi confonderebbe la logica di filtro built-in.
const RESERVED_SLUGS = new Set<string>(["unknown", "user", "group"]);

const CreateSchema = z.object({
  slug: z
    .string()
    .min(2)
    .max(64)
    .regex(SLUG_RE, "slug deve essere kebab/snake lowercase, iniziare con lettera"),
  label: z.string().min(1).max(80).trim(),
  parent_slug: z.string().min(1),
});

export async function GET() {
  return withTenantFromSession(async () => {
    const authCheck = await requireAuth();
    if (isAuthError(authCheck)) return authCheck;
    try {
      const items = listCustomClassifications();
      // v0.2.642 audit perf UI7: dati read-mostly (mutati solo dalla UI Settings),
      // cache client 60s + SWR 5min — switch tab istantaneo invece di refetch.
      return NextResponse.json({ items }, {
        headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=300" },
      });
    } catch (e) {
      console.error("[/api/classifications/custom] GET failed:", e);
      return NextResponse.json({ error: "Errore caricamento classification custom" }, { status: 500 });
    }
  });
}

export async function POST(req: Request) {
  return withTenantFromSession(async () => {
    const auth = await requireAdmin();
    if (isAuthError(auth)) return auth;

    let body;
    try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON non valido" }, { status: 400 }); }

    const parsed = CreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const { slug, label, parent_slug } = parsed.data;

    if (BUILTIN_SET.has(slug)) {
      return NextResponse.json({ error: `Lo slug "${slug}" coincide con una classification built-in` }, { status: 400 });
    }
    if (RESERVED_SLUGS.has(slug)) {
      return NextResponse.json({ error: `Lo slug "${slug}" è riservato (sentinel di sistema)` }, { status: 400 });
    }
    if (!BUILTIN_SET.has(parent_slug)) {
      return NextResponse.json({ error: `parent_slug "${parent_slug}" non è una classification built-in valida` }, { status: 400 });
    }
    if (getCustomClassificationBySlug(slug)) {
      return NextResponse.json({ error: `Lo slug "${slug}" esiste già` }, { status: 409 });
    }

    try {
      const item = createCustomClassification({ slug, label, parent_slug });
      invalidateCustomClassificationsCache(getCurrentTenantCode());
      return NextResponse.json({ item }, { status: 201 });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.toLowerCase().includes("unique") && msg.includes("label")) {
        return NextResponse.json({ error: "Esiste già una classification custom con questa label" }, { status: 409 });
      }
      console.error("[/api/classifications/custom] POST failed:", e);
      return NextResponse.json({ error: "Errore creazione classification custom" }, { status: 500 });
    }
  });
}
