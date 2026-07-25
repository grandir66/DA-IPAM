import type { RuleDef } from "../types";
import { anomalyRules } from "./anomaly";
import { privilegedRules } from "./privileged";
import { staleRules } from "./stale";
import { trustRules } from "./trust";

export const ALL_RULES: RuleDef[] = [
  ...staleRules,
  ...privilegedRules,
  ...trustRules,
  ...anomalyRules,
];

export { anomalyRules, privilegedRules, staleRules, trustRules };
