import { NextResponse } from "next/server";
import { requireAuth, requireAdmin, isAuthError } from "@/lib/api-auth";
import { getIntegrationConfig, setIntegrationConfig } from "@/lib/integrations/config";
import { getContainerStatus } from "@/lib/integrations/docker";
import type { IntegrationComponent } from "@/lib/integrations/types";
import { z } from "zod";

const VALID_COMPONENTS: IntegrationComponent[] = ["librenms", "loki", "graylog"];

function parseComponent(raw: string): IntegrationComponent | null {
  return VALID_COMPONENTS.includes(raw as IntegrationComponent)
    ? (raw as IntegrationComponent)
    : null;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ component: string }> }
) {
  const authError = await requireAuth();
  if (isAuthError(authError)) return authError;

  const { component: raw } = await params;
  const component = parseComponent(raw);
  if (!component) return NextResponse.json({ error: "Componente non valido" }, { status: 400 });

  const cfg = getIntegrationConfig(component);

  let containerStatus = null;
  if (cfg.mode === "managed" && cfg.containerName) {
    containerStatus = await getContainerStatus(cfg.containerName);
  }

  return NextResponse.json({ component, config: cfg, containerStatus });
}

const ConfigSchema = z.object({
  mode: z.enum(["managed", "external", "disabled"]).optional(),
  url: z.string().optional(),
  apiToken: z.string().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  containerName: z.string().optional(),
});

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ component: string }> }
) {
  const authError = await requireAdmin();
  if (isAuthError(authError)) return authError;

  const { component: raw } = await params;
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
