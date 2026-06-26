import { NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { resolveDataDir } from "@/lib/data-dir";

export async function GET() {
  const adminCheck = await requireAdmin();
  if (isAuthError(adminCheck)) return adminCheck;
  // Multi-tenant: il DB legacy `ipam.db` non esiste più. Il backup raw a file
  // singolo è `hub.db`; per un backup completo (hub + tutti i tenant) usare
  // l'export per-tenant `/api/tenant/export`. Path via resolveDataDir() per
  // rispettare DA_INVENT_DATA_DIR (volume Docker/systemd).
  const dbPath = path.join(resolveDataDir(), "hub.db");

  if (!fs.existsSync(dbPath)) {
    return NextResponse.json({ error: "Database non trovato" }, { status: 404 });
  }

  const buffer = fs.readFileSync(dbPath);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/x-sqlite3",
      "Content-Disposition": `attachment; filename="hub-backup-${new Date().toISOString().slice(0, 10)}.db"`,
    },
  });
}
