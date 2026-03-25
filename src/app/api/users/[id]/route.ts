import { NextResponse } from "next/server";
import { getUserById, updateUserRole, deleteUser, getUserTenantAccess, setUserTenantAccess, removeUserTenantAccess } from "@/lib/db";
import { requireAdmin, isAuthError } from "@/lib/api-auth";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;

    const { id } = await params;
    const userId = Number(id);
    if (isNaN(userId)) {
      return NextResponse.json(
        { error: "ID utente non valido" },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { role: rawRole, tenant_ids } = body as { role?: string; tenant_ids?: number[] };
    const validRoles = ["superadmin", "admin", "viewer"] as const;
    type ValidRole = typeof validRoles[number];

    if (!rawRole || !validRoles.includes(rawRole as ValidRole)) {
      return NextResponse.json(
        { error: "Il ruolo deve essere 'superadmin', 'admin' o 'viewer'" },
        { status: 400 }
      );
    }
    const role = rawRole as ValidRole;

    const user = getUserById(userId);
    if (!user) {
      return NextResponse.json(
        { error: "Utente non trovato" },
        { status: 404 }
      );
    }

    // Protezione: non declassare l'ultimo superadmin/admin
    if (user.role === "superadmin" && role !== "superadmin") {
      const { getDb } = await import("@/lib/db");
      const supers = getDb().prepare("SELECT COUNT(*) as c FROM users WHERE role = 'superadmin'").get() as { c: number };
      if (supers.c <= 1) {
        return NextResponse.json(
          { error: "Impossibile modificare il ruolo dell'ultimo super amministratore" },
          { status: 400 }
        );
      }
    }
    if (user.role === "admin" && role === "viewer") {
      const { getDb } = await import("@/lib/db");
      const admins = getDb().prepare("SELECT COUNT(*) as c FROM users WHERE role IN ('admin', 'superadmin')").get() as { c: number };
      if (admins.c <= 1) {
        return NextResponse.json(
          { error: "Impossibile rimuovere il ruolo admin dall'ultimo amministratore" },
          { status: 400 }
        );
      }
    }

    // Admin e viewer devono avere almeno un tenant
    if (role !== "superadmin" && (!tenant_ids || tenant_ids.length === 0)) {
      return NextResponse.json(
        { error: "Seleziona almeno un cliente per questo ruolo" },
        { status: 400 }
      );
    }

    // Aggiorna ruolo
    updateUserRole(userId, role);

    // Sincronizza accessi tenant
    const currentAccess = getUserTenantAccess(userId);
    const currentTenantIds = new Set(currentAccess.map(a => a.tenant_id));
    const newTenantIds = new Set(role === "superadmin" ? [] : (tenant_ids ?? []));

    // Rimuovi tenant non più assegnati
    for (const tid of currentTenantIds) {
      if (!newTenantIds.has(tid)) {
        removeUserTenantAccess(userId, tid);
      }
    }
    // Aggiungi nuovi tenant
    for (const tid of newTenantIds) {
      if (!currentTenantIds.has(tid)) {
        setUserTenantAccess(userId, tid, role === "superadmin" ? "admin" : role);
      }
    }
    // Aggiorna ruolo sui tenant esistenti se cambiato
    for (const tid of newTenantIds) {
      if (currentTenantIds.has(tid)) {
        const existing = currentAccess.find(a => a.tenant_id === tid);
        if (existing && existing.role !== role) {
          setUserTenantAccess(userId, tid, role);
        }
      }
    }

    return NextResponse.json({ success: true, message: "Utente aggiornato" });
  } catch (error) {
    console.error("Errore aggiornamento utente:", error);
    return NextResponse.json(
      { error: "Errore nell'aggiornamento dell'utente" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;

    const { id } = await params;
    const userId = Number(id);
    if (isNaN(userId)) {
      return NextResponse.json(
        { error: "ID utente non valido" },
        { status: 400 }
      );
    }

    // Non permettere di eliminare se stessi
    const session = adminCheck;
    const currentUsername = session.user.name;
    const targetUser = getUserById(userId);
    if (!targetUser) {
      return NextResponse.json(
        { error: "Utente non trovato" },
        { status: 404 }
      );
    }

    if (targetUser.username === currentUsername) {
      return NextResponse.json(
        { error: "Non puoi eliminare il tuo stesso account" },
        { status: 400 }
      );
    }

    try {
      const deleted = deleteUser(userId);
      if (!deleted) {
        return NextResponse.json(
          { error: "Utente non trovato" },
          { status: 404 }
        );
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes("ultimo amministratore")) {
        return NextResponse.json(
          { error: err.message },
          { status: 400 }
        );
      }
      throw err;
    }

    return NextResponse.json({ success: true, message: "Utente eliminato" });
  } catch (error) {
    console.error("Errore eliminazione utente:", error);
    return NextResponse.json(
      { error: "Errore nell'eliminazione dell'utente" },
      { status: 500 }
    );
  }
}
