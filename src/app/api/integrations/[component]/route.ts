import { NextResponse } from "next/server";
import { requireAuth, requireAdmin, isAuthError } from "@/lib/api-auth";
import { getIntegrationConfig, setIntegrationConfig } from "@/lib/integrations/config";
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
  const authError = await requireAuth();
  if (isAuthError(authError)) return authError;

  const { component: raw } = await params;
  const component = parseComponent(raw);
  if (!component) return NextResponse.json({ error: "Componente non valido" }, { status: 400 });

  const cfg = getIntegrationConfig(component);

  if (component === "unifi") {
    // Le credenziali del controller non tornano al browser (questo GET basta
    // a un utente in sola lettura): si dice solo se sono impostate.
    const { password, apiToken, ...visible } = cfg;
    return NextResponse.json({
      component,
      config: {
        ...visible,
        password: "",
        apiToken: "",
        passwordSet: !!password,
        apiTokenSet: !!apiToken,
      },
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
    config: cfg,
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
    if (url && !/^https?:\/\/[^/\s]+/i.test(url)) {
      return NextResponse.json(
        { error: "L'indirizzo del controller deve iniziare con https:// (es. https://192.168.1.10:8443)" },
        { status: 400 },
      );
    }
  }

  setIntegrationConfig(component, parsed.data);
  return NextResponse.json({ ok: true });
}
