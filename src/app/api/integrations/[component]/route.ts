import { NextResponse } from "next/server";
import { requireAuth, requireAdmin, isAuthError } from "@/lib/api-auth";
import { getIntegrationConfig, setIntegrationConfig } from "@/lib/integrations/config";
import { mascheraConfigIntegrazione, puoVedereSegreti } from "@/lib/permessi/politica";
import { getContainerStatus } from "@/lib/integrations/docker";
import { resolveIntegrationBrowserUrl } from "@/lib/integrations/public-url-server";
import type { IntegrationComponent } from "@/lib/integrations/types";
import { z } from "zod";

const VALID_COMPONENTS: IntegrationComponent[] = ["librenms", "loki", "graylog"];

/**
 * UniFi non passa più da qui (ADR 0007): i controller sono righe del DB del
 * cliente, gestite da /api/controllers. Scrivere qui la configurazione unica
 * dell'hub non farebbe niente, e lo si dice invece di accettarla in silenzio.
 */
function unifiMoved(): NextResponse {
  return NextResponse.json(
    { error: "I controller UniFi si gestiscono da Rete → Controller di rete (/api/controllers)" },
    { status: 410 },
  );
}

function parseComponent(raw: string): IntegrationComponent | null {
  return VALID_COMPONENTS.includes(raw as IntegrationComponent)
    ? (raw as IntegrationComponent)
    : null;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ component: string }> }
) {
  const session = await requireAuth();
  if (isAuthError(session)) return session;

  const { component: raw } = await params;
  if (raw === "unifi") return unifiMoved();
  const component = parseComponent(raw);
  if (!component) return NextResponse.json({ error: "Componente non valido" }, { status: 400 });

  const cfg = getIntegrationConfig(component);

  let containerStatus = null;
  if (cfg.mode === "managed" && cfg.containerName) {
    containerStatus = await getContainerStatus(cfg.containerName);
  }

  return NextResponse.json({
    component,
    // Questo GET basta a un utente in sola lettura: i segreti solo all'admin (SEC-5).
    config: mascheraConfigIntegrazione(cfg, puoVedereSegreti(session.user.role)),
    browserUrl: cfg.browserUrl ?? resolveIntegrationBrowserUrl(component, cfg.url),
    containerStatus,
  });
}

const ConfigSchema = z.object({
  mode: z.enum(["managed", "external", "disabled"]).optional(),
  url: z.string().optional(),
  apiToken: z.string().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  containerName: z.string().optional(),
  uiUrl: z.string().optional(),
});

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ component: string }> }
) {
  const authError = await requireAdmin();
  if (isAuthError(authError)) return authError;

  const { component: raw } = await params;
  if (raw === "unifi") return unifiMoved();
  const component = parseComponent(raw);
  if (!component) return NextResponse.json({ error: "Componente non valido" }, { status: 400 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON non valido" }, { status: 400 });
  }

  const parsed = ConfigSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dati non validi" }, { status: 400 });
  }

  setIntegrationConfig(component, parsed.data);
  return NextResponse.json({ ok: true });
}
