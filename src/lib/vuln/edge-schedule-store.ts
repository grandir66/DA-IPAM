import { getTenantDb, getCurrentTenantCode } from "@/lib/db-tenant";

export interface EdgeScheduleConfig {
  network_id: number;
  job_name: string | null;
  frequency: string | null;
  at_time: string | null;
  days_of_week: string | null;
  day_of_month: number | null;
  cron_expr: string | null;
  profile: string | null;
  targeting_mode: string | null;
  enabled: boolean;
  /** `orario` = cron (di sempre); `finestra` = fascia oraria in ora italiana (05/11/2026). */
  modo: ModoEdge;
  fascia_dalle: string | null;
  fascia_alle: string | null;
  ip_per_gruppo: number | null;
  tentativi: number | null;
  ripeti: string | null;
}

export type ModoEdge = "orario" | "finestra";

type CampiFinestra = "modo" | "fascia_dalle" | "fascia_alle" | "ip_per_gruppo" | "tentativi" | "ripeti";

/** Chi salva un orario fisso non è tenuto a nominare la finestra: `modo` torna `orario`. */
export type EdgeScheduleInput = Omit<EdgeScheduleConfig, CampiFinestra> & Partial<Pick<EdgeScheduleConfig, CampiFinestra>>;

function db() {
  const c = getCurrentTenantCode();
  if (!c) throw new Error("edge-schedule-store: no tenant context");
  return getTenantDb(c);
}

export function getEdgeSchedule(networkId: number): EdgeScheduleConfig | null {
  const r = db().prepare(`SELECT * FROM edge_scan_schedules WHERE network_id=?`).get(networkId) as
    | Record<string, unknown>
    | undefined;
  if (!r) return null;
  return daRiga(r);
}

/** Tutte le scansioni Edge pianificate del cliente, una per rete (pagina Schedulazioni). */
export function listEdgeSchedules(): EdgeScheduleConfig[] {
  return (db().prepare(`SELECT * FROM edge_scan_schedules ORDER BY network_id`).all() as Record<string, unknown>[]).map(daRiga);
}

function daRiga(r: Record<string, unknown>): EdgeScheduleConfig {
  return {
    network_id: r.network_id as number,
    job_name: (r.job_name as string) ?? null,
    frequency: (r.frequency as string) ?? null,
    at_time: (r.at_time as string) ?? null,
    days_of_week: (r.days_of_week as string) ?? null,
    day_of_month: (r.day_of_month as number) ?? null,
    cron_expr: (r.cron_expr as string) ?? null,
    profile: (r.profile as string) ?? null,
    targeting_mode: (r.targeting_mode as string) ?? null,
    enabled: !!r.enabled,
    modo: r.modo === "finestra" ? "finestra" : "orario",
    fascia_dalle: (r.fascia_dalle as string) ?? null,
    fascia_alle: (r.fascia_alle as string) ?? null,
    ip_per_gruppo: (r.ip_per_gruppo as number) ?? null,
    tentativi: (r.tentativi as number) ?? null,
    ripeti: (r.ripeti as string) ?? null,
  };
}

/**
 * Salva l'orario fisso della rete. Rimette `modo` a `orario`; le colonne della finestra restano
 * come sono (servono a riproporre l'ultima finestra), tranne `days_of_week` che è dell'orario
 * come della finestra e prende il valore nuovo.
 */
export function saveEdgeSchedule(c: EdgeScheduleInput): void {
  db()
    .prepare(
      `INSERT INTO edge_scan_schedules
         (network_id, job_name, frequency, at_time, days_of_week, day_of_month, cron_expr, profile, targeting_mode, enabled, modo, updated_at)
       VALUES (@network_id,@job_name,@frequency,@at_time,@days_of_week,@day_of_month,@cron_expr,@profile,@targeting_mode,@enabled,'orario', datetime('now'))
       ON CONFLICT(network_id) DO UPDATE SET job_name=@job_name, frequency=@frequency, at_time=@at_time,
         days_of_week=@days_of_week, day_of_month=@day_of_month, cron_expr=@cron_expr, profile=@profile,
         targeting_mode=@targeting_mode, enabled=@enabled, modo='orario', updated_at=datetime('now')`,
    )
    .run({
      network_id: c.network_id,
      job_name: c.job_name,
      frequency: c.frequency,
      at_time: c.at_time,
      days_of_week: c.days_of_week,
      day_of_month: c.day_of_month,
      cron_expr: c.cron_expr,
      profile: c.profile,
      targeting_mode: c.targeting_mode,
      enabled: c.enabled ? 1 : 0,
    });
}

/**
 * Ricorda la finestra che la sonda ha accettato. L'orario fisso (cron, frequenza, ora) resta nella
 * riga com'era: `days_of_week` è condiviso e qui prende i giorni della finestra.
 */
export function saveEdgeFinestra(c: {
  network_id: number;
  job_name: string | null;
  days_of_week: string;
  fascia_dalle: string;
  fascia_alle: string;
  ip_per_gruppo: number;
  tentativi: number;
  ripeti: string;
  profile: string;
  targeting_mode: string | null;
  enabled: boolean;
}): void {
  db()
    .prepare(
      `INSERT INTO edge_scan_schedules
         (network_id, job_name, days_of_week, profile, targeting_mode, enabled, modo, fascia_dalle, fascia_alle,
          ip_per_gruppo, tentativi, ripeti, updated_at)
       VALUES (@network_id,@job_name,@days_of_week,@profile,@targeting_mode,@enabled,'finestra',@fascia_dalle,@fascia_alle,
          @ip_per_gruppo,@tentativi,@ripeti, datetime('now'))
       ON CONFLICT(network_id) DO UPDATE SET job_name=COALESCE(@job_name, job_name), days_of_week=@days_of_week,
         profile=@profile, targeting_mode=@targeting_mode, enabled=@enabled, modo='finestra',
         fascia_dalle=@fascia_dalle, fascia_alle=@fascia_alle, ip_per_gruppo=@ip_per_gruppo,
         tentativi=@tentativi, ripeti=@ripeti, updated_at=datetime('now')`,
    )
    .run({ ...c, enabled: c.enabled ? 1 : 0 });
}

/**
 * La finestra non c'è più sulla sonda: la riga torna all'orario fisso, spento (il `DELETE` della
 * sonda non riaccende la pianificazione). Una riga che era solo finestra, senza orario, si toglie.
 */
export function dimenticaEdgeFinestra(networkId: number): void {
  const d = db();
  d.transaction(() => {
    const r = d.prepare(`SELECT frequency, modo FROM edge_scan_schedules WHERE network_id=?`).get(networkId) as
      | { frequency: string | null; modo: string }
      | undefined;
    if (!r || r.modo !== "finestra") return;
    if (r.frequency == null) {
      d.prepare(`DELETE FROM edge_scan_schedules WHERE network_id=?`).run(networkId);
    } else {
      d.prepare(`UPDATE edge_scan_schedules SET modo='orario', enabled=0, updated_at=datetime('now') WHERE network_id=?`).run(networkId);
    }
  })();
}

export function deleteEdgeSchedule(networkId: number): void {
  db().prepare(`DELETE FROM edge_scan_schedules WHERE network_id=?`).run(networkId);
}
