/**
 * Restituisce il contenuto dello script di provisioning Wazuh per la UI.
 *
 * Sorgente: scripts/setup-wazuh-integration.sh
 * Lettura sola — admin only — usato dalla sezione "Setup guidato" della
 * card Wazuh per copy-paste sul server Wazuh.
 */
import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { requireAdmin, isAuthError } from "@/lib/api-auth";

export async function GET() {
  const adminCheck = await requireAdmin();
  if (isAuthError(adminCheck)) return adminCheck;

  const scriptPath = path.join(process.cwd(), "scripts", "setup-wazuh-integration.sh");
  const playbookPath = path.join(process.cwd(), "docs", "playbooks", "wazuh-integration.md");

  const [script, playbook] = await Promise.all([
    fs.readFile(scriptPath, "utf8").catch(() => ""),
    fs.readFile(playbookPath, "utf8").catch(() => ""),
  ]);

  return NextResponse.json({
    script,
    playbook,
    scriptName: "setup-wazuh-integration.sh",
    playbookName: "docs/playbooks/wazuh-integration.md",
  });
}
