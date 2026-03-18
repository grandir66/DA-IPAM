/**
 * Client WinRM per interrogare host Windows via WMI/PowerShell.
 * Supporta HTTP (5985) e HTTPS (5986) con timeout e messaggi di errore chiari.
 *
 * Requisiti sul host Windows (PowerShell come Admin):
 *   winrm quickconfig
 *   winrm set winrm/config/service/Auth '@{Basic="true"}'
 *   winrm set winrm/config/service '@{AllowUnencrypted="true"}'
 *   winrm set winrm/config/winrs '@{MaxMemoryPerShellMB="1024"}'
 */

import type { NetworkDevice } from "@/types";
import { getDeviceCredentials } from "@/lib/db";
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

  return {
    async runCommand(command: string, usePowershell = false): Promise<string> {
      return runWinrmCommand(host, port, username, password, command, usePowershell);
    },

    async testConnection(): Promise<boolean> {
      try {
        const out = await runWinrmCommand(host, port, username, password, "echo test", false);
        return out != null && String(out).trim().length >= 0;
      } catch {
        return false;
      }
    },
  };
}
