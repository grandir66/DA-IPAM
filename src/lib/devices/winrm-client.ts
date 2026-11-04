/**
 * Client WinRM per interrogare host Windows via WMI/PowerShell.
 * Supporta Kerberos (auto-kinit), NTLM, CredSSP, Basic.
 *
 * Kerberos è il metodo preferito in ambienti Active Directory con GPO
 * che bloccano NTLM. Il realm viene recuperato dalla configurazione AD.
 */

import type { NetworkDevice } from "@/types";
import { getDeviceCredentials, getAdRealm } from "@/lib/db";
import { runWinrmCommand, type OpzioniWinrm } from "./winrm-run";

export interface WinrmClient {
  runCommand(command: string, usePowershell?: boolean): Promise<string>;
  /** `opzioni` solo da chi ha già passato i freni del logon: con la password non verificata, un logon solo. */
  testConnection(opzioni?: OpzioniWinrm): Promise<boolean>;
}

/**
 * L'accesso dell'apparato viene dal legame `wmi`: con quell'account WinRM non si prova. Sarebbe un login che fallisce a ogni
 * acquisizione, e su un account di dominio i login errati ripetuti sono il blocco dell'account.
 */
export class AccessoSoloWmiError extends Error {
  constructor(device: Pick<NetworkDevice, "name">) {
    super(`L'apparato «${device.name}» ha un accesso solo WMI: WinRM non si prova con questo account.`);
    this.name = "AccessoSoloWmiError";
  }
}

/** Per nome, non con `instanceof`: chi lo cerca importa questo modulo a runtime e sotto tsx può averne un'altra istanza. */
export function isAccessoSoloWmi(e: unknown): boolean {
  return e instanceof Error && e.name === "AccessoSoloWmiError";
}

export async function createWinrmClient(device: NetworkDevice, esegui: typeof runWinrmCommand = runWinrmCommand): Promise<WinrmClient> {
  const creds = getDeviceCredentials(device);
  if (creds?.protocollo === "wmi") throw new AccessoSoloWmiError(device);
  const username = creds?.username ?? "";
  const password = creds?.password ?? "";

  if (!username || !password) {
    throw new Error("Credenziali mancanti. Assegna una credenziale di tipo Windows al dispositivo.");
  }

  const host = device.host;
  const port = device.port || 5985;
  const adInfo = getAdRealm();
  const realm = adInfo?.realm || "";

  return {
    async runCommand(command: string, usePowershell = false): Promise<string> {
      return esegui(host, port, username, password, command, usePowershell, realm);
    },

    async testConnection(opzioni?: OpzioniWinrm): Promise<boolean> {
      try {
        const out = await esegui(host, port, username, password, "echo test", false, realm, opzioni);
        return out != null && String(out).trim().length >= 0;
      } catch {
        return false;
      }
    },
  };
}
