import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/api-auth";
import { netServices, BridgeUnavailableError } from "@/lib/network-services/client";

const ALLOWED = ["resolver", "adblock", "dns", "dhcp"] as const;
const PayloadSchema = z.object({ enable: z.boolean() });

export async function POST(
  req: Request,
  { params }: { params: Promise<{ service: string }> },
) {
  const session = await requireAdmin();
  if (session instanceof NextResponse) return session;

  const { service } = await params;
  if (!ALLOWED.includes(service as (typeof ALLOWED)[number])) {
    return NextResponse.json({ error: `service must be one of ${ALLOWED.join(", ")}` }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = PayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  }

  try {
    const result = await netServices.toggle(
      service as (typeof ALLOWED)[number],
      parsed.data.enable,
    );
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof BridgeUnavailableError) {
      return NextResponse.json({ error: e.message }, { status: 503 });
    }
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
