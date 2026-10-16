/**
 * SNMP v3 completo (authPriv) — Attribution v2 Fase 4b Task 2 (spec §7.4/§7.1).
 *
 * Fino alla tappa 2 credenziali (T4, 15/10) cinque sessioni v3 degli apparati
 * avevano `authNoPriv` + MD5 fissi, mai `privKey`. Ora ogni sessione v3 si apre
 * con `apriSessioneSnmp` (snmp-sessione.ts), con authProtocol/privProtocol e
 * chiavi della credenziale. Qui restano il record, la validazione dedicata
 * (`snmpValidateV3`) per il ramo `credential_validate` di `discovery.ts`
 * (apparati enterprise dove v2c è disabilitato per policy) e `provaV3`, il GET
 * di prova usato anche dalla prova di binding e credenziale.
 *
 * `buildV3Options` è PURA e testabile senza rete: costruisce (o rifiuta) i
 * parametri di sessione net-snmp da un record credenziale già decifrato,
 * PRIMA che si apra una sola socket (Global Constraints: "nessuno sweep",
 * gate anti-lockout lato chiamante). Le combinazioni incoerenti (es. authPriv
 * senza privKey) sono rifiutate con un errore parlante in italiano — mai un
 * tentativo di rete su parametri incompleti.
 *
 * Sicurezza: gli errori restituiti non includono MAI la chiave di
 * autenticazione/privacy, solo nomi di protocollo/livello (Global Constraints
 * "nessun segreto nei log").
 */
import { AuthProtocols, PrivProtocols, SecurityLevel } from "net-snmp";
import { stringifySnmpValue } from "../scanner/snmp-query";
import { leggiSegretoDb } from "../credentials/segreti";
import { apriSessioneSnmp, opzioniSessioneV3 } from "./snmp-sessione";

// Tappa 2 credenziali, T4: costanti e opzioni stanno in snmp-sessione.ts, che
// apre ogni sessione v3 ed è importabile dal client. Qui restano riesportate
// per chi le prende da questo modulo (validators.ts, credentials/tipi.ts).
export {
  SNMP_V3_AUTH_PROTOCOLS,
  SNMP_V3_PRIV_PROTOCOLS,
  SNMP_V3_SECURITY_LEVELS,
  type SnmpV3AuthProtocol,
  type SnmpV3PrivProtocol,
  type SnmpV3SecurityLevel,
} from "./snmp-sessione";

const OID_SYSDESCR = "1.3.6.1.2.1.1.1.0";

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

/**
 * Costruisce i parametri di sessione SNMPv3 da un record credenziale
 * decifrato — PURA, nessuna rete. È `opzioniSessioneV3` (snmp-sessione.ts) con
 * gli enum di net-snmp: rifiuta PRIMA di toccare la rete utente mancante,
 * livello sconosciuto, protocollo o chiave mancanti, AES192 (assente nella
 * libreria) e DES (Node 22 non lo sa fare). AES256 = Blumenthal, AES256C =
 * Reeder («AES-256 (Cisco)»).
 *
 * Non lancia MAI eccezioni: qualunque input malformato produce `{ok:false}`
 * con un messaggio in italiano, senza includere authKey/privKey (Global
 * Constraints "nessun segreto nei log").
 */
export function buildV3Options(cred: SnmpV3CredentialRecord): BuildV3OptionsResult {
  const r = opzioniSessioneV3({ AuthProtocols, PrivProtocols, SecurityLevel }, cred);
  return r.ok ? { ok: true, options: r.user } : { ok: false, error: r.motivo };
}

export interface SnmpV3ValidateResult {
  ok: boolean;
  sysDescr?: string | null;
  error?: string;
}

/**
 * Valida una credenziale SNMPv3 su `ip:port` interrogando `sysDescr.0`.
 * Legge la voce con `leggiSegretoDb` (tappa 2 credenziali, T3: accetta
 * `snmp_v3`, oppure `snmp` con `security_level`) e la prova con `provaV3`.
 * Non lancia mai: qualunque errore (credenziale assente, chiave incoerente,
 * timeout, autenticazione rifiutata) risolve a `{ok:false,error}`.
 * Il gate anti-lockout (`CredentialRunBudget`/`recordCredentialSuccess`/
 * `recordCredentialFailure`) resta responsabilità del chiamante
 * (`scanner/discovery.ts`), esattamente come per Redfish/SSH/WinRM.
 */
export async function snmpValidateV3(
  ip: string,
  credentialId: number,
  opts?: { port?: number; timeoutMs?: number }
): Promise<SnmpV3ValidateResult> {
  const { getDb } = await import("@/lib/db");

  // Un lettore solo (credentials/segreti.ts): vale una voce snmp_v3, o snmp con
  // security_level. Una community non si prova come v3.
  const esito = leggiSegretoDb(getDb(), credentialId, "snmp");
  if (!esito.ok) return { ok: false, error: esito.motivo };
  if (esito.segreto.forma !== "v3") {
    return { ok: false, error: `La credenziale «${esito.nome}» è una community SNMP v1/v2c, non una SNMPv3` };
  }
  return provaV3(ip, esito.segreto.record, opts);
}

/**
 * Un GET di `sysDescr.0` in v3 con un record già decifrato: la sessione si
 * apre con `apriSessioneSnmp` (rifiuto PRIMA della rete su opzioni
 * incoerenti) e si chiude una volta sola. Non lancia mai. La usano la
 * validazione della discovery, la prova di un binding e la prova di una
 * credenziale (tappa 2 credenziali, T4).
 */
export async function provaV3(
  ip: string,
  record: SnmpV3CredentialRecord,
  opts?: { port?: number; timeoutMs?: number }
): Promise<SnmpV3ValidateResult> {
  const port = opts?.port ?? 161;
  const timeoutMs = opts?.timeoutMs ?? 5000;

  const snmp = await import("net-snmp");
  const aperta = apriSessioneSnmp(snmp, ip, { forma: "v3", record }, { port, timeout: Math.floor(timeoutMs * 0.6), versione: null });
  if (!aperta.ok) return { ok: false, error: aperta.motivo };
  const session = aperta.session;

  return new Promise((resolve) => {
    let done = false;
    const finish = (result: SnmpV3ValidateResult) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        session.close();
      } catch {
        /* socket già chiuso */
      }
      resolve(result);
    };

    const timer = setTimeout(() => finish({ ok: false, error: "Timeout SNMPv3 (nessuna risposta)" }), timeoutMs);

    try {
      session.get([OID_SYSDESCR], (err, varbinds) => {
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
      finish({ ok: false, error: ((e as Error).message ?? "Errore SNMPv3").slice(0, 300) });
    }
  });
}
