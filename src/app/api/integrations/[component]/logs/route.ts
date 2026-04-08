import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { execFile } from "child_process";
import { promisify } from "util";
import { getIntegrationConfig } from "@/lib/integrations/config";
import type { IntegrationComponent } from "@/lib/integrations/types";

const execFileAsync = promisify(execFile);
const VALID_COMPONENTS: IntegrationComponent[] = ["librenms", "loki", "graylog"];

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

  const cfg = getIntegrationConfig(component);
  const containerName = cfg.containerName ?? `da-${component}`;

  try {
    const { stdout, stderr } = await execFileAsync(
      "docker",
      ["logs", "--tail", String(lines), containerName],
      { timeout: 15_000, maxBuffer: 2 * 1024 * 1024 }
    );
    // docker logs scrive su stderr per design
    const output = (stderr || stdout || "").trim();
    return NextResponse.json({ logs: output, containerName });
  } catch (err) {
    const e = err as { stderr?: string; stdout?: string; message?: string };
    const output = (e.stderr || e.stdout || e.message || "Errore").trim();
    return NextResponse.json({ logs: output, containerName }, { status: 200 });
  }
}
