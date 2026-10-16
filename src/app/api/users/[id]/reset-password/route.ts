import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { resetPasswordAs } from "@/lib/users/service";

/** Reimpostazione della password di un utente: regole nel servizio `@/lib/users/service` (UI-18). */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAdmin();
    if (isAuthError(session)) return session;

    const { id } = await params;
    const result = await resetPasswordAs(session, id, request);
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error("Errore reset password:", error);
    return NextResponse.json(
      { error: "Errore nel reset password" },
      { status: 500 }
    );
  }
}
