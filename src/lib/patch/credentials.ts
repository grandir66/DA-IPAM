/**
 * Risoluzione credenziali WinRM per un host del tenant.
 *
 * JOIN `host_credentials` + `credentials` + `hosts`, filtro `protocol_type='winrm'`,
 * scelta della migliore (validated DESC, sort_order ASC, id ASC) e decifratura
 * con `safeDecrypt`. In caso di decrypt fallito ritorna `null` e logga warning
 * (non lancia eccezione: l'executor segna l'operation come `failed`).
 *
 * Il realm AD viene preso dalla configurazione hub (`getAdRealm`) — può essere
 * `null` per ambienti senza dominio Kerberos.
 *
 * Anti-pattern evitati:
 *  - NIENTE `decrypt()` raw (regola crypto.ts).
 *  - NIENTE log della password (mai stampare `password` in console o DB).
 *  - NIENTE include di password nel messaggio di errore.
 */

import type { Database } from "better-sqlite3";
import { safeDecrypt } from "@/lib/crypto";
import { getAdRealm } from "@/lib/db";
import type { WinrmCredentialsResolved } from "./types";

interface JoinedRow {
  host_ip: string | null;
  port: number;
  encrypted_username: string | null;
  encrypted_password: string | null;
}

// Porta WinRM default per fallback AD: 5985 (HTTP). 5986 (HTTPS) richiede
// cert sul target, non assumibile come default.
const WINRM_DEFAULT_PORT = 5985;

/**
 * Ritorna la migliore credenziale WinRM disponibile per `hostId`, già decifrata.
 *
 * Cascade di lookup:
 *   1. `host_credentials` con `protocol_type='winrm'` per quell'host specifico
 *      (validated DESC, sort_order ASC, id ASC).
 *   2. Fallback **AD integration**: se nessuna riga esplicita, prende la prima
 *      `ad_integrations` enabled con `winrm_credential_id` valido, JOIN
 *      `credentials` per username/password cifrati. Porta WinRM default 5985.
 *
 * Ritorna `null` se:
 *   - l'host non esiste / non ha IP
 *   - nessuna credenziale né esplicita né da AD fallback
 *   - la decifratura di username o password fallisce / è vuota
 */
export function loadWinrmCredentialsForHost(
  db: Database,
  hostId: number
): WinrmCredentialsResolved | null {
  // Primo lookup: host_credentials esplicite
  let row = db
    .prepare(
      `SELECT h.ip AS host_ip,
              hc.port AS port,
              c.encrypted_username AS encrypted_username,
              c.encrypted_password AS encrypted_password
         FROM host_credentials hc
         JOIN credentials c ON c.id = hc.credential_id
         JOIN hosts h ON h.id = hc.host_id
        WHERE hc.host_id = ?
          AND hc.protocol_type = 'winrm'
        ORDER BY hc.validated DESC, hc.sort_order ASC, hc.id ASC
        LIMIT 1`
    )
    .get(hostId) as JoinedRow | undefined;

  // Fallback: credenziali AD globali del tenant (ad_integrations.winrm_credential_id)
  if (!row) {
    row = db
      .prepare(
        `SELECT h.ip AS host_ip,
                ? AS port,
                c.encrypted_username AS encrypted_username,
                c.encrypted_password AS encrypted_password
           FROM ad_integrations ai
           JOIN credentials c ON c.id = ai.winrm_credential_id
           JOIN hosts h ON h.id = ?
          WHERE ai.enabled = 1
            AND ai.winrm_credential_id IS NOT NULL
          ORDER BY ai.id ASC
          LIMIT 1`
      )
      .get(WINRM_DEFAULT_PORT, hostId) as JoinedRow | undefined;
  }

  if (!row) {
    return null;
  }
  if (!row.host_ip) {
    console.error(`[patch/credentials] Host ${hostId} senza IP, impossibile WinRM`);
    return null;
  }
  if (!row.encrypted_username || !row.encrypted_password) {
    console.error(
      `[patch/credentials] Credenziale WinRM host ${hostId} senza username/password cifrati`
    );
    return null;
  }

  const username = safeDecrypt(row.encrypted_username);
  const password = safeDecrypt(row.encrypted_password);
  if (!username || !password) {
    console.error(
      `[patch/credentials] Decifratura credenziale WinRM host ${hostId} fallita`
    );
    return null;
  }

  // Realm AD viene dalla config hub (non tenant). Può essere null in ambienti
  // senza dominio: in quel caso runWinrmCommand userà NTLM/Basic.
  let realm: string | null = null;
  try {
    const adInfo = getAdRealm();
    realm = adInfo?.realm ?? null;
  } catch (err) {
    console.warn(
      "[patch/credentials] getAdRealm() ha lanciato, proseguo senza realm:",
      (err as Error).message
    );
    realm = null;
  }

  return {
    host: row.host_ip,
    port: row.port,
    username,
    password,
    realm,
  };
}
