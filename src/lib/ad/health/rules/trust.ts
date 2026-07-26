import { TRUST_ATTR_WITHIN_FOREST, type RuleDef } from "../types";
import { aggFinding } from "./helpers";

/** External/forest trusts only — WITHIN_FOREST (0x20) excluded. */
export function externalTrusts(trusts: { name: string; trustAttributes: number | null }[]) {
  return trusts.filter((t) => ((t.trustAttributes ?? 0) & TRUST_ATTR_WITHIN_FOREST) === 0);
}

export const trustRules: RuleDef[] = [
  {
    id: "DA-T-TrustInventory",
    axis: "trust",
    points: 5,
    title: "Domain trusts present",
    run(ctx) {
      const external = externalTrusts(ctx.trusts);
      if (external.length === 0) return null;
      const names = external.map((t) => t.name);
      return aggFinding({
        ruleId: "DA-T-TrustInventory",
        axis: "trust",
        points: 5,
        title: "Domain trusts present",
        description: `${names.length} external trust(s): ${names.join(", ")}`,
        dns: names,
      });
    },
  },
];
