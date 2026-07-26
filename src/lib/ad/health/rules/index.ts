import type { RuleDef } from "../types";
import { anomalyRules } from "./anomaly";
import { phase2Rules } from "./phase2";
import { phase3Rules } from "./phase3";
import { phase4Rules } from "./phase4";
import { phase5Rules } from "./phase5";
import { phase6Rules } from "./phase6";
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
  ...phase5Rules,
  ...phase6Rules,
];

export {
  anomalyRules,
  phase2Rules,
  phase3Rules,
  phase4Rules,
  phase5Rules,
  phase6Rules,
  privilegedRules,
  staleRules,
  trustRules,
};
