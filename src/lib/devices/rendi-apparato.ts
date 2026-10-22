/**
 * Logica pura della finestra «Rendi apparato» (tappa 3, 21/10): cosa si deduce da solo e cosa
 * si manda alla creazione. Niente React e niente DB, per poterla provare.
 *
 * La finestra chiede poche cose (classificazione, piattaforma, variante, protocollo, porta,
 * credenziale); tutto il resto — tipo dispositivo, scan target, sottotipo, profilo, flag ARP —
 * si ricava qui dalle scelte, con le stesse funzioni che usa il server.
 */
import {
  resolveDeviceTypeForCreate,
  resolveUseForArpPoll,
  scanTargetHintFromProductProfile,
  variantiPer,
  vendorSubtypeFromProductProfile,
  type ProductProfileId,
} from "@/lib/device-product-profiles";
import { coerceScanTargetForVendor } from "@/lib/vendor-device-profile";
import { DEFAULT_PORTS } from "@/lib/credentials/porte";
import { profiloPerClassificazione, type HostPerProposta, type PropostaApparato, type ProtocolloApparato } from "@/lib/devices/proposta-apparato";
import type { RuoloServer } from "@/lib/classification/canonico";
import type { NetworkDevice } from "@/types";
import { FUSO_UTENTI, parseDbDate } from "@/lib/db-date";

/** Riga di `hosts` come la finestra la riceve: quella della proposta, più id e fiducia dell'auto-rilevamento. */
export type HostPerRendiApparato = HostPerProposta & {
  id: number;
  inferred_confidence?: number | null;
  inferred_at?: string | null;
  /** Dalla scheda dell'host (`/api/hosts/<id>`): se l'IP è già di un apparato, la finestra è bloccata. */
  network_device?: { name: string } | null;
  apparato_cluster?: { nome: string; host_id: number } | null;
};

export type TipoDispositivo = "router" | "switch" | "firewall" | "hypervisor" | "access_point" | "nas" | "server";

/** Tipo dispositivo richiesto dalla tabella degli apparati, dedotto dalla classificazione. */
export function deviceTypeDaClassificazione(c: string): TipoDispositivo {
  if (c === "firewall") return "firewall";
  if (c === "router") return "router";
  if (c === "switch") return "switch";
  if (c === "access_point") return "access_point";
  if (c === "nas") return "nas";
  if (c === "hypervisor" || c === "vm") return "hypervisor";
  return "server";
}

/** Da dove viene la proposta, per la riga «Proposto da». */
export function fonteProposta(host: HostPerRendiApparato): { fonte: string; confidenza: number | null } {
  const confidenza = typeof host.inferred_confidence === "number" ? Math.round(host.inferred_confidence) : null;
  if (host.classification_manual === 1) return { fonte: "scelta a mano", confidenza: null };
  if (host.snmp_data) return { fonte: "SNMP", confidenza };
  if (host.inferred_at) return { fonte: "auto-rilevamento", confidenza };
  return { fonte: "dati della scansione", confidenza };
}

/** Porta standard del protocollo? (SNMP 161, SSH 22, WinRM 5985, API 443.) */
export function portaStandard(protocollo: ProtocolloApparato, porta: number): boolean {
  const proto = protocollo === "snmp_v2" || protocollo === "snmp_v3" ? "snmp" : protocollo;
  return DEFAULT_PORTS[proto] === porta;
}

export interface ScelteComuni {
  classificazione: string;
  piattaforma: string;
  /** Variante scelta a mano; vale solo se è fra quelle ammesse da classificazione + piattaforma. */
  variante: string | null;
  ruoli: RuoloServer[];
  protocollo: ProtocolloApparato;
  porta: number;
}

/** Profilo prodotto effettivo: la variante scelta se ammessa, altrimenti quello coerente con la classificazione. */
export function profiloEffettivo(s: Pick<ScelteComuni, "classificazione" | "piattaforma" | "variante" | "ruoli">): ProductProfileId {
  const ammesse = variantiPer(s.piattaforma, s.classificazione);
  if (ammesse.length > 1 && s.variante && (ammesse as string[]).includes(s.variante)) return s.variante as ProductProfileId;
  return profiloPerClassificazione(s.piattaforma, s.classificazione, s.ruoli) as ProductProfileId;
}

/** Parte della proposta di un host che conta per le scelte comuni. */
export type PropostaPerComuni = Pick<PropostaApparato, "vendor" | "protocol" | "classification" | "port">;

/**
 * Scelte comuni a più host (22/10: fix A). Dove le proposte degli host sono tutte uguali si parte da
 * quella; dove differiscono il campo resta **da scegliere** (non si indovina per tutti: prima
 * Piattaforma e Protocollo venivano dal primo host, e quattro host misti ricevevano tutti WinRM 5985).
 * `comuni` porta comunque un valore interno valido (quello del primo host) perché il resto della
 * finestra lavora su valori veri; `daScegliere` dice quali campi la schermata deve mostrare vuoti
 * e quali bloccano «Rendi apparato» finché non si scelgono.
 */
export function scelteComuniDaProposte(proposte: PropostaPerComuni[]): {
  comuni: Pick<ScelteComuni, "classificazione" | "piattaforma" | "protocollo" | "porta">;
  daScegliere: { classificazione: boolean; piattaforma: boolean; protocollo: boolean };
} {
  const prima = proposte[0];
  const tutte = (f: (p: PropostaPerComuni) => unknown) => proposte.every((p) => f(p) === f(prima));
  const classificazioneUguale = tutte((p) => p.classification);
  const piattaformaUguale = tutte((p) => p.vendor);
  const protocolloUguale = tutte((p) => p.protocol);
  const daScegliere = {
    // Una classificazione vuota è già «da scegliere» anche per un host solo.
    classificazione: !classificazioneUguale || !prima.classification,
    piattaforma: !piattaformaUguale,
    protocollo: !protocolloUguale,
  };
  return {
    comuni: {
      classificazione: classificazioneUguale ? prima.classification : "",
      piattaforma: prima.vendor,
      protocollo: prima.protocol,
      porta: prima.port,
    },
    daScegliere,
  };
}

export interface RigaPerCreazione {
  nome: string;
  ip: string;
  credentialId: string | null;
  snmpCredentialId: string | null;
  scanTargetProposto?: string | null;
}

/** Corpo di `POST /api/devices` per un host: scelte comuni + nome e credenziale della sua riga. */
export function corpoCreazione(s: ScelteComuni, riga: RigaPerCreazione): Record<string, unknown> {
  const profilo = profiloEffettivo(s);
  const deviceType = resolveDeviceTypeForCreate({ product_profile: profilo, classification: s.classificazione });
  const scanTarget = scanTargetHintFromProductProfile(profilo) ?? coerceScanTargetForVendor(s.piattaforma, riga.scanTargetProposto ?? undefined);
  const corpo: Record<string, unknown> = {
    name: riga.nome.trim(),
    host: riga.ip,
    device_type: deviceType,
    classification: s.classificazione,
    vendor: s.piattaforma,
    protocol: s.protocollo,
    port: s.porta,
    product_profile: profilo,
    vendor_subtype: vendorSubtypeFromProductProfile(profilo) ?? undefined,
    scan_target: scanTarget || undefined,
    // 0 esplicito: l'API non deve riaccendere il flag da sola.
    use_for_arp_poll: resolveUseForArpPoll({ device_type: deviceType, classification: s.classificazione, vendor: s.piattaforma as NetworkDevice["vendor"] }),
  };
  if (riga.credentialId && riga.credentialId !== "none") corpo.credential_id = Number(riga.credentialId);
  if (riga.snmpCredentialId && riga.snmpCredentialId !== "none") corpo.snmp_credential_id = Number(riga.snmpCredentialId);
  if (s.classificazione === "server" && s.ruoli.length > 0) corpo.server_roles = s.ruoli;
  return corpo;
}

const dataIt = (d: Date) => d.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", timeZone: FUSO_UTENTI });

/** «20/10» (data italiana, senza anno) di un'ora UTC del database o ISO; vuoto se illeggibile. */
export function dataBreve(quando: string | null | undefined): string {
  if (!quando) return "";
  const d = parseDbDate(quando);
  return Number.isNaN(d.getTime()) ? "" : dataIt(d);
}

/** Oggi: «09:41» in ora italiana; un altro giorno: «20/10». */
export function quandoBreve(quando: string | null | undefined, adesso: Date = new Date()): string {
  if (!quando) return "";
  const d = parseDbDate(quando);
  if (Number.isNaN(d.getTime())) return "";
  if (dataIt(d) === dataIt(adesso)) return d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", timeZone: FUSO_UTENTI });
  return dataIt(d);
}
