import { requireAuth } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getMobileDetailByHost } from "@/lib/integrations/mdm-sync";

export async function GET(_req: Request, { params }: { params: Promise<{ hostId: string }> }) {
  const auth = await requireAuth();
  if (auth instanceof Response) return auth;
  const { hostId } = await params;
  const detail = await withTenantFromSession(() => getMobileDetailByHost(Number(hostId)));
  return Response.json({ detail });
}
