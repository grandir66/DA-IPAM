import { motivoPasswordDebole } from "@/lib/accesso/password-debole";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { updateUserPassword } from "@/lib/db";
// Dall'hub, non dalla facciata: serve il segno `emergenza` della riga.
import { getUserByUsername } from "@/lib/db-hub";
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
    // L'accesso d'emergenza vale una volta: con una password sua diventerebbe un ingresso stabile senza codice
    // (analisi del 15/11/2026). Chi è entrato così reimposta l'utente vero dalla pagina Utenti.
    if (user.emergenza === 1) {
      return NextResponse.json({ error: "L'accesso d'emergenza non ha una password da cambiare: reimposta quella del tuo utente dalla pagina Utenti" }, { status: 403 });
    }
    const debole = motivoPasswordDebole(new_password, user.username);
    if (debole) return NextResponse.json({ error: debole }, { status: 400 });

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
