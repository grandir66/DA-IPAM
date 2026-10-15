/**
 * Campi da scrivere per PUT /api/credentials/[id] (tappa 1 credenziali, 15/10).
 *
 * Segreti (password/community, chiavi SNMPv3): vuoti o assenti = non
 * modificare. Prima `password: ""` diventava `encrypted_password = NULL`, e la
 * pagina in modifica la mandava vuota: salvare il nome cancellava il segreto.
 */
import { encrypt } from "@/lib/crypto";
import type { CredentialInput } from "@/types";

type DatiCredenziale = Partial<Omit<CredentialInput, "port">> & { port?: number | null };

/**
 * @param data  corpo validato (CredentialSchema.partial())
 * @param corpo corpo grezzo: serve a distinguere «porta assente» da «porta
 *              vuota» (che Zod rende entrambe undefined); vuota = torna standard.
 */
export function aggiornamentiCredenziale(data: DatiCredenziale, corpo: unknown): Record<string, unknown> {
  const updates: Record<string, unknown> = {};
  if (data.name !== undefined) updates.name = data.name;
  if (data.credential_type !== undefined) updates.credential_type = data.credential_type;
  // Lo username la pagina lo manda precompilato: presente = si scrive.
  if (data.username !== undefined) updates.encrypted_username = data.username ? encrypt(data.username) : null;
  if (data.password) updates.encrypted_password = encrypt(data.password);
  if (data.auth_key) updates.encrypted_auth_key = encrypt(data.auth_key);
  if (data.priv_key) updates.encrypted_priv_key = encrypt(data.priv_key);
  // Protocolli e livello SNMPv3 non sono segreti: presenti = si scrivono, vuoti →
  // null per poter tornare a v2c/noAuthNoPriv.
  if (data.auth_protocol !== undefined) updates.auth_protocol = data.auth_protocol || null;
  if (data.priv_protocol !== undefined) updates.priv_protocol = data.priv_protocol || null;
  if (data.security_level !== undefined) updates.security_level = data.security_level || null;
  if (corpo && typeof corpo === "object" && "port" in corpo) updates.port = data.port ?? null;
  return updates;
}
