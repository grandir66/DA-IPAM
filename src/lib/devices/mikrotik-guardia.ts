/**
 * Chi può leggere cosa da GET /api/devices/[id]/mikrotik. L'export completo della configurazione RouterOS
 * (`action=config`, e `exportFull` dentro `action=all`) è solo dell'amministratore; lease, server e pool DHCP
 * restano a chi ha la sessione. Puro: la rotta ci passa il ruolo della sessione.
 */
const ADMIN = new Set(["admin", "superadmin"]);
const AZIONI_SOLO_ADMIN = new Set(["config"]);

export type EsitoAzione = { ok: true } | { ok: false; status: 403; error: string };

export function esitoAzioneMikrotik(action: string, ruolo: string | undefined): EsitoAzione {
  if (AZIONI_SOLO_ADMIN.has(action) && !ADMIN.has(ruolo ?? "")) {
    return { ok: false, status: 403, error: "Richiesti privilegi di amministratore" };
  }
  return { ok: true };
}

/** Per un non admin la configurazione perde l'export e tiene l'identità del sistema (versione, scheda, uptime). */
export function configPerRuolo<C extends { exportFull?: string; exportCompact?: string; systemInfo?: unknown }>(
  config: C | null | undefined,
  ruolo: string | undefined,
): C | { exportFull: string; systemInfo?: unknown } | null {
  if (!config) return null;
  if (ADMIN.has(ruolo ?? "")) return config;
  return { exportFull: "", ...(config.systemInfo !== undefined ? { systemInfo: config.systemInfo } : {}) };
}
