/**
 * Pipeline di valutazione subnet: ordine logico delle fasi di acquisizione dati
 * (ARP, DHCP, AD, ICMP, Nmap, SNMP, OS, credenziali rete, promozione a dispositivo).
 * Le fasi sono orchestrabili da job/API; molte sono già implementate come scan_type separati.
 */

export type SubnetEvaluationPhaseId =
  | "arp_vendor"
  | "dhcp_leases"
  | "ad_computers"
  | "icmp_discovery"
  | "nmap_soft"
  | "snmp_light"
  | "nmap_advanced"
  | "snmp_walk_vendor"
  | "os_detect_win_linux"
  | "credential_chain_auto"
  | "manual_review"
  | "monitor_flag"
  | "promote_to_device"
  | "device_deep_scan"
  | "switch_port_ipam_link";

export interface SubnetEvaluationPhase {
  id: SubnetEvaluationPhaseId;
  /** Ordine nella prima analisi (1 = prima) */
  order: number;
  title: string;
  description: string;
  /** Implementazione attuale nel codice (riferimento per sviluppatori) */
  implementationHint: string;
}

/**
 * Fasi della “prima analisi” e oltre: allineato a requisiti inventario/monitoraggio.
 */
export const SUBNET_EVALUATION_PHASES: readonly SubnetEvaluationPhase[] = [
  {
    id: "arp_vendor",
    order: 1,
    title: "ARP e vendor",
    description:
      "Tabella ARP dal router di rete: MAC↔IP, vendor OUI sugli host, base per mappatura.",
    implementationHint: "arp_poll / router ARP → arp_entries, hosts.mac/vendor",
  },
  {
    id: "dhcp_leases",
    order: 2,
    title: "DHCP (lease e statico/dinamico)",
    description:
      "Lease da MikroTik, API dhcp-leases, o DHCP Windows (AD): derivare se l’IP è dinamico, riservato o statico.",
    implementationHint: "dhcp_leases, ad_dhcp_leases → hosts.ip_assignment",
  },
  {
    id: "ad_computers",
    order: 3,
    title: "Computer Active Directory",
    description:
      "Allineamento computer AD agli host IPAM (nome DNS, OS) quando l’integrazione è configurata.",
    implementationHint: "syncActiveDirectory → ad_computers, linkComputersToHosts",
  },
  {
    id: "icmp_discovery",
    order: 4,
    title: "ICMP (prima fase)",
    description: "Ping sweep per host online nella subnet.",
    implementationHint: "scan_type ping o network_discovery fase ICMP",
  },
  {
    id: "nmap_soft",
    order: 5,
    title: "Nmap “soft” / quick",
    description: "Porte comuni TCP veloci sugli online (profilo Nmap attivo).",
    implementationHint: "network_discovery → Nmap quick; nmap profile",
  },
  {
    id: "snmp_light",
    order: 6,
    title: "SNMP leggero",
    description: "sysName/sysDescr/sysObjectID e dati base dove la community risponde.",
    implementationHint: "network_discovery / nmap con SNMP; snmp_vendor_profiles",
  },
  {
    id: "nmap_advanced",
    order: 7,
    title: "Nmap avanzato",
    description: "Scansione porte ampia o profilo personalizzato (TCP/UDP).",
    implementationHint: "scan_type nmap + nmap_profiles",
  },
  {
    id: "snmp_walk_vendor",
    order: 8,
    title: "SNMP walk approfondito (profili produttore)",
    description: "OID e campi per vendor tramite profili SNMP configurati.",
    implementationHint: "snmp_vendor_profiles, scan snmp / ipam_full",
  },
  {
    id: "os_detect_win_linux",
    order: 9,
    title: "OS e inventario Win/Linux",
    description: "WinRM per Windows, SSH per Linux: hostname, OS, servizi dove previsto.",
    implementationHint: "scan_type windows / ssh; credenziali da catena rete",
  },
  {
    id: "credential_chain_auto",
    order: 10,
    title: "Credenziali funzionanti (rete)",
    description: "Prova sequenziale delle credenziali assegnate alla subnet; salvataggio binding per host.",
    implementationHint: "network_host_credentials, host_detect_credential",
  },
  {
    id: "manual_review",
    order: 11,
    title: "Revisione e correzione manuale",
    description: "Nome, classificazione, note, override assegnazione IP.",
    implementationHint: "UI rete / host PUT",
  },
  {
    id: "monitor_flag",
    order: 12,
    title: "Monitoraggio IP",
    description: "Segnare host “conosciuti” per ping/porte periodiche (monitoraggio noto).",
    implementationHint: "hosts.known_host, monitor_ports, known_host_check",
  },
  {
    id: "promote_to_device",
    order: 13,
    title: "Promozione a dispositivo gestito",
    description: "Creare network_device con profilo prodotto e credenziali nominative.",
    implementationHint: "POST /api/devices/bulk, product_profile",
  },
  {
    id: "device_deep_scan",
    order: 14,
    title: "Scansione approfondita dispositivo",
    description: "Query/ARP/porte per router e switch; scan Proxmox/WinRM dedicati.",
    implementationHint: "query device, proxmox-scan, mikrotik API",
  },
  {
    id: "switch_port_ipam_link",
    order: 15,
    title: "Switch: porta ↔ MAC ↔ IPAM",
    description:
      "MAC table sullo switch; se una porta ha un solo MAC, risolvere verso host IPAM e salvare porta/switch (switch_ports.host_id).",
    implementationHint: "arp_poll → upsertSwitchPorts, resolveMacToDevice",
  },
] as const;

export function getSubnetEvaluationPhasesSorted(): SubnetEvaluationPhase[] {
  return [...SUBNET_EVALUATION_PHASES].sort((a, b) => a.order - b.order);
}
