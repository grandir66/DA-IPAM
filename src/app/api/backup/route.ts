import { NextResponse } from "next/server";
import fs from "fs";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { resolveDataDir } from "@/lib/data-dir";
import { unisci } from "@/lib/percorsi";
import { isTecnico } from "@/lib/profilo";
import { puoScaricareHub } from "@/lib/accesso/profilo-pubblico";

export async function GET() {
  const adminCheck = await requireAdmin();
  if (isAuthError(adminCheck)) return adminCheck;
  // Sul profilo tecnico hub.db tiene gli utenti di tutti i clienti: serve il superadmin (P0-1, 14/11).
  if (!puoScaricareHub(adminCheck.user.role, isTecnico())) {
    return NextResponse.json(
      { error: "Su questa installazione il database intero lo scarica solo il superadmin." },
      { status: 403 },
    );
  }
  // Chi e quando: resta nel journal.
  console.info(`[backup] hub.db scaricato da ${adminCheck.user.name ?? "?"} (${adminCheck.user.role ?? "?"})`);
  // Multi-tenant: il DB legacy `ipam.db` non esiste più. Il backup raw a file
  // singolo è `hub.db`; per un backup completo (hub + tutti i tenant) usare
  // l'export per-tenant `/api/tenant/export`. Path via resolveDataDir() per
  // rispettare DA_INVENT_DATA_DIR (volume Docker/systemd).
  const dbPath = unisci(resolveDataDir(), "hub.db");

  if (!fs.existsSync(dbPath)) {
    return NextResponse.json({ error: "Database non trovato" }, { status: 404 });
  }

  const buffer = fs.readFileSync(dbPath);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/x-sqlite3",
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="hub-backup-${new Date().toISOString().slice(0, 10)}.db"`,
    },
  });
}
