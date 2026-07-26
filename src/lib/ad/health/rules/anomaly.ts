import { THRESHOLDS } from "../thresholds";
import type { RuleDef } from "../types";
import { aggFinding, daysSince } from "./helpers";

export const anomalyRules: RuleDef[] = [
  {
    id: "DA-A-KrbtgtAge",
    axis: "anomaly",
    points: 25,
    title: "krbtgt password age",
    run(ctx) {
      // null = data not collected / unknown → skip (no false positive; same as Recycle Bin)
      const iso = ctx.krbtgtPasswordLastSetAt;
      if (iso == null) return null;
      const days = daysSince(iso, ctx.now);
      if (days != null && days <= THRESHOLDS.krbtgtMaxDays) return null;
      return aggFinding({
        ruleId: "DA-A-KrbtgtAge",
        axis: "anomaly",
        points: 25,
        title: "krbtgt password age",
        description:
          days == null
            ? "krbtgt password last set is unparseable"
            : `krbtgt password last set is older than ${THRESHOLDS.krbtgtMaxDays} days`,
        dns: ["krbtgt"],
      });
    },
  },
  {
    id: "DA-A-GuestEnabled",
    axis: "anomaly",
    points: 20,
    title: "Guest account enabled",
    run(ctx) {
      if (ctx.guestEnabled !== true) return null;
      return aggFinding({
        ruleId: "DA-A-GuestEnabled",
        axis: "anomaly",
        points: 20,
        title: "Guest account enabled",
        description: "Built-in Guest account is enabled",
        dns: ["Guest"],
      });
    },
  },
  {
    id: "DA-A-RecycleBin",
    axis: "anomaly",
    points: 15,
    title: "AD Recycle Bin disabled",
    run(ctx) {
      // null = data not collected → skip (no match)
      if (ctx.recycleBinEnabled !== false) return null;
      return aggFinding({
        ruleId: "DA-A-RecycleBin",
        axis: "anomaly",
        points: 15,
        title: "AD Recycle Bin disabled",
        description: `AD Recycle Bin is disabled for ${ctx.domainFqdn}`,
        dns: [ctx.domainFqdn],
      });
    },
  },
];
