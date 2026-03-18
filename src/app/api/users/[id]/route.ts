import { NextResponse } from "next/server";
import { getUserById, updateUserRole, deleteUser } from "@/lib/db";
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
    const { role } = body as { role?: string };

    if (role !== "admin" && role !== "viewer") {
      return NextResponse.json(
        { error: "Il ruolo deve essere 'admin' o 'viewer'" },
        { status: 400 }
      );
    }

    const user = getUserById(userId);
    if (!user) {
      return NextResponse.json(
        { error: "Utente non trovato" },
        { status: 404 }
      );
    }

    // Se si sta rimuovendo il ruolo admin, verificare che non sia l'ultimo admin
    if (user.role === "admin" && role === "viewer") {
      const { getDb } = await import("@/lib/db");
      const admins = getDb().prepare("SELECT COUNT(*) as c FROM users WHERE role = 'admin'").get() as { c: number };
      if (admins.c <= 1) {
        return NextResponse.json(
          { error: "Impossibile rimuovere il ruolo admin dall'ultimo amministratore" },
          { status: 400 }
        );
      }
    }

    const updated = updateUserRole(userId, role);
    if (!updated) {
      return NextResponse.json(
        { error: "Utente non trovato" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, message: "Ruolo aggiornato" });
  } catch (error) {
    console.error("Errore aggiornamento ruolo:", error);
    return NextResponse.json(
      { error: "Errore nell'aggiornamento del ruolo" },
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
