import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requireAdmin } from "@/lib/api-auth";
import { netServices, BridgeUnavailableError } from "@/lib/network-services/client";

const RuleSchema = z.object({
  rule: z.string().min(1).max(500),
});

export async function GET() {
  const session = await requireAuth();
  if (session instanceof NextResponse) return session;
  try {
    return NextResponse.json({ ok: true, ...(await netServices.adblockRules()) });
  } catch (e) {
    if (e instanceof BridgeUnavailableError) return NextResponse.json({ ok: false, error: e.message }, { status: 503 });
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const session = await requireAdmin();
  if (session instanceof NextResponse) return session;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = RuleSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  try {
    return NextResponse.json(await netServices.addAdblockRule(parsed.data.rule));
  } catch (e) {
    if (e instanceof BridgeUnavailableError) return NextResponse.json({ error: e.message }, { status: 503 });
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const session = await requireAdmin();
  if (session instanceof NextResponse) return session;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = RuleSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  try {
    return NextResponse.json(await netServices.removeAdblockRule(parsed.data.rule));
  } catch (e) {
    if (e instanceof BridgeUnavailableError) return NextResponse.json({ error: e.message }, { status: 503 });
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
