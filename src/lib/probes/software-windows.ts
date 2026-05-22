/**
 * Software inventory probe — Windows via WinRM.
 *
 * Strategia: enumera le tre uninstall hive del registry (HKLM 64-bit,
 * HKLM WOW6432Node 32-bit, HKU per-user) tramite PowerShell remoto e
 * ritorna JSON.
 *
 * ANTI-PATTERN VIETATO: `Win32_Product` WMI. Triggera msiexec /reconfigure
 * su ogni pacchetto MSI installato (reinstall silenzioso, eventi Event Log,
 * possibili riavvii servizi). Non usare mai.
 *
 * Riusa `runWinrmCommand()` esistente, non modificare il bridge Python.
 */

import { runWinrmCommand } from "@/lib/devices/winrm-run";
import type { SoftwarePackage } from "@/types";

/**
 * Script PowerShell single-shot. Esegue ConvertTo-Json finale.
 * Note:
 * - `-Depth 3` sufficiente, struttura piatta
 * - `-Compress` per ridurre overhead trasferimento
 * - SilentlyContinue su errori registry (chiavi orfane/non leggibili)
 * - Filtra entries senza DisplayName (rumore)
 */
const PS_SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$results = New-Object System.Collections.Generic.List[object]

$hivePaths = @(
  @{ Path = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*'; Arch = 'x64'; Source = 'registry' },
  @{ Path = 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'; Arch = 'x86'; Source = 'registry' }
)

foreach ($hive in $hivePaths) {
  Get-ItemProperty $hive.Path -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName } | ForEach-Object {
    $sizeBytes = $null
    if ($_.EstimatedSize) {
      try { $sizeBytes = [int64]$_.EstimatedSize * 1024 } catch { $sizeBytes = $null }
    }
    $obj = [PSCustomObject]@{
      name = "$($_.DisplayName)"
      version = if ($_.DisplayVersion) { "$($_.DisplayVersion)" } else { $null }
      publisher = if ($_.Publisher) { "$($_.Publisher)" } else { $null }
      install_date = if ($_.InstallDate) { "$($_.InstallDate)" } else { $null }
      install_location = if ($_.InstallLocation) { "$($_.InstallLocation)" } else { $null }
      source = $hive.Source
      architecture = $hive.Arch
      size_bytes = $sizeBytes
    }
    $results.Add($obj) | Out-Null
  }
}

# Per-user (HKU) — enumera SID utenti reali (S-1-5-21-*)
Get-ChildItem 'Registry::HKEY_USERS' -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'S-1-5-21' -and $_.Name -notmatch '_Classes$' } | ForEach-Object {
  $userPath = "Registry::$($_.Name)\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*"
  Get-ItemProperty $userPath -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName } | ForEach-Object {
    $sizeBytes = $null
    if ($_.EstimatedSize) {
      try { $sizeBytes = [int64]$_.EstimatedSize * 1024 } catch { $sizeBytes = $null }
    }
    $obj = [PSCustomObject]@{
      name = "$($_.DisplayName)"
      version = if ($_.DisplayVersion) { "$($_.DisplayVersion)" } else { $null }
      publisher = if ($_.Publisher) { "$($_.Publisher)" } else { $null }
      install_date = if ($_.InstallDate) { "$($_.InstallDate)" } else { $null }
      install_location = if ($_.InstallLocation) { "$($_.InstallLocation)" } else { $null }
      source = 'registry-user'
      architecture = $null
      size_bytes = $sizeBytes
    }
    $results.Add($obj) | Out-Null
  }
}

# Output: array JSON. Se vuoto, [] esplicito.
if ($results.Count -eq 0) { '[]' } else { $results | ConvertTo-Json -Depth 3 -Compress }
`;

interface RawWinPackage {
  name?: unknown;
  version?: unknown;
  publisher?: unknown;
  install_date?: unknown;
  install_location?: unknown;
  source?: unknown;
  architecture?: unknown;
  size_bytes?: unknown;
}

function toStringOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

function toIntOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? Math.trunc(v) : null;
  const n = Number.parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Normalizza il formato InstallDate del registry Windows.
 * Registry usa `yyyyMMdd` (es. "20240115"). Ritorna ISO date `YYYY-MM-DD`
 * o la stringa originale se non matcha il pattern.
 */
function normalizeInstallDate(raw: string | null): string | null {
  if (!raw) return null;
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(raw);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return raw;
}

function normalizeArchitecture(raw: string | null): string | null {
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (lower === "x64" || lower === "amd64" || lower === "64-bit") return "x64";
  if (lower === "x86" || lower === "32-bit") return "x86";
  if (lower === "arm64" || lower === "aarch64") return "arm64";
  return raw;
}

function normalizeSource(raw: string | null): SoftwarePackage["source"] {
  if (raw === "registry-user") return "registry-user";
  return "registry";
}

/**
 * Parser JSON ricevuto dal bridge. Sempre dentro try/catch (regola DA-IPAM).
 * ConvertTo-Json può ritornare un singolo oggetto invece di array se 1 elemento.
 */
export function parseWindowsSoftwareJson(stdout: string): SoftwarePackage[] {
  const trimmed = (stdout || "").trim();
  if (!trimmed || trimmed === "[]") return [];

  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch (err) {
    throw new Error(
      `Output PowerShell non è JSON valido: ${(err as Error).message}`
    );
  }

  const arr: RawWinPackage[] = Array.isArray(raw)
    ? (raw as RawWinPackage[])
    : [raw as RawWinPackage];

  const out: SoftwarePackage[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const name = toStringOrNull(item.name);
    if (!name) continue;
    out.push({
      name,
      version: toStringOrNull(item.version),
      publisher: toStringOrNull(item.publisher),
      install_date: normalizeInstallDate(toStringOrNull(item.install_date)),
      install_location: toStringOrNull(item.install_location),
      source: normalizeSource(toStringOrNull(item.source)),
      architecture: normalizeArchitecture(toStringOrNull(item.architecture)),
      size_bytes: toIntOrNull(item.size_bytes),
    });
  }
  return out;
}

export interface WindowsSoftwareProbeInput {
  host: string;
  port: number;
  username: string;
  password: string;
  realm?: string;
}

/**
 * Errori "host non raggiungibile" su WinRM (TCP refused / no route / connection reset).
 * Su questi tentiamo fallback HTTP 5985 se la richiesta era HTTPS 5986.
 */
function isUnreachableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    /no route to host/i.test(msg) ||
    /connection refused/i.test(msg) ||
    /max retries exceeded/i.test(msg) ||
    /ECONNREFUSED/i.test(msg) ||
    /EHOSTUNREACH/i.test(msg) ||
    /failed to establish/i.test(msg)
  );
}

/** Riformula errori pywinrm/HTTP in messaggio breve e azionabile per l'utente. */
function userFriendlyError(host: string, port: number, err: unknown): Error {
  const original = err instanceof Error ? err.message : String(err);
  let hint = "";
  if (isUnreachableError(err)) {
    hint =
      port === 5986
        ? `Verifica sul target: 'Enable-PSRemoting' e che WinRM HTTPS (5986) sia configurato con cert (winrm quickconfig -transport:https). In alternativa abilita HTTP 5985 e ripeti scegliendo porta 5985 dal form.`
        : `Verifica sul target: 'Enable-PSRemoting' e che il firewall consenta la porta ${port}.`;
  } else if (/401|unauthorized|access[ _]?denied/i.test(original)) {
    hint = `Credenziale rifiutata. Verifica username (DOMAIN\\user oppure user@realm), password e che l'utente sia in 'Remote Management Users' o admin sul target.`;
  } else if (/ssl|certificate|cert_verify/i.test(original)) {
    hint = `Problema TLS: cert WinRM 5986 non valido o autofirmato. Sul DC: 'winrm quickconfig -transport:https' con cert firmato dalla CA aziendale, oppure usa HTTP 5985.`;
  } else if (/kerberos|gssapi/i.test(original)) {
    hint = `Kerberos fallito. Specifica il 'realm' nel form (es. DOMINIO.LOCAL maiuscolo) oppure usa NTLM passando username come DOMINIO\\\\user.`;
  }
  return new Error(hint ? `${hint}\nDettaglio tecnico: ${original}` : original);
}

/**
 * Esegue lo scan applicativo via WinRM con fallback automatico HTTPS 5986 → HTTP 5985
 * quando l'host non è raggiungibile su 5986. Ritorna i pacchetti normalizzati.
 * Il chiamante è responsabile di catturare errori e mapparli su `status='error'`.
 */
export async function runWindowsSoftwareProbe(
  input: WindowsSoftwareProbeInput
): Promise<SoftwarePackage[]> {
  try {
    const stdout = await runWinrmCommand(
      input.host,
      input.port,
      input.username,
      input.password,
      PS_SCRIPT,
      true,
      input.realm
    );
    return parseWindowsSoftwareJson(stdout);
  } catch (firstErr) {
    // Fallback automatico: se 5986 HTTPS unreachable, riproviamo 5985 HTTP
    if (input.port === 5986 && isUnreachableError(firstErr)) {
      try {
        const stdout = await runWinrmCommand(
          input.host,
          5985,
          input.username,
          input.password,
          PS_SCRIPT,
          true,
          input.realm
        );
        return parseWindowsSoftwareJson(stdout);
      } catch (secondErr) {
        // Entrambi falliti: messaggio utile sull'ultimo
        throw userFriendlyError(input.host, 5985, secondErr);
      }
    }
    throw userFriendlyError(input.host, input.port, firstErr);
  }
}
