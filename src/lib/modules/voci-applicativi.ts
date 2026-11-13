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
  /** Registrato anche se spento (per Edge: una riga in `vuln_scanners`). */
  installed?: boolean;
  uiUrl: string | null;
  uiIsInternal: boolean;
  externalUiUrl?: string | null;
}

export type IconaVoce =
  | "ShieldCheck" | "Bug" | "History"
  | "MonitorSmartphone" | "Activity" | "ExternalLink"
  | "Settings" | "LayoutDashboard" | "PlusCircle";

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

  // Dal 13/11/2026 (Riccardo: «chocolatey e mesh central… voci singole anch'esse con i tab e non voci di menù»):
  // una voce per prodotto; CVE e Storico sono schede della pagina (`lib/menu/sezioni.ts`). La console di MeshCentral
  // sta con le altre console esterne.
  const v: VoceApplicativo[] = [];
  if (acceso("patch_management")) v.push({ href: "/patch-management", label: "Patch Management", icona: "ShieldCheck" });
  if (acceso("meshcentral")) v.push({ href: "/rmm", label: "Controllo remoto", icona: "MonitorSmartphone" });
  // Zabbix non sta più qui: dal 13/11/2026 ha il suo gruppo «DATIA MON» (`vociDatiaMon`). Il parametro resta per
  // non cambiare chi chiama.
  void pannelloZabbix;

  const esterne = [
    ...console("meshcentral", "MeshCentral"),
    ...console("edge", "Scanner-Edge"), ...console("wazuh", "Wazuh"), ...console("unifi", "UniFi"),
    ...console("librenms", "LibreNMS"), ...console("graylog", "Graylog"), ...console("mdm", "MDM (Headwind)"),
  ];
  if (esterne.length > 0) esterne[0] = { ...esterne[0], divider: "Console esterne" };
  return [...v, ...esterne];
}

/**
 * Il gruppo «DATIA MON» del menu (Riccardo, 13/11/2026: «una voce di menu dedicata al monitoraggio, al posto
 * di Zabbix dentro Applicativi, con le impostazioni, la pagina di configurazione e la dashboard per il cliente»).
 *
 * Con il pannello acceso: la pagina che vede il cliente, gli apparati letti da Zabbix, l'aggiunta di apparati e
 * la configurazione. Senza (non configurato o spento) resta la sola configurazione, e solo per chi la può fare:
 * così il monitoraggio si trova anche prima di averlo acceso.
 */
export function vociDatiaMon(pannelloZabbix: boolean, amministratore: boolean): VoceApplicativo[] {
  const configurazione: VoceApplicativo = { href: "/settings?tab=moduli#module-zabbix", label: "Configurazione", icona: "Settings" };
  if (!pannelloZabbix) return amministratore ? [configurazione] : [];
  const v: VoceApplicativo[] = [
    { href: "/cliente/monitoring", label: "Pagina del cliente", icona: "LayoutDashboard" },
    { href: "/zabbix", label: "Apparati monitorati", icona: "Activity" },
  ];
  if (amministratore) v.push({ href: "/zabbix/aggiungi", label: "Aggiungi apparati", icona: "PlusCircle" }, configurazione);
  return v;
}
