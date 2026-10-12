import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { deleteUserAs, updateUserAs } from "@/lib/users/service";

/** Modifica ed eliminazione di un utente: regole nel servizio `@/lib/users/service` (UI-18). */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAdmin();
    if (isAuthError(session)) return session;

    const { id } = await params;
    const result = await updateUserAs(session, id, request);
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error("Errore aggiornamento utente:", error);
    return NextResponse.json(
      { error: "Errore nell'aggiornamento dell'utente" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAdmin();
    if (isAuthError(session)) return session;

    const { id } = await params;
    const result = deleteUserAs(session, id);
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error("Errore eliminazione utente:", error);
    return NextResponse.json(
      { error: "Errore nell'eliminazione dell'utente" },
      { status: 500 }
    );
  }
}
