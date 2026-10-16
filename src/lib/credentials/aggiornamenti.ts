/**
 * Colonne da scrivere per POST /api/credentials e PUT /api/credentials/[id]
 * (tappa 1 credenziali, 15/10; colonne della tappa 2, T13, 16/10).
 *
 * Segreti (password, community, token, chiave API o client secret; chiave SSH
 * e passphrase; chiavi SNMPv3): vuoti o assenti = non modificare. Prima
 * `password: ""` diventava `encrypted_password = NULL`, e la pagina in
 * modifica la mandava vuota: salvare il nome cancellava il segreto.
 */
import type { z } from "zod";
import { encrypt } from "@/lib/crypto";
import type { CredentialSchema } from "@/lib/validators";
import type { ColonneCredenziale } from "./archivio";

type DatiCredenziale = z.infer<typeof CredentialSchema>;

/**
 * @param data  corpo validato (CredentialSchema.partial())
 * @param corpo corpo grezzo: serve a distinguere «porta assente» da «porta
 *              vuota» (che Zod rende entrambe undefined); vuota = torna standard.
 */
export function aggiornamentiCredenziale(data: Partial<DatiCredenziale>, corpo: unknown): Record<string, unknown> {
  const updates: Record<string, unknown> = {};
  if (data.name !== undefined) updates.name = data.name;
  if (data.credential_type !== undefined) updates.credential_type = data.credential_type;
  // Metodo: presente = si scrive; null = torna al primo del tipo.
  if (data.auth_method !== undefined) updates.auth_method = data.auth_method ?? null;
  // Lo username la pagina lo manda precompilato: presente = si scrive.
  if (data.username !== undefined) updates.encrypted_username = data.username ? encrypt(data.username) : null;
  if (data.password) updates.encrypted_password = encrypt(data.password);
  // Una chiave nuova porta la sua passphrase o nessuna: quella vecchia era
  // della chiave vecchia, e con la chiave nuova la decifratura fallirebbe.
  if (data.private_key) {
    updates.encrypted_private_key = encrypt(data.private_key);
    updates.encrypted_key_passphrase = data.passphrase ? encrypt(data.passphrase) : null;
  } else if (data.passphrase) {
    updates.encrypted_key_passphrase = encrypt(data.passphrase);
  }
  if (data.auth_key) updates.encrypted_auth_key = encrypt(data.auth_key);
  if (data.priv_key) updates.encrypted_priv_key = encrypt(data.priv_key);
  // Protocolli e livello SNMPv3 non sono segreti: presenti = si scrivono, vuoti →
  // null.
  if (data.auth_protocol !== undefined) updates.auth_protocol = data.auth_protocol || null;
  if (data.priv_protocol !== undefined) updates.priv_protocol = data.priv_protocol || null;
  if (data.security_level !== undefined) updates.security_level = data.security_level || null;
  if (corpo && typeof corpo === "object" && "port" in corpo) updates.port = data.port ?? null;
  return updates;
}

/** Colonne di una voce nuova (POST): i segreti cifrati, i vuoti come NULL. */
export function colonneNuovaCredenziale(data: DatiCredenziale): ColonneCredenziale {
  const cifra = (v: string | undefined) => (v ? encrypt(v) : null);
  return {
    name: data.name,
    credential_type: data.credential_type,
    auth_method: data.auth_method ?? null,
    encrypted_username: cifra(data.username),
    encrypted_password: cifra(data.password),
    encrypted_private_key: cifra(data.private_key),
    encrypted_key_passphrase: cifra(data.passphrase),
    encrypted_auth_key: cifra(data.auth_key),
    auth_protocol: data.auth_protocol ?? null,
    encrypted_priv_key: cifra(data.priv_key),
    priv_protocol: data.priv_protocol ?? null,
    security_level: data.security_level ?? null,
    port: data.port ?? null,
  };
}
