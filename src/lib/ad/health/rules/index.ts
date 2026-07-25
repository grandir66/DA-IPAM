import type { RuleDef } from "../types";
import { anomalyRules } from "./anomaly";
import { phase2Rules } from "./phase2";
import { privilegedRules } from "./privileged";
import { staleRules } from "./stale";
import { trustRules } from "./trust";

export const ALL_RULES: RuleDef[] = [
  ...staleRules,
  ...privilegedRules,
  ...trustRules,
  ...anomalyRules,
  ...phase2Rules,
];

export { anomalyRules, phase2Rules, privilegedRules, staleRules, trustRules };
