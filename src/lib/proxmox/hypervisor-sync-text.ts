/**
 * Lo stato della lettura giornaliera degli hypervisor detto in parole, per la
 * pagina «Dati della mappa» (topologia fase 2b). Modulo puro: lo usano la
 * pagina e le prove.
 */
import { FUSO_UTENTI, parseDbDate } from "@/lib/db-date";
import type { HypervisorSyncState } from "@/lib/db-tenant";

function quando(x: string): string {
  const d = parseDbDate(x);
  if (Number.isNaN(d.getTime())) return "data non leggibile";
  return d.toLocaleString("it-IT", {
    timeZone: FUSO_UTENTI,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Due frasi: se è accesa e cosa fa, e quando sono stati letti l'ultima volta. */
export function statoLetturaHypervisor(s: HypervisorSyncState): string[] {
  const n = s.hypervisors;
  const uno = n === 1; // singolare in ogni frase (revisione finale M-4: diceva «dei 1 hypervisor»)
  const prima =
    n === 0
      ? s.enabled
        ? "Accesa, ma nessun hypervisor ha la scansione Proxmox configurata: non c'è niente da leggere."
        : "Spenta. Nessun hypervisor ha la scansione Proxmox configurata."
      : s.enabled
        ? `Accesa: ogni giorno alle 3:00 legge ${n} hypervisor (VM e schede).`
        : `Spenta: VM e schede ${uno ? "dell'unico hypervisor" : `dei ${n} hypervisor`} si aggiornano solo a mano, con la scansione Proxmox dell'apparato.`;
  const seconda = s.lastScanAt
    ? `Ultima lettura ${uno ? "dell'hypervisor" : "degli hypervisor"}: ${quando(s.lastScanAt)}.`
    : n > 0
      ? uno ? "L'hypervisor non è mai stato letto." : "Gli hypervisor non sono mai stati letti."
      : null;
  return seconda ? [prima, seconda] : [prima];
}
