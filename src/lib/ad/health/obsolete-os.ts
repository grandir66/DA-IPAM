/**
 * End-of-support dates for Windows products seen in AD `operatingSystem`.
 *
 * Date-driven rather than a static "obsolete" list, so a release becomes
 * obsolete on its own EOL date without a code change. First match wins, so
 * entries are ordered most-specific first ("windows 8.1" before "windows 8",
 * LTSC channels before the matching mainstream release).
 */
const OS_END_OF_SUPPORT: ReadonlyArray<{ match: string; eol: string }> = [
  // Windows 10 LTSC/LTSB channels have their own, longer lifecycles
  { match: "ltsb 2015", eol: "2025-10-14" },
  { match: "ltsc 2015", eol: "2025-10-14" },
  { match: "ltsb 2016", eol: "2026-10-13" },
  { match: "ltsc 2016", eol: "2026-10-13" },
  { match: "ltsc 2019", eol: "2029-01-09" },
  { match: "ltsc 2021", eol: "2027-01-12" },

  // Server
  { match: "windows server 2003", eol: "2015-07-14" },
  { match: "windows server 2008", eol: "2020-01-14" }, // covers 2008 R2
  { match: "windows server 2012", eol: "2023-10-10" }, // covers 2012 R2
  { match: "windows server 2016", eol: "2027-01-12" },
  { match: "windows server 2019", eol: "2029-01-09" },
  { match: "windows server 2022", eol: "2031-10-14" },
  { match: "windows server 2025", eol: "2034-10-10" },

  // Client
  { match: "windows xp", eol: "2014-04-08" },
  { match: "windows vista", eol: "2017-04-11" },
  { match: "windows 7", eol: "2020-01-14" },
  { match: "windows 8.1", eol: "2023-01-10" },
  { match: "windows 8", eol: "2016-01-12" },
  { match: "windows 10", eol: "2025-10-14" },
  { match: "windows 11", eol: "2031-10-14" },
];

/** Generic LTSC/LTSB build with no recognised year — assume the longest lifecycle. */
const UNKNOWN_LTSC_EOL = "2029-01-09";

/**
 * True when the OS string names a release whose support ended before `now`.
 * Unknown or unparseable strings return false: never invent a finding.
 */
export function isObsoleteOs(os: string | null, now: Date = new Date()): boolean {
  if (os == null || os.trim() === "") return false;
  const lower = os.toLowerCase();

  const entry = OS_END_OF_SUPPORT.find((e) => lower.includes(e.match));
  if (entry) return Date.parse(entry.eol) <= now.getTime();

  // LTSC/LTSB edition we don't have a year for: stay conservative.
  if (lower.includes("ltsc") || lower.includes("ltsb")) {
    return Date.parse(UNKNOWN_LTSC_EOL) <= now.getTime();
  }
  return false;
}
