/**
 * Apertura delle sessioni SNMP a community (v1 / v2c), con la versione sempre esplicita.
 *
 * In net-snmp `createSession` SENZA `version` parla v1 (Version1 = 0) e
 * `version: 1` vuol dire v2c, non v1. Per anni la discovery ha forzato v2c
 * mentre lettura dati, client switch/router, sonda interfacce e test
 * credenziali parlavano v1 per caso. Qui ogni chiamante dichiara la versione.
 *
 * Per apparato la versione sta in `network_devices.snmp_version` ('1' | '2c'),
 * scritta dalla discovery (v2c, poi v1) o fissata a mano. NULL = come prima:
 * ogni punto passa la versione che usava prima di questo modulo
 * (`versioneApparato(device, comePrima)`), così un apparato non ancora
 * rilevato si comporta esattamente come prima.
 *
 * Incidente: DTS 2026-10-15, AP Ubiquiti 172.16.3.4-7 che rispondono solo in
 * v1 e in v2c vanno in timeout: rendere v2c esplicita ovunque li avrebbe spenti.
 * La prova `snmp-sessione.test.ts` fallisce se un `createSession(` compare
 * fuori da questo file.
 *
 * SNMPv3 (tappa 2 credenziali, T4, 15/10): cinque punti aprivano la sessione
 * v3 da soli, con authNoPriv e MD5 fissi, e una v3 authPriv SHA/AES non
 * entrava mai. Anche la sessione v3 si apre solo qui (`apriSessioneSnmp`),
 * con livello, protocolli e chiavi del record; `createV3Session(` fuori da
 * questo file fa fallire la stessa prova.
 *
 * Il modulo resta importabile dai componenti client: di net-snmp prende solo i
 * tipi, i valori (enum, funzioni) arrivano dal modulo passato da chi chiama.
 */
import type * as NetSnmp from "net-snmp";
import type { SnmpV3CredentialRecord } from "./snmpv3";

export type VersioneSnmp = "1" | "2c";

export const VERSIONI_SNMP: readonly VersioneSnmp[] = ["1", "2c"];

export function isVersioneSnmp(v: unknown): v is VersioneSnmp {
  return v === "1" || v === "2c";
}

/** Etichetta per registro e interfaccia: «v1», «v2c». */
export function etichettaVersioneSnmp(v: VersioneSnmp): string {
  return v === "2c" ? "v2c" : "v1";
}

/** Costante net-snmp della versione (Version1 = 0, Version2c = 1). */
export function versioneNetSnmp(snmp: Pick<typeof NetSnmp, "Version1" | "Version2c">, v: VersioneSnmp): number {
  return v === "2c" ? snmp.Version2c : snmp.Version1;
}

/**
 * Versione con cui parlare a un apparato: quella salvata, oppure — se NULL —
 * quella che quel punto del codice usava prima (`comePrima`).
 */
export function versioneApparato(
  device: { snmp_version?: string | null } | null | undefined,
  comePrima: VersioneSnmp
): VersioneSnmp {
  const v = device?.snmp_version;
  return isVersioneSnmp(v) ? v : comePrima;
}

export interface OpzioniSessioneCommunity {
  port?: number;
  timeout?: number;
  retries?: number;
  versione: VersioneSnmp;
}

/** L'unico punto del codice che apre una sessione SNMP a community. */
export function apriSessioneCommunity(
  snmp: Pick<typeof NetSnmp, "createSession" | "Version1" | "Version2c">,
  host: string,
  community: string,
  opzioni: OpzioniSessioneCommunity
): NetSnmp.Session {
  const { versione, ...resto } = opzioni;
  return snmp.createSession(host, community, { ...resto, version: versioneNetSnmp(snmp, versione) });
}

export type EsitoProvaVersioni =
  | { ok: true; versione: VersioneSnmp; varbinds: NetSnmp.Varbind[] }
  | { ok: false; errore: string };

/**
 * Prova un GET nelle versioni date, in ordine, e si ferma alla prima che
 * risponde. Per i test di una credenziale senza apparato: dice anche QUALE
 * versione ha risposto. La sessione si chiude una volta sola (timer e
 * risposta possono arrivare entrambi: DTS, 2026-10-15).
 */
export async function provaVersioniSnmp(
  snmp: Pick<typeof NetSnmp, "createSession" | "Version1" | "Version2c">,
  host: string,
  community: string,
  opzioni: { port: number; timeoutMs: number; oids: string[]; versioni?: readonly VersioneSnmp[] }
): Promise<EsitoProvaVersioni> {
  const errori: string[] = [];
  for (const versione of opzioni.versioni ?? ["2c", "1"]) {
    const esito = await new Promise<{ varbinds: NetSnmp.Varbind[] } | { errore: string }>((resolve) => {
      const session = apriSessioneCommunity(snmp, host, community, { port: opzioni.port, timeout: opzioni.timeoutMs, retries: 0, versione });
      let chiuso = false;
      const fine = (r: { varbinds: NetSnmp.Varbind[] } | { errore: string }): void => {
        if (chiuso) return;
        chiuso = true;
        clearTimeout(timer);
        try { session.close(); } catch { /* socket già chiuso */ }
        resolve(r);
      };
      const timer = setTimeout(() => fine({ errore: "timeout" }), opzioni.timeoutMs + 500);
      session.get(opzioni.oids, (err, varbinds) => fine(err ? { errore: err.message } : { varbinds }));
    });
    if ("varbinds" in esito) return { ok: true, versione, varbinds: esito.varbinds };
    errori.push(`${etichettaVersioneSnmp(versione)}: ${esito.errore}`);
  }
  return { ok: false, errore: errori.join("; ") };
}

// ── SNMPv3 ────────────────────────────────────────────────────────────────

export const SNMP_V3_AUTH_PROTOCOLS = ["MD5", "SHA", "SHA224", "SHA256", "SHA384", "SHA512"] as const;
export type SnmpV3AuthProtocol = (typeof SNMP_V3_AUTH_PROTOCOLS)[number];

/**
 * Codici ammessi a livello DB/UI (spec §7.1). AES256 è AES-256 di Blumenthal
 * (`aes256b`), il più diffuso; AES256C è quello di Reeder (`aes256r`), usato
 * dagli apparati Cisco. AES192 non esiste nella libreria e DES non lo sa fare
 * Node 22 (OpenSSL 3 senza il provider legacy): restano sceglibili per non
 * rompere le voci già salvate, ma si rifiutano prima della rete col motivo.
 */
export const SNMP_V3_PRIV_PROTOCOLS = ["DES", "AES", "AES192", "AES256", "AES256C"] as const;
export type SnmpV3PrivProtocol = (typeof SNMP_V3_PRIV_PROTOCOLS)[number];

export const SNMP_V3_SECURITY_LEVELS = ["noAuthNoPriv", "authNoPriv", "authPriv"] as const;
export type SnmpV3SecurityLevel = (typeof SNMP_V3_SECURITY_LEVELS)[number];

const ETICHETTE_PRIVACY_V3: Partial<Record<string, string>> = { AES256C: "AES-256 (Cisco)" };

/** Etichetta di un protocollo di privacy SNMPv3 per le tendine: il codice, salvo AES256C. */
export function etichettaPrivacyV3(codice: string): string {
  return ETICHETTE_PRIVACY_V3[codice] ?? codice;
}

/** Protocolli di privacy che si rifiutano prima della rete, col perché. */
const PRIVACY_NON_SUPPORTATA: Partial<Record<string, string>> = {
  DES: "DES non è supportato da Node 22: usa AES",
  AES192: 'Protocollo di privacy SNMPv3 "AES192" non supportato dalla libreria SNMP disponibile (usa AES o AES256)',
};

type EnumV3 = Pick<typeof NetSnmp, "SecurityLevel" | "AuthProtocols" | "PrivProtocols">;

export type EsitoOpzioniV3 = { ok: true; user: NetSnmp.V3User } | { ok: false; motivo: string };

/**
 * Opzioni net-snmp (utente v3) da un record già DECIFRATO. Nessuna rete, non
 * lancia mai. Rifiuta: utente mancante, livello sconosciuto, protocollo o
 * chiave d'autenticazione mancanti (authNoPriv/authPriv), protocollo o chiave
 * di privacy mancanti o non supportati (authPriv). I motivi sono in italiano
 * e non contengono mai le chiavi.
 */
export function opzioniSessioneV3(snmp: EnumV3, cred: SnmpV3CredentialRecord): EsitoOpzioniV3 {
  const name = (cred.username ?? "").trim();
  if (!name) return { ok: false, motivo: "Username SNMPv3 mancante" };

  const level = cred.securityLevel;
  if (level !== "noAuthNoPriv" && level !== "authNoPriv" && level !== "authPriv") {
    return { ok: false, motivo: `security_level SNMPv3 non riconosciuto: "${String(level)}" (livelli ammessi: ${SNMP_V3_SECURITY_LEVELS.join(", ")})` };
  }
  if (level === "noAuthNoPriv") return { ok: true, user: { name, level: snmp.SecurityLevel.noAuthNoPriv } };

  const auth: Partial<Record<string, NetSnmp.AuthProtocols>> = {
    MD5: snmp.AuthProtocols.md5,
    SHA: snmp.AuthProtocols.sha,
    SHA224: snmp.AuthProtocols.sha224,
    SHA256: snmp.AuthProtocols.sha256,
    SHA384: snmp.AuthProtocols.sha384,
    SHA512: snmp.AuthProtocols.sha512,
  };
  const authProtocol = auth[(cred.authProtocol ?? "").trim().toUpperCase()];
  if (!authProtocol) {
    return {
      ok: false,
      motivo: `Protocollo di autenticazione SNMPv3 non riconosciuto: "${cred.authProtocol ?? ""}" (ammessi: ${SNMP_V3_AUTH_PROTOCOLS.join(", ")})`,
    };
  }
  const authKey = (cred.authKey ?? "").trim();
  if (!authKey) return { ok: false, motivo: "Chiave di autenticazione SNMPv3 mancante (richiesta per authNoPriv/authPriv)" };
  if (level === "authNoPriv") return { ok: true, user: { name, level: snmp.SecurityLevel.authNoPriv, authProtocol, authKey } };

  const codicePriv = (cred.privProtocol ?? "").trim().toUpperCase();
  if (!codicePriv) return { ok: false, motivo: "Protocollo di privacy SNMPv3 mancante (richiesto per authPriv)" };
  const nonSupportata = PRIVACY_NON_SUPPORTATA[codicePriv];
  if (nonSupportata) return { ok: false, motivo: nonSupportata };
  const priv: Partial<Record<string, NetSnmp.PrivProtocols>> = {
    AES: snmp.PrivProtocols.aes,
    AES256: snmp.PrivProtocols.aes256b,
    AES256C: snmp.PrivProtocols.aes256r,
  };
  const privProtocol = priv[codicePriv];
  if (!privProtocol) {
    return {
      ok: false,
      motivo: `Protocollo di privacy SNMPv3 non riconosciuto: "${cred.privProtocol ?? ""}" (ammessi: ${SNMP_V3_PRIV_PROTOCOLS.join(", ")})`,
    };
  }
  const privKey = (cred.privKey ?? "").trim();
  if (!privKey) return { ok: false, motivo: "Chiave di privacy SNMPv3 mancante (richiesta per authPriv)" };
  return { ok: true, user: { name, level: snmp.SecurityLevel.authPriv, authProtocol, authKey, privProtocol, privKey } };
}

/** Credenziale con cui aprire una sessione: una community (v1/v2c) o un record v3 decifrato. */
export type CredenzialeSnmp = { forma: "community"; community: string } | { forma: "v3"; record: SnmpV3CredentialRecord };

/** Messaggio unico per un apparato `snmp_v3` senza una v3 leggibile: non si ripiega sulla community. */
export const V3_ASSENTE = "Credenziale SNMPv3 assente o illeggibile";

type ModuloSnmp = Pick<typeof NetSnmp, "createSession" | "createV3Session" | "Version1" | "Version2c"> & EnumV3;

/**
 * L'unico punto del codice che apre una sessione SNMP v3, e l'ingresso per
 * le due forme: la community passa da `apriSessioneCommunity` con la versione
 * dichiarata (obbligatoria), la v3 da `createV3Session` con le opzioni del
 * record. Non lancia: opzioni incoerenti o una sessione che non si apre sono
 * un `ok: false` col motivo, senza segreti.
 */
export function apriSessioneSnmp(
  snmp: ModuloSnmp,
  host: string,
  cred: CredenzialeSnmp,
  opts: { port: number; timeout: number; retries?: number; versione: VersioneSnmp | null }
): { ok: true; session: NetSnmp.Session } | { ok: false; motivo: string } {
  const { versione, ...sessione } = opts;
  if (sessione.retries === undefined) delete sessione.retries;
  try {
    if (cred.forma === "community") {
      if (!versione) return { ok: false, motivo: "Versione SNMP non indicata per la community (v1 o v2c)" };
      return { ok: true, session: apriSessioneCommunity(snmp, host, cred.community, { ...sessione, versione }) };
    }
    const o = opzioniSessioneV3(snmp, cred.record);
    if (!o.ok) return o;
    return { ok: true, session: snmp.createV3Session(host, o.user, sessione) };
  } catch (e) {
    return { ok: false, motivo: `Sessione SNMP non aperta: ${e instanceof Error ? e.message : String(e)}` };
  }
}
