/**
 * Restituisce il contenuto dello script di provisioning Wazuh per la UI.
 *
 * Sorgente: scripts/setup-wazuh-integration.sh
 * Lettura sola — admin only — usato dalla sezione "Setup guidato" della
 * card Wazuh per copy-paste sul server Wazuh.
 */
import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { unisci } from "@/lib/percorsi";

export async function GET() {
  const adminCheck = await requireAdmin();
  if (isAuthError(adminCheck)) return adminCheck;

  const scriptPath = unisci(process.cwd(), "scripts", "setup-wazuh-integration.sh");
  const playbookPath = unisci(process.cwd(), "docs", "playbooks", "wazuh-integration.md");

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
