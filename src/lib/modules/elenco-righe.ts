/**
 * Una riga dell'elenco dei moduli (analisi del 19/10, F10). Modulo puro: lo usa
 * `components/settings/elenco-moduli.tsx`.
 */
export type StatoRiga = "guasto" | "attenzione" | "acceso" | "da_verificare" | "spento";

export interface RigaModulo {
  key: string;
  label: string;
  opzione: boolean;
  stato: StatoRiga;
  dettaglio: string | null;
  /** Dove porta «Apri»; null = nessuna pagina da aprire (es. sistema appliance). */
  href: string | null;
}

/** I moduli con una sezione in `ModulesTab`: la loro pagina è /settings/moduli/<chiave>. */
export const MODULI_CON_PAGINA: ReadonlySet<string> = new Set([
  "edge", "patch_management", "inventory_agent", "meshcentral", "nis2_inventory", "network_services",
  "zabbix", "unifi", "librenms", "graylog", "wazuh", "loki", "credenziali",
]);

export function rigaModulo(
  m: { key: string; label: string; offerta: "base" | "opzione"; enabled: boolean; configHref: string; note?: string },
  salute: { key: string; verdict: string; detail: string | null } | null,
  dettaglio?: string,
): RigaModulo {
  const v = salute?.verdict;
  const stato: StatoRiga =
    v === "fail" ? "guasto"
      : v === "degraded" ? "attenzione"
        : v === "ok" ? "acceso"
          : !m.enabled || v === "off" ? "spento"
            : "da_verificare";
  const href = MODULI_CON_PAGINA.has(m.key)
    ? `/settings/moduli/${m.key}`
    : m.configHref && !m.configHref.startsWith("/settings?tab=moduli") ? m.configHref : null;
  return {
    key: m.key,
    label: m.label,
    opzione: m.offerta === "opzione",
    stato,
    dettaglio: salute?.detail ?? m.note ?? dettaglio ?? null,
    href,
  };
}
