/**
 * La richiesta al collector, costruita nel backend (piano C1.2): i segreti si leggono dall'archivio solo qui, solo per
 * le voci della fonte (una per protocollo, quella mostrata nella scheda) e non escono mai da questo processo. Una voce
 * illeggibile o di forma sbagliata non fa passare alla voce dopo: è un esito detto (budget anti-lockout: un tentativo
 * per pressione del pulsante, nessuna seconda credenziale, nemmeno dopo un'uscita parziale).
 */
import type { AcquisitionRequest, CollectorId } from "@/lib/acquisition";
import type { ProtocolloCollector } from "@/lib/acquisition/catalogo";
import { leggiSegretoDb, type Segreto, type UsoSegreto } from "@/lib/credentials/segreti";
import type Database from "better-sqlite3";
import type { CredenzialiProposte } from "./fonte";

export type RichiestaCostruita =
  | { ok: true; richiesta: AcquisitionRequest; segreti: string[] }
  | { ok: false; codice: string; motivo: string };

export interface ApparatoPerRichiesta {
  host: string;
  protocol: string;
  snmp_version?: string | null;
}

/** Legge un segreto per id, già noto: nessuna scelta, nessun ripiego. */
export type LettoreSegreto = (credentialId: number, uso: UsoSegreto, apparatoV3: boolean) => { ok: true; segreto: Segreto } | { ok: false; motivo: string };

export function lettoreDb(dbh: Database.Database): LettoreSegreto {
  return (id, uso, apparatoV3) => {
    const e = leggiSegretoDb(dbh, id, uso, { apparatoV3 });
    return e.ok ? { ok: true, segreto: e.segreto } : { ok: false, motivo: e.motivo };
  };
}

function segretiDi(s: Segreto): string[] {
  switch (s.forma) {
    case "utente": return [s.password];
    case "chiave_ssh": return [s.privateKey, s.passphrase ?? ""];
    case "community": return [s.community];
    case "v3": return [s.record.authKey ?? "", s.record.privKey ?? ""];
    case "token": return [s.token];
    case "chiave_api": return [s.chiave];
    case "client": return [s.clientSecret];
  }
}

const USO: Record<ProtocolloCollector, UsoSegreto> = { ssh: "ssh", snmp: "snmp", api: "api", winrm: "winrm" };

export function costruisciRichiesta(collector: CollectorId, device: ApparatoPerRichiesta, credenziali: CredenzialiProposte, leggi: LettoreSegreto): RichiestaCostruita {
  const richiesta: Record<string, unknown> = { collector, host: device.host };
  const segreti: string[] = [];
  for (const [p, c] of Object.entries(credenziali) as Array<[ProtocolloCollector, NonNullable<CredenzialiProposte[ProtocolloCollector]>]>) {
    const letto = leggi(c.credential_id, USO[p], p === "snmp" && device.protocol === "snmp_v3");
    if (!letto.ok) return { ok: false, codice: "CREDENTIAL_UNREADABLE", motivo: `Credenziale «${c.nome}» illeggibile: ${letto.motivo}` };
    const s = letto.segreto;
    segreti.push(...segretiDi(s).filter((x) => x.length > 0));
    const sbagliata = (): RichiestaCostruita => ({ ok: false, codice: "CREDENTIAL_FORM_UNSUPPORTED", motivo: `La credenziale «${c.nome}» non ha la forma che ${p.toUpperCase()} chiede` });
    if (p === "ssh") {
      if (s.forma === "utente") richiesta.ssh = { username: s.username, password: s.password, port: c.port };
      else if (s.forma === "chiave_ssh") richiesta.ssh = { username: s.username, privateKey: s.privateKey, ...(s.passphrase ? { passphrase: s.passphrase } : {}), port: c.port };
      else return sbagliata();
    } else if (p === "snmp") {
      if (s.forma === "community") richiesta.snmp = { community: s.community, version: device.snmp_version === "1" ? "1" : "2c", port: c.port };
      else if (s.forma === "v3") {
        const r = s.record;
        richiesta.snmp = {
          version: "3", username: r.username, level: r.securityLevel, port: c.port,
          ...(r.authProtocol ? { authProtocol: r.authProtocol } : {}), ...(r.authKey ? { authKey: r.authKey } : {}),
          ...(r.privProtocol ? { privProtocol: r.privProtocol } : {}), ...(r.privKey ? { privKey: r.privKey } : {}),
        };
      } else return sbagliata();
    } else if (p === "api" || p === "winrm") {
      if (s.forma !== "utente") return sbagliata();
      richiesta[p] = { username: s.username, password: s.password, port: c.port };
    }
  }
  return { ok: true, richiesta: richiesta as AcquisitionRequest, segreti };
}
