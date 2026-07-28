/**
 * SNMP v3 completo (authPriv) — Attribution v2 Fase 4b Task 2 (spec §7.4/§7.1).
 *
 * Oggi `snmp-query.ts` ha solo un percorso v3 parziale (`snmpSubwalkLimitedForDevice`
 * → `snmpSubwalkLimitedV3`): SEMPRE `authNoPriv` + MD5 hardcoded, mai `privKey`.
 * Questo modulo aggiunge il percorso v3 completo: authProtocol/privProtocol
 * configurabili per credenziale, authPriv con chiave di privacy, e una funzione
 * di validazione dedicata (`snmpValidateV3`) per il ramo `credential_validate`
 * di `discovery.ts` (apparati enterprise dove v2c è disabilitato per policy).
 *
 * `buildV3Options` è PURA e testabile senza rete: costruisce (o rifiuta) i
 * parametri di sessione net-snmp da un record credenziale già decifrato,
 * PRIMA che `snmpValidateV3` aggiorni una sola socket (Global Constraints:
 * "nessuno sweep", gate anti-lockout lato chiamante). Le combinazioni
 * incoerenti (es. authPriv senza privKey) sono rifiutate con un errore
 * parlante in italiano — mai un tentativo di rete su parametri incompleti.
 *
 * Sicurezza: gli errori restituiti non includono MAI la chiave di
 * autenticazione/privacy, solo nomi di protocollo/livello (Global Constraints
 * "nessun segreto nei log").
 */
import { AuthProtocols, PrivProtocols, SecurityLevel } from "net-snmp";
import { stringifySnmpValue } from "../scanner/snmp-query";

const OID_SYSDESCR = "1.3.6.1.2.1.1.1.0";

export const SNMP_V3_AUTH_PROTOCOLS = ["MD5", "SHA", "SHA224", "SHA256", "SHA384", "SHA512"] as const;
export type SnmpV3AuthProtocol = (typeof SNMP_V3_AUTH_PROTOCOLS)[number];

/**
 * Valori ammessi a livello DB/UI (spec §7.1). `AES192` è un valore legittimo
 * nel dominio SNMPv3 (RFC non standard ma diffuso in alcuni stack vendor) ma
 * NON è implementato dalla libreria `net-snmp` in uso (nessun algoritmo
 * AES-192 fra i suoi `PrivProtocols`): resta nell'enum DB/UI per non
 * bloccare la selezione, ma `buildV3Options` lo rifiuta esplicitamente con un
 * errore che lo dice chiaramente, invece di un tentativo di sessione che
 * fallirebbe in modo oscuro.
 */
export const SNMP_V3_PRIV_PROTOCOLS = ["DES", "AES", "AES192", "AES256"] as const;
export type SnmpV3PrivProtocol = (typeof SNMP_V3_PRIV_PROTOCOLS)[number];

export const SNMP_V3_SECURITY_LEVELS = ["noAuthNoPriv", "authNoPriv", "authPriv"] as const;
export type SnmpV3SecurityLevel = (typeof SNMP_V3_SECURITY_LEVELS)[number];

/** Record credenziale SNMPv3 già DECIFRATO (mai passare ciphertext qui). */
export interface SnmpV3CredentialRecord {
  username: string;
  /** Atteso uno tra `SNMP_V3_SECURITY_LEVELS`; qualunque altro valore è un errore. */
  securityLevel: string;
  authProtocol?: string | null;
  authKey?: string | null;
  privProtocol?: string | null;
  privKey?: string | null;
}

/** Parametri di sessione net-snmp (secondo argomento di `createV3Session`). */
export interface SnmpV3SessionOptions {
  name: string;
  level: SecurityLevel;
  authProtocol?: AuthProtocols;
  authKey?: string;
  privProtocol?: PrivProtocols;
  privKey?: string;
}

export type BuildV3OptionsResult =
  | { ok: true; options: SnmpV3SessionOptions }
  | { ok: false; error: string };

const AUTH_PROTOCOL_MAP: Partial<Record<string, AuthProtocols>> = {
  MD5: AuthProtocols.md5,
  SHA: AuthProtocols.sha,
  SHA224: AuthProtocols.sha224,
  SHA256: AuthProtocols.sha256,
  SHA384: AuthProtocols.sha384,
  SHA512: AuthProtocols.sha512,
};

/**
 * AES192 volutamente ASSENTE: `net-snmp` non implementa un algoritmo
 * AES a 192 bit (i suoi `PrivProtocols` coprono solo des/aes(128)/aes256b/
 * aes256r) — vedi commento su `SNMP_V3_PRIV_PROTOCOLS`. AES256 è mappato su
 * `aes256b` (Blumenthal), la variante più diffusa fra gli stack vendor.
 */
const PRIV_PROTOCOL_MAP: Partial<Record<string, PrivProtocols>> = {
  DES: PrivProtocols.des,
  AES: PrivProtocols.aes,
  AES256: PrivProtocols.aes256b,
};

/**
 * Costruisce i parametri di sessione SNMPv3 da un record credenziale
 * decifrato — PURA, nessuna rete. Rifiuta PRIMA di toccare la rete:
 *   - username mancante → errore
 *   - security_level non riconosciuto → errore
 *   - authNoPriv/authPriv senza authProtocol riconosciuto o authKey → errore
 *   - authPriv senza privProtocol riconosciuto o privKey → errore
 *
 * Non lancia MAI eccezioni: qualunque input malformato produce `{ok:false}`
 * con un messaggio in italiano, senza includere authKey/privKey (Global
 * Constraints "nessun segreto nei log").
 */
export function buildV3Options(cred: SnmpV3CredentialRecord): BuildV3OptionsResult {
  const username = (cred.username ?? "").trim();
  if (!username) {
    return { ok: false, error: "Username SNMPv3 mancante" };
  }

  const level = cred.securityLevel;
  if (level !== "noAuthNoPriv" && level !== "authNoPriv" && level !== "authPriv") {
    return { ok: false, error: `security_level SNMPv3 non riconosciuto: "${String(level)}" (livelli ammessi: ${SNMP_V3_SECURITY_LEVELS.join(", ")})` };
  }

  if (level === "noAuthNoPriv") {
    return { ok: true, options: { name: username, level: SecurityLevel.noAuthNoPriv } };
  }

  // authNoPriv e authPriv richiedono entrambi un protocollo di autenticazione
  // riconosciuto e una authKey non vuota.
  const authProtocolKey = (cred.authProtocol ?? "").trim().toUpperCase();
  const authProtocol = AUTH_PROTOCOL_MAP[authProtocolKey];
  if (!authProtocol) {
    return {
      ok: false,
      error: `Protocollo di autenticazione SNMPv3 non riconosciuto: "${cred.authProtocol ?? ""}" (ammessi: ${SNMP_V3_AUTH_PROTOCOLS.join(", ")})`,
    };
  }
  if (!(cred.authKey ?? "").trim()) {
    return { ok: false, error: "Chiave di autenticazione SNMPv3 mancante (richiesta per authNoPriv/authPriv)" };
  }

  if (level === "authNoPriv") {
    return {
      ok: true,
      options: { name: username, level: SecurityLevel.authNoPriv, authProtocol, authKey: (cred.authKey as string).trim() },
    };
  }

  // authPriv: in aggiunta ad auth, richiede protocollo di privacy riconosciuto
  // (e supportato dalla libreria, vedi PRIV_PROTOCOL_MAP) e una privKey non vuota.
  const privProtocolKey = (cred.privProtocol ?? "").trim().toUpperCase();
  if (!privProtocolKey) {
    return { ok: false, error: "Protocollo di privacy SNMPv3 mancante (richiesto per authPriv)" };
  }
  const isKnownPrivProtocol = (SNMP_V3_PRIV_PROTOCOLS as readonly string[]).includes(privProtocolKey);
  const privProtocol = PRIV_PROTOCOL_MAP[privProtocolKey];
  if (!privProtocol) {
    const error = isKnownPrivProtocol
      ? `Protocollo di privacy SNMPv3 "${privProtocolKey}" non supportato dalla libreria SNMP disponibile (usa AES o AES256)`
      : `Protocollo di privacy SNMPv3 non riconosciuto: "${cred.privProtocol ?? ""}" (ammessi: ${SNMP_V3_PRIV_PROTOCOLS.join(", ")})`;
    return { ok: false, error };
  }
  if (!(cred.privKey ?? "").trim()) {
    return { ok: false, error: "Chiave di privacy SNMPv3 mancante (richiesta per authPriv)" };
  }

  return {
    ok: true,
    options: {
      name: username,
      level: SecurityLevel.authPriv,
      authProtocol,
      authKey: (cred.authKey as string).trim(),
      privProtocol,
      privKey: (cred.privKey as string).trim(),
    },
  };
}

export interface SnmpV3ValidateResult {
  ok: boolean;
  sysDescr?: string | null;
  error?: string;
}

/**
 * Valida una credenziale SNMPv3 su `ip:port` interrogando `sysDescr.0`.
 * Decifra con `safeDecrypt` (mai `decrypt()` nudo — regola anti-regressione
 * #3), costruisce le opzioni con `buildV3Options` (rifiuto PRIMA della rete
 * su combinazioni incoerenti) e apre una `createV3Session` con timeout
 * esplicito. Non lancia mai: qualunque errore (credenziale assente, chiave
 * incoerente, timeout, autenticazione rifiutata) risolve a `{ok:false,error}`.
 * Il gate anti-lockout (`CredentialRunBudget`/`recordCredentialSuccess`/
 * `recordCredentialFailure`) resta responsabilità del chiamante
 * (`scanner/discovery.ts`), esattamente come per Redfish/SSH/WinRM.
 */
export async function snmpValidateV3(
  ip: string,
  credentialId: number,
  opts?: { port?: number; timeoutMs?: number }
): Promise<SnmpV3ValidateResult> {
  const { getCredentialById } = await import("@/lib/db");
  const { safeDecrypt } = await import("@/lib/crypto");

  const cred = getCredentialById(credentialId);
  if (!cred) return { ok: false, error: "Credenziale non trovata" };
  if (String(cred.credential_type ?? "").toLowerCase() !== "snmp") {
    return { ok: false, error: "La credenziale non è di tipo SNMP" };
  }

  const username = cred.encrypted_username ? safeDecrypt(cred.encrypted_username) : null;
  if (!username || !username.trim()) {
    return { ok: false, error: "Username SNMPv3 mancante o non decifrabile" };
  }
  const authKey = cred.encrypted_auth_key ? safeDecrypt(cred.encrypted_auth_key) : null;
  const privKey = cred.encrypted_priv_key ? safeDecrypt(cred.encrypted_priv_key) : null;

  const built = buildV3Options({
    username,
    securityLevel: cred.security_level ?? "",
    authProtocol: cred.auth_protocol,
    authKey,
    privProtocol: cred.priv_protocol,
    privKey,
  });
  if (!built.ok) return { ok: false, error: built.error };

  const port = opts?.port ?? 161;
  const timeoutMs = opts?.timeoutMs ?? 5000;

  const snmp = await import("net-snmp");

  return new Promise((resolve) => {
    let done = false;
    let session: ReturnType<typeof snmp.createV3Session> | null = null;

    const finish = (result: SnmpV3ValidateResult) => {
      if (done) return;
      done = true;
      try {
        session?.close();
      } catch {
        /* socket già chiuso */
      }
      resolve(result);
    };

    const timer = setTimeout(() => finish({ ok: false, error: "Timeout SNMPv3 (nessuna risposta)" }), timeoutMs);

    try {
      session = snmp.createV3Session(ip, built.options, { port, timeout: Math.floor(timeoutMs * 0.6) });
      session.get([OID_SYSDESCR], (err, varbinds) => {
        clearTimeout(timer);
        if (err) {
          finish({ ok: false, error: (err.message ?? "Errore SNMPv3").slice(0, 300) });
          return;
        }
        const vb = varbinds?.[0];
        if (!vb || snmp.isVarbindError(vb)) {
          finish({ ok: false, error: "Nessuna risposta valida da sysDescr.0 (credenziali non valide o host non raggiungibile)" });
          return;
        }
        finish({ ok: true, sysDescr: stringifySnmpValue(vb.value) });
      });
    } catch (e) {
      clearTimeout(timer);
      finish({ ok: false, error: ((e as Error).message ?? "Errore SNMPv3").slice(0, 300) });
    }
  });
}
