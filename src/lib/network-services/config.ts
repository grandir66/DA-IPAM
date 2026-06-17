/**
 * Configurazione runtime del modulo network-services.
 *
 * Sorgente di verità (in priorità):
 *   1. hub.tenant_features (feature_key='network_services', config_json cifrato AES-GCM)
 *   2. fallback: env vars NET_SERVICES_API_URL + NET_SERVICES_API_TOKEN (backward-compat)
 *
 * Lo stato `configured=false` significa che la feature è installata ma manca la
 * config valida (raro) — la UI mostra il setup wizard.
 *
 * Vedi `src/lib/network-services/feature.ts` per install/uninstall/get state.
 */
import { getNetServicesState } from "./feature";

export interface NetServicesConfig {
  apiUrl: string;
  apiToken: string;
  enabled: boolean;
  configured: boolean;
}

/**
 * Async helper: legge config per il tenant corrente.
 * Da usare nei server component / API routes.
 */
export async function getNetServicesConfig(
  tenantCode: string,
): Promise<NetServicesConfig> {
  const state = await getNetServicesState(tenantCode);
  return {
    apiUrl: state.apiUrl,
    apiToken: state.apiToken,
    enabled: state.enabled,
    configured: state.configured,
  };
}
