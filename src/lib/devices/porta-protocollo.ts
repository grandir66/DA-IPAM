/**
 * La porta dell'apparato e il suo protocollo (16/10).
 *
 * Incidente (pilota, 16/10): un MikroTik creato in SNMP (161) e passato a SSH
 * dalla finestra di modifica è rimasto con protocol=ssh, port=161, e
 * l'acquisizione SSH, che usa `device.port`, falliva. La promozione aveva già la
 * porta che segue il protocollo (`riallineaAlProtocollo`); la modifica no.
 *
 * Modulo puro: lo usano la finestra di modifica (client) e le rotte dei device.
 */
import { tipiCredenzialePerProtocollo } from "@/lib/credential-protocol-map";
import { DEFAULT_PORTS, type CredProtocol } from "@/lib/credentials/porte";
import { isProxmoxVeDevice, type DeviceAcquisitionInput } from "@/lib/devices/device-acquisition-resolve";
import { portaPerCredenziale, type CredenzialeArchivio, type ProtocolloApparato } from "@/lib/devices/proposta-apparato";

/** Porta dell'API di Proxmox VE: per Proxmox `device.port` è quella, l'SSH prende la sua dal candidato SSH. */
const PORTA_API_PROXMOX = 8006;

/**
 * Protocolli principali che leggono `device.port` per connettersi. SNMP no: prende
 * la porta dalla credenziale (T8), e per un apparato SNMP `device.port` è la porta
 * del ripiego SSH della tabella MAC (`switch-client`: `device.port || 22`).
 */
const PROTOCOLLO_CON_PORTA: Record<string, "ssh" | "winrm" | "api"> = { ssh: "ssh", winrm: "winrm", api: "api" };

/** Un binding dell'apparato come lo dà `GET /api/devices/[id]/credentials`. */
export interface BindingPorta {
  protocol_type: string;
  port: number | null;
  credential_id: number | null;
  credential_type?: string | null;
  test_status?: string | null;
}

const portaValida = (p: number | null | undefined): p is number => p != null && Number.isInteger(p) && p > 0 && p <= 65535;

/**
 * Porta propria del primo binding del protocollo, nell'ordine del motore
 * (`candidatiApparato`, la regola di `portaSshApparatoDb`): d'archivio riusciti,
 * d'archivio non provati, inline; saltati i falliti e le voci di tipo
 * incompatibile. `null` se nessuno ha una porta valida.
 */
export function portaDaBinding(binding: BindingPorta[], protocollo: "ssh" | "winrm" | "api"): number | null {
  const tipi = tipiCredenzialePerProtocollo(protocollo);
  const mio = binding.filter((b) => b.protocol_type === protocollo && b.test_status !== "failed");
  const conVoce = mio.filter((b) => b.credential_id != null && b.credential_type != null && tipi.includes(b.credential_type));
  const ordine = [
    ...conVoce.filter((b) => b.test_status === "success"),
    ...conVoce.filter((b) => b.test_status === "untested"),
    ...mio.filter((b) => b.credential_id == null),
  ];
  return ordine.find((b) => portaValida(b.port))?.port ?? null;
}

export interface CambioProtocollo {
  protocollo: ProtocolloApparato;
  /** Le colonne dell'apparato: `credential_id`, `snmp_credential_id`. */
  credenziali: Array<string | null>;
  archivio: CredenzialeArchivio[];
  /** I binding dell'apparato (DeviceCredentialsTable): la loro porta vince sulle colonne, come nel motore. */
  binding?: BindingPorta[];
  proxmox?: boolean;
  portaAttuale?: number | null;
  /** Protocollo e porta salvati: tornando a quel protocollo torna quella porta. */
  salvata?: { protocollo: string | null | undefined; porta: number | null | undefined };
}

/** Porta propria di un protocollo che legge `device.port`: binding, poi voce compatibile nelle colonne, poi standard. */
function portaPropria(a: CambioProtocollo, protocollo: "ssh" | "winrm" | "api"): number {
  const daBinding = portaDaBinding(a.binding ?? [], protocollo);
  if (daBinding != null) return daBinding;
  const tipi = tipiCredenzialePerProtocollo(protocollo);
  const compatibile = a.credenziali.find((id) => {
    if (!id || id === "none") return false;
    const voce = a.archivio.find((c) => c.id === Number(id));
    return voce != null && tipi.includes(voce.credential_type);
  });
  return portaPerCredenziale(compatibile ?? null, protocollo, a.archivio);
}

/**
 * Porta da proporre cambiando protocollo:
 * - tornando al protocollo salvato, la porta salvata (un cambio annullato non la perde);
 * - Proxmox VE: la porta dell'API, che non segue il protocollo (`portaSshApparatoDb`);
 * - SNMP: la porta non si tocca, è quella del ripiego SSH (vuota: la porta SSH), mai la 161;
 * - SSH, WinRM, API: la porta del primo binding del protocollo, poi quella propria
 *   della voce compatibile nelle colonne, altrimenti lo standard (22, 5985, 443).
 */
export function portaAlCambioProtocollo(a: CambioProtocollo): number {
  if (a.salvata && a.protocollo === a.salvata.protocollo && portaValida(a.salvata.porta)) return a.salvata.porta;
  if (a.proxmox) return a.portaAttuale ?? PORTA_API_PROXMOX;
  const proto = PROTOCOLLO_CON_PORTA[a.protocollo];
  if (!proto) return portaValida(a.portaAttuale) ? a.portaAttuale : portaPropria(a, "ssh");
  return portaPropria(a, proto);
}

const NOMI: Array<{ proto: CredProtocol; nome: string }> = [
  { proto: "ssh", nome: "SSH" },
  { proto: "snmp", nome: "SNMP" },
  { proto: "winrm", nome: "WinRM" },
  { proto: "api", nome: "API (HTTPS)" },
];

/**
 * Avviso se la porta dell'apparato è lo standard di UN ALTRO protocollo (SSH
 * sulla 161, WinRM sulla 22…). Non un rifiuto: Proxmox tiene la porta dell'API
 * anche in SSH, e le scansioni scrivono la porta da sole.
 */
export function avvisoPortaProtocollo(
  device: DeviceAcquisitionInput & { protocol?: string | null; port?: number | null },
): string | null {
  const proto = device.protocol ? PROTOCOLLO_CON_PORTA[device.protocol] : undefined;
  const porta = device.port;
  if (!proto || porta == null) return null;
  if (isProxmoxVeDevice({ ...device, protocol: device.protocol ?? undefined })) return null;
  const propria = DEFAULT_PORTS[proto];
  if (porta === propria) return null;
  const altro = NOMI.find((n) => n.proto !== proto && DEFAULT_PORTS[n.proto] === porta);
  if (!altro) return null;
  const nome = NOMI.find((n) => n.proto === proto)?.nome ?? proto;
  return `La porta ${porta} è quella ${altro.nome}: per ${nome} usa ${propria} o la porta del tuo ${nome}.`;
}
