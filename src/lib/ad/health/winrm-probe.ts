/**
 * Optional WinRM probes against the AD integration DC (Phase 5b).
 * Best-effort: never throws to caller — returns status unavailable/skipped.
 */

import { decrypt } from "@/lib/crypto";
import { getAdIntegrationById, getCredentialById } from "@/lib/db";
import { runWinrmCommand } from "@/lib/devices/winrm-run";
import type { WinrmProbeResult } from "./types";

/** High-signal KBs often referenced in AD assessments (presence check). */
export const CRITICAL_HOTFIX_KBS = [
  "KB3011780", // MS14-068 Kerberos
  "KB4012212", // MS17-010 (Win7/2008R2 example)
  "KB4012215", // MS17-010 (2012)
  "KB4012598", // MS17-010
] as const;

function skipped(reason?: string): WinrmProbeResult {
  return {
    configured: false,
    status: "skipped",
    errorMessage: reason,
    lastHotfixAt: null,
    missingCriticalKbs: [],
    cpasswordPaths: [],
    durationMs: 0,
  };
}

function unavailable(message: string, started: number): WinrmProbeResult {
  return {
    configured: true,
    status: "unavailable",
    errorMessage: message,
    lastHotfixAt: null,
    missingCriticalKbs: [],
    cpasswordPaths: [],
    durationMs: Date.now() - started,
  };
}

/**
 * Pure helper: parse probe JSON from PowerShell.
 */
export function parseWinrmProbeJson(raw: string): {
  lastHotfixAt: string | null;
  installedKbs: string[];
  cpasswordPaths: string[];
} {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { lastHotfixAt: null, installedKbs: [], cpasswordPaths: [] };
  }
  // PowerShell may emit BOM / noise before JSON
  const start = trimmed.indexOf("{");
  const json = start >= 0 ? trimmed.slice(start) : trimmed;
  const parsed = JSON.parse(json) as {
    lastHotfixAt?: string | null;
    installedKbs?: string[];
    cpasswordPaths?: string[];
  };
  return {
    lastHotfixAt: parsed.lastHotfixAt ?? null,
    installedKbs: Array.isArray(parsed.installedKbs)
      ? parsed.installedKbs.map(String)
      : [],
    cpasswordPaths: Array.isArray(parsed.cpasswordPaths)
      ? parsed.cpasswordPaths.map(String)
      : [],
  };
}

export function missingCriticalKbs(installed: string[]): string[] {
  const set = new Set(installed.map((k) => k.toUpperCase()));
  return CRITICAL_HOTFIX_KBS.filter((kb) => !set.has(kb));
}

const PROBE_PS = `
$ErrorActionPreference = 'SilentlyContinue'
$kbs = @()
try { $kbs = @(Get-HotFix | Select-Object -ExpandProperty HotFixID) } catch {}
$last = $null
try {
  $hf = Get-HotFix | Where-Object { $_.InstalledOn } | Sort-Object InstalledOn | Select-Object -Last 1
  if ($hf -and $hf.InstalledOn) { $last = $hf.InstalledOn.ToUniversalTime().ToString('o') }
} catch {}
$cp = @()
try {
  $dom = $env:USERDNSDOMAIN
  if ($dom) {
    $root = "\\\\$dom\\SYSVOL\\$dom\\Policies"
    if (Test-Path $root) {
      $cp = @(Get-ChildItem -Path $root -Recurse -Filter '*.xml' -ErrorAction SilentlyContinue |
        Select-String -Pattern 'cpassword' -SimpleMatch -List -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty Path -Unique |
        Select-Object -First 30)
    }
  }
} catch {}
@{ lastHotfixAt = $last; installedKbs = $kbs; cpasswordPaths = $cp } | ConvertTo-Json -Compress
`.trim();

export async function collectWinrmProbe(integrationId: number): Promise<WinrmProbeResult> {
  const started = Date.now();
  const integration = getAdIntegrationById(integrationId);
  if (!integration) return skipped("integration missing");
  if (!integration.winrm_credential_id) return skipped();

  const cred = getCredentialById(integration.winrm_credential_id);
  if (!cred) return unavailable("WinRM credential not found", started);

  let username: string;
  let password: string;
  try {
    username = cred.encrypted_username ? decrypt(cred.encrypted_username) : "";
    password = cred.encrypted_password ? decrypt(cred.encrypted_password) : "";
  } catch {
    return unavailable("Cannot decrypt WinRM credentials", started);
  }

  try {
    const raw = await runWinrmCommand(
      integration.dc_host,
      5985,
      username,
      password,
      PROBE_PS,
      true,
      integration.domain || "",
    );
    const parsed = parseWinrmProbeJson(raw);
    return {
      configured: true,
      status: "ok",
      lastHotfixAt: parsed.lastHotfixAt,
      missingCriticalKbs: missingCriticalKbs(parsed.installedKbs),
      cpasswordPaths: parsed.cpasswordPaths.slice(0, 30),
      durationMs: Date.now() - started,
    };
  } catch (err) {
    return unavailable(err instanceof Error ? err.message : String(err), started);
  }
}
