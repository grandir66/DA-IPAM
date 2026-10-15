/**
 * Agente SNMPv3 vero (quello di net-snmp) su una porta UDP locale, per le prove
 * della tappa 2 credenziali (T4, 15/10).
 *
 * L'agente finto a community (`agente-snmp-finto.ts`) non sa la v3: per provare
 * davvero autenticazione e cifratura serve l'agente della libreria, con un
 * utente (`authorizer.addUser`) e due scalari nel MIB (sysDescr, sysObjectID).
 * Una chiave sbagliata l'agente la scarta in silenzio, come un apparato vero:
 * chi chiama vede un timeout. Gli errori dell'agente (digest diverso, PDU non
 * decifrabile) si raccolgono in `errori`, senza stamparli.
 *
 * net-snmp ascolta sulla 161 se la porta è 0: la porta libera si prende prima
 * con un socket di passaggio. Il socket dell'agente si cattura con
 * `dgramModule`, così si aspetta che sia davvero in ascolto prima di usarlo.
 */
import dgram from "node:dgram";
import type { AddressInfo } from "node:net";
import * as snmp from "net-snmp";

export const OID_SYSDESCR = "1.3.6.1.2.1.1.1.0";
export const OID_SYSOBJECTID = "1.3.6.1.2.1.1.2.0";

export interface AgenteV3 {
  porta: number;
  /** Messaggi d'errore dell'agente (autenticazione o cifratura fallite). */
  errori: string[];
  chiudi(): Promise<void>;
}

async function portaLibera(): Promise<number> {
  const s = dgram.createSocket("udp4");
  await new Promise<void>((resolve, reject) => {
    s.once("error", reject);
    s.bind(0, "127.0.0.1", () => resolve());
  });
  const porta = (s.address() as AddressInfo).port;
  await new Promise<void>((resolve) => s.close(() => resolve()));
  return porta;
}

export async function avviaAgenteV3(opzioni: {
  utente: snmp.V3User;
  sysDescr?: string;
  sysObjectID?: string;
}): Promise<AgenteV3> {
  const porta = await portaLibera();
  const errori: string[] = [];
  let socket: dgram.Socket | null = null;
  const agente = snmp.createAgent(
    {
      port: porta,
      address: "127.0.0.1",
      dgramModule: {
        createSocket: (tipo) => {
          socket = dgram.createSocket(tipo);
          return socket;
        },
      },
    },
    (errore) => {
      if (errore) errori.push(errore.message);
    }
  );
  const s = socket as dgram.Socket | null;
  if (!s) throw new Error("agente SNMPv3: socket non creato");
  await new Promise<void>((resolve, reject) => {
    s.once("error", reject);
    s.once("listening", () => resolve());
  });

  agente.getAuthorizer().addUser(opzioni.utente);
  const mib = agente.getMib();
  if (opzioni.sysDescr != null) {
    mib.registerProvider({
      name: "sysDescr",
      type: snmp.MibProviderType.Scalar,
      oid: "1.3.6.1.2.1.1.1",
      scalarType: snmp.ObjectType.OctetString,
      maxAccess: snmp.MaxAccess["read-only"],
    });
    mib.setScalarValue("sysDescr", opzioni.sysDescr);
  }
  if (opzioni.sysObjectID != null) {
    mib.registerProvider({
      name: "sysObjectID",
      type: snmp.MibProviderType.Scalar,
      oid: "1.3.6.1.2.1.1.2",
      scalarType: snmp.ObjectType.OID,
      maxAccess: snmp.MaxAccess["read-only"],
    });
    mib.setScalarValue("sysObjectID", opzioni.sysObjectID);
  }

  return {
    porta,
    errori,
    chiudi: () => new Promise<void>((resolve) => agente.close(() => resolve())),
  };
}

/** Utente authPriv SHA/AES-128, il caso che oggi nessuna sessione sa aprire. */
export function utenteShaAes(nome = "monitor", authKey = "chiave-auth-123", privKey = "chiave-priv-456"): snmp.V3User {
  return {
    name: nome,
    level: snmp.SecurityLevel.authPriv,
    authProtocol: snmp.AuthProtocols.sha,
    authKey,
    privProtocol: snmp.PrivProtocols.aes,
    privKey,
  };
}
