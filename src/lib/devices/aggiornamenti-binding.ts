/**
 * Campi dei binding credenziale di un apparato (POST/PUT
 * /api/devices/[id]/credentials), tappa 1 credenziali (15/10).
 *
 * SNMP inline: la community va nel campo cifrato e lo username resta vuoto.
 * Prima la tabella la mandava come `inline_username`, in chiaro, e chi legge la
 * community guarda solo il campo cifrato.
 */
import { encrypt } from "@/lib/crypto";

export function normalizzaInlineSnmp(
  protocolType: string | undefined,
  inlineUsername: string | null | undefined,
  inlinePassword: string | null | undefined
): { inline_username: string | null | undefined; inline_password: string | null | undefined } {
  if (protocolType !== "snmp") return { inline_username: inlineUsername, inline_password: inlinePassword };
  return { inline_username: null, inline_password: inlinePassword || inlineUsername || null };
}

export interface AggiornamentoBinding {
  credential_id?: number | null;
  protocol_type?: string;
  port?: number;
  inline_username?: string | null;
  inline_encrypted_password?: string | null;
}

/** Aggiornamenti per «update»: i campi inline si toccano solo in modalità inline. */
export function aggiornamentiBinding(data: {
  credential_id?: number | null;
  protocol_type?: string;
  port?: number;
  inline_username?: string | null;
  inline_password?: string | null;
}): AggiornamentoBinding {
  const updates: AggiornamentoBinding = {};
  if (data.credential_id !== undefined) updates.credential_id = data.credential_id;
  if (data.protocol_type !== undefined) updates.protocol_type = data.protocol_type;
  if (data.port !== undefined) updates.port = data.port;
  // Un aggiornamento della sola porta di un binding d'archivio non deve scrivere
  // i campi inline: scriverli stacca la credenziale (updateDeviceCredentialBinding).
  const modificaInline = !data.credential_id && (data.inline_username !== undefined || data.inline_password !== undefined);
  if (!modificaInline) return updates;
  if (data.protocol_type === "snmp") {
    const inline = normalizzaInlineSnmp(data.protocol_type, data.inline_username, data.inline_password);
    updates.inline_username = null;
    // Community vuota = non modificare (come le password).
    if (inline.inline_password) updates.inline_encrypted_password = encrypt(inline.inline_password);
    return updates;
  }
  if (data.inline_username !== undefined) updates.inline_username = data.inline_username;
  if (data.inline_password !== undefined) {
    updates.inline_encrypted_password = data.inline_password ? encrypt(data.inline_password) : null;
  }
  return updates;
}
