/**
 * Configurazione del modulo network-services.
 * Legge l'URL del bridge FastAPI sulla VM dedicata 192.168.99.52
 * e il token Bearer condiviso (vedi ADR-0007 nel repo DA-Vul-can).
 */
export interface NetServicesConfig {
  apiUrl: string;
  apiToken: string;
  enabled: boolean;
}

export function getNetServicesConfig(): NetServicesConfig {
  const apiUrl = (process.env.NET_SERVICES_API_URL ?? "").trim();
  const apiToken = (process.env.NET_SERVICES_API_TOKEN ?? "").trim();
  return {
    apiUrl,
    apiToken,
    enabled: apiUrl.length > 0 && apiToken.length > 0,
  };
}
