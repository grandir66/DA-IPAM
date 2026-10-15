/**
 * Tipi del modello della mappa (spec 2026-10-12-topology-map-design §3).
 * Logica pura: nessun import del DB. Gli id dei nodi sono "dev:<id>" (apparato
 * di rete) e "host:<id>" (host non fuso con un apparato).
 */

export type LinkSource = "manual" | "unifi_uplink" | "lldp" | "cdp" | "mndp" | "mac_table" | "vm_mac";

/**
 * Più basso = più affidabile (spec §3, «fonti in ordine di fiducia»). `vm_mac` (spec §12.5, «dalle VM»: su una porta
 * passano solo VM accese di un hypervisor) viene subito dopo la tabella MAC: la porta la dice una prova indiretta.
 */
export const LINK_SOURCE_RANK: Readonly<Record<LinkSource, number>> = {
  manual: 0,
  unifi_uplink: 1,
  lldp: 2,
  cdp: 2,
  mndp: 2,
  mac_table: 3,
  vm_mac: 3.5,
};

export interface ModelDeviceRow {
  id: number;
  name: string;
  host: string;
  device_type: string;
  vendor: string;
  model: string | null;
  enabled: number;
  host_id: number | null;
  physical_device_id: number | null;
  location_id: number | null;
  controller_mac: string | null;
  uplink_mac: string | null;
  uplink_remote_port: number | null;
  uplink_seen_at: string | null;
  /** Tipo dell'uplink UniFi: 'wire' | 'wireless' (Task 3); null se la lettura non l'ha riportato. */
  uplink_type: string | null;
  topology_hidden: number;
  port_count: number;
  /**
   * 1 = l'apparato ha la scansione Proxmox (tipo di scansione «proxmox» o un risultato salvato): per la
   * mappa un server così è un hypervisor anche con un altro fornitore (spec §11.5, revisione finale M-2).
   * Facoltativo: le fixture anonime precedenti non ce l'hanno (vale 0).
   */
  proxmox_scan?: number;
  /** network_devices.protocol, la via di lettura (ssh, snmp_v2, api…): la usano i traduttori (spec §13.6.1). Assente nelle fixture di prima. */
  via?: string | null;
  /** network_devices.topology_role, «Ruolo nella mappa» a mano (T1b): '' o null = decide il sistema. Assente nelle fixture di prima. */
  topology_role?: string | null;
}

export interface ModelHostRow {
  id: number;
  network_id: number;
  ip: string;
  mac: string | null;
  hostname: string | null;
  custom_name: string | null;
  classification: string | null;
  status: string | null;
  physical_device_id: number | null;
}

export interface ModelNeighborRow {
  device_id: number;
  local_port: string;
  remote_device_name: string;
  remote_port: string;
  protocol: string;
  remote_ip: string | null;
  remote_mac: string | null;
  /** La piattaforma annunciata dal vicino: il traduttore del lato remoto (spec §13.6.1). Assente nelle fixture di prima. */
  remote_platform?: string | null;
  timestamp: string | null;
  source: string;
}

export interface ModelUplinkPortRow {
  device_id: number;
  port_index: number;
  port_name: string;
}

export interface ModelLocationRow {
  id: number;
  name: string;
  parent_id: number | null;
  head_device_id: number | null;
}

export interface ModelNetworkRow {
  id: number;
  cidr: string;
  name: string;
  gateway: string | null;
  location_id: number | null;
}

export interface ModelKnownMacRow {
  device_id: number;
  mac: string;
}

export interface ModelMacPortRow {
  device_id: number;
  mac: string;
  port_name: string;
  timestamp: string;
  source: string;
}

export interface LinkOverrideRow {
  id: number;
  action: "add" | "ignore";
  a_node: string;
  a_port: string;
  b_node: string;
  b_port: string;
  /** 'cavo' | 'fibra' | 'wireless' o null (tipo non indicato); le rotte non scrivono altro. */
  medium: string | null;
  /** Chi e quando, per le frasi di T1b («Collegato a mano da ‹utente› il ‹data›»). Assenti nelle fixture di prima. */
  created_by?: string | null;
  created_at?: string | null;
}

/** Il collegamento principale scelto a mano: «per node_id il principale è quello verso other_node». */
export interface ModelPrimaryRow {
  node_id: string;
  other_node: string;
  node_port: string;
  other_port: string;
}

export interface ModelPortInfoRow {
  device_id: number;
  port_name: string;
  speed: string | null;
  poe_status: string | null;
  poe_power_mw: number | null;
}

export interface ModelPortRow {
  device_id: number;
  port_index: number;
  port_name: string;
  speed: string | null;
  status: string | null;
  /** Stato dello spanning tree come lo scrive la lettura di oggi: lo legge la prova di ruolo di T1b. */
  stp_state: string | null;
}

/** Una VM letta dalla scansione Proxmox di un apparato (spec §11.5). */
export interface ModelVmRow {
  scannedDeviceId: number;
  vmid: number;
  name: string;
  /** Il nome dell'host Proxmox su cui gira. */
  node: string;
  status: string;
  type: string;
  macs: string[];
  ips: string[];
  scannedAt: string | null;
}

/** Un host del cluster letto dalla scansione Proxmox: serve ad abbinare le VM al loro hypervisor. */
export interface ModelScanHostRow {
  scannedDeviceId: number;
  hostname: string;
  ips: string[];
  macs: string[];
  /** `scanned_at` della scansione Proxmox da cui viene (serve al nome dal Proxmox: solo ultimi 30 giorni). */
  scannedAt?: string | null;
}

export interface TopologyModelInput {
  devices: ModelDeviceRow[];
  hosts: ModelHostRow[];
  neighbors: ModelNeighborRow[];
  uplinkPorts: ModelUplinkPortRow[];
  locations: ModelLocationRow[];
  networks: ModelNetworkRow[];
  knownMacs: ModelKnownMacRow[];
  overrides: LinkOverrideRow[];
  /** Ultimi 30 giorni; spec §10.5. */
  macPorts: ModelMacPortRow[];
  /** Collegamenti principali scelti a mano (tabella topology_link_primary). */
  primaries: ModelPrimaryRow[];
  /** Velocità e PoE delle porte degli switch. */
  portInfo: ModelPortInfoRow[];
  /** Tutte le porte di ogni apparato, con l'indice (spec §13.6.1): la chiave della porta e la velocità per chiave. */
  ports?: ModelPortRow[];
  /** VM delle scansioni Proxmox e host dei cluster. */
  vms: ModelVmRow[];
  scanHosts: ModelScanHostRow[];
  /** Orologio iniettato: stessi dati + stesso nowMs = stesso modello. */
  nowMs: number;
  /** Giorni dopo cui un collegamento è «non visto» (decisione 13/10: 2). */
  staleDays: number;
}

export interface MapNode {
  id: string;
  kind: "device" | "host";
  refId: number;
  name: string;
  /** device_type dell'apparato, o classificazione dell'host. */
  type: string;
  mgmtIp: string | null;
  /** Host assorbiti dall'apparato: niente doppi (spec §3). */
  fusedHostIds: number[];
  /** Tutti gli indirizzi dell'oggetto fisico; virtual = IP di un MAC VRRP/HSRP (spec §10.4). */
  addresses: Array<{ ip: string; virtual: boolean; hostId: number | null }>;
  /** Altri nomi con cui l'oggetto si annuncia (hostname, nome personalizzato, LLDP/CDP/MNDP). */
  aliases: string[];
  siteId: number | null;
  rackId: number | null;
  /** true = sede proposta dal sistema, non confermata da un admin. */
  siteProposed: boolean;
  hidden: boolean;
  /** Fornitore dell'apparato (proxmox, vmware… per riconoscere un hypervisor); null per un host. */
  vendor: string | null;
  /** L'apparato ha la scansione Proxmox (revisione finale M-2); assente = no. */
  proxmoxScan?: boolean;
  /**
   * Spec §12.5, «nome dal Proxmox»: un hypervisor il cui IP sta nelle schede di un host della scansione Proxmox
   * con un altro nome si chiama come il nodo Proxmox (`name`); qui resta il nome di prima, che la mappa mostra come
   * «DNS: …». Solo la mappa: l'inventario non cambia. Assente = nessun cambio di nome.
   */
  dnsName?: string;
}

export type LinkMedium = "cavo" | "fibra" | "wireless";

/** Orientamento della mappa (spec §12.2): `lr` «Verticale», da sinistra a destra con i fratelli impilati (predefinito); `tb` «Orizzontale», dall'alto. */
export type MapOrientation = "lr" | "tb";

export interface MapLink {
  id: string;
  a: string;
  aPort: string;
  b: string;
  bPort: string;
  /** La fonte più affidabile fra quelle che vedono il collegamento. */
  source: LinkSource;
  sources: LinkSource[];
  /** Per un uplink UniFi: il nodo che esce (il figlio). */
  uplinkFrom: string | null;
  lastSeen: string | null;
  daysUnseen: number | null;
  stale: boolean;
  /** Tipo a mano; altrimenti wireless se l'uplink è wireless o la porta è «wifi»; altrimenti null. */
  medium: LinkMedium | null;
  /** Presente solo per un collegamento dichiarato a mano: confermato se i dati lo vedono. */
  manual: { confirmed: boolean } | null;
  /** Velocità della porta dello switch sul collegamento (Mbps). */
  speedMbps: number | null;
  /** Potenza PoE erogata sulla porta (W). */
  poeW: number | null;
  /** «user» = scelto a mano dall'admin; «auto» = scelto dal sistema (lo imposta l'albero); null = non è un principale. */
  primary: "user" | "auto" | null;
  /** Per primary «user»: il nodo (il figlio) per cui l'admin ha scelto questo collegamento. */
  primaryFor: string | null;
  /** Collegamento verso un nodo visibile che l'albero non usa: ridondanza (lo imposta l'albero). */
  redundant: boolean;
  /** Solo con la fonte `vm_mac` (spec §12.5): quante VM accese dell'hypervisor (`uplinkFrom`) passano dalla porta. */
  vmCount?: number;
}

/** Attributi del collegamento che nascono neutri; li riempiono link-attrs.ts (dati) e l'albero (principale, ridondanza). */
export const LINK_ATTRS_DEFAULT: Pick<MapLink, "medium" | "manual" | "speedMbps" | "poeW" | "primary" | "primaryFor" | "redundant"> = {
  medium: null, manual: null, speedMbps: null, poeW: null, primary: null, primaryFor: null, redundant: false,
};

/** Una VM dentro il suo hypervisor (spec §11.5). */
export interface MapVm {
  /** "vm:<scannedDeviceId>:<vmid>" */
  id: string;
  name: string;
  status: string;
  ips: string[];
  hypervisorNodeId: string | null;
  /** Il nodo esistente (host o apparato) che è questa VM: stesso MAC, o stesso nome se la VM non ha MAC. */
  nodeId: string | null;
  scannedAt: string | null;
}

export interface SiteInfo {
  locationId: number;
  name: string;
  headNodeId: string | null;
  headProposed: boolean;
  nodeIds: string[];
}

export interface PromoteProposal {
  hostId: number;
  name: string;
  ip: string;
  classification: string;
  links: number;
}

export interface UnmatchedNeighbor {
  deviceNodeId: string;
  localPort: string;
  remoteName: string;
  remoteIp: string | null;
  remoteMac: string | null;
}

/** Un MAC visto sulla porta di bordo di uno switch o AP (spec §10.5). */
export interface PortClient {
  mac: string;
  nodeId: string | null;
  name: string | null;
  ip: string | null;
  lastSeen: string;
  stale: boolean;
}

export interface PortClients {
  nodeId: string;
  port: string;
  clients: PortClient[];
}

export interface ModelCounts {
  nodes: number;
  devices: number;
  links: number;
  linksBySource: Record<LinkSource, number>;
  deviceLinks: number;
  attachedLinks: number;
  staleLinks: number;
  unmatchedNeighbors: number;
  isolatedDevices: number;
  fusedHosts: number;
  /** Host rimasti fusi fra loro (stesso MAC vero o stesso nome) senza un apparato. */
  mergedHosts: number;
  devicesWithoutSite: number;
  sitesWithHead: number;
  promoteProposals: number;
  suspiciousTypes: number;
  vms: number;
  hypervisors: number;
  /** VM che coincidono con un nodo già censito. */
  vmsOnNodes: number;
}

export interface TopologyModel {
  nodes: MapNode[];
  links: MapLink[];
  sites: SiteInfo[];
  promote: PromoteProposal[];
  unmatched: UnmatchedNeighbor[];
  isolated: string[];
  suspicious: string[];
  withoutSite: string[];
  counts: ModelCounts;
  /** Client per porta di bordo; i server e gli apparati sono collegamenti «mac_table». */
  portClients: PortClients[];
  /** Client freschi (visti entro la soglia) per nodo (switch/AP), a prescindere dalla porta: il numero sul riquadro. */
  clientCount: Record<string, number>;
  /**
   * Id di ogni host fuso in un altro nodo («host:N» → id del nodo): un host
   * promosso ad apparato, assorbito o fuso con altri host. Le mappe salvate
   * passano da qui, così un oggetto promosso non risulta «non più presente».
   */
  canonical: Record<string, string>;
  /** VM degli hypervisor, ognuna col suo host (spec §11.5). */
  vms: MapVm[];
  /**
   * Di quante reti censite ogni apparato è il gateway (spec §13.8.1): a pari nodi raggiunti la testa proposta è il router
   * gateway di più reti. Assente con la regola «testa-per-reti» spenta e nei modelli costruiti a mano dalle prove.
   */
  gatewayDi?: Record<string, number>;
}
