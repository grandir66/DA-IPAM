import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { execDockerCommand } from "@/lib/integrations/docker";
import { getIntegrationConfig } from "@/lib/integrations/config";
import type { IntegrationComponent } from "@/lib/integrations/types";
import { z } from "zod";

const VALID_COMPONENTS: IntegrationComponent[] = ["librenms", "loki", "graylog"];

function parseComponent(raw: string): IntegrationComponent | null {
  return VALID_COMPONENTS.includes(raw as IntegrationComponent)
    ? (raw as IntegrationComponent)
    : null;
}

const ActionSchema = z.object({
  action: z.enum(["start", "stop", "restart", "remove", "remove-all"]),
});

/** Tutti i container da rimuovere per ogni componente (principale + dipendenze) */
function getAllContainers(component: IntegrationComponent, containerName: string): string[] {
  if (component === "librenms") {
    return [containerName, `${containerName}-db`, `${containerName}-redis`];
  }
  if (component === "graylog") {
    return [containerName, "da-graylog-opensearch", "da-graylog-mongo"];
  }
  return [containerName]; // loki: solo un container
}

export async function POST(
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

  const parsed = ActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dati non validi" }, { status: 400 });
  }

  const cfg = getIntegrationConfig(component);
  if (cfg.mode !== "managed") {
    return NextResponse.json({ error: "Solo le istanze managed supportano questa azione" }, { status: 400 });
  }

  const containerName = cfg.containerName ?? `da-${component}`;
  const { action } = parsed.data;

  try {
    if (action === "start") {
      await execDockerCommand(["start", containerName]);
    } else if (action === "stop") {
      await execDockerCommand(["stop", containerName]);
    } else if (action === "restart") {
      await execDockerCommand(["restart", containerName]);
    } else if (action === "remove") {
      await execDockerCommand(["rm", "-f", containerName]);
    } else if (action === "remove-all") {
      // Rimuove tutti i container + rete Docker associata
      const all = getAllContainers(component, containerName);
      for (const c of all) {
        try { await execDockerCommand(["rm", "-f", c]); } catch { /* già rimosso */ }
      }
      // Rimuovi anche la rete Docker dedicata se esiste
      const network = component === "librenms" ? "da-librenms-net"
                    : component === "graylog"  ? "da-graylog-net"
                    : null;
      if (network) {
        try { await execDockerCommand(["network", "rm", network]); } catch { /* non esisteva */ }
      }
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
