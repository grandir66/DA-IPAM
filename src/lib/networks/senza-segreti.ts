/**
 * Cosa esce di una rete verso chi non è admin (piano di sicurezza 14/11, P0-1).
 * Riccardo, 14/11: la community SNMP resta leggibile dalla UI, ma la legge chi la può
 * anche scrivere (admin, superadmin). Agli altri resta solo il fatto che è configurata.
 * Incidente: `GET /api/networks/[id]` rispondeva la riga intera a qualunque utente autenticato.
 */
export function ruoloAdmin(role: string | null | undefined): boolean {
  return role === "admin" || role === "superadmin";
}

export function reteSenzaSegreti<T extends Record<string, unknown>>(
  rete: T,
  admin: boolean,
): T & { snmp_community_configurata: boolean } {
  const valore = rete.snmp_community;
  const configurata = typeof valore === "string" && valore.trim() !== "";
  if (admin) return { ...rete, snmp_community_configurata: configurata };
  return { ...rete, snmp_community: null, snmp_community_configurata: configurata };
}

/** Per i log delle scansioni: quante community si provano, mai quali. */
export function communityPerLog(communities: readonly string[]): string {
  return communities.length === 1 ? "1 community" : `${communities.length} community`;
}
