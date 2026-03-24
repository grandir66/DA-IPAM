import { NextResponse } from "next/server";
import { z } from "zod";
import { updateSysObjLookupEntry, deleteSysObjLookupEntry } from "@/lib/db";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { invalidateSysObjLookupCache } from "@/lib/scanner/snmp-sysobj-lookup";

const updateSchema = z.object({
  oid: z.string().min(1).optional(),
  vendor: z.string().min(1).optional(),
  product: z.string().min(1).optional(),
  category: z.enum(["networking", "wireless", "firewall", "server", "storage"]).optional(),
  enterprise_id: z.number().optional(),
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
        { error: "Dati non validi", details: parsed.error.issues },
        { status: 400 },
      );
    }

    const updated = updateSysObjLookupEntry(Number(id), parsed.data);
    if (!updated) return NextResponse.json({ error: "Entry non trovata" }, { status: 404 });
    invalidateSysObjLookupCache();
    return NextResponse.json(updated);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Errore";
    if (msg.includes("UNIQUE")) {
      return NextResponse.json({ error: "Esiste già una entry con questo OID" }, { status: 409 });
    }
    console.error("Error updating sysobj_lookup entry:", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;
    const { id } = await params;
    const deleted = deleteSysObjLookupEntry(Number(id));
    if (!deleted) return NextResponse.json({ error: "Entry non trovata" }, { status: 404 });
    invalidateSysObjLookupCache();
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("Error deleting sysobj_lookup entry:", e);
    return NextResponse.json({ error: "Errore nell'eliminazione" }, { status: 500 });
  }
}
