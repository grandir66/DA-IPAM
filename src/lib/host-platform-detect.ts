/**
 * Rilevamento piattaforma host da campi discovery / GLPI Agent (senza dipendenze UI).
 */
export function isMacOsHost(input: {
  os_info?: string | null;
  inferred_os_family?: string | null;
  device_manufacturer?: string | null;
  model?: string | null;
  vendor?: string | null;
}): boolean {
  const os = (input.os_info ?? "").toLowerCase();
  if (/macos|mac os|darwin|\bosx\b/.test(os)) return true;
  if (input.inferred_os_family === "macos") return true;
  const mfg = (input.device_manufacturer ?? input.vendor ?? "").toLowerCase();
  if (/apple|macbook|imac|mac mini|mac studio|mac pro/.test(mfg)) return true;
  const model = input.model ?? "";
  if (/^mac\d+/i.test(model)) return true;
  return false;
}

export function suggestEndpointClassification(input: {
  os_info?: string | null;
  inferred_os_family?: string | null;
  classification?: string | null;
  model?: string | null;
}): "notebook" | "workstation" | null {
  if (isMacOsHost(input)) {
    const model = (input.model ?? "").toLowerCase();
    if (/macbook|air|pro/.test(model)) return "notebook";
    if (input.classification === "notebook" || input.classification === "workstation") {
      return input.classification;
    }
    return "notebook";
  }
  return null;
}
