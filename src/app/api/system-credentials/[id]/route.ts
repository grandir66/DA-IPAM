import { NextResponse } from "next/server";
import { AggiornaCredenzialeSchema as UpdateSchema } from "@/lib/credentials-vault-tipi";
import { requireAuth, requireAdmin } from "@/lib/api-auth";
import {
  getCredential,
  updateCredential,
  deleteCredential,
  logCredentialEvent,
} from "@/lib/credentials-vault";

type Ctx = { params: Promise<{ id: string }> };

async function parseId(ctx: Ctx): Promise<number | null> {
  const { id } = await ctx.params;
  const n = Number(id);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function GET(_req: Request, ctx: Ctx) {
  const session = await requireAuth();
  if (session instanceof NextResponse) return session;
  const id = await parseId(ctx);
  if (id === null) return NextResponse.json({ error: "id invalido" }, { status: 400 });
  const item = getCredential(id);
  if (!item) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ item });
}

export async function PUT(req: Request, ctx: Ctx) {
  const session = await requireAdmin();
  if (session instanceof NextResponse) return session;
  const id = await parseId(ctx);
  if (id === null) return NextResponse.json({ error: "id invalido" }, { status: 400 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  }
  const updated = updateCredential(id, parsed.data);
  if (!updated) return NextResponse.json({ error: "not found" }, { status: 404 });

  logCredentialEvent({
    credentialId: id,
    action: "update",
    actorUsername: session.user.name ?? null,
    result: "ok",
    details: { fields: Object.keys(parsed.data) },
  });
  return NextResponse.json({ item: updated });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const session = await requireAdmin();
  if (session instanceof NextResponse) return session;
  const id = await parseId(ctx);
  if (id === null) return NextResponse.json({ error: "id invalido" }, { status: 400 });
  const existing = getCredential(id);
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  logCredentialEvent({
    credentialId: id,
    action: "delete",
    actorUsername: session.user.name ?? null,
    result: "ok",
    details: { kind: existing.kind, label: existing.label },
  });
  deleteCredential(id);
  return NextResponse.json({ ok: true });
}
