import { test, after } from "node:test";
import assert from "node:assert/strict";
import { withTenant, deleteTenantDatabase, getTenantDb } from "@/lib/db-tenant";
import { getEdgeSchedule, saveEdgeSchedule, deleteEdgeSchedule } from "@/lib/vuln/edge-schedule-store";

const T = "TESTEDGESCHED";
after(() => deleteTenantDatabase(T));

test("save/get/delete edge schedule", () => {
  withTenant(T, () => {
    getTenantDb(T).prepare("INSERT INTO networks(name,cidr) VALUES('n','10.0.0.0/24')").run();
    assert.equal(getEdgeSchedule(1), null);
    saveEdgeSchedule({
      network_id: 1,
      job_name: "ACME_n_10.0.0.0-24_ip-attivi_mensile",
      frequency: "monthly",
      at_time: "10:00",
      days_of_week: null,
      day_of_month: 15,
      cron_expr: "0 10 15 * *",
      profile: "balanced",
      targeting_mode: "found_ips",
      enabled: true,
    });
    const c = getEdgeSchedule(1)!;
    assert.equal(c.cron_expr, "0 10 15 * *");
    assert.equal(c.enabled, true);
    assert.equal(c.day_of_month, 15);
    assert.equal(c.job_name, "ACME_n_10.0.0.0-24_ip-attivi_mensile");
    deleteEdgeSchedule(1);
    assert.equal(getEdgeSchedule(1), null);
  });
});
