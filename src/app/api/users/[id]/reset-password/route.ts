import { NextResponse } from "next/server";
import bcrypt from "bcrypt";
import { getUserById, updateUserPassword } from "@/lib/db";
import { requireAdmin, isAuthError } from "@/lib/api-auth";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;

    const { id } = await params;
    const userId = Number(id);
    if (isNaN(userId)) {
      return NextResponse.json({ error: "ID utente non valido" }, { status: 400 });
    }

    let body: { new_password?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "JSON non valido" }, { status: 400 });
    }

    const newPassword = (body.new_password ?? "").toString();
    if (newPassword.length < 8) {
      return NextResponse.json(
        { error: "La nuova password deve avere almeno 8 caratteri" },
        { status: 400 }
      );
    }

    const user = getUserById(userId);
    if (!user) {
      return NextResponse.json({ error: "Utente non trovato" }, { status: 404 });
    }

    const newHash = await bcrypt.hash(newPassword, 12);
    updateUserPassword(userId, newHash);

    return NextResponse.json({
      success: true,
      message: `Password di "${user.username}" reimpostata`,
    });
  } catch (error) {
    console.error("Errore reset password:", error);
    return NextResponse.json(
      { error: "Errore nel reset password" },
      { status: 500 }
    );
  }
}
