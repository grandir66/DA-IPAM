import { NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import { requireAdmin, isAuthError } from "@/lib/api-auth";

export async function GET() {
  const adminCheck = await requireAdmin();
  if (isAuthError(adminCheck)) return adminCheck;
  const dbPath = path.join(process.cwd(), "data", "ipam.db");

  if (!fs.existsSync(dbPath)) {
    return NextResponse.json({ error: "Database non trovato" }, { status: 404 });
  }

  const buffer = fs.readFileSync(dbPath);
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/x-sqlite3",
      "Content-Disposition": `attachment; filename="ipam-backup-${new Date().toISOString().slice(0, 10)}.db"`,
    },
  });
}
