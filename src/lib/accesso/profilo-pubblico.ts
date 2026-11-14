/**
 * Cosa esce di una riga di `hub.tenants` (piano di sicurezza 14/11, P0-1).
 * Incidente: `GET /api/tenants` e `GET /api/tenants/[id]` rispondevano la riga intera,
 * con `agent_token_hash` e `agent_token_encrypted`, e la seconda a qualunque utente
 * autenticato, anche per un profilo non suo (conta sul profilo tecnico, il solo multi-cliente).
 * Modulo puro, senza DB.
 */
const CAMPI_SEGRETI = ["agent_token_hash", "agent_token_encrypted"] as const;

export function profiloSenzaSegreti<T extends object>(riga: T): T & { agent_token_configurato: boolean } {
  const copia: Record<string, unknown> = { ...(riga as Record<string, unknown>) };
  const configurato = !!copia.agent_token_hash || !!copia.agent_token_encrypted;
  for (const c of CAMPI_SEGRETI) delete copia[c];
  return { ...(copia as T), agent_token_configurato: configurato };
}

/** Admin e superadmin vedono ogni profilo; gli altri solo quelli a cui appartengono. */
export function puoVedereProfilo(
  utente: { role?: string | null; tenants?: Array<{ code: string }> | null },
  codiceCliente: string,
): boolean {
  if (utente.role === "admin" || utente.role === "superadmin") return true;
  return (utente.tenants ?? []).some((t) => t.code === codiceCliente);
}

/**
 * Chi scarica `hub.db` intero. Sull'installazione di un cliente (una sola, senza altri clienti dentro)
 * basta l'admin; sul profilo tecnico, il solo multi-cliente (Riccardo, 14/11), `hub.db` tiene gli
 * utenti di tutti i clienti e serve il superadmin.
 */
export function puoScaricareHub(role: string | null | undefined, tecnico: boolean): boolean {
  if (role === "superadmin") return true;
  return role === "admin" && !tecnico;
}
