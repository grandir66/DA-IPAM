import { getContainerStatus } from "./docker";

/**
 * LibreNMS dello stack consolidato: lo mette in Docker l'installatore
 * dell'appliance (Deploy-Appliance) con questo nome, API su 127.0.0.1:8000 e
 * pagina sulla 7443. Per DA-IPAM è un'istanza «external», ma sta sulla stessa
 * macchina: la scheda lo dice, e «Installa» non ne crea un secondo (pilota
 * PX-NAS 2026-10-15: il pulsante ha avviato `da-librenms` sulla 8090 e a fine
 * lavoro avrebbe spostato DA-IPAM su quello nuovo, vuoto).
 */
export const CONTENITORE_LIBRENMS_APPLIANCE = "appliance-librenms";

export const RIFIUTO_SECONDO_LIBRENMS =
  "LibreNMS è già installato dall'appliance (contenitore appliance-librenms): non se ne installa un secondo.";

type StatoContenitore = (nome: string) => Promise<unknown>;

/** true se sulla macchina c'è il contenitore LibreNMS dell'installatore, acceso o fermo. */
export async function librenmsDellAppliance(
  stato: StatoContenitore = getContainerStatus,
): Promise<boolean> {
  return (await stato(CONTENITORE_LIBRENMS_APPLIANCE)) !== null;
}

/** Il motivo per cui «Installa» va rifiutato, o null se si può procedere. */
export async function rifiutoInstallazione(
  component: string,
  stato: StatoContenitore = getContainerStatus,
): Promise<string | null> {
  if (component !== "librenms") return null;
  return (await librenmsDellAppliance(stato)) ? RIFIUTO_SECONDO_LIBRENMS : null;
}
