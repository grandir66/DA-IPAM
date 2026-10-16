import { requireAdmin } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { runMdmSync } from "@/lib/integrations/mdm-runner";

export async function POST() {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;
  // G5: via withTenantFromSession → in vista aggregata (__ALL__) ritorna 409 invece di
  // scrivere silenziosamente su DEFAULT (prima usava getServerTenantCode che rimappava).
  const result = await withTenantFromSession(() => runMdmSync());
  if (result instanceof Response) return result;
  return Response.json(result);
}
