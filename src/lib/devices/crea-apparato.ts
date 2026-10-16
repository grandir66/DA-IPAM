/**
 * Creazione di un apparato da POST /api/devices, senza la parte HTTP
 * (autenticazione e contesto tenant restano nella rotta). Separata per poterla
 * provare su un tenant di prova (tappa 1 credenziali, 15/10).
 *
 * Dalla 2e (T20, 16/10) i segreti non vanno più nelle colonne di
 * `network_devices` (`username`, `encrypted_password`, `community_string`,
 * `api_token`) né dentro i binding: utente e password, community e token
 * scritti a mano diventano voci `«<nome> · <protocollo>»` più il binding.
 * Apparato e credenziali nascono nella stessa transazione: una credenziale
 * rifiutata (utente senza password) non lascia un apparato a metà.
 */
import {
  createNetworkDevice,
  getHostByIp,
  updateHost,
  ensureInventoryAssetForNetworkDevice,
  addDeviceCredentialBinding,
  getCredentialById,
  getDb,
} from "@/lib/db";
import { NetworkDeviceSchema } from "@/lib/validators";
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
import { RifiutoCredenziali, segretiInVociApparatoDb } from "@/lib/credentials/apparato-archivio";
import { tipoBindingPerProtocollo } from "./binding-apparato";
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
  let device: NetworkDevice;
  try {
    device = getDb().transaction((): NetworkDevice => {
      const nuovo = createNetworkDevice({
        name: data.name,
        host: data.host,
        device_type: deviceType,
        classification: deviceClassification,
        vendor: data.vendor,
        vendor_subtype: data.vendor_subtype ?? vendorSubtypeFromProductProfile(productProfile),
        protocol: data.protocol,
        // Nemmeno gli id delle voci (revisione della 2e, 16/10): il motore legge
        // `credential_id` / `snmp_credential_id` come livello 4 (device_column),
        // quindi con il binding fallito (D10) o tolto dalla tabella
        // dell'apparato la voce tornava da una colonna che la pagina non mostra.
        // Le voci stanno solo nei binding qui sotto; il wizard del router le
        // cerca lì (`onboarding/router-store.ts`).
        credential_id: null,
        snmp_credential_id: null,
        username: null,
        encrypted_password: null,
        community_string: null,
        api_token: null,
        api_url: data.api_url || null,
        port: devicePort,
        enabled: 1,
        scan_target: scanTarget,
        product_profile: productProfile,
        use_for_arp_poll: useForArpPoll,
      });

      // Binding delle voci scelte (regola condivisa con la modifica del router del wizard).
      const protoType = tipoBindingPerProtocollo(data.protocol);
      if (data.credential_id) {
        addDeviceCredentialBinding({ device_id: nuovo.id, credential_id: data.credential_id, protocol_type: protoType, port: devicePort });
      }
      if (data.snmp_credential_id && data.snmp_credential_id !== data.credential_id) {
        // Porta propria della credenziale SNMP (tappa 1), non 161 fisso.
        const snmpCred = getCredentialById(data.snmp_credential_id);
        const snmpPort = snmpCred ? portaCredenziale(snmpCred, "snmp") : 161;
        addDeviceCredentialBinding({ device_id: nuovo.id, credential_id: data.snmp_credential_id, protocol_type: "snmp", port: snmpPort });
      }
      // Segreti scritti a mano: voci dell'apparato, in coda. Con una voce
      // scelta utente e password non valgono, con una SNMP la community no (come prima).
      segretiInVociApparatoDb(
        getDb(),
        nuovo.id,
        {
          username: data.credential_id ? null : data.username,
          password: data.credential_id ? null : data.password,
          community: data.snmp_credential_id ? null : data.community_string,
          token: data.api_token,
        },
        { inTesta: false },
      );
      return nuovo;
    })();
  } catch (e) {
    if (e instanceof RifiutoCredenziali) return { ok: false, status: 400, error: e.message };
    throw e;
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
