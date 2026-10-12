import { NextResponse } from "next/server";
import { requireAuth, requireAdmin, isAuthError } from "@/lib/api-auth";
import { getIntegrationConfig, setIntegrationConfig } from "@/lib/integrations/config";
import { mascheraConfigIntegrazione, puoVedereSegreti } from "@/lib/permessi/politica";
import { getContainerStatus } from "@/lib/integrations/docker";
import { resolveIntegrationBrowserUrl } from "@/lib/integrations/public-url-server";
import type { IntegrationComponent } from "@/lib/integrations/types";
import { z } from "zod";

const VALID_COMPONENTS: IntegrationComponent[] = ["librenms", "loki", "graylog", "unifi"];

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
  const component = parseComponent(raw);
  if (!component) return NextResponse.json({ error: "Componente non valido" }, { status: 400 });

  const cfg = getIntegrationConfig(component);

  if (component === "unifi") {
    // Le credenziali del controller non tornano al browser, nemmeno all'admin
    // (la UnifiCard lavora coi soli flag «impostato»).
    return NextResponse.json({
      component,
      config: mascheraConfigIntegrazione(cfg, false),
      browserUrl: cfg.browserUrl ?? "",
      containerStatus: null,
    });
  }

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
  // solo unifi
  kind: z.enum(["self_hosted", "udm", "cloud"]).optional(),
  site: z
    .string()
    .trim()
    .max(64, "Nome del site troppo lungo")
    .regex(/^[A-Za-z0-9_-]*$/, "Nome del site non valido: solo lettere, cifre, - e _")
    .optional(),
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

  if (component === "unifi") {
    if (parsed.data.mode === "managed") {
      return NextResponse.json(
        { error: "UniFi non ha una modalità gestita: usare «external» o «disabled»" },
        { status: 400 },
      );
    }
    const url = parsed.data.url?.trim();
    if (url && !/^https:\/\/[^/\s]+/i.test(url)) {
      return NextResponse.json(
        { error: "L'indirizzo del controller deve iniziare con https:// (es. https://192.168.1.10:8443)" },
        { status: 400 },
      );
    }
  }

  setIntegrationConfig(component, parsed.data);
  return NextResponse.json({ ok: true });
}
