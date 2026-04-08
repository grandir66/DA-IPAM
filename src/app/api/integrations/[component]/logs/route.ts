import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { execFile } from "child_process";
import { promisify } from "util";
import { getIntegrationConfig } from "@/lib/integrations/config";
import type { IntegrationComponent } from "@/lib/integrations/types";

const execFileAsync = promisify(execFile);
const VALID_COMPONENTS: IntegrationComponent[] = ["librenms", "loki", "graylog"];

/** Percorsi dei file di log applicativi per componente */
const APP_LOG_PATHS: Partial<Record<IntegrationComponent, string>> = {
  librenms: "/opt/librenms/logs/librenms.log",
};

async function tryExec(cmd: string, args: string[]): Promise<string> {
  try {
    const r = await execFileAsync(cmd, args, { timeout: 15_000, maxBuffer: 4 * 1024 * 1024 });
    return (r.stderr || r.stdout || "").trim();
  } catch (err) {
    const e = err as { stderr?: string; stdout?: string; message?: string };
    return (e.stderr || e.stdout || e.message || "").trim();
  }
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ component: string }> }
) {
  const authError = await requireAdmin();
  if (isAuthError(authError)) return authError;

  const { component: raw } = await params;
  if (!VALID_COMPONENTS.includes(raw as IntegrationComponent)) {
    return NextResponse.json({ error: "Componente non valido" }, { status: 400 });
  }
  const component = raw as IntegrationComponent;

  const url = new URL(req.url);
  const lines = Math.min(parseInt(url.searchParams.get("lines") ?? "200"), 500);
  const source = url.searchParams.get("source") ?? "docker"; // "docker" | "app"

  const cfg = getIntegrationConfig(component);
  const containerName = cfg.containerName ?? `da-${component}`;

  let output = "";

  if (source === "app" && APP_LOG_PATHS[component]) {
    // Legge il log applicativo direttamente dal container
    output = await tryExec("docker", [
      "exec", containerName,
      "tail", "-n", String(lines), APP_LOG_PATHS[component]!,
    ]);
    if (!output) output = "(log applicativo vuoto o non ancora creato)";
  } else {
    // Log container Docker (stdout+stderr)
    output = await tryExec("docker", ["logs", "--tail", String(lines), containerName]);
    if (!output) output = "(nessun output dal container)";
  }

  return NextResponse.json({ logs: output, containerName, source });
}
