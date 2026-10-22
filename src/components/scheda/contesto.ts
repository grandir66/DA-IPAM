/**
 * Il contesto che la pagina `/objects/[id]` (la regia) passa a ogni tab della scheda: i dati caricati, i
 * derivati che servono a più tab e le azioni che toccano lo stato della pagina. Ogni tab riceve `{ ctx }`.
 */
import type { HostDetail, InventoryAsset } from "@/types";
import type { TipoScheda, TabId } from "@/lib/scheda/tipo-scheda";
import type { RispostaAd, RispostaDipendenze } from "@/lib/devices/server-scheda";
import type { DatiLibrenmsScheda } from "@/lib/scheda/librenms-vista";
import type { DeviceFull } from "./dati";
import type { VmSu } from "./intestazione-scheda";

/** Risposta di GET /api/hosts/[id]/librenms. */
export interface LibreNmsStato {
  configured: boolean;
  mapped?: boolean;
  librenmsDeviceId?: number;
  librenmsHostname?: string | null;
  lastSyncedAt?: string;
  device?: {
    status?: number | string;
    uptime_seconds?: number;
    os?: string;
    hardware?: string;
    sysname?: string;
    lastpolled?: string;
  } | null;
  librenmsUrl?: string;
}

/** Un IP dello stesso device fisico (cluster), da GET /api/physical-devices/[id]/hosts. */
export interface MembroCluster {
  id: number;
  ip: string;
  hostname: string | null;
  vendor: string | null;
  status: "online" | "offline" | "unknown";
  network_name: string;
  inferred_os_family: string | null;
  /** Questo IP è quello di un apparato gestito (network_devices.host_id). */
  ha_apparato?: boolean;
}

export interface ContestoScheda {
  host: HostDetail;
  hostId: number;
  /** Apparato gestito con lo stesso IP (`network_devices`), se c'è. */
  device: DeviceFull | null;
  asset: InventoryAsset | null;
  librenms: LibreNmsStato | null;
  /** Dati di LibreNMS dell'oggetto dalle tabelle `librenms_*` (GET /api/hosts/[id]/librenms/dati); null = non letti. */
  librenmsDati: DatiLibrenmsScheda | null;
  tipo: TipoScheda;
  ruoli: string[];
  isAdmin: boolean;
  isManaged: boolean;
  isAsset: boolean;
  isWindowsOrLinux: boolean;
  isMacPlatform: boolean;
  displayName: string;
  classificationLabel: string | null;
  /** Porte aperte e credenziali validate sull'host: la fonte unica, letta una volta dalla pagina. */
  runtimeSummary: {
    tcpPorts: number[];
    udpPorts: number[];
    validatedCreds: NonNullable<HostDetail["host_credentials"]>;
  };
  clusterMembers: MembroCluster[];
  /** Principale del cluster per la regola di Discovery (null = ambiguo o cluster di un IP solo) e se il cluster ha un apparato. */
  clusterPrincipaleHostId: number | null;
  clusterHaApparato: boolean;
  /** PUT /api/physical-devices/[id]/principale, poi rilegge il cluster. */
  scegliPrincipale: (hostId: number) => Promise<void>;
  /** «VM n su <nodo>» se l'host è una VM delle scansioni Proxmox salvate. */
  vmSu: VmSu | null;
  /** Server: il computer in Active Directory e i rilievi (solo se DC). null = non letto o non è un server. */
  ad: RispostaAd | null;
  /** Server: i servizi NIS2 che poggiano su questo host. null = non letto o non è un server. */
  dipendenze: RispostaDipendenze | null;
  unlinkingHostId: number | null;
  /** Cambia quando la tabella dei binding è stata modificata: «Credenziali assegnate» rilegge le prove. */
  versioneBinding: number;
  alCambioBinding: () => void;
  /** Etichetta e slug delle classificazioni (comprese quelle personalizzate del tenant). */
  etichettaClassificazione: (slug: string) => string;
  slugsClassificazione: string[];
  /** Ricarica host, apparato, asset e LibreNMS. */
  ricarica: () => Promise<void>;
  apriTab: (t: TabId) => void;
  apriCollegaIp: () => void;
  scollegaIp: (hostId: number) => Promise<void>;
  /** PUT /api/hosts/[id] con i campi cambiati (seriale, numero inventario, note). */
  salvaCampoHost: (patch: Record<string, unknown>) => Promise<void>;
  creaAsset: () => Promise<void>;
  /** Sotto-tab di «Dettagli» da aprire (da un vecchio ?tab=software). */
  sottoTabDettagli?: string;
}
