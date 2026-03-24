import { NextResponse } from "next/server";
import { getTenantById, updateTenant, deleteTenant } from "@/lib/db-hub";
import { deleteTenantDatabase } from "@/lib/db-tenant";
import { requireAuth, requireAdmin, isAuthError } from "@/lib/api-auth";
import { z } from "zod";

const TenantUpdateSchema = z.object({
  codice_cliente: z.string().min(1).optional(),
  ragione_sociale: z.string().min(1).optional(),
  indirizzo: z.string().optional(),
  citta: z.string().optional(),
  provincia: z.string().optional(),
  cap: z.string().optional(),
  telefono: z.string().optional(),
  email: z.string().optional(),
  piva: z.string().optional(),
  cf: z.string().optional(),
  referente: z.string().optional(),
  note: z.string().optional(),
  active: z.number().optional(),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    if (isAuthError(session)) return session;

    const { id } = await params;
    const tenant = getTenantById(Number(id));
    if (!tenant) {
      return NextResponse.json({ error: "Cliente non trovato" }, { status: 404 });
    }

    return NextResponse.json(tenant);
  } catch (error) {
    console.error("Errore nel recupero del tenant:", error);
    return NextResponse.json({ error: "Errore nel recupero del cliente" }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const parsed = TenantUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const updated = updateTenant(Number(id), parsed.data);
    if (!updated) {
      return NextResponse.json({ error: "Cliente non trovato" }, { status: 404 });
    }

    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE")) {
      return NextResponse.json({ error: "Codice cliente già esistente" }, { status: 409 });
    }
    console.error("Errore nell'aggiornamento del tenant:", error);
    return NextResponse.json({ error: "Errore nell'aggiornamento del cliente" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;

    const { id } = await params;
    const tenant = getTenantById(Number(id));
    if (!tenant) {
      return NextResponse.json({ error: "Cliente non trovato" }, { status: 404 });
    }

    // Elimina il database del tenant prima di rimuovere il record
    try {
      deleteTenantDatabase(tenant.codice_cliente);
    } catch (e) {
      console.error("Errore nell'eliminazione del database tenant:", e);
    }

    const deleted = deleteTenant(Number(id));
    if (!deleted) {
      return NextResponse.json({ error: "Errore nell'eliminazione del cliente" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Errore nell'eliminazione del tenant:", error);
    return NextResponse.json({ error: "Errore nell'eliminazione del cliente" }, { status: 500 });
  }
}
