/** MVP obsolete OS substrings (case-insensitive): XP/Vista/7/8, Server 2003/2008/2012 (+ R2). */
const OBSOLETE_OS_SUBSTRINGS = [
  "windows xp",
  "windows vista",
  "windows 7",
  "windows 8",
  "windows server 2003",
  "windows server 2008",
  "windows server 2012",
] as const;

export function isObsoleteOs(os: string | null): boolean {
  if (os == null || os.trim() === "") return false;
  const lower = os.toLowerCase();
  return OBSOLETE_OS_SUBSTRINGS.some((s) => lower.includes(s));
}
