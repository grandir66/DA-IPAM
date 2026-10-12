import { NextResponse } from "next/server";
import { z } from "zod";
import { upsertTopologyPositions } from "@/lib/db";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";

const BodySchema = z.object({
  view: z.string().min(1).default("default"),
  positions: z
    .array(
      z.object({
        nodeId: z.string().min(1),
        x: z.number(),
        y: z.number(),
        pinned: z.boolean().default(true),
      }),
    )
    .max(5000),
});

export async function PUT(request: Request) {
  return withTenantFromSession(async () => {
    const authCheck = await requireAuth();
    if (isAuthError(authCheck)) return authCheck;
    try {
      const parsed = BodySchema.safeParse(await request.json());
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
      }
      upsertTopologyPositions(parsed.data.view, parsed.data.positions);
      return NextResponse.json({ ok: true });
    } catch (error) {
      console.error("Error saving positions:", error);
      return NextResponse.json({ error: "Errore nel salvataggio posizioni" }, { status: 500 });
    }
  });
}
