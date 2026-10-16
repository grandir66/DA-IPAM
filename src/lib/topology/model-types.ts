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
  /** 'cavo' | 'fibra' | 'wireless', da T3 'tunnel', o null (tipo non indicato); le rotte non scrivono altro. */
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
  /** «segmento» (T3, spec §13.7.2): il nodo di un segmento condiviso, solo con la mappa nuova accesa. */
  kind: "device" | "host" | "segmento";
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
  /** «Ruolo nella mappa» scelto a mano da un admin (T1b, spec §13.8.2); assente = decide il sistema. Solo per un apparato. «core» e «accesso» (T3): il modello per cavo li passa, quello di T1 li legge «rete». */
  ruolo?: "rete" | "attaccato" | "core" | "accesso";
  /** La via di lettura dell'apparato (per i traduttori, spec §13.6.1); assente per un host. */
  via?: string;
  /**
   * Spec §12.5, «nome dal Proxmox»: un hypervisor il cui IP sta nelle schede di un host della scansione Proxmox
   * con un altro nome si chiama come il nodo Proxmox (`name`); qui resta il nome di prima, che la mappa mostra come
   * «DNS: …». Solo la mappa: l'inventario non cambia. Assente = nessun cambio di nome.
   */
  dnsName?: string;
}

// LinkMedium riceve «tunnel» (T3, spec §13.9): una correzione a mano può dichiarare un tunnel.
export type LinkMedium = "cavo" | "fibra" | "wireless" | "tunnel";

// T3 (spec §13.7.2, §13.10.3): i tipi del modello per cavo che la pagina legge. Stanno qui (nessuna logica), e
// cavi/collegamenti.ts li riesporta: i componenti della pagina non importano la logica del modello.
export type Genere = "cavo" | "fascio" | "tunnel" | "radio" | "senza_fili" | "segmento";
export type StatoCollegamento = "inoltra" | "bloccato" | "bloccato_comune" | "instradato" | "riserva_bond" | "giu" | null;
export type Fiducia = "certo" | "probabile" | "dedotto" | "a_mano_confermato" | "a_mano";
/** Il genere di una linea della pagina: quello del collegamento, più la contrazione di una mappa passo passo (§13.7.7). */
export type GenereLinea = Genere | "contrazione";

/** Il collegamento per cavo dietro una linea (presente solo con la mappa nuova accesa). */
export interface CavoLinea {
  genere: GenereLinea;
  stato: StatoCollegamento;
  fiducia: Fiducia;
  /** Bloccato nell'albero comune, attivo per le VLAN di un'istanza (§13.7.2 passo 8). */
  attivoPerVlan?: number[];
  /** Bloccato fra due bridge della stessa regione MSTP di cui le istanze non sono lette: «… può portare altre VLAN». */
  istanzeNonLette?: boolean;
  /** L'uplink di un gateway del controller: «instradato: la WAN del gateway» (§13.8.3 punto 1). */
  wan?: boolean;
  /** Fra router, un annuncio di segmento come unico vicino: «probabile, attraverso apparati non letti». */
  attraverso?: boolean;
  /** «dedotto: oltre ‹radio›, salto non letto» (§13.7.6 punto 5): l'id della radio vicina. */
  oltre?: string;
  /** Un fascio (§13.6.3): i membri porta per porta, e se è dedotto. */
  fascio?: { membri: Array<{ aPort: string; bPort: string; stato: StatoCollegamento; velocitaMbps: number | null }>; dedotto: boolean };
  /** La prova accoppia porte con velocità diverse (§13.6.1, I45). */
  porteDaVerificare: boolean;
  /** Una linea a mano su porte diverse da quelle viste fra gli stessi oggetti (§13.9). */
  aManoDiverse?: boolean;
  /** Un tunnel sentito da un capo solo (§13.4.6). */
  unVerso?: boolean;
  /** Il capo giù di un collegamento «giu»: «cavo giù: la porta ‹p› di ‹A› è giù» (§13.10.3). */
  giuSu?: { nodo: string; porta: string };
  /** Le prove in parole, senza doppi, nell'ordine in cui le dà il modello («LLDP», «uplink del controller», «partner LACP»…). */
  detti: string[];
  /** «Perché questo ‹genere›» (§13.4.6): le frasi già scritte dal modello, con la conclusione in fondo. */
  frasi: string[];
  /** Solo per una contrazione: che cosa è stato contratto. */
  via?: "segmento" | "radio";
}

/** Ciò che la pagina sa del modello per cavo oltre le linee (presente solo con la mappa nuova accesa). */
export interface InfoCavi {
  /** nodo → id della linea scelta dalla porta radice o dall'uplink del controller (§13.8.3 punto 1). */
  scelto: Record<string, string>;
  /** La testa del modello per cavo (§13.8.3 punto 7), con la scelta dell'admin della mappa automatica già applicata. */
  testa: string | null;
  /** «core che esce da uno switch di accesso» (§13.8.3 punto 8), sulla mappa automatica. */
  anomalie: Array<{ nodo: string; padre: string; porta: string; altri: string[] }>;
  /** In parole, senza dati («uplink del controller su una porta ferma»…). */
  avvisi: Array<{ nodo: string; testo: string }>;
  segmenti: Array<{ id: string; membri: Array<{ nodo: string; porta: string }>; altriApparati: number; frase: string }>;
  /** I capi dei ponti radio: fanno da ponte nell'albero anche se sono server o host (§13.7.6 punto 4). */
  ponti: string[];
  /** ★ scelte prima di T3, senza porte o con porte che non indicano più un collegamento (§13.9). */
  stelleDiPrima: Array<{ nodo: string; altro: string; linea: string }>;
  /** hypervisor → i collegamenti «dalle VM» che non si disegnano (§13.7.2 passo 10). */
  dalleVm: Record<string, Array<{ altro: string; porta: string; vm: number }>>;
  /** Le parti che la mappa nuova non calcola ancora, una riga ciascuna. */
  nonCalcolato: readonly string[];
}

/** Una riga di «Candidati per porta» (§13.4.6): le prove di una porta, il collegamento scelto, gli scartati col motivo. */
export interface CandidatoPorta {
  porta: string;
  prove: Array<{ chi: string; detto: string; quando: string | null }>;
  scelto: { linea: string; verso: string; genere: Genere } | null;
  scartati: Array<{ chi: string; motivo: string }>;
}

/** Orientamento della mappa (spec §12.2): `lr` «Verticale», da sinistra a destra con i fratelli impilati (predefinito); `tb` «Orizzontale», dall'alto. */
export type MapOrientation = "lr" | "tb";

/** Un altro cavo visto fra gli stessi due oggetti (spec §13.4.6, T1): una linea è una coppia fino a T3. Porte orientate come la linea. */
export interface AltroCavo { aPort: string; bPort: string; sources: LinkSource[]; lastSeen: string | null }

/**
 * Un passo di «Perché questo collegamento» (T1b; spec §13.4.6 in forma corta, §13.15 punto 6): un fatto sulla coppia, con
 * gli id degli oggetti e i nomi delle porte come li dice la prova. La frase la scrive `cavi/frasi.ts`.
 */
export type PassoPerche =
  | { tipo: "a_mano"; utente: string | null; quando: string | null }
  | { tipo: "vicino"; da: string; porta: string; altro: string; portaRemota: string; fonte: LinkSource; visto: string | null; altreRighe: number }
  | { tipo: "uplink"; figlio: string; porta: string; padre: string; dallaRiga: boolean; stessaOsservazione: boolean }
  | { tipo: "tabella_mac"; da: string; porta: string; altro: string; visto: string | null; router: boolean }
  | { tipo: "vm"; da: string; porta: string; hypervisor: string; vm: number; visto: string | null }
  | { tipo: "scartata"; motivo: "segmento"; da: string; porta: string; sentiti: Array<{ nodo: string | null; nome: string }> }
  | { tipo: "scartata"; motivo: "stessa_rete"; da: string; porta: string; altro: string; fonte: LinkSource }
  /** Spec §13.4.6, «Nome scelto»: la riga di un router su un nome che il traduttore del suo prodotto non riconosce (I58). */
  | { tipo: "scartata"; motivo: "nome_scelto"; da: string; porta: string; altro: string };

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
  /** Gli altri cavi visti fra gli stessi due oggetti (spec §13.4.6): servono all'«Ignora» per cavo e alla verifica a mano. */
  altriCavi?: AltroCavo[];
  /** «Perché questo collegamento» (T1b): le prove del cavo della linea, poi le righe scartate sulla coppia. Assente nelle linee fatte a mano dalle prove. */
  perche?: PassoPerche[];
  /** Il collegamento per cavo dietro la linea (T3): presente solo con la mappa nuova accesa. */
  cavo?: CavoLinea;
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
  /** Oggetti dichiarati apparati di rete senza una prova (spec §13.8.2). */
  senzaProve: number;
}

/** La classe di un nodo nella mappa (spec §13.8.2): quella di nodeClass, più «da sistemare» per chi non ha prove di ruolo. */
export type ClasseMappa = "infra" | "ap" | "hyper" | "att" | "client" | "da_sistemare";

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
   * Le correzioni «ignora» che non corrispondono a nessun cavo visto (spec §13.9, C5): non tolgono niente, «Dati della
   * mappa» le mostra con «Togli la correzione». Assente nei modelli costruiti a mano dalle prove.
   */
  correzioniOrfane?: number[];
  /** La classe nella mappa dove è diversa da nodeClass (spec §13.8.2): «da sistemare» o il ruolo a mano. Assente nelle prove di prima. */
  classiMappa?: Record<string, ClasseMappa>;
  /** Gli oggetti senza prove di ruolo, col motivo in parole: l'elenco «Da sistemare» (spec §8, D6). */
  daSistemare?: Array<{ id: string; motivo: string }>;
  /**
   * Le porte di segmento (spec §13.7.1 passo 2): «nodo|porta normalizzata» → gli oggetti che la porta sente via LLDP o CDP.
   * In T1 non si disegnano; le legge la misura (H5, H6, C8). Assente nei modelli costruiti a mano dalle prove.
   */
  segmenti?: Record<string, string[]>;
  /**
   * Di quante reti censite ogni apparato è il gateway (spec §13.8.1): a pari nodi raggiunti la testa proposta è il router
   * gateway di più reti. Assente con la regola «testa-per-reti» spenta e nei modelli costruiti a mano dalle prove.
   */
  gatewayDi?: Record<string, number>;
  /** Ciò che la pagina sa del modello per cavo oltre le linee (T3): presente solo con la mappa nuova accesa. */
  cavi?: InfoCavi;
}
