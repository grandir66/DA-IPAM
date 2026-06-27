import { requireAdmin } from "@/lib/api-auth";
import { getServerTenantCode } from "@/lib/api-tenant";
import { withTenant } from "@/lib/db-tenant";
import { runMdmSync } from "@/lib/integrations/mdm-runner";

export async function POST() {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;
  const code = await getServerTenantCode();
  const result = await withTenant(code, () => runMdmSync());
  return Response.json(result);
}
