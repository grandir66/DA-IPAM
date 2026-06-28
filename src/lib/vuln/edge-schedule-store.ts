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
}

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
  };
}

export function saveEdgeSchedule(c: EdgeScheduleConfig): void {
  db()
    .prepare(
      `INSERT INTO edge_scan_schedules
         (network_id, job_name, frequency, at_time, days_of_week, day_of_month, cron_expr, profile, targeting_mode, enabled, updated_at)
       VALUES (@network_id,@job_name,@frequency,@at_time,@days_of_week,@day_of_month,@cron_expr,@profile,@targeting_mode,@enabled, datetime('now'))
       ON CONFLICT(network_id) DO UPDATE SET job_name=@job_name, frequency=@frequency, at_time=@at_time,
         days_of_week=@days_of_week, day_of_month=@day_of_month, cron_expr=@cron_expr, profile=@profile,
         targeting_mode=@targeting_mode, enabled=@enabled, updated_at=datetime('now')`,
    )
    .run({ ...c, enabled: c.enabled ? 1 : 0 });
}

export function deleteEdgeSchedule(networkId: number): void {
  db().prepare(`DELETE FROM edge_scan_schedules WHERE network_id=?`).run(networkId);
}
