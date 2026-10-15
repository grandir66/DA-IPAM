/**
 * «Prova» di una credenziale SNMP su un host (POST /api/credentials/[id]/test),
 * tappa 2 credenziali, T4, 15/10. Sta fuori dalla rotta per poterla provare:
 * la rotta passa dall'autenticazione e qui si riceve l'handle del DB.
 *
 * Prima la rotta sapeva solo la community: una voce v3 rispondeva «Community
 * string mancante», e senza porta nel corpo si provava sempre la 161, anche
 * quando la voce ha la sua (tappa 1). Ora:
 * - il ramo si decide dalla forma del segreto (`leggiSegretoDb(…, "snmp")`);
 * - community: v2c, poi v1, e si dice quale ha risposto (com'era);
 * - v3: un GET di sysDescr con livello, protocolli e chiavi della voce;
 * - porta: quella chiesta, poi quella della voce, poi la 161.
 *
 * Non importa né `db.ts` né `db-tenant.ts`. Non scrive: la rotta registra
 * l'esito riuscito sull'host.
 */
import type Database from "better-sqlite3";
import { leggiSegretoDb } from "./segreti";
import { portaCredenziale } from "./porte";
import { etichettaVersioneSnmp, provaVersioniSnmp, type VersioneSnmp } from "@/lib/protocols/snmp-sessione";
import { provaV3 } from "@/lib/protocols/snmpv3";

const OID_SYSDESCR = "1.3.6.1.2.1.1.1.0";

export type EsitoProvaCredenzialeSnmp =
  | { success: true; message: string; port: number; snmp_version?: VersioneSnmp }
  | { success: false; error: string };

export async function provaCredenzialeSnmpDb(
  dbh: Database.Database,
  credentialId: number,
  host: string,
  portaChiesta: number | null,
  opz: { timeoutMs?: number } = {}
): Promise<EsitoProvaCredenzialeSnmp> {
  const esito = leggiSegretoDb(dbh, credentialId, "snmp");
  if (!esito.ok) return { success: false, error: esito.motivo };
  const port = portaChiesta ?? portaCredenziale({ port: esito.port }, "snmp");
  const timeoutMs = opz.timeoutMs ?? 8000;

  if (esito.segreto.forma === "v3") {
    const v3 = await provaV3(host, esito.segreto.record, { port, timeoutMs });
    return v3.ok
      ? { success: true, message: "Connessione SNMPv3 riuscita", port }
      : { success: false, error: `Connessione SNMPv3 fallita (${v3.error ?? "autenticazione non riuscita"})` };
  }
  if (esito.segreto.forma !== "community") {
    return { success: false, error: `La credenziale «${esito.nome}» non ha una forma SNMP` };
  }

  const snmp = await import("net-snmp");
  // Senza apparato non si sa la versione: v2c, poi v1, e si dice quale ha risposto.
  const r = await provaVersioniSnmp(snmp, host, esito.segreto.community, { port, timeoutMs, oids: [OID_SYSDESCR] });
  if (!r.ok) return { success: false, error: `Connessione SNMP fallita (${r.errore})` };
  return { success: true, message: `Connessione SNMP riuscita (${etichettaVersioneSnmp(r.versione)})`, port, snmp_version: r.versione };
}
