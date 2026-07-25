import type { RuleDef } from "../types";
import { anomalyRules } from "./anomaly";
import { phase2Rules } from "./phase2";
import { phase3Rules } from "./phase3";
import { phase4Rules } from "./phase4";
import { privilegedRules } from "./privileged";
import { staleRules } from "./stale";
import { trustRules } from "./trust";

export const ALL_RULES: RuleDef[] = [
  ...staleRules,
  ...privilegedRules,
  ...trustRules,
  ...anomalyRules,
  ...phase2Rules,
  ...phase3Rules,
  ...phase4Rules,
];

export {
  anomalyRules,
  phase2Rules,
  phase3Rules,
  phase4Rules,
  privilegedRules,
  staleRules,
  trustRules,
};
