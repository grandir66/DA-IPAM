/**
 * Catalog of high-signal security KBs, each scoped to the OS releases it ships
 * for. Pure module: imported by both the WinRM probe and the rules, so neither
 * pulls the DB layer into the other's import chain.
 */

export const CRITICAL_HOTFIX_KBS: ReadonlyArray<{
  kb: string;
  bulletin: string;
  /** Lower-case substrings of Win32_OperatingSystem Caption this KB applies to. */
  appliesTo: readonly string[];
}> = [
  {
    kb: "KB3011780",
    bulletin: "MS14-068 (Kerberos privilege elevation)",
    appliesTo: ["windows server 2003", "windows server 2008", "windows server 2012"],
  },
  {
    kb: "KB4012212",
    bulletin: "MS17-010 (SMBv1 remote code execution)",
    appliesTo: ["windows server 2008 r2", "windows 7"],
  },
  {
    kb: "KB4012215",
    bulletin: "MS17-010 (SMBv1 remote code execution)",
    appliesTo: ["windows server 2012", "windows 8.1"],
  },
  {
    kb: "KB4012598",
    bulletin: "MS17-010 (SMBv1 remote code execution)",
    appliesTo: ["windows server 2003", "windows server 2008", "windows vista", "windows xp"],
  },
];

/**
 * KBs that apply to `osCaption` and are absent from `installed`.
 *
 * Returns [] when the OS is unknown or newer than every entry: silence beats a
 * false Critical. Note that on 2008 R2 / 2012 R2 a monthly rollup can supersede
 * an individual KB, so a hit is a strong lead to verify, not proof.
 */
export function missingCriticalKbs(
  installed: string[],
  osCaption: string | null | undefined,
): string[] {
  if (osCaption == null || osCaption.trim() === "") return [];
  const os = osCaption.toLowerCase();
  const set = new Set(installed.map((k) => k.toUpperCase()));
  return CRITICAL_HOTFIX_KBS.filter(
    (e) => e.appliesTo.some((m) => os.includes(m)) && !set.has(e.kb),
  ).map((e) => e.kb);
}

/** Human label for a KB id, used in findings. */
export function criticalKbLabel(kb: string): string {
  const entry = CRITICAL_HOTFIX_KBS.find((e) => e.kb === kb);
  return entry ? `${entry.kb} — ${entry.bulletin}` : kb;
}
