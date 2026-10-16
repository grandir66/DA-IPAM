import { NextResponse } from "next/server";
import { z } from "zod";
import { updateMacProductEntry, deleteMacProductEntry } from "@/lib/db-hub";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { invalidateMacProductCache } from "@/lib/attribution/mac-product";
import { normalizeMacHex } from "@/lib/attribution/kb";
import { isValidCategory } from "@/lib/attribution/taxonomy";

/** Stessi vincoli di ../route.ts (POST): normalizzazione riusata da kb.ts, non duplicata. */
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

const updateSchema = z.object({
  mac_prefix: macPrefixSchema.optional(),
  hostname_pattern: hostnamePatternSchema,
  vendor: z.string().min(1).optional(),
  product_family: z.string().nullable().optional(),
  category: categorySchema,
  confidence: z.number().min(0).max(1).optional(),
  source: z.enum(["seed", "domarc", "feedback"]).optional(),
  enabled: z.union([z.literal(0), z.literal(1)]).optional(),
  note: z.string().nullable().optional(),
});

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;
    const { id } = await params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "JSON non valido" }, { status: 400 });
    }

    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Dati non validi", details: parsed.error.issues },
        { status: 400 },
      );
    }

    const updated = updateMacProductEntry(Number(id), parsed.data);
    if (!updated) return NextResponse.json({ error: "Entry non trovata" }, { status: 404 });
    invalidateMacProductCache();
    return NextResponse.json(updated);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Errore";
    if (msg.includes("UNIQUE")) {
      return NextResponse.json(
        { error: "Esiste già una entry con questo prefisso MAC e pattern hostname" },
        { status: 409 },
      );
    }
    console.error("Error updating mac_product_map entry:", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;
    const { id } = await params;
    const deleted = deleteMacProductEntry(Number(id));
    if (!deleted) return NextResponse.json({ error: "Entry non trovata" }, { status: 404 });
    invalidateMacProductCache();
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("Error deleting mac_product_map entry:", e);
    return NextResponse.json({ error: "Errore nell'eliminazione" }, { status: 500 });
  }
}
