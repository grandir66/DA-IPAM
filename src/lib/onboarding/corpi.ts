/**
 * Router e prima subnet del wizard (tappa 4 credenziali, 15/10): controlli e
 * corpi delle richieste, senza la parte visiva.
 *
 * Prima il router chiedeva utente, password e community in linea: finivano
 * come binding sull'apparato, fuori dall'archivio, e la stessa voce si
 * chiedeva di nuovo al passo delle credenziali. Ora il router sceglie le voci
 * dell'archivio per id (regola tipo ↔ protocollo di `credentials/tipi.ts`), e
 * tornando indietro si modifica col PUT dell'apparato mandando solo i campi
 * toccati. Modulo puro.
 */
import { credTypeForProtocol } from "@/lib/credential-protocol-map";
import type { RouterDelWizard } from "./progresso-store";
import { vociPerProtocollo, vociSnmp, type VoceMinima } from "./credenziali-wizard";

export const MARCHE_ROUTER = [
  { value: "mikrotik", label: "MikroTik" },
  { value: "ubiquiti", label: "Ubiquiti" },
  { value: "cisco", label: "Cisco" },
  { value: "stormshield", label: "Stormshield" },
  { value: "other", label: "Altro" },
] as const;

export const ACCESSI_ROUTER = [
  { value: "ssh", label: "SSH" },
  { value: "snmp_v2", label: "SNMP v2c" },
  { value: "snmp_v3", label: "SNMP v3" },
] as const;

export interface ModuloRouter {
  name: string;
  host: string;
  vendor: string;
  protocol: string;
  credentialId: number | null;
  /** Voce SNMP per porte, LLDP/CDP e spanning tree quando l'accesso non è già SNMP. */
  snmpCredentialId: number | null;
}

export const ROUTER_VUOTO: ModuloRouter = {
  name: "Router principale",
  host: "",
  vendor: "mikrotik",
  protocol: "ssh",
  credentialId: null,
  snmpCredentialId: null,
};

const ETICHETTA_ACCESSO: Readonly<Record<string, string>> = Object.fromEntries(ACCESSI_ROUTER.map((a) => [a.value, a.label]));

/** Con accesso SNMP la seconda tendina («SNMP per porte/LLDP») non serve: la voce principale è già SNMP. */
export function usaSnmpSeparato(protocollo: string): boolean {
  return !protocollo.startsWith("snmp");
}

export function credenzialeValidaPer(id: number | null, voci: readonly VoceMinima[], protocollo: string): boolean {
  return id != null && vociPerProtocollo(voci, protocollo).some((v) => v.id === id);
}

/** Tipo con cui si apre il modulo dal «+ nuova nell'archivio» della credenziale del router. */
export function tipoPerNuovaVoce(protocollo: string): string {
  return credTypeForProtocol(protocollo).primary;
}

/**
 * Il primo errore del passo router, o null. IP vuoto con il router non ancora
 * creato = passo saltato; con il router già creato non si può togliere da qui.
 */
export function erroreRouter(form: ModuloRouter, giaCreato: boolean, voci: readonly VoceMinima[]): string | null {
  if (!form.host.trim()) {
    return giaCreato
      ? "Il router è già registrato: l'IP non può restare vuoto (per toglierlo usa la pagina dell'apparato)"
      : null;
  }
  const accesso = ETICHETTA_ACCESSO[form.protocol] ?? form.protocol;
  if (form.credentialId == null || !voci.some((v) => v.id === form.credentialId)) {
    return "Scegli la credenziale del router, o creane una con «+ nuova nell'archivio»";
  }
  if (!credenzialeValidaPer(form.credentialId, voci, form.protocol)) {
    return `La credenziale scelta non vale per l'accesso ${accesso}`;
  }
  if (usaSnmpSeparato(form.protocol) && form.snmpCredentialId != null && !vociSnmp(voci).some((v) => v.id === form.snmpCredentialId)) {
    return "La voce per porte e LLDP dev'essere una credenziale SNMP dell'archivio";
  }
  return null;
}

function snmpEffettiva(form: ModuloRouter): number | null {
  return usaSnmpSeparato(form.protocol) ? form.snmpCredentialId : null;
}

export function corpoCreaRouter(form: ModuloRouter): Record<string, unknown> {
  const corpo: Record<string, unknown> = {
    name: form.name.trim() || "Router",
    host: form.host.trim(),
    device_type: "router",
    vendor: form.vendor,
    protocol: form.protocol,
    credential_id: form.credentialId,
  };
  const snmp = snmpEffettiva(form);
  if (snmp != null) corpo.snmp_credential_id = snmp;
  return corpo;
}

/**
 * Corpo del PUT dell'apparato già creato: solo i campi cambiati rispetto a
 * quanto salvato. Con accesso SNMP la voce SNMP separata non si tocca (la
 * tendina non è a schermo).
 */
export function corpoModificaRouter(salvato: ModuloRouter, form: ModuloRouter): Record<string, unknown> {
  const corpo: Record<string, unknown> = {};
  const nome = form.name.trim() || "Router";
  if (nome !== (salvato.name.trim() || "Router")) corpo.name = nome;
  if (form.host.trim() !== salvato.host.trim()) corpo.host = form.host.trim();
  if (form.vendor !== salvato.vendor) corpo.vendor = form.vendor;
  if (form.protocol !== salvato.protocol) corpo.protocol = form.protocol;
  if (form.credentialId !== salvato.credentialId) corpo.credential_id = form.credentialId;
  if (usaSnmpSeparato(form.protocol) && form.snmpCredentialId !== salvato.snmpCredentialId) {
    corpo.snmp_credential_id = form.snmpCredentialId;
  }
  return corpo;
}

export function moduloDaRouter(r: RouterDelWizard): ModuloRouter {
  return {
    name: r.name,
    host: r.host,
    vendor: r.vendor,
    protocol: r.protocol,
    credentialId: r.credential_id,
    snmpCredentialId: r.snmp_credential_id,
  };
}

/** Corpo di /api/devices/test-provisional: la porta è quella propria della voce, come alla creazione. */
export function corpoProvaRouter(form: ModuloRouter, voci: readonly (VoceMinima & { port: number | null })[]): Record<string, unknown> {
  const corpo: Record<string, unknown> = {
    host: form.host.trim(),
    vendor: form.vendor,
    protocol: form.protocol,
    credential_id: form.credentialId,
    snmp_credential_id: snmpEffettiva(form),
  };
  const porta = voci.find((v) => v.id === form.credentialId)?.port;
  if (porta != null) corpo.port = porta;
  return corpo;
}

export function erroreRete(r: { name: string; cidr: string }): string | null {
  if (!r.name.trim()) return "Nome della rete obbligatorio";
  if (!r.cidr.trim()) return "CIDR della rete obbligatorio (es. 192.168.1.0/24)";
  return null;
}

export interface DatiRete {
  name: string;
  cidr: string;
  gateway: string;
  /** DNS scritto per questa rete; vuoto = quello del passo DNS. */
  dns: string;
  dnsPredefinito: string;
  routerId: number | null;
  credentialIds: number[];
}

/** Corpo di POST /api/networks: la lista nuova `credential_ids`, nell'ordine scelto. */
export function corpoCreaRete(d: DatiRete): Record<string, unknown> {
  const dns = d.dns.trim() || d.dnsPredefinito.trim();
  const corpo: Record<string, unknown> = {
    name: d.name.trim(),
    cidr: d.cidr.trim(),
    description: "",
    gateway: d.gateway.trim() || "",
    dns_server: dns || null,
  };
  if (d.routerId != null) corpo.router_id = d.routerId;
  if (d.credentialIds.length > 0) corpo.credential_ids = [...d.credentialIds];
  return corpo;
}
