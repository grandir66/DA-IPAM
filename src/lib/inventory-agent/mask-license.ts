/** Maschera chiavi licenza per utenti non admin (NIS2: visibili solo ad admin). */
export function maskLicenseKey(key: string | null | undefined): string | null {
  if (!key) return null;
  const trimmed = key.trim();
  if (trimmed.length <= 8) return "****";
  return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`;
}
