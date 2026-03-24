import { NextResponse } from "next/server";
import { getLicenseById, updateLicense, deleteLicense } from "@/lib/db";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withTenantFromSession(async () => {
    try {
      const authCheck = await requireAdmin();
      if (isAuthError(authCheck)) return authCheck;
      const { id } = await params;
      const license = getLicenseById(Number(id));
      if (!license) {
        return NextResponse.json({ error: "Licenza non trovata" }, { status: 404 });
      }
      return NextResponse.json(license);
    } catch (error) {
      console.error("Error fetching license:", error);
      return NextResponse.json({ error: "Errore nel recupero della licenza" }, { status: 500 });
    }
  });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withTenantFromSession(async () => {
    try {
      const adminCheck = await requireAdmin();
      if (isAuthError(adminCheck)) return adminCheck;
      const { id } = await params;
      const body = await request.json();
      const updated = updateLicense(Number(id), {
        name: body.name?.trim(),
        serial: body.serial !== undefined ? (body.serial?.trim() || null) : undefined,
        seats: body.seats,
        category: body.category !== undefined ? (body.category?.trim() || null) : undefined,
        expiration_date: body.expiration_date !== undefined ? (body.expiration_date?.trim() || null) : undefined,
        purchase_cost: body.purchase_cost,
        min_amt: body.min_amt,
        fornitore: body.fornitore !== undefined ? (body.fornitore?.trim() || null) : undefined,
        note: body.note !== undefined ? (body.note?.trim() || null) : undefined,
      });
      if (!updated) {
        return NextResponse.json({ error: "Licenza non trovata" }, { status: 404 });
      }
      return NextResponse.json(updated);
    } catch (error) {
      console.error("Error updating license:", error);
      return NextResponse.json({ error: "Errore nell'aggiornamento della licenza" }, { status: 500 });
    }
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withTenantFromSession(async () => {
    try {
      const adminCheck = await requireAdmin();
      if (isAuthError(adminCheck)) return adminCheck;
      const { id } = await params;
      const deleted = deleteLicense(Number(id));
      if (!deleted) {
        return NextResponse.json({ error: "Licenza non trovata" }, { status: 404 });
      }
      return NextResponse.json({ success: true });
    } catch (error) {
      console.error("Error deleting license:", error);
      return NextResponse.json({ error: "Errore nell'eliminazione della licenza" }, { status: 500 });
    }
  });
}
