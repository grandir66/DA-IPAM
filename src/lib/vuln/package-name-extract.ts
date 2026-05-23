/**
 * Best-effort estrazione del nome pacchetto da `nvt_name` Greenbone.
 *
 * Esempi di input → output attesi:
 *   "Mozilla Firefox 138.0.1 Security Update (mfsa_2025-29_2025-32_linux)" → "Mozilla Firefox"
 *   "Microsoft Edge (Chromium-based) Multiple Vulnerabilities (May 2025)"  → "Microsoft Edge"
 *   "OpenSSH < 9.7p1 Multiple Vulnerabilities"                              → "OpenSSH"
 *   "Operating System (OS) End of Life (EOL) Detection: Windows 10"        → null (info-only)
 *   "TCP Timestamps Information Disclosure"                                 → null (prefisso noto)
 *
 * Usato dalla pagina globale /software per il contributo Greenbone (3a fonte).
 * Quando ritorna null, il finding non contribuisce all'aggregazione software
 * ma resta visibile nella pagina /vulnerabilities con il `nvt_name` intero.
 */

const NON_PACKAGE_PREFIXES = /^(operating system|os\s|end of life|eol|tcp timestamp|http\s|ssl\/|tls\s|certificate|dns\s|smb\s|snmp\s|icmp\s|ftp\s|nfs\s|cpe\b|cpe-)/i;

const TRAILING_NOISE = /\s+(Multiple\s+)?(Vulnerabilit(?:y|ies)|Security\s+Update|Detection|Advisory|Patch|Information\s+Disclosure|Denial\s+of\s+Service|RCE|XSS).*$/i;

const VERSION_TOKEN = /\s+([<>=]+\s*)?[vV]?\d+(\.\d+){1,4}([a-z0-9_+\-.]*)?\b.*$/;

export function extractPackageName(nvtName: string | null | undefined): string | null {
  if (!nvtName) return null;
  const raw = nvtName.trim();
  if (raw.length < 3) return null;
  if (NON_PACKAGE_PREFIXES.test(raw)) return null;

  let s = raw.replace(VERSION_TOKEN, "");
  s = s.replace(TRAILING_NOISE, "");
  s = s.replace(/\s*\(.*$/, "");
  s = s.trim();

  if (s.length < 3 || s.length > 80) return null;
  return s;
}
