import { requireAdmin } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getMdmConfig, saveMdmConfig } from "@/lib/integrations/mdm-config";
import { z } from "zod";

export async function GET() {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;
  const config = await withTenantFromSession(() => getMdmConfig());
  return Response.json({ config });
}

const schema = z.object({
  base_url: z.string().url(),
  username: z.string().min(1),
  password: z.string().optional(),
  user_field: z.enum(["description", "custom1", "custom2", "custom3"]).optional(),
  enabled: z.boolean().optional(),
});

export async function PUT(req: Request) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.issues }, { status: 400 });
  await withTenantFromSession(() => saveMdmConfig(parsed.data));
  return Response.json({ ok: true });
}
