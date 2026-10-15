/**
 * Creazione di un apparato da POST /api/devices, senza la parte HTTP
 * (autenticazione e contesto tenant restano nella rotta). Separata per poterla
 * provare su un tenant di prova (tappa 1 credenziali, 15/10).
 */
import {
  createNetworkDevice,
  getHostByIp,
  updateHost,
  ensureInventoryAssetForNetworkDevice,
  addDeviceCredentialBinding,
  getCredentialById,
} from "@/lib/db";
import { NetworkDeviceSchema } from "@/lib/validators";
import { encrypt } from "@/lib/crypto";
import {
  suggestProductProfileForClassification,
  resolveDeviceTypeForCreate,
  resolveUseForArpPoll,
  scanTargetHintFromProductProfile,
  vendorSubtypeFromProductProfile,
  type ProductProfileId,
} from "@/lib/device-product-profiles";
import { linkInvAgentEndpointToHost } from "@/lib/inventory-agent/db";
import { portaCredenziale } from "@/lib/credentials/porte";
import type { NetworkDevice } from "@/types";

export type EsitoCreaApparato =
  | { ok: true; device: NetworkDevice }
  | { ok: false; status: 400; error: string };

export function creaApparato(body: unknown): EsitoCreaApparato {
  const parsed = NetworkDeviceSchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, status: 400, error: parsed.error.issues[0].message };
  }

  const data = parsed.data;
  // Senza classificazione vale il tipo dispositivo (è un valore ammesso anche
  // fra le classificazioni). Prima il ripiego era «hypervisor» per tutto ciò
  // che non era router o switch: un server diventava hypervisor, anche sull'host.
  const deviceClassification: string = data.classification ?? data.device_type;
  const productProfile = suggestProductProfileForClassification(
    data.vendor,
    deviceClassification,
    data.product_profile
  ) as ProductProfileId;
  const deviceType = resolveDeviceTypeForCreate({
    product_profile: productProfile,
    device_type: data.device_type,
    classification: deviceClassification,
  });
  const useForArpPoll = resolveUseForArpPoll({
    use_for_arp_poll: data.use_for_arp_poll,
    device_type: deviceType,
    classification: deviceClassification,
    vendor: data.vendor,
  });
  const defaultPort =
    data.protocol === "ssh" ? 22 : data.protocol === "api" ? (deviceType === "hypervisor" ? 8006 : 443) : data.protocol === "winrm" ? 5985 : 161;
  const scanTarget =
    data.scan_target ?? scanTargetHintFromProductProfile(productProfile);
  // Senza porta nel corpo vale quella propria della credenziale principale (tappa 1).
  const mainCred = data.credential_id ? getCredentialById(data.credential_id) : undefined;
  const devicePort = data.port || mainCred?.port || defaultPort;
  const device = createNetworkDevice({
    name: data.name,
    host: data.host,
    device_type: deviceType,
    classification: deviceClassification,
    vendor: data.vendor,
    vendor_subtype: data.vendor_subtype ?? vendorSubtypeFromProductProfile(productProfile),
    protocol: data.protocol,
    credential_id: data.credential_id ?? null,
    snmp_credential_id: data.snmp_credential_id ?? null,
    username: data.credential_id ? null : (data.username || null),
    encrypted_password: data.credential_id ? null : (data.password ? encrypt(data.password) : null),
    community_string: data.community_string ? encrypt(data.community_string) : null,
    api_token: data.api_token ? encrypt(data.api_token) : null,
    api_url: data.api_url || null,
    port: devicePort,
    enabled: 1,
    scan_target: scanTarget,
    product_profile: productProfile,
    use_for_arp_poll: useForArpPoll,
  });

  // Crea bindings credenziali nella nuova tabella
  const protoType = data.protocol === "winrm" ? "winrm" : data.protocol === "snmp_v2" || data.protocol === "snmp_v3" ? "snmp" : data.protocol === "api" ? "api" : "ssh";
  if (data.credential_id) {
    addDeviceCredentialBinding({ device_id: device.id, credential_id: data.credential_id, protocol_type: protoType, port: devicePort });
  } else if (data.username) {
    addDeviceCredentialBinding({
      device_id: device.id, protocol_type: protoType, port: devicePort,
      inline_username: data.username, inline_encrypted_password: data.password ? encrypt(data.password) : null,
    });
  }
  if (data.snmp_credential_id && data.snmp_credential_id !== data.credential_id) {
    // Porta propria della credenziale SNMP (tappa 1), non 161 fisso.
    const snmpCred = getCredentialById(data.snmp_credential_id);
    const snmpPort = snmpCred ? portaCredenziale(snmpCred, "snmp") : 161;
    addDeviceCredentialBinding({ device_id: device.id, credential_id: data.snmp_credential_id, protocol_type: "snmp", port: snmpPort });
  } else if (data.community_string && !data.snmp_credential_id) {
    addDeviceCredentialBinding({
      device_id: device.id, protocol_type: "snmp", port: 161,
      inline_encrypted_password: encrypt(data.community_string),
    });
  }

  const host = getHostByIp(data.host);
  if (host) {
    updateHost(host.id, { classification: deviceClassification });
    try {
      linkInvAgentEndpointToHost(host.id);
    } catch {
      /* inventory agent opzionale */
    }
  }

  ensureInventoryAssetForNetworkDevice(device);
  return { ok: true, device };
}
