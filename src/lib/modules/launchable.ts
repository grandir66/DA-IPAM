import type { ModuleHealth } from "./health";
import type { ModuleState } from "./registry";

/** Modulo mostrato in Launchpad: installato, attivo, con URL e non in errore L7. */
export function isModuleLaunchable(
  module: ModuleState,
  health?: ModuleHealth,
): boolean {
  if (!module.installed || !module.enabled || !module.uiUrl) return false;
  if (health?.verdict === "fail") return false;
  return true;
}
