/**
 * La riga di Opzioni di un job, per i rimandi della pagina dei job e della rete (`/settings/opzioni#<id>`). Deve dare gli
 * stessi id del catalogo: per tipo per i job aggregati, per controller per unifi_sync, per job per gli altri. Modulo
 * puro: lo usano i componenti client. Provato in `__tests__/ancore.test.ts` contro il catalogo.
 */
import { unifiJobKind } from "@/lib/scheduled-job-types";

export const TIPI_PER_TIPO: ReadonlySet<string> = new Set([
  "arp_poll", "hypervisor_sync", "dns_resolve", "fast_scan", "known_host_check", "pulizia_host",
]);

export function idOpzioneDelJob(job: { id: number; job_type: string; config: string | null }): string {
  if (TIPI_PER_TIPO.has(job.job_type)) return `job.${job.job_type}`;
  if (job.job_type === "unifi_sync") {
    let cid: unknown = null;
    try {
      cid = (JSON.parse(job.config || "{}") as { controller_id?: unknown }).controller_id;
    } catch {
      cid = null;
    }
    if (typeof cid === "number") return `controller.${cid}.${unifiJobKind(job.config) === "client" ? "client" : "apparati"}`;
  }
  return `job.${job.id}`;
}
