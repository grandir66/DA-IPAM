/**
 * I job che nascono da soli su ogni appliance (spec pagina Opzioni §3.2, decisione di Riccardo del 22/10): sull'appliance
 * di 70151 nessun job leggeva gli apparati, perché giro ARP, scansioni e lettura degli hypervisor si creavano a mano.
 *
 * Il seme gira a ogni avvio per ogni cliente (`applySchedulerBootMigration`) e crea solo i job che MANCANO: un job che
 * esiste, con l'intervallo scelto da un admin o spento, non si tocca. Chi spegne un job di serie da Opzioni, o lo
 * cancella dalla pagina dei job, lascia la lapide `opzioni.job_di_serie.<tipo>` in tenant_settings: con la lapide il seme
 * non lo ricrea. Riaccenderlo da Opzioni toglie la lapide.
 */
import {
  deleteTenantSetting, getScheduledJobs, getTenantSetting, insertSeededJob, listNetworkIds, setHypervisorSyncSchedule, setTenantSetting,
  staggerOffsetMinutes,
} from "@/lib/db-tenant";
import { HYPERVISOR_SYNC_MINUTES } from "@/lib/scheduled-job-types";
import { oraUtc, type StatoInterruttore } from "@/lib/topology/letture/interruttori";

export type TipoJobDiSerie = "arp_poll" | "hypervisor_sync" | "dns_resolve" | "fast_scan";

/** 720 minuti è la soglia che il freno sulle reti /22 (`applyTenantSchedulerDefaults`, passo 1) già tollera. */
export const JOB_DI_SERIE: ReadonlyArray<{ tipo: TipoJobDiSerie; intervalloMinuti: number; perRete: boolean }> = [
  { tipo: "arp_poll", intervalloMinuti: 30, perRete: false },
  { tipo: "hypervisor_sync", intervalloMinuti: HYPERVISOR_SYNC_MINUTES, perRete: false },
  { tipo: "dns_resolve", intervalloMinuti: 1440, perRete: false },
  { tipo: "fast_scan", intervalloMinuti: 720, perRete: true },
];

export function eJobDiSerie(tipo: string): tipo is TipoJobDiSerie {
  return JOB_DI_SERIE.some((j) => j.tipo === tipo);
}

export const chiaveLapide = (tipo: TipoJobDiSerie): string => `opzioni.job_di_serie.${tipo}`;

/**
 * La lapide del tipo, o null se non c'è. Un valore rovinato vale come lapide (con `da` e `il` null): nel dubbio il seme
 * non crea un job che qualcuno potrebbe aver spento.
 */
export function lapide(tipo: TipoJobDiSerie): StatoInterruttore | null {
  const testo = getTenantSetting(chiaveLapide(tipo));
  if (testo === null) return null;
  try {
    const o = JSON.parse(testo) as { acceso?: unknown; da?: unknown; il?: unknown } | null;
    if (o && typeof o === "object" && o.acceso === true) return null;
    return {
      acceso: false,
      da: typeof o?.da === "string" ? o.da : null,
      il: typeof o?.il === "string" ? o.il : null,
    };
  } catch {
    return { acceso: false, da: null, il: null };
  }
}

export function scriviLapide(tipo: TipoJobDiSerie, chi: string, adesso: Date = new Date()): void {
  const s: StatoInterruttore = { acceso: false, da: chi, il: oraUtc(adesso) };
  setTenantSetting(chiaveLapide(tipo), JSON.stringify(s));
}

export function togliLapide(tipo: TipoJobDiSerie): void {
  deleteTenantSetting(chiaveLapide(tipo));
}

/** Crea i job di serie che mancano nel cliente corrente (contesto tenant di chi chiama). */
export function seminaJobDiSerie(): { creati: number } {
  const jobs = getScheduledJobs();
  let creati = 0;
  for (const def of JOB_DI_SERIE) {
    if (lapide(def.tipo)) continue;
    if (!def.perRete) {
      if (jobs.some((j) => j.job_type === def.tipo)) continue;
      if (def.tipo === "hypervisor_sync") setHypervisorSyncSchedule(true);
      else insertSeededJob(def.tipo, null, def.intervalloMinuti, 1);
      creati++;
      continue;
    }
    const mancanti = listNetworkIds().filter((id) => !jobs.some((j) => j.job_type === def.tipo && j.network_id === id));
    mancanti.forEach((id, idx) => insertSeededJob(def.tipo, id, def.intervalloMinuti, staggerOffsetMinutes(idx, mancanti.length)));
    creati += mancanti.length;
  }
  return { creati };
}
