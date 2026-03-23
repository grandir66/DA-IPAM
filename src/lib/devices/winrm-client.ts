/**
 * Client WinRM per interrogare host Windows via WMI/PowerShell.
 * Supporta Kerberos (auto-kinit), NTLM, CredSSP, Basic.
 *
 * Kerberos è il metodo preferito in ambienti Active Directory con GPO
 * che bloccano NTLM. Il realm viene recuperato dalla configurazione AD.
 */

import type { NetworkDevice } from "@/types";
import { getDeviceCredentials, getAdRealm } from "@/lib/db";
import { runWinrmCommand } from "./winrm-run";

export interface WinrmClient {
  runCommand(command: string, usePowershell?: boolean): Promise<string>;
  testConnection(): Promise<boolean>;
}

export async function createWinrmClient(device: NetworkDevice): Promise<WinrmClient> {
  const creds = getDeviceCredentials(device);
  const username = creds?.username ?? device.username ?? "";
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
      return runWinrmCommand(host, port, username, password, command, usePowershell, realm);
    },

    async testConnection(): Promise<boolean> {
      try {
        const out = await runWinrmCommand(host, port, username, password, "echo test", false, realm);
        return out != null && String(out).trim().length >= 0;
      } catch {
        return false;
      }
    },
  };
}
