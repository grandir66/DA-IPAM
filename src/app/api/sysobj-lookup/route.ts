import { NextResponse } from "next/server";
import { z } from "zod";
import { getSysObjLookupEntries, createSysObjLookupEntry, resetBuiltinSysObjLookup } from "@/lib/db";
import { requireAdmin, requireAuth, isAuthError } from "@/lib/api-auth";
import { invalidateSysObjLookupCache } from "@/lib/scanner/snmp-sysobj-lookup";

const createSchema = z.object({
  oid: z.string().min(1, "OID è obbligatorio"),
  vendor: z.string().min(1, "Vendor è obbligatorio"),
  product: z.string().min(1, "Product è obbligatorio"),
  category: z.string().min(1, "Categoria è obbligatoria"),
  enterprise_id: z.number(),
  enabled: z.union([z.literal(0), z.literal(1)]).optional(),
  note: z.string().optional(),
});

export async function GET() {
  try {
    const authCheck = await requireAuth();
    if (isAuthError(authCheck)) return authCheck;
    return NextResponse.json(getSysObjLookupEntries());
  } catch (e) {
    console.error("Error fetching sysobj_lookup entries:", e);
    return NextResponse.json({ error: "Errore nel recupero entry sysObjectID" }, { status: 500 });
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

    const obj = body as Record<string, unknown>;

    if (obj._action === "reset_builtin") {
      resetBuiltinSysObjLookup();
      invalidateSysObjLookupCache();
      return NextResponse.json({ success: true, message: "Entry built-in ripristinate" });
    }

    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Dati non validi", details: parsed.error.issues },
        { status: 400 },
      );
    }

    const entry = createSysObjLookupEntry(parsed.data);
    invalidateSysObjLookupCache();
    return NextResponse.json(entry, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Errore";
    if (msg.includes("UNIQUE")) {
      return NextResponse.json({ error: "Esiste già una entry con questo OID" }, { status: 409 });
    }
    console.error("Error creating sysobj_lookup entry:", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
