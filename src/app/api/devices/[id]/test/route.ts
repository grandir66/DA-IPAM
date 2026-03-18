import { NextResponse } from "next/server";
import { getNetworkDeviceById, getCredentialById, getDeviceCredentials } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { createRouterClient } from "@/lib/devices/router-client";
import { createSwitchClient } from "@/lib/devices/switch-client";
import { createWinrmClient } from "@/lib/devices/winrm-client";
import { sshExec } from "@/lib/devices/ssh-helper";
import { ProxmoxClient } from "@/lib/proxmox/proxmox-client";
import { testProxmoxSsh } from "@/lib/proxmox/proxmox-ssh";

function isProxmoxDevice(device: { device_type?: string; protocol?: string; scan_target?: string | null }): boolean {
  const scanTarget = (device as { scan_target?: string | null }).scan_target;
  if (scanTarget === "windows" || scanTarget === "vmware" || scanTarget === "linux") return false;
  return scanTarget === "proxmox" || device.device_type === "hypervisor";
}

function isWindowsDevice(device: { vendor?: string; protocol?: string }): boolean {
  return device.protocol === "winrm" || device.vendor === "windows";
}

function isSshScannableDevice(device: { vendor?: string; protocol?: string }): boolean {
  return device.protocol === "ssh" && (device.vendor === "linux" || device.vendor === "other" || device.vendor === "synology" || device.vendor === "qnap");
}

/**
 * Testa la connessione a un dispositivo (router, switch o Proxmox).
 * GET /api/devices/[id]/test
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const device = getNetworkDeviceById(Number(id));
    if (!device) {
      return NextResponse.json({ error: "Dispositivo non trovato" }, { status: 404 });
    }

    const timeoutMs = 15000;
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Timeout: il dispositivo non ha risposto entro 15 secondi")), timeoutMs)
    );

    const testPromise = (async () => {
      if (isProxmoxDevice(device)) {
        let username = "root";
        let password = "";
        if (device.credential_id) {
          const cred = getCredentialById(device.credential_id);
          if (cred) {
            if (cred.encrypted_username) username = decrypt(cred.encrypted_username);
            if (cred.encrypted_password) password = decrypt(cred.encrypted_password);
          }
        }
        if (!password) {
          throw new Error("Configura le credenziali (SSH o API) per questo dispositivo. Per Proxmox usa root e password.");
        }
        const host = (device.api_url?.trim() || device.host).replace(/^https?:\/\//i, "").split(":")[0];

        if (device.protocol === "ssh") {
          const ok = await testProxmoxSsh({
            host,
            port: device.port ?? 22,
            username,
            password,
          });
          return { success: ok, device_type: "hypervisor" };
        }

        if (username && !username.includes("@")) username = `${username}@pam`;
        const hostOrUrl = device.api_url?.trim() || device.host;
        const client = new ProxmoxClient({
          host: hostOrUrl,
          port: device.port || 8006,
          username,
          password,
          verifySsl: false,
        });
        await client.login();
        return { success: true, device_type: "hypervisor" };
      }
      if (device.device_type === "router") {
        const client = await createRouterClient(device);
        const ok = await client.testConnection();
        return { success: ok, device_type: "router" };
      }
      if (isWindowsDevice(device)) {
        const client = await createWinrmClient(device);
        const ok = await client.testConnection();
        return { success: ok, device_type: "windows" };
      }
      if (isSshScannableDevice(device)) {
        const creds = getDeviceCredentials(device);
        const username = creds?.username ?? device.username ?? undefined;
        const password = creds?.password;
        if (!username || !password) {
          throw new Error("Credenziali mancanti. Assegna una credenziale di tipo Linux (SSH) al dispositivo.");
        }
        const host = device.host.replace(/^https?:\/\//i, "").split(":")[0];
        const res = await sshExec(
          { host, port: device.port ?? 22, username, password, timeout: 15000 },
          "hostname 2>/dev/null || echo ok"
        );
        return { success: res.code === 0, device_type: device.vendor === "synology" || device.vendor === "qnap" ? "storage" : "linux" };
      }
      const client = await createSwitchClient(device);
      const ok = await client.testConnection();
      return { success: ok, device_type: "switch" };
    })();

    const result = await Promise.race([testPromise, timeoutPromise]);
    return NextResponse.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Errore nel test di connessione";
    const device = getNetworkDeviceById(Number(id));
    const isWin = device && isWindowsDevice(device);
    let hint = "";
    if (isWin) {
      if (msg.includes("NTLM") || msg.includes("401")) {
        hint = " Su Windows: winrm set winrm/config/service/Auth '@{Basic=\"true\"}' e verifica che WinRM sia attivo.";
      } else if (msg.includes("Credenziali mancanti")) {
        hint = " Assegna una credenziale di tipo Windows al dispositivo.";
      } else if (msg.includes("Connessione rifiutata") || msg.includes("ECONNREFUSED")) {
        hint = " Su Windows: winrm quickconfig e verifica che la porta 5985 (HTTP) o 5986 (HTTPS) sia aperta.";
      }
    }
    return NextResponse.json(
      {
        success: false,
        error: msg + hint,
      },
      { status: 200 }
    );
  }
}
