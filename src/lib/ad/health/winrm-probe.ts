/**
 * Optional WinRM probes against the AD integration DC (Phase 5b / 6).
 * Best-effort: never throws to caller — returns status unavailable/skipped.
 */

import { decrypt } from "@/lib/crypto";
import { getAdIntegrationById, getCredentialById } from "@/lib/db";
import { runWinrmCommand } from "@/lib/devices/winrm-run";
import type { DcHardeningProbe, WinrmProbeResult } from "./types";

/** High-signal KBs often referenced in AD assessments (presence check). */
export const CRITICAL_HOTFIX_KBS = [
  "KB3011780", // MS14-068 Kerberos
  "KB4012212", // MS17-010 (Win7/2008R2 example)
  "KB4012215", // MS17-010 (2012)
  "KB4012598", // MS17-010
] as const;

const EMPTY_HARDENING: DcHardeningProbe = {
  ldapServerIntegrity: null,
  ldapEnforceChannelBinding: null,
  smbRequireSecuritySignature: null,
  lmCompatibilityLevel: null,
  wdigestUseLogonCredential: null,
  spoolerRunning: null,
};

function skipped(reason?: string): WinrmProbeResult {
  return {
    configured: false,
    status: "skipped",
    errorMessage: reason,
    lastHotfixAt: null,
    missingCriticalKbs: [],
    cpasswordPaths: [],
    durationMs: 0,
    hardening: null,
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
    hardening: null,
  };
}

function asNullableNumber(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseInt(String(v), 10);
  return Number.isNaN(n) ? null : n;
}

function asNullableBool(v: unknown): boolean | null {
  if (v == null) return null;
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.toLowerCase();
    if (s === "true" || s === "running") return true;
    if (s === "false" || s === "stopped") return false;
  }
  return null;
}

/**
 * Pure helper: parse probe JSON from PowerShell.
 */
export function parseWinrmProbeJson(raw: string): {
  lastHotfixAt: string | null;
  installedKbs: string[];
  cpasswordPaths: string[];
  hardening: DcHardeningProbe;
} {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {
      lastHotfixAt: null,
      installedKbs: [],
      cpasswordPaths: [],
      hardening: { ...EMPTY_HARDENING },
    };
  }
  // PowerShell may emit BOM / noise before JSON
  const start = trimmed.indexOf("{");
  const json = start >= 0 ? trimmed.slice(start) : trimmed;
  const parsed = JSON.parse(json) as {
    lastHotfixAt?: string | null;
    installedKbs?: string[];
    cpasswordPaths?: string[];
    hardening?: Record<string, unknown>;
  };
  const h = parsed.hardening ?? {};
  return {
    lastHotfixAt: parsed.lastHotfixAt ?? null,
    installedKbs: Array.isArray(parsed.installedKbs)
      ? parsed.installedKbs.map(String)
      : [],
    cpasswordPaths: Array.isArray(parsed.cpasswordPaths)
      ? parsed.cpasswordPaths.map(String)
      : [],
    hardening: {
      ldapServerIntegrity: asNullableNumber(h.ldapServerIntegrity),
      ldapEnforceChannelBinding: asNullableNumber(h.ldapEnforceChannelBinding),
      smbRequireSecuritySignature: asNullableNumber(
        h.smbRequireSecuritySignature,
      ),
      lmCompatibilityLevel: asNullableNumber(h.lmCompatibilityLevel),
      wdigestUseLogonCredential: asNullableNumber(h.wdigestUseLogonCredential),
      spoolerRunning: asNullableBool(h.spoolerRunning),
    },
  };
}

export function missingCriticalKbs(installed: string[]): string[] {
  const set = new Set(installed.map((k) => k.toUpperCase()));
  return CRITICAL_HOTFIX_KBS.filter((kb) => !set.has(kb));
}

const PROBE_PS = `
$ErrorActionPreference = 'SilentlyContinue'
function Get-RegInt([string]$Path, [string]$Name) {
  try {
    $p = Get-ItemProperty -Path $Path -Name $Name -ErrorAction Stop
    return [int]$p.$Name
  } catch { return $null }
}
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
$spooler = $null
try { $spooler = ((Get-Service -Name Spooler -ErrorAction Stop).Status -eq 'Running') } catch {}
$hardening = @{
  ldapServerIntegrity = Get-RegInt 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\NTDS\\Parameters' 'LDAPServerIntegrity'
  ldapEnforceChannelBinding = Get-RegInt 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\NTDS\\Parameters' 'LDAPEnforceChannelBinding'
  smbRequireSecuritySignature = Get-RegInt 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\LanmanServer\\Parameters' 'RequireSecuritySignature'
  lmCompatibilityLevel = Get-RegInt 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Lsa' 'LmCompatibilityLevel'
  wdigestUseLogonCredential = Get-RegInt 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\SecurityProviders\\WDigest' 'UseLogonCredential'
  spoolerRunning = $spooler
}
@{ lastHotfixAt = $last; installedKbs = $kbs; cpasswordPaths = $cp; hardening = $hardening } | ConvertTo-Json -Compress -Depth 4
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
      hardening: parsed.hardening,
    };
  } catch (err) {
    return unavailable(err instanceof Error ? err.message : String(err), started);
  }
}
