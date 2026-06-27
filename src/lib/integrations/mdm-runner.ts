import { getMdmConfig, getMdmCreds, recordSync } from "@/lib/integrations/mdm-config";
import { loginJwt, searchDevices, getDeviceInfo } from "@/lib/integrations/hmdm-client";
import { applyDevice } from "@/lib/integrations/mdm-sync";

/**
 * Sync completo del tenant corrente: pull paginato dei device da Headwind + arricchimento
 * per-device (plugin deviceinfo) + map in DA-IPAM. Da invocare dentro
 * `withTenant(code, () => runMdmSync())` — il contesto AsyncLocalStorage propaga sugli await.
 */
export async function runMdmSync(): Promise<{ devices: number; changed: number; error?: string }> {
  const cfg = getMdmConfig();
  if (!cfg.enabled) return { devices: 0, changed: 0, error: "disabled" };
  const creds = getMdmCreds();
  if (!creds) {
    recordSync(false, "no credentials");
    return { devices: 0, changed: 0, error: "no credentials" };
  }
  try {
    const jwt = await loginJwt(creds);
    let page = 1; // hmdm pageNum is 1-based (0 → 500 OFFSET error)
    const pageSize = 50;
    let total = 0;
    let changed = 0;
    for (;;) {
      const batch = await searchDevices(creds.baseUrl, jwt, page, pageSize);
      if (batch.length === 0) break;
      for (const dv of batch) {
        const di = await getDeviceInfo(creds.baseUrl, jwt, dv.number).catch(() => null);
        const r = applyDevice(dv, di);
        total++;
        if (!r.deduped) changed += r.changes;
      }
      if (batch.length < pageSize) break;
      page++;
    }
    recordSync(true);
    return { devices: total, changed };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "sync error";
    recordSync(false, msg);
    return { devices: 0, changed: 0, error: msg };
  }
}
