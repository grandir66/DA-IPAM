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
 */
import type * as NetSnmp from "net-snmp";

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
