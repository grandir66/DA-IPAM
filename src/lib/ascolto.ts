/**
 * Indirizzo su cui ascolta `server.ts`. `DA_ASCOLTO` serve all'installazione «tecnico» su Mac
 * (127.0.0.1: il portatile sta nella LAN del cliente e DA-IPAM risponde solo a lui). Senza
 * variabile `0.0.0.0`, come sempre.
 */
export function indirizzoAscolto(env: Readonly<Record<string, string | undefined>> = process.env): string {
  return env.DA_ASCOLTO?.trim() || "0.0.0.0";
}
