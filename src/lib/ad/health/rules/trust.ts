import type { RuleDef } from "../types";
import { aggFinding } from "./helpers";

export const trustRules: RuleDef[] = [
  {
    id: "DA-T-TrustInventory",
    axis: "trust",
    points: 5,
    title: "Domain trusts present",
    run(ctx) {
      if (ctx.trusts.length === 0) return null;
      const names = ctx.trusts.map((t) => t.name);
      return aggFinding({
        ruleId: "DA-T-TrustInventory",
        axis: "trust",
        points: 5,
        title: "Domain trusts present",
        description: `${names.length} trust(s): ${names.join(", ")}`,
        dns: names,
      });
    },
  },
];
