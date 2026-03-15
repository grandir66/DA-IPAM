import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { resetConfiguration } from "@/lib/db";

export async function POST() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
    }
    const user = session.user as { role?: string };
    if (user.role !== "admin") {
      return NextResponse.json({ error: "Solo gli amministratori possono resettare la configurazione" }, { status: 403 });
    }

    resetConfiguration();
    return NextResponse.json({ success: true, message: "Configurazione resettata" });
  } catch (error) {
    console.error("Reset configuration error:", error);
    return NextResponse.json(
      { error: "Errore durante il reset della configurazione" },
      { status: 500 }
    );
  }
}
