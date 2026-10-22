/**
 * Salute del modulo MDM (Headwind) dalla sua sincronizzazione (analisi del 19/10,
 * F11). Modulo puro: nessuna sonda di rete in più, si legge l'esito di `mdm_sync`
 * scritto in `mdm_config` (`integrations/mdm-config.ts`).
 */
import type { MdmConfig } from "@/lib/integrations/mdm-config";

export interface SaluteMdm {
  verdict: "ok" | "degraded" | "fail" | "off" | "unverified";
  detail: string;
  lastSyncAt: string | null;
}

export function saluteMdm(c: MdmConfig): SaluteMdm {
  const lastSyncAt = c.last_success_at ?? c.last_sync_at;
  if (c.auto_disabled) {
    return {
      verdict: "fail",
      detail: `spento da solo dopo ${c.consecutive_errors} errori di fila${c.last_error ? `: ${c.last_error}` : ""}`,
      lastSyncAt,
    };
  }
  if (!c.enabled) return { verdict: "off", detail: "Spento", lastSyncAt };
  if (c.consecutive_errors > 0) {
    return {
      verdict: c.last_success_at ? "degraded" : "fail",
      detail: `${c.consecutive_errors} sincronizzazioni fallite di fila${c.last_error ? `: ${c.last_error}` : ""}`,
      lastSyncAt,
    };
  }
  if (!c.last_success_at) return { verdict: "unverified", detail: "Nessuna sincronizzazione ancora riuscita", lastSyncAt };
  return { verdict: "ok", detail: "Ultima sincronizzazione riuscita", lastSyncAt };
}
