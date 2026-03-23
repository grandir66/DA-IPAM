import type { NetworkDevice } from "@/types";

/**
 * Profilo prodotto: marca (vendor DB) + tipologia funzionale.
 * Assegnazione manuale; supporta scansioni dedicate e credenziali nominative per profilo.
 */
export const PRODUCT_PROFILE_IDS = [
  "mikrotik_router",
  "mikrotik_switch",
  "mikrotik_other",
  "ubiquiti_switch_base",
  "ubiquiti_switch_managed",
  "ubiquiti_access_point",
  "ubiquiti_other",
  "windows_server",
  "windows_client",
  "linux_server",
  "linux_client",
  "proxmox_ve",
  "proxmox_pbs",
  "synology_storage",
  "qnap_storage",
  "qnap_switch",
  "qnap_router",
  "hp_switch_procurve",
  "hp_switch_comware",
  "hp_switch_arubaos",
  "hp_server_ilo",
  "hp_stampante",
  "omada_switch",
  "omada_access_point",
  "omada_other",
  "stormshield_firewall",
  "cisco_switch",
  "cisco_router",
  "cisco_telefono",
  "vmware_vsphere",
  "generic_ups",
  "generic_voip",
  "generic_cam",
  "generic_stampante",
  "generic_iot",
] as const;

export type ProductProfileId = (typeof PRODUCT_PROFILE_IDS)[number];

export const PRODUCT_PROFILE_LABELS: Record<ProductProfileId, string> = {
  mikrotik_router: "Router",
  mikrotik_switch: "Switch",
  mikrotik_other: "Altro",
  ubiquiti_switch_base: "Switch base",
  ubiquiti_switch_managed: "Switch gestito",
  ubiquiti_access_point: "Access Point",
  ubiquiti_other: "Altro",
  windows_server: "Server",
  windows_client: "Client",
  linux_server: "Server",
  linux_client: "Client",
  proxmox_ve: "VE (Proxmox VE)",
  proxmox_pbs: "PBS (Backup Server)",
  synology_storage: "Storage",
  qnap_storage: "Storage",
  qnap_switch: "Switch",
  qnap_router: "Router",
  hp_switch_procurve: "Switch ProCurve",
  hp_switch_comware: "Switch Comware",
  hp_switch_arubaos: "Switch ArubaOS",
  hp_server_ilo: "Server (iLO)",
  hp_stampante: "Stampante",
  omada_switch: "Switch",
  omada_access_point: "Access Point",
  omada_other: "Altro",
  stormshield_firewall: "Firewall",
  cisco_switch: "Switch",
  cisco_router: "Router",
  cisco_telefono: "Telefono",
  vmware_vsphere: "vSphere / ESXi",
  generic_ups: "UPS",
  generic_voip: "Telefono VoIP",
  generic_cam: "Telecamera",
  generic_stampante: "Stampante",
  generic_iot: "IoT",
};

/** Vendor DB → elenco profili ammessi */
export const PRODUCT_PROFILES_BY_VENDOR: Record<NetworkDevice["vendor"], readonly ProductProfileId[]> = {
  mikrotik: ["mikrotik_router", "mikrotik_switch", "mikrotik_other"],
  ubiquiti: ["ubiquiti_switch_base", "ubiquiti_switch_managed", "ubiquiti_access_point", "ubiquiti_other"],
  windows: ["windows_server", "windows_client"],
  linux: ["linux_server", "linux_client"],
  proxmox: ["proxmox_ve", "proxmox_pbs"],
  synology: ["synology_storage"],
  qnap: ["qnap_storage", "qnap_switch", "qnap_router"],
  hp: ["hp_switch_procurve", "hp_switch_comware", "hp_switch_arubaos", "hp_server_ilo", "hp_stampante"],
  omada: ["omada_switch", "omada_access_point", "omada_other"],
  stormshield: ["stormshield_firewall"],
  cisco: ["cisco_switch", "cisco_router", "cisco_telefono"],
  vmware: ["vmware_vsphere"],
  other: ["generic_ups", "generic_voip", "generic_cam", "generic_stampante", "generic_iot"],
};

export function getProductProfilesForVendor(vendor: string | null | undefined): { id: ProductProfileId; label: string }[] {
  const v = (vendor || "other") as NetworkDevice["vendor"];
  const ids = PRODUCT_PROFILES_BY_VENDOR[v] ?? PRODUCT_PROFILES_BY_VENDOR.other;
  return ids.map((id) => ({ id, label: PRODUCT_PROFILE_LABELS[id] }));
}

export function getDefaultProductProfileForVendor(vendor: string | null | undefined): ProductProfileId {
  const list = getProductProfilesForVendor(vendor);
  return list[0]?.id ?? "generic_iot";
}

export function isValidProductProfileForVendor(
  vendor: string | null | undefined,
  profile: string | null | undefined
): profile is ProductProfileId {
  if (!profile) return false;
  const allowed = new Set(PRODUCT_PROFILES_BY_VENDOR[(vendor || "other") as NetworkDevice["vendor"]] ?? []);
  return allowed.has(profile as ProductProfileId);
}

/**
 * Suggerisce device_type in base al profilo (router/switch/hypervisor).
 */
export function suggestDeviceTypeFromProductProfile(profile: ProductProfileId): NetworkDevice["device_type"] {
  if (
    profile === "mikrotik_router" ||
    profile === "qnap_router" ||
    profile === "cisco_router"
  ) {
    return "router";
  }
  if (
    profile === "proxmox_ve" ||
    profile === "proxmox_pbs" ||
    profile === "vmware_vsphere"
  ) {
    return "hypervisor";
  }
  return "switch";
}

/**
 * Allinea vendor_subtype (ProCurve/Comware) per compatibilità client SSH/SNMP esistenti.
 */
export function vendorSubtypeFromProductProfile(profile: ProductProfileId): "procurve" | "comware" | null {
  if (profile === "hp_switch_procurve") return "procurve";
  if (profile === "hp_switch_comware") return "comware";
  return null;
}

/**
 * Allinea scan_target Proxmox (VE vs PBS).
 */
export function scanTargetHintFromProductProfile(profile: ProductProfileId): NetworkDevice["scan_target"] | null {
  if (profile === "proxmox_ve") return "proxmox";
  if (profile === "proxmox_pbs") return "linux";
  return null;
}

/** Protocolli/trasporti tipici per orchestrare acquisizione (ordine = priorità suggerita). */
export type AcquisitionProtocol = "icmp" | "snmp" | "ssh" | "api" | "winrm" | "https";

/**
 * Conoscenza operativa per profilo: obiettivo, stack di scan, credenziali attese, note.
 * Usabile da UI (tooltip), registry acquisizione e documentazione generata.
 */
export interface ProductProfileMeta {
  /** Scopo funzionale del profilo in una riga */
  intent: string;
  /** Ordine consigliato per reachability + raccolta dati (dopo ICMP di discovery globale) */
  acquisitionPriority: readonly AcquisitionProtocol[];
  /** Che tipo di credenziale nominata ha senso (senza segreti) */
  credentialHint: string;
  /** Note per operatori: limiti, varianti HW/SW, alternative */
  notes: string;
}

/** Metadati generati da pratica comune su reti enterprise / SMB. */
export const PRODUCT_PROFILE_KNOWLEDGE: Record<ProductProfileId, ProductProfileMeta> = {
  mikrotik_router: {
    intent: "Router/gateway RouterOS: routing, firewall, NAT, VPN, DHCP.",
    acquisitionPriority: ["ssh", "snmp", "api"],
    credentialHint: "Credenziale SSH (admin) o SNMP community/v3 per solo lettura tabelle.",
    notes: "RouterOS espone CLI/API coerenti; per inventario completo servono permessi che consentano export o lettura strutturata. API REST su HTTPS se abilitata.",
  },
  mikrotik_switch: {
    intent: "Switch/CAP RouterOS (CRS/CSS): bridge, VLAN, spanning tree, MAC.",
    acquisitionPriority: ["ssh", "snmp"],
    credentialHint: "SSH con utente che può leggere bridge e interface; SNMP per MAC/VLAN senza sessione interattiva.",
    notes: "CRS spesso in bridge: distinguere porte fisiche da bridge logici. LLDP se abilitato in rete.",
  },
  mikrotik_other: {
    intent: "Dispositivo MikroTik non classificato come router/switch dedicato (CHR, tunnel, altro ruolo).",
    acquisitionPriority: ["ssh", "snmp"],
    credentialHint: "SSH; SNMP se serve solo telemetria.",
    notes: "Verificare ruolo reale sul campo: stesso vendor ma comandi e sezioni inventario diverse.",
  },
  ubiquiti_switch_base: {
    intent: "Switch UniFi ‘lite’ / Layer2 senza feature avanzate gestite via controller.",
    acquisitionPriority: ["snmp", "ssh"],
    credentialHint: "SNMP read-only; SSH solo se abilitato e utile (non sempre presente su tutti i modelli).",
    notes: "Molti dati (VLAN, porte) passano dal controller UniFi; inventario lato device spesso limitato senza integrazione controller.",
  },
  ubiquiti_switch_managed: {
    intent: "Switch UniFi gestiti (UniFi OS / controller): VLAN, STP, aggregazione, statistiche porte.",
    acquisitionPriority: ["snmp", "ssh"],
    credentialHint: "SNMP + eventuale API/controller con token dedicato (profilo separato).",
    notes: "Per vista coerente con la dashboard ufficiale spesso serve anche la lettura via controller, non solo SNMP diretto.",
  },
  ubiquiti_access_point: {
    intent: "AP UniFi: radio, SSID, client associati, canale, potenza.",
    acquisitionPriority: ["snmp", "ssh"],
    credentialHint: "SNMP; credenziali device se serve CLI/debug.",
    notes: "Dettagli client e RF spesso nel controller; sul singolo AP restano contatori e stato radio via SNMP dove esposto.",
  },
  ubiquiti_other: {
    intent: "Ecosistema UniFi non switch/AP (gateway UDM, ecc.) o classificazione generica.",
    acquisitionPriority: ["ssh", "snmp", "api"],
    credentialHint: "SSH o API UniFi secondo modello.",
    notes: "Allineare il profilo al ruolo reale: stesso vendor, profili d’acquisizione diversi.",
  },
  windows_server: {
    intent: "Server Windows: ruoli (AD, file, DNS, IIS), servizi, patch, hardware, storage.",
    acquisitionPriority: ["winrm", "ssh", "snmp"],
    credentialHint: "Credenziale WinRM (locale o dominio) con lettura WMI/CIM; SNMP solo se agente presente.",
    notes: "Per inventario profondo: account con permessi di lettura WMI e non interattivo. Server Core vs GUI: stesso WinRM.",
  },
  windows_client: {
    intent: "Workstation Windows: software, patch, rete, utenti locali.",
    acquisitionPriority: ["winrm", "ssh"],
    credentialHint: "WinRM con utente standard o helpdesk; firewall client può bloccare: policy GPO.",
    notes: "Client spesso in DHCP e senza SNMP; WinRM deve essere abilitato e consentito in rete.",
  },
  linux_server: {
    intent: "Server GNU/Linux: systemd, pacchetti, rete, storage, container.",
    acquisitionPriority: ["ssh", "snmp"],
    credentialHint: "Utente SSH con sudo senza password per script o gruppo dedicato inventario.",
    notes: "SNMP utile se net-snmp configurato; altrimenti SSH + comandi idempotenti. Attenzione a distro minimal/container.",
  },
  linux_client: {
    intent: "Desktop Linux: servizi utente, rete, ultimo login.",
    acquisitionPriority: ["ssh"],
    credentialHint: "SSH con utente con shell; spesso niente SNMP.",
    notes: "Permessi utente limitano cosa si può leggere senza sudo.",
  },
  proxmox_ve: {
    intent: "Proxmox VE: cluster, nodi, VM/CT, storage, backup job lato hypervisor.",
    acquisitionPriority: ["api", "ssh", "snmp"],
    credentialHint: "Token API o utente @pam + segreto; SSH root o chiave per comandi pvesh.",
    notes: "API porta 8006; verificare certificati o usare http per test. Multi-nodo: stesso cluster, più IP.",
  },
  proxmox_pbs: {
    intent: "Proxmox Backup Server: datastore, gruppi backup, schedulazione, dedup.",
    acquisitionPriority: ["api", "ssh"],
    credentialHint: "API PBS (utente dedicato inventario) o SSH per lettura configurazione.",
    notes: "Non confondere con PVE: stesso ecosistema ma metriche e oggetti diversi. Scan target ‘linux’ + profilo PBS per coerenza.",
  },
  synology_storage: {
    intent: "NAS Synology DSM: volumi, shared folder, iSCSI, snapshot, account.",
    acquisitionPriority: ["ssh", "snmp", "api"],
    credentialHint: "Utente amministratore DSM o dedicato; SNMP DSM standard; API HTTPS se esposta.",
    notes: "Feature variano per modello e pacchetti (es. Virtualization). SSH spesso disabilitato di default.",
  },
  qnap_storage: {
    intent: "NAS QNAP QTS/QuTS: volumi, share, snapshot, app container.",
    acquisitionPriority: ["ssh", "snmp", "api"],
    credentialHint: "Admin QTS o utente con permessi; SNMP se attivato.",
    notes: "Interfaccia ricca: preferire API documentate o SSH controllato per non sovraccaricare il NAS.",
  },
  qnap_switch: {
    intent: "Switch gestiti QNAP (serie QSW): VLAN, porte, mirroring.",
    acquisitionPriority: ["snmp", "ssh"],
    credentialHint: "SNMP + credenziali web/CLI se esposte per automazione.",
    notes: "Firmware e CLI possono differire tra serie; validare su campo.",
  },
  qnap_router: {
    intent: "Router QNAP (es. QHora): WAN/LAN, VPN, NAT, Wi‑Fi integrato.",
    acquisitionPriority: ["ssh", "snmp"],
    credentialHint: "SSH o SNMP secondo firmware; profilo simile a router SMB.",
    notes: "Non assumere piena compatibilità con i comandi MikroTik/Cisco: semantics propria.",
  },
  hp_switch_procurve: {
    intent: "Switch HPE Aruba (ex ProCurve): VLAN, trunks, MAC, LLDP, spanning tree.",
    acquisitionPriority: ["snmp", "ssh"],
    credentialHint: "SNMP read-only + manager/operator SSH; comandi CLI classici ProCurve.",
    notes: "Modelli molto long-life: alcune feature solo su firmware recente. SNMP MIB standard + enterprise.",
  },
  hp_switch_comware: {
    intent: "Switch H3C/Comware (HPE A‑serie): IRF/stacking, routing leggero.",
    acquisitionPriority: ["snmp", "ssh"],
    credentialHint: "SSH privilegiato; SNMP v3 consigliato in produzione.",
    notes: "CLI diversa da ProCurve: non mischiare template comandi. Stack IRF = una sola entità logica.",
  },
  hp_switch_arubaos: {
    intent: "Switch ArubaOS‑CX / OS‑Switch: fabric, EVPN, policy, porte.",
    acquisitionPriority: ["ssh", "snmp", "api"],
    credentialHint: "SSH API/REST su piattaforme CX; SNMP dove supportato.",
    notes: "Central/cloud cambia dove risiede la verità configurativa; switch può essere solo agent.",
  },
  hp_server_ilo: {
    intent: "Management out‑of‑band iLO: hardware, sensori, log, power, virtual media.",
    acquisitionPriority: ["https", "snmp"],
    credentialHint: "Account iLO dedicato (lettura); Redfish preferibile a XML legacy dove disponibile.",
    notes: "Non è il SO del server: inventario OS va raccolto via agent o scan OS separato.",
  },
  hp_stampante: {
    intent: "Stampante HP Jetdirect: contatori, toner, errori, rete.",
    acquisitionPriority: ["snmp", "https"],
    credentialHint: "SNMP standard stampanti; pagina web se abilitata.",
    notes: "Spesso solo SNMP v1/v2 community ‘public’ in LAN; valutare hardening.",
  },
  omada_switch: {
    intent: "Switch Omada SDN: VLAN, PoE, profili porte.",
    acquisitionPriority: ["snmp", "ssh"],
    credentialHint: "SNMP diretto; integrazione controller Omada per vista unificata.",
    notes: "Stesso vendor della linea TP‑Link business ma stack gestione Omada.",
  },
  omada_access_point: {
    intent: "Access point Omada EAP: SSID, radio, client, roaming.",
    acquisitionPriority: ["snmp", "ssh"],
    credentialHint: "SNMP; controller Omada per dettagli RF/client.",
    notes: "Modalità standalone vs controller cambiano cosa è leggibile in locale.",
  },
  omada_other: {
    intent: "Controller Omada (OC200/300, software) o dispositivi non AP/switch puri.",
    acquisitionPriority: ["https", "ssh", "snmp"],
    credentialHint: "Credenziale web controller o SSH se esposto.",
    notes: "Qui l’inventario è spesso ‘logico’ (siti, WLAN) più che fisico singolo.",
  },
  stormshield_firewall: {
    intent: "Firewall Stormshield (ex Netasq): policy, VPN IPsec/SSL, oggetti, log.",
    acquisitionPriority: ["ssh", "snmp", "https"],
    credentialHint: "Admin Stormshield o API; SNMP limitato a metriche.",
    notes: "CLI proprietaria; per export coerenti usare strumenti ufficiali o API documentata.",
  },
  cisco_switch: {
    intent: "Switch Cisco IOS/IOS‑XE/NX‑OS (layer access/distribution): VLAN, trunk, STP, port‑channel.",
    acquisitionPriority: ["ssh", "snmp"],
    credentialHint: "Utente privilegiato o SNMPv3 authPriv; attenzione a VRF e AAA.",
    notes: "NX‑OS vs IOS differiscono per comandi; modular vs fixed cambia output. CDP/LLDP utili per topologia.",
  },
  cisco_router: {
    intent: "Router Cisco ISR/ASR/CSR: routing, VPN, QoS, interfacce.",
    acquisitionPriority: ["ssh", "snmp"],
    credentialHint: "SSH TACACS/RADIUS o locale; SNMP per routing table e interface.",
    notes: "Configurazioni grandi: preferire show strutturati o JSON dove supportato (piattaforma dipendente).",
  },
  cisco_telefono: {
    intent: "Telefono IP Cisco (SCCP/SIP): linee, registrazione, firmware.",
    acquisitionPriority: ["https", "snmp"],
    credentialHint: "Web phone o SNMP se abilitato; CUCM lato centralino per verità massima.",
    notes: "Molti dati sono nel CUCM; sul device restano stato e network.",
  },
  vmware_vsphere: {
    intent: "VMware ESXi o stack vSphere: host, VM, datastore, networking vSphere.",
    acquisitionPriority: ["https", "ssh", "snmp"],
    credentialHint: "Account ESXi locale o AD; API vSphere per inventario completo; SNMP limitato su host.",
    notes: "vCenter centralizza: inventario ‘vero’ spesso da API vCenter, non solo host singolo.",
  },
  generic_ups: {
    intent: "UPS/PDU intelligenti: stato batteria, carico, eventi, autonomia.",
    acquisitionPriority: ["snmp", "https"],
    credentialHint: "SNMP (MIB UPS standard/IETF o vendor); interfaccia web se presente.",
    notes: "Marche diverse (APC, Eaton, …) con OID diversi: profilo generico = adattatori per MIB.",
  },
  generic_voip: {
    intent: "Telefono VoIP generico (SIP): account, codec, rete.",
    acquisitionPriority: ["https", "snmp"],
    credentialHint: "HTTP/HTTPS device; SNMP se esposto.",
    notes: "Provisioning da PBX centralizzato: inventario distribuito vs centralizzato va esplicitato.",
  },
  generic_cam: {
    intent: "Telecamera IP: stream, motion, firmware, rete.",
    acquisitionPriority: ["https", "snmp"],
    credentialHint: "Credenziale ONVIF o web; SNMP raro.",
    notes: "ONVIF per profilo device; attenzione a firmware obsoleti e credenziali default.",
  },
  generic_stampante: {
    intent: "Stampante non-HP: contatori, supply, errori (Jetdirect‑like).",
    acquisitionPriority: ["snmp", "https"],
    credentialHint: "SNMP Printer MIB; pagina web.",
    notes: "Vendor diversi (Kyocera, Epson, Brother) con OID specifici oltre allo standard minimo.",
  },
  generic_iot: {
    intent: "Dispositivo IoT/sensore/PLC leggero: telemetry, stato, firmware.",
    acquisitionPriority: ["https", "snmp", "ssh"],
    credentialHint: "Molto variabile: MQTT/API REST custom, SNMP minimale, SSH su gateway.",
    notes: "Profilo catch‑all: spesso serve integrazione dedicata per protocollo verticale.",
  },
};

/** Per inventario: chiavi JSON / sezioni UI consigliate (estendibile). */
export const PRODUCT_PROFILE_INVENTORY_HINTS: Record<
  ProductProfileId,
  { summary: string; specificFields: string[] }
> = {
  mikrotik_router: {
    summary: "Interfacce, route, firewall, NAT, VPN, DHCP, queue",
    specificFields: ["interfaces", "routes", "firewall", "dhcp", "ip_pool", "vpn"],
  },
  mikrotik_switch: { summary: "Bridge, VLAN, MAC, STP", specificFields: ["bridge", "vlan", "mac_table", "stp"] },
  mikrotik_other: { summary: "Identità, risorse, servizi", specificFields: ["system", "resource", "services"] },
  ubiquiti_switch_base: { summary: "Porte, stato link, VLAN base", specificFields: ["ports", "vlan", "link_status"] },
  ubiquiti_switch_managed: {
    summary: "Porte, VLAN, STP, LLDP, PoE, statistiche",
    specificFields: ["ports", "vlan", "stp", "lldp", "poe", "counters"],
  },
  ubiquiti_access_point: {
    summary: "Radio 2.4/5/6 GHz, SSID, client, canale, potenza",
    specificFields: ["wifi", "ssid", "clients", "channel", "tx_power"],
  },
  ubiquiti_other: { summary: "Sistema, servizi, ruolo", specificFields: ["system", "services", "role"] },
  windows_server: {
    summary: "Ruoli, servizi, patch, hardware, disco, rete, AD (se DC)",
    specificFields: ["roles", "services", "updates", "hardware", "disks", "network", "ad"],
  },
  windows_client: {
    summary: "Software, patch, rete, utenti, antivirus",
    specificFields: ["software", "updates", "network", "users", "av"],
  },
  linux_server: {
    summary: "Pacchetti, systemd, rete, storage, container",
    specificFields: ["packages", "services", "network", "storage", "containers"],
  },
  linux_client: { summary: "Servizi, rete, ultimo accesso", specificFields: ["services", "network", "sessions"] },
  proxmox_ve: {
    summary: "Nodi, VM/CT, storage, rete virtuale, backup",
    specificFields: ["nodes", "vms", "storage", "network", "backups", "cluster"],
  },
  proxmox_pbs: { summary: "Datastore, gruppi backup, catalogo, schedulazione", specificFields: ["datastores", "groups", "jobs", "catalog"] },
  synology_storage: {
    summary: "Volumi, shared folder, iSCSI, snapshot, DSM, utenti",
    specificFields: ["volumes", "shares", "iscsi", "snapshots", "dsm", "users"],
  },
  qnap_storage: {
    summary: "Volumi, cartelle, app, snapshot, rete",
    specificFields: ["volumes", "shares", "apps", "snapshots", "network"],
  },
  qnap_switch: { summary: "Porte, VLAN, mirroring, PoE", specificFields: ["ports", "vlan", "mirror", "poe"] },
  qnap_router: { summary: "Interfacce, NAT, VPN, Wi‑Fi", specificFields: ["interfaces", "nat", "vpn", "wifi"] },
  hp_switch_procurve: {
    summary: "Porte, VLAN, MAC, LLDP, trunks, PoE",
    specificFields: ["ports", "vlan", "mac", "lldp", "trunks", "poe"],
  },
  hp_switch_comware: { summary: "Porte, VLAN, IRF, routing statico", specificFields: ["ports", "vlan", "irf", "routing"] },
  hp_switch_arubaos: {
    summary: "Porte, policy, VSX/VSF, EVPN (se presente)",
    specificFields: ["ports", "policy", "stacking", "evpn"],
  },
  hp_server_ilo: {
    summary: "Modello seriale, sensori, log IML, power, firmware iLO",
    specificFields: ["hardware", "sensors", "events", "power", "firmware_ilo"],
  },
  hp_stampante: { summary: "Contatori pagine, toner, vassoio, errori", specificFields: ["counters", "supplies", "alerts"] },
  omada_switch: { summary: "VLAN, PoE, profili, statistiche", specificFields: ["ports", "vlan", "poe", "profiles"] },
  omada_access_point: { summary: "SSID, radio, client, WLAN group", specificFields: ["ssid", "radio", "clients", "wlan"] },
  omada_other: { summary: "Siti, WLAN, controller, adoption", specificFields: ["sites", "wlan", "controller", "devices"] },
  stormshield_firewall: {
    summary: "Policy, oggetti, VPN, HA, log filtrati",
    specificFields: ["rules", "objects", "vpn", "ha", "logs"],
  },
  cisco_switch: {
    summary: "Porte, VLAN, STP, EtherChannel, MAC, PoE",
    specificFields: ["ports", "vlan", "stp", "port_channel", "mac", "poe"],
  },
  cisco_router: {
    summary: "Interfacce, routing, VPN, ACL, QoS",
    specificFields: ["interfaces", "routing", "vpn", "acl", "qos"],
  },
  cisco_telefono: { summary: "Linee SIP/SCCP, registrazione, firmware", specificFields: ["lines", "registration", "firmware"] },
  vmware_vsphere: {
    summary: "Host, VM, datastore, vSwitch/portgroup, risorse",
    specificFields: ["hosts", "vms", "datastores", "networking", "resources"],
  },
  generic_ups: { summary: "Stato UPS, batteria, carico, eventi, test autonomia", specificFields: ["status", "battery", "load", "events", "runtime"] },
  generic_voip: { summary: "Registrazione SIP, account, codec, NAT", specificFields: ["sip", "accounts", "codec", "nat"] },
  generic_cam: { summary: "Risoluzione, stream, motion, firmware, rete", specificFields: ["stream", "motion", "firmware", "network"] },
  generic_stampante: { summary: "Contatori, supply, modello, errori", specificFields: ["counters", "supplies", "alerts"] },
  generic_iot: { summary: "Telemetry, stato, firmware, connettività", specificFields: ["telemetry", "state", "firmware", "connectivity"] },
};

/** Restituisce metadati operativi per un profilo (o null se sconosciuto). */
export function getProductProfileKnowledge(profile: string | null | undefined): ProductProfileMeta | null {
  if (!profile) return null;
  return PRODUCT_PROFILE_KNOWLEDGE[profile as ProductProfileId] ?? null;
}

/** Inventario richiede credenziale nominata (non opzionale per scan gestiti). */
export function productProfileRequiresNamedCredential(profile: ProductProfileId): boolean {
  return true;
}

export function inferProductProfileFromLegacy(
  vendor: NetworkDevice["vendor"],
  deviceType: NetworkDevice["device_type"],
  vendorSubtype: NetworkDevice["vendor_subtype"],
  scanTarget: NetworkDevice["scan_target"]
): ProductProfileId | null {
  if (vendor === "mikrotik") {
    return deviceType === "router" ? "mikrotik_router" : "mikrotik_switch";
  }
  if (vendor === "hp") {
    if (vendorSubtype === "procurve") return "hp_switch_procurve";
    if (vendorSubtype === "comware") return "hp_switch_comware";
    return "hp_switch_arubaos";
  }
  /** QNAP: router/switch/storage (slug DB vendor `qnap`). */
  if (vendor === "qnap") {
    if (deviceType === "router") return "qnap_router";
    if (deviceType === "switch") return "qnap_switch";
    return "qnap_storage";
  }
  if (vendor === "proxmox") {
    if (scanTarget === "proxmox" || deviceType === "hypervisor") return "proxmox_ve";
    return "proxmox_pbs";
  }
  if (vendor === "vmware") return "vmware_vsphere";
  return getDefaultProductProfileForVendor(vendor);
}
