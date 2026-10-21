/**
 * Chi può leggere cosa da GET /api/devices/[id]/mikrotik. L'export completo della configurazione RouterOS
 * (`action=config`, e `exportFull` dentro `action=all`) è solo dell'amministratore; lease, server e pool DHCP
 * restano a chi ha la sessione. Puro: la rotta ci passa il ruolo della sessione.
 */
import { ripulisciExport } from "@/lib/scheda/mikrotik";

const ADMIN = new Set(["admin", "superadmin"]);
const AZIONI_SOLO_ADMIN = new Set(["config"]);

export type EsitoAzione = { ok: true } | { ok: false; status: 403; error: string };

export function esitoAzioneMikrotik(action: string, ruolo: string | undefined): EsitoAzione {
  if (AZIONI_SOLO_ADMIN.has(action) && !ADMIN.has(ruolo ?? "")) {
    return { ok: false, status: 403, error: "Richiesti privilegi di amministratore" };
  }
  return { ok: true };
}

/**
 * Per un non admin la configurazione perde l'export e tiene l'identità del sistema (versione, scheda, uptime).
 * Per l'admin i due export passano da `ripulisciExport` QUI, sul server (22/10): `/system script` e
 * `/system scheduler` sui router con lo script di backup del Manager portano la password SFTP, e la vecchia pagina
 * /devices/[id] mostrava e scaricava l'export così com'era. `exportTolte` dice quali sezioni sono state tolte (nome senza «/»).
 */
export function configPerRuolo<C extends { exportFull?: string; exportCompact?: string; systemInfo?: unknown }>(
  config: C | null | undefined,
  ruolo: string | undefined,
): (C & { exportTolte: string[] }) | { exportFull: string; systemInfo?: unknown } | null {
  if (!config) return null;
  if (ADMIN.has(ruolo ?? "")) {
    const full = typeof config.exportFull === "string" ? ripulisciExport(config.exportFull) : null;
    const compact = typeof config.exportCompact === "string" ? ripulisciExport(config.exportCompact) : null;
    // senza la «/» iniziale: la risposta non contiene mai il testo «/system script» né «/system scheduler»
    const tolte = [...new Set([...(full?.tolte ?? []), ...(compact?.tolte ?? [])].map((t) => t.replace(/^\//, "")))];
    return {
      ...config,
      ...(full ? { exportFull: full.testo } : {}),
      ...(compact ? { exportCompact: compact.testo } : {}),
      exportTolte: tolte,
    };
  }
  return { exportFull: "", ...(config.systemInfo !== undefined ? { systemInfo: config.systemInfo } : {}) };
}
