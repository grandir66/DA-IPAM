import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import {
  getCredential,
  getCredentialSecrets,
  logCredentialEvent,
} from "@/lib/credentials-vault";

/**
 * Reveal plaintext secrets per una credenziale.
 * RICHIEDE ADMIN. Ogni reveal viene loggato in system_credential_events.
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireAdmin();
  if (session instanceof NextResponse) return session;

  const { id: idStr } = await ctx.params;
  const id = Number(idStr);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "id invalido" }, { status: 400 });
  }

  const meta = getCredential(id);
  if (!meta) return NextResponse.json({ error: "not found" }, { status: 404 });

  const secrets = getCredentialSecrets(id);
  logCredentialEvent({
    credentialId: id,
    action: "reveal",
    actorUsername: session.user.name ?? null,
    result: "ok",
    details: { kind: meta.kind, label: meta.label },
  });
  return NextResponse.json({
    id,
    label: meta.label,
    url: meta.url,
    username: meta.username,
    password: secrets?.password ?? null,
    api_token: secrets?.api_token ?? null,
    extra: secrets?.extra ?? null,
  });
}
