import { NextResponse } from "next/server";
import { KnownHostRunCheckSchema } from "@/lib/validators";
import { runKnownHostCheck } from "@/lib/cron/jobs";
import { requireAdmin, isAuthError } from "@/lib/api-auth";

/**
 * Esegue subito il controllo ping/TCP sugli host conosciuti (come il job known_host_check).
 * Può richiedere tempo se molti host.
 */
export async function POST(request: Request) {
  try {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;
    let networkId: number | null = null;
    try {
      const body = await request.json();
      const parsed = KnownHostRunCheckSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
      }
      networkId = parsed.data.network_id ?? null;
    } catch {
      networkId = null;
    }
    await runKnownHostCheck(networkId);
    return NextResponse.json({ success: true, message: "Verifica host conosciuti completata" });
  } catch (error) {
    console.error("Known host run-check error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Errore durante la verifica" },
      { status: 500 }
    );
  }
}
