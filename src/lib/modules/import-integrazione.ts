/**
 * Import JSON dei moduli → configurazione di LibreNMS e Graylog (rotta
 * `POST /api/modules/import`, la chiama Deploy-Appliance in `connect.sh`).
 *
 * Modo scritto (passo 5 del piano di solidità, seguito del 16/10):
 * - LibreNMS con `extra.mode === "appliance"` → `appliance`: Deploy-Appliance ora
 *   dichiara che quel LibreNMS l'ha messo lui sulla macchina;
 * - tutto il resto → `external`, come prima. Un installatore vecchio non manda
 *   `extra.mode` e deve continuare a funzionare; Graylog non ha il modo
 *   `appliance` (`rifiutoModo` lo rifiuterebbe), quindi lo ignora.
 *
 * Nessuna migrazione: una riga `external` già salvata resta com'è finché un
 * import nuovo (o «Converti») non la riscrive.
 *
 * Pura, senza import lato server: la usano la rotta e le prove.
 */
import type { ComponentConfig, IntegrationMode } from "@/lib/integrations/types";
import type { ModuleImportEntry } from "./import-schema";

/** Il modo che l'import scrive per un'integrazione a dashboard esterna. */
export function modoDaImport(
  module: "librenms" | "graylog",
  extra: ModuleImportEntry["extra"],
): Extract<IntegrationMode, "appliance" | "external"> {
  if (module === "librenms" && extra?.mode === "appliance") return "appliance";
  return "external";
}

/**
 * La configurazione da salvare con `setIntegrationConfig` per una voce
 * LibreNMS o Graylog dell'import. Lancia se mancano sia `url` sia `api_url`.
 */
export function configIntegrazioneDaImport(
  e: ModuleImportEntry & { module: "librenms" | "graylog" },
): Partial<ComponentConfig> {
  const apiUrl = (e.api_url ?? e.url ?? "").trim();
  if (!e.url && !apiUrl) throw new Error(`${e.module} richiede url o api_url`);
  const apiInternal = apiUrl || (e.url ?? "");
  const browserUrl = apiUrl && e.url && e.url !== apiUrl ? e.url : undefined;
  return {
    mode: modoDaImport(e.module, e.extra),
    url: apiInternal,
    uiUrl: browserUrl,
    apiToken: e.api_key ?? "",
    ...(e.module === "graylog"
      ? { username: e.username ?? undefined, password: e.password ?? undefined }
      : {}),
  };
}
