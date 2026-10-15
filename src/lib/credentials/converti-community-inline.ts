/**
 * Conversione idempotente dei binding SNMP inline vecchi (tappa 1, 15/10): la
 * tabella dei binding salvava la community nel campo `inline_username`, in
 * chiaro, e chi legge la community guarda `inline_encrypted_password`. Gira
 * all'apertura del tenant; il 15/10 le righe così erano 0 sull'hub e sul
 * cliente A.
 */
import type Database from "better-sqlite3";
import { encrypt } from "@/lib/crypto";

/** Converte le righe vecchie in una transazione; restituisce quante. */
export function convertiCommunityInlineSnmp(dbh: Database.Database): number {
  const righe = dbh
    .prepare(
      `SELECT id, inline_username FROM device_credential_bindings
       WHERE protocol_type = 'snmp' AND credential_id IS NULL
         AND inline_username IS NOT NULL AND inline_encrypted_password IS NULL`
    )
    .all() as Array<{ id: number; inline_username: string }>;
  if (righe.length === 0) return 0;
  const aggiorna = dbh.prepare(
    `UPDATE device_credential_bindings SET inline_encrypted_password = ?, inline_username = NULL WHERE id = ?`
  );
  dbh.transaction(() => {
    for (const r of righe) aggiorna.run(encrypt(r.inline_username), r.id);
  })();
  return righe.length;
}
