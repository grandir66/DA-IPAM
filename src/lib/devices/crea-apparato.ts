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
  ensureInventoryAssetForNetworkDevice,
  addDeviceCredentialBinding,
  getCredentialById,
  getDb,
} from "@/lib/db";
import { scriviSeCambiata } from "@/lib/classification/scrivi";
import { RUOLI_SERVER, type RuoloServer } from "@/lib/classification/canonico";
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

/** Ruoli del server dal corpo della richiesta: solo quelli del catalogo, il resto si ignora. */
export function ruoliDalCorpo(body: unknown): RuoloServer[] {
  const grezzi = body && typeof body === "object" ? (body as { server_roles?: unknown }).server_roles : undefined;
  if (!Array.isArray(grezzi)) return [];
  return grezzi.filter((r): r is RuoloServer => (RUOLI_SERVER as readonly string[]).includes(String(r)));
}

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
        // Nessuna colonna di credenziali (T20; dalla 2g il tipo non le ha più e
        // il motore non le legge): le voci stanno solo nei binding qui sotto, e
        // il wizard del router le cerca lì (`onboarding/router-store.ts`).
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
    // Punto unico. È «a mano» solo se l'utente ha cambiato la classificazione proposta dall'host
    // (revisione finale, n. 1): una proposta accettata così com'è resta automatica.
    const ruoli = body && typeof body === "object" && Array.isArray((body as { server_roles?: unknown }).server_roles) ? ruoliDalCorpo(body) : undefined;
    scriviSeCambiata(getDb(), { hostId: host.id }, deviceClassification, { classification: host.classification ?? null, server_roles: (host as { server_roles?: string | null }).server_roles ?? null }, { ruoli });
    try {
      linkInvAgentEndpointToHost(host.id);
    } catch {
      /* inventory agent opzionale */
    }
  }

  ensureInventoryAssetForNetworkDevice(device);
  return { ok: true, device };
}
