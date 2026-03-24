import { NextResponse } from "next/server";
import { unassignLicenseSeat } from "@/lib/db";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withTenantFromSession(async () => {
    try {
      const adminCheck = await requireAdmin();
      if (isAuthError(adminCheck)) return adminCheck;
      const { id } = await params;
      const deleted = unassignLicenseSeat(Number(id));
      if (!deleted) {
        return NextResponse.json({ error: "Posto licenza non trovato" }, { status: 404 });
      }
      return NextResponse.json({ success: true });
    } catch (error) {
      console.error("Error unassigning license seat:", error);
      return NextResponse.json({ error: "Errore nella rimozione dell'assegnazione" }, { status: 500 });
    }
  });
}
