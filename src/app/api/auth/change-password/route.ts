import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getUserByUsername, updateUserPassword } from "@/lib/db";
import bcrypt from "bcrypt";

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.name) {
      return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
    }

    const { current_password, new_password } = await request.json();

    if (!current_password || !new_password) {
      return NextResponse.json({ error: "Password corrente e nuova password richieste" }, { status: 400 });
    }

    if (new_password.length < 8) {
      return NextResponse.json({ error: "La nuova password deve avere almeno 8 caratteri" }, { status: 400 });
    }

    const user = getUserByUsername(session.user.name);
    if (!user) {
      return NextResponse.json({ error: "Utente non trovato" }, { status: 404 });
    }

    const isValid = await bcrypt.compare(current_password, user.password_hash);
    if (!isValid) {
      return NextResponse.json({ error: "Password corrente non corretta" }, { status: 403 });
    }

    const newHash = await bcrypt.hash(new_password, 12);
    updateUserPassword(user.id, newHash);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error changing password:", error);
    return NextResponse.json({ error: "Errore nel cambio password" }, { status: 500 });
  }
}
