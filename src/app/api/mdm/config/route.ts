import { requireAdmin } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getCurrentTenantCode } from "@/lib/db-tenant";
import { reloadTenantScheduler } from "@/lib/cron/scheduler";
import { getMdmConfig, saveMdmConfig } from "@/lib/integrations/mdm-config";
import { z } from "zod";

export async function GET() {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;
  const config = await withTenantFromSession(() => getMdmConfig());
  if (config instanceof Response) return config;
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
    return Response.json({ error: "JSON non valido" }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.issues }, { status: 400 });
  // Passo 3 (16/10): il salvataggio allinea anche il job mdm_sync all'interruttore;
  // se il job è cambiato, lo scheduler del tenant si ricarica (come per Wazuh).
  const esito = await withTenantFromSession(() => {
    const r = saveMdmConfig(parsed.data);
    const tenantCode = getCurrentTenantCode();
    if (tenantCode && r.job !== "invariato" && r.job !== "assente") {
      reloadTenantScheduler(tenantCode);
    }
    return r;
  });
  // Vista aggregata o tenant non risolto: la risposta d'errore di withTenantFromSession.
  if (esito instanceof Response) return esito;
  return Response.json({ ok: true, ...esito });
}
