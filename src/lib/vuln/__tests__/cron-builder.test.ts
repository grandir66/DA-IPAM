import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCron, describeCron, slugifyJobName, nearestIntervalForFrequency } from "@/lib/vuln/cron-builder";

test("buildCron daily/weekly/monthly", () => {
  assert.equal(buildCron({ frequency: "daily", at: "10:00" }), "0 10 * * *");
  assert.equal(buildCron({ frequency: "weekly", at: "09:30", daysOfWeek: [1, 3, 5] }), "30 9 * * 1,3,5");
  assert.equal(buildCron({ frequency: "monthly", at: "10:00", dayOfMonth: 15 }), "0 10 15 * *");
});

test("describeCron Italian preview", () => {
  assert.match(describeCron({ frequency: "monthly", at: "10:00", dayOfMonth: 15 }), /15 del mese.*10:00/);
  assert.match(describeCron({ frequency: "daily", at: "02:00" }), /ogni giorno.*02:00/i);
});

test("slugifyJobName: no spaces, safe chars, slash->dash, non-empty", () => {
  assert.equal(
    slugifyJobName(["ACME", "Sede MI", "10.0.0.0/24", "IP attivi", "mensile"]),
    "ACME_Sede-MI_10.0.0.0-24_IP-attivi_mensile",
  );
  assert.equal(slugifyJobName(["Caffè", "réte!"]), "Caffe_rete");
  assert.ok(slugifyJobName(["", "  "]).length > 0); // fallback non-empty
});

test("nearestIntervalForFrequency", () => {
  assert.equal(nearestIntervalForFrequency("daily"), 1440);
  assert.equal(nearestIntervalForFrequency("weekly"), 10080);
  assert.equal(nearestIntervalForFrequency("monthly"), 10080);
});
