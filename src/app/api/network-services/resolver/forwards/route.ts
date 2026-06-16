import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requireAdmin } from "@/lib/api-auth";
import { netServices, BridgeUnavailableError } from "@/lib/network-services/client";

const TargetRE = /^[a-fA-F0-9:.]+(@\d{1,5})?$/;
const ZoneRE = /^[a-zA-Z0-9._-]+$/;

const AddSchema = z.object({
  zone: z.string().regex(ZoneRE, "zone must match [a-zA-Z0-9._-]+"),
  targets: z.array(z.string().regex(TargetRE)).min(1).max(8),
});

const DeleteSchema = z.object({
  zone: z.string().regex(ZoneRE),
});

export async function GET() {
  const session = await requireAuth();
  if (session instanceof NextResponse) return session;

  try {
    const res = await netServices.resolverStatus();
    return NextResponse.json({ ok: true, status: res });
  } catch (e) {
    if (e instanceof BridgeUnavailableError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 503 });
    }
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const session = await requireAdmin();
  if (session instanceof NextResponse) return session;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = AddSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  try {
    return NextResponse.json(await netServices.addForwardZone(parsed.data.zone, parsed.data.targets));
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
  const parsed = DeleteSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  try {
    return NextResponse.json(await netServices.removeForwardZone(parsed.data.zone));
  } catch (e) {
    if (e instanceof BridgeUnavailableError) return NextResponse.json({ error: e.message }, { status: 503 });
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
