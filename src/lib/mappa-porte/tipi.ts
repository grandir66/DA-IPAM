/** Tipi della Mappa porte (piano 2026-11-07): l'ingresso letto dal DB e il risultato della regola. */

export type Confidenza = "certa" | "spiegata" | "da_capire" | "non_so";
export type TipoPorta = "passaggio" | "hypervisor" | "terminale" | "telefono_pc" | "condivisa" | "wifi" | "vuota";
export type ModoPorta = "accesso" | "trunk" | "non_letto";
export type DatoVlan = "letto" | "dedotto" | "non_letto";
export type Categoria = "dispositivo" | "apparato";
export type MotivoPassaggio = "lldp" | "vede_apparato" | "uplink";

export interface RigaApparato { id: number; name: string; device_type: string; protocol: string | null }
export interface RigaMacPorta { device_id: number; mac: string; port_name: string; vlan: number | null; timestamp: string; source: string }
export interface RigaPorta {
  device_id: number; port_index: number; port_name: string; status: string | null; speed: string | null; vlan: number | null;
  poe_status: string | null; poe_power_mw: number | null; stp_state: string | null; is_uplink: number | null;
}
export interface RigaVicino {
  device_id: number; local_port: string; local_port_index: number | null; remote_device_name: string; remote_port: string;
  protocol: string; remote_mac: string | null; source: string;
}
export interface RigaFatto { device_id: number; source: string; port_name: string; port_index: number | null; lag_group: string | null }
export interface RigaMacApparato { device_id: number; mac: string }
export interface RigaHost {
  id: number; ip: string; mac: string | null; hostname: string | null; custom_name: string | null; vendor: string | null;
  classification: string | null; status: string | null;
}
export interface RigaMacIp { mac_normalized: string; ip: string; hostname: string | null; vendor: string | null; last_seen: string | null }
export interface RigaArp { device_id: number; mac: string; ip: string | null; interface_name: string | null; timestamp: string | null; status: string | null }
export interface RigaArpLibrenms { device_id: number | null; mac: string; ip: string; if_name: string | null; letto_il: string }
export interface RigaDhcp { source_device_id: number | null; source_name: string | null; ip_address: string; mac_address: string; hostname: string | null; scope_name: string | null; last_seen: string | null; last_synced: string | null }
export interface RigaVlanInterfaccia { device_id: number; name: string; vlan_id: number }
export interface RigaVm { mac: string; nome: string; acceso: boolean; nodo: string; apparatoScansione: number }
export interface RigaVlanPorta { device_id: number; vlan_id: number; if_index: number; egress: number; untagged: number | null }
export interface RigaPvid { device_id: number; if_index: number; pvid: number }
export interface RigaNativa { device_id: number; if_index: number; vlan_id: number }
export interface RigaVlanLettura { device_id: number; ordine_bit: string }
export interface RigaMkPorta { device_id: number; interface: string; pvid: number | null }
export interface RigaMkVlan { device_id: number; vlan_ids: string; tagged: string | null; current_tagged: string | null }

export interface IngressoMappaPorte {
  nowMs: number;
  staleDays: number;
  apparati: RigaApparato[];
  macPorte: RigaMacPorta[];
  porte: RigaPorta[];
  vicini: RigaVicino[];
  fatti: RigaFatto[];
  macApparati: RigaMacApparato[];
  /** Tutti i MAC noti di ogni apparato: host, scheda, interfacce, scansione Proxmox. */
  macNote: RigaMacApparato[];
  hosts: RigaHost[];
  macIp: RigaMacIp[];
  vm: RigaVm[];
  vlanPorte: RigaVlanPorta[];
  pvid: RigaPvid[];
  nativa: RigaNativa[];
  vlanLetture: RigaVlanLettura[];
  mkPorte: RigaMkPorta[];
  mkVlan: RigaMkVlan[];
  mkVlanIf: RigaVlanInterfaccia[];
  arp: RigaArp[];
  lnmsArp: RigaArpLibrenms[];
  dhcp: RigaDhcp[];
}

/** Una porta dove il MAC è stato visto: la prova mostrata nel dettaglio. */
export interface Prova { apparato: string; porta: string; tipo: TipoPorta | "vista"; nMac: number; fonte: string; visto: string }

export interface OggettoMappa {
  chiave: string;
  categoria: Categoria;
  mac: string | null;
  /** Tutti i MAC dell'oggetto: un hypervisor o un server ne hanno più di uno. */
  macs: string[];
  ip: string | null;
  /** Tutti gli IP visti, da inventario, ARP, DHCP e storico. */
  ips: string[];
  nIp: number;
  nome: string | null;
  tipo: string | null;
  hostId: number | null;
  apparatoId: number | null;
  confidenza: Confidenza;
  deviceId: number | null;
  apparato: string | null;
  portaChiave: string | null;
  porta: string | null;
  tipoPorta: TipoPorta | null;
  vlan: number | null;
  /** Quando la porta non si sa: dove si ferma quello che sappiamo. */
  ramo: string | null;
  perche: string;
  fonti: string[];
  prove: Prova[];
  conflitto: boolean;
  dedotta: boolean;
  /** Non visto entro la soglia: resta nell'elenco, fuori dai conteggi. */
  vecchio: boolean;
  senzaHost: boolean;
  visto: string | null;
}

/** Un oggetto prima di `completaOggetti`: un MAC, una riga. */
export type OggettoGrezzo = Omit<OggettoMappa, "macs" | "ips">;

export interface PortaMappa {
  deviceId: number;
  chiave: string;
  apparato: string;
  ordine: number;
  nome: string;
  membri: string[];
  stato: string | null;
  velocita: string | null;
  modo: ModoPorta;
  pvid: number | null;
  vlanTagged: number[];
  datoVlan: DatoVlan;
  poeStato: string | null;
  poeMw: number | null;
  stp: string | null;
  tipo: TipoPorta;
  vicino: string | null;
  nMac: number;
  motivi: MotivoPassaggio[];
}

export interface ConteggiMappa {
  certe: number; spiegate: number; daCapire: number; nonSo: number; senzaHost: number;
  apparatiConTabella: number; apparatiSoloController: number;
}

export interface RisultatoMappa { oggetti: OggettoMappa[]; porte: PortaMappa[]; conteggi: ConteggiMappa }

export interface Spostamento { chiave: string; mac: string | null; nome: string | null; daApparato: string; daPorta: string; aApparato: string; aPorta: string }
