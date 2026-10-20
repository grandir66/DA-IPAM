import { requireAuth, requireAdmin, isAuthError } from "@/lib/api-auth";
import { rispostaAgenteTolto } from "@/lib/agente-remoto-tolto";

/** Agente Python remoto tolto il 20/10/2026: rotta ferma (410), il perché in `lib/agente-remoto-tolto.ts`. */
export async function GET() {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  return rispostaAgenteTolto();
}

export async function POST() {
  const auth = await requireAdmin();
  if (isAuthError(auth)) return auth;
  return rispostaAgenteTolto();
}
