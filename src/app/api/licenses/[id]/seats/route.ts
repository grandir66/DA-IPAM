import { NextResponse } from "next/server";
import { getLicenseSeatsByLicense, assignLicenseSeat, assignLicenseSeatToAssignee } from "@/lib/db";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withTenantFromSession(async () => {
    try {
      const { id } = await params;
      const seats = getLicenseSeatsByLicense(Number(id));
      return NextResponse.json(seats);
    } catch (error) {
      console.error("Error fetching license seats:", error);
      return NextResponse.json({ error: "Errore nel recupero dei posti licenza" }, { status: 500 });
    }
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withTenantFromSession(async () => {
    try {
      const adminCheck = await requireAdmin();
      if (isAuthError(adminCheck)) return adminCheck;
      const { id } = await params;
      const body = await request.json();
      const { asset_type, asset_id, asset_assignee_id, note } = body;

      if (asset_assignee_id != null) {
        const seat = assignLicenseSeatToAssignee(Number(id), Number(asset_assignee_id), note?.trim() || null);
        if (!seat) {
          return NextResponse.json({ error: "Nessun posto disponibile o licenza non trovata" }, { status: 400 });
        }
        return NextResponse.json(seat);
      }

      if (asset_type && asset_id != null) {
        if (asset_type !== "inventory_asset" && asset_type !== "host") {
          return NextResponse.json({ error: "asset_type deve essere 'inventory_asset' o 'host'" }, { status: 400 });
        }
        const seat = assignLicenseSeat(Number(id), asset_type, Number(asset_id), note?.trim() || null);
        if (!seat) {
          return NextResponse.json({ error: "Nessun posto disponibile o licenza non trovata" }, { status: 400 });
        }
        return NextResponse.json(seat);
      }

      return NextResponse.json({ error: "Specificare asset_type e asset_id oppure asset_assignee_id" }, { status: 400 });
    } catch (error) {
      console.error("Error assigning license seat:", error);
      return NextResponse.json({ error: "Errore nell'assegnazione del posto licenza" }, { status: 500 });
    }
  });
}
