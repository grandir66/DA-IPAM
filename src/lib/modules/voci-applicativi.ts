/**
 * Le voci del gruppo «Applicativi» del menu (Riccardo, 19/10). Prima c'erano il
 * Launchpad a tessere e, in più, le voci sparse dei moduli: un doppione. Ogni
 * prodotto ha la sua sezione (separatore) con le pagine interne di DA-IPAM che lo
 * riguardano e la sua console esterna. Modulo puro: lo usa `shared/sidebar.tsx`.
 *
 * Vulnerabilità e Alert sicurezza stanno nel gruppo «Sicurezza», Controller di rete
 * in Network sotto «Credenziali» (Riccardo, 19/10 sera): qui restano i moduli
 * opzionali con le loro pagine e le console esterne, solo coi moduli accesi.
 */
export interface ModuloPerMenu {
  key: string;
  label: string;
  enabled: boolean;
  uiUrl: string | null;
  uiIsInternal: boolean;
  externalUiUrl?: string | null;
}

export type IconaVoce =
  | "ShieldCheck" | "Bug" | "History"
  | "MonitorSmartphone" | "Activity" | "ExternalLink";

export interface VoceApplicativo {
  href: string;
  label: string;
  icona: IconaVoce;
  divider?: string;
  /** Console di un prodotto: si apre in una scheda nuova. */
  esterno?: boolean;
}

export function vociApplicativi(moduli: readonly ModuloPerMenu[], pannelloZabbix: boolean): VoceApplicativo[] {
  const acceso = (k: string) => moduli.find((x) => x.key === k && x.enabled);
  const console = (k: string, label: string): VoceApplicativo[] => {
    const mod = acceso(k);
    const url = mod ? (mod.uiIsInternal ? mod.externalUiUrl : mod.uiUrl) : null;
    return url ? [{ href: url, label, icona: "ExternalLink", esterno: true }] : [];
  };

  const v: VoceApplicativo[] = [];
  if (acceso("patch_management")) {
    v.push(
      { href: "/patch-management", label: "Panoramica", icona: "ShieldCheck", divider: "Patch Management" },
      { href: "/patch-management/cve", label: "CVE", icona: "Bug" },
      { href: "/patch-management/history", label: "Storico", icona: "History" },
    );
  }
  if (acceso("meshcentral")) {
    v.push({ href: "/rmm", label: "Dispositivi", icona: "MonitorSmartphone", divider: "Controllo remoto" }, ...console("meshcentral", "Console MeshCentral"));
  }
  if (pannelloZabbix) v.push({ href: "/zabbix", label: "Pannello", icona: "Activity", divider: "Zabbix" });

  const esterne = [
    ...console("edge", "Scanner-Edge"), ...console("wazuh", "Wazuh"), ...console("unifi", "UniFi"),
    ...console("librenms", "LibreNMS"), ...console("graylog", "Graylog"), ...console("mdm", "MDM (Headwind)"),
  ];
  if (esterne.length > 0) esterne[0] = { ...esterne[0], divider: "Console esterne" };
  return [...v, ...esterne];
}
