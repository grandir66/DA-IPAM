import { NextResponse } from "next/server";
import { getUsers, getUserByUsername, createUser } from "@/lib/db";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import bcrypt from "bcrypt";

const NO_CACHE_HEADERS = { "Cache-Control": "no-store, no-cache, must-revalidate" };

export async function GET() {
  try {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;

    const users = getUsers();
    return NextResponse.json(users, { headers: NO_CACHE_HEADERS });
  } catch (error) {
    console.error("Errore caricamento utenti:", error);
    return NextResponse.json(
      { error: "Errore nel caricamento degli utenti" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;

    const body = await request.json();
    const { username, password, role } = body as {
      username?: string;
      password?: string;
      role?: string;
    };

    if (!username || !password) {
      return NextResponse.json(
        { error: "Username e password sono obbligatori" },
        { status: 400 }
      );
    }

    if (username.length < 3 || username.length > 50) {
      return NextResponse.json(
        { error: "Lo username deve avere tra 3 e 50 caratteri" },
        { status: 400 }
      );
    }

    if (!/^[a-zA-Z0-9._-]+$/.test(username)) {
      return NextResponse.json(
        { error: "Lo username può contenere solo lettere, numeri, punti, trattini e underscore" },
        { status: 400 }
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: "La password deve avere almeno 8 caratteri" },
        { status: 400 }
      );
    }

    if (role && role !== "admin" && role !== "viewer") {
      return NextResponse.json(
        { error: "Il ruolo deve essere 'admin' o 'viewer'" },
        { status: 400 }
      );
    }

    // Verifica che lo username non sia già in uso
    const existing = getUserByUsername(username);
    if (existing) {
      return NextResponse.json(
        { error: "Username già in uso" },
        { status: 409 }
      );
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const validRole = (role === "admin" || role === "viewer") ? role : "viewer";
    const user = createUser(username, passwordHash, validRole);

    // Restituisci utente senza password_hash
    const { password_hash: _, ...safeUser } = user;
    return NextResponse.json(safeUser, { status: 201 });
  } catch (error) {
    console.error("Errore creazione utente:", error);
    return NextResponse.json(
      { error: "Errore nella creazione dell'utente" },
      { status: 500 }
    );
  }
}
