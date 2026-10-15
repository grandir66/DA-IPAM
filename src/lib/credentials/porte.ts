/**
 * Porte standard dei protocolli di credenziale e porta propria della credenziale
 * (tappa 1 credenziali, 15/10). Modulo puro, senza DB: lo importano anche i
 * componenti client (`resolve.ts` no, perché carica `db-tenant`).
 */

// Fase 4b Task 4: 'redfish' (BMC iLO/iDRAC/XClarity) e 'onvif' (telecamere) sono
// protocolli dedicati (protocol_type su host_credentials/device_credential_bindings).
// La credenziale sottostante (`credentials.credential_type`) resta 'api' per entrambi.
export type CredProtocol = "ssh" | "snmp" | "winrm" | "api" | "redfish" | "onvif";

/** Porta di default per protocollo quando né la sorgente né la credenziale ne portano una propria. */
export const DEFAULT_PORTS: Record<CredProtocol, number> = {
  ssh: 22,
  snmp: 161,
  winrm: 5985,
  api: 443,
  redfish: 443,
  onvif: 80,
};

/**
 * Porta con cui usare una credenziale per un protocollo: quella propria della
 * credenziale (SSH sulla 2022, SNMP fuori standard), altrimenti lo standard.
 */
export function portaCredenziale(cred: { port: number | null }, protocol: CredProtocol): number {
  return cred.port ?? DEFAULT_PORTS[protocol];
}
