import { NextResponse } from "next/server";
import { z } from "zod";
import { getMacProductMap, createMacProductEntry } from "@/lib/db-hub";
import { requireAdmin, requireAuth, isAuthError } from "@/lib/api-auth";
import { invalidateMacProductCache } from "@/lib/attribution/mac-product";
import { normalizeMacHex, kbVersion, kbAvailable } from "@/lib/attribution/kb";
import { isValidCategory } from "@/lib/attribution/taxonomy";

/** `mac_prefix` deve normalizzare (stessa funzione di kb.ts/mac-product.ts, non
 *  duplicata) a 6, 7 o 9 cifre esadecimali — cioè 24, 28 o 36 bit (MA-L/MA-M/MA-S). */
function isValidMacPrefixValue(v: string): boolean {
  const hex = normalizeMacHex(v);
  return !!hex && [6, 7, 9].includes(hex.length);
}

function isValidHostnamePattern(v: string | null | undefined): boolean {
  if (!v) return true;
  try {
    new RegExp(v);
    return true;
  } catch {
    return false;
  }
}

const macPrefixSchema = z
  .string()
  .min(1, "mac_prefix è obbligatorio")
  .refine(isValidMacPrefixValue, {
    message: "mac_prefix deve normalizzare a 6, 7 o 9 cifre esadecimali (24/28/36 bit)",
  });

const hostnamePatternSchema = z
  .string()
  .nullable()
  .optional()
  .refine(isValidHostnamePattern, { message: "hostname_pattern non è una regex valida" });

const categorySchema = z
  .string()
  .nullable()
  .optional()
  .refine((v) => v == null || isValidCategory(v), { message: "Categoria non valida" });

export const createSchema = z.object({
  mac_prefix: macPrefixSchema,
  hostname_pattern: hostnamePatternSchema,
  vendor: z.string().min(1, "vendor è obbligatorio"),
  product_family: z.string().nullable().optional(),
  category: categorySchema,
  confidence: z.number().min(0).max(1).optional(),
  source: z.enum(["seed", "domarc", "feedback"]).optional(),
  enabled: z.union([z.literal(0), z.literal(1)]).optional(),
  note: z.string().nullable().optional(),
});

export async function GET(request: Request) {
  try {
    const authCheck = await requireAuth();
    if (isAuthError(authCheck)) return authCheck;

    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q")?.trim().toLowerCase() ?? "";

    let entries = getMacProductMap();
    if (q) {
      entries = entries.filter((r) =>
        r.mac_prefix.toLowerCase().includes(q) ||
        r.vendor.toLowerCase().includes(q) ||
        (r.product_family ?? "").toLowerCase().includes(q) ||
        (r.category ?? "").toLowerCase().includes(q) ||
        (r.note ?? "").toLowerCase().includes(q)
      );
    }

    return NextResponse.json({
      entries,
      kb_version: kbVersion(),
      kb_available: kbAvailable(),
    });
  } catch (e) {
    console.error("Error fetching mac_product_map entries:", e);
    return NextResponse.json({ error: "Errore nel recupero mappa MAC→prodotto" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "JSON non valido" }, { status: 400 });
    }

    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Dati non validi", details: parsed.error.issues },
        { status: 400 },
      );
    }

    const entry = createMacProductEntry(parsed.data);
    invalidateMacProductCache();
    return NextResponse.json(entry, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Errore";
    if (msg.includes("UNIQUE")) {
      return NextResponse.json(
        { error: "Esiste già una entry con questo prefisso MAC e pattern hostname" },
        { status: 409 },
      );
    }
    console.error("Error creating mac_product_map entry:", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
