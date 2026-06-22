import {
  resolveDeviceAcquisition,
  deviceScanApiPath,
  type DeviceAcquisitionInput,
} from "@/lib/devices/device-acquisition-resolve";

type ScanProgress = {
  status: string;
  phase?: string;
};

/**
 * Avvia lo scan ottimale per il device e attende il completamento (sync Proxmox o poll query).
 * Usato da liste device, scheda oggetto e scheda device.
 */
export async function runDeviceAcquisitionScan(
  deviceId: number,
  device: DeviceAcquisitionInput,
  options?: {
    onProgress?: (progress: ScanProgress) => void;
    pollIntervalMs?: number;
    pollMaxAttempts?: number;
  }
): Promise<{ ok: boolean; message?: string; error?: string }> {
  const plan = resolveDeviceAcquisition(device);
  if (!plan.implemented) {
    return { ok: false, error: plan.notImplementedHint ?? `${plan.label} non ancora disponibile` };
  }

  const endpoint = deviceScanApiPath(deviceId, device);
  const res = await fetch(endpoint, { method: "POST" });
  const data = (await res.json()) as {
    error?: string;
    id?: string;
    progress?: ScanProgress;
    hosts?: unknown[];
    vms?: unknown[];
    message?: string;
  };

  if (!res.ok) {
    return { ok: false, error: data.error ?? "Errore durante lo scan" };
  }

  if (plan.scanEndpoint === "proxmox-scan") {
    return {
      ok: true,
      message: `Proxmox: ${data.hosts?.length ?? 0} nodi, ${data.vms?.length ?? 0} VM/CT`,
    };
  }

  if (data.id && data.progress) {
    const pollIntervalMs = options?.pollIntervalMs ?? 1500;
    const pollMaxAttempts = options?.pollMaxAttempts ?? 400;
    return new Promise((resolve) => {
      let attempts = 0;
      const poll = setInterval(async () => {
        attempts++;
        if (attempts >= pollMaxAttempts) {
          clearInterval(poll);
          resolve({ ok: false, error: "Timeout scan dopo 10 minuti" });
          return;
        }
        try {
          const pr = await fetch(`/api/scans/progress/${data.id}`);
          if (!pr.ok) return;
          const pd = (await pr.json()) as ScanProgress;
          options?.onProgress?.(pd);
          if (pd.status === "completed" || pd.status === "failed") {
            clearInterval(poll);
            if (pd.status === "completed") {
              resolve({ ok: true, message: pd.phase ?? "Scan completato" });
            } else {
              resolve({ ok: false, error: pd.phase ?? "Scan fallito" });
            }
          }
        } catch {
          /* retry next tick */
        }
      }, pollIntervalMs);
    });
  }

  return { ok: true, message: data.message ?? plan.label };
}
