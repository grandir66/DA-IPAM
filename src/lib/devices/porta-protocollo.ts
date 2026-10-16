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
 * Porta da proporre cambiando protocollo: quella propria della prima credenziale
 * di tipo compatibile col nuovo protocollo (in ordine: principale, SNMP),
 * altrimenti lo standard (SSH 22, SNMP 161, WinRM 5985, API 443). Per Proxmox VE
 * la porta è quella dell'API e non segue il protocollo (`portaSshApparatoDb`).
 */
export function portaAlCambioProtocollo(a: {
  protocollo: ProtocolloApparato;
  credenziali: Array<string | null>;
  archivio: CredenzialeArchivio[];
  proxmox?: boolean;
  portaAttuale?: number | null;
}): number {
  if (a.proxmox) return a.portaAttuale ?? PORTA_API_PROXMOX;
  const tipi = tipiCredenzialePerProtocollo(a.protocollo);
  const compatibile = a.credenziali.find((id) => {
    if (!id || id === "none") return false;
    const voce = a.archivio.find((c) => c.id === Number(id));
    return voce != null && tipi.includes(voce.credential_type);
  });
  return portaPerCredenziale(compatibile ?? null, a.protocollo, a.archivio);
}

/** Protocolli che leggono `device.port` per connettersi; SNMP prende la porta dalla credenziale (T8). */
const PROTOCOLLO_CON_PORTA: Record<string, CredProtocol> = { ssh: "ssh", winrm: "winrm", api: "api" };

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
