/**
 * Modifica del router già creato dal wizard (tappa 4 credenziali, revisione
 * del 15/10), senza la parte HTTP: la rotta `/api/onboarding/router` aggiunge
 * guardia e contesto del cliente.
 *
 * Perché non basta il PUT dell'apparato: scrive solo le colonne
 * `credential_id`, `snmp_credential_id` e `protocol`, mentre chi usa davvero le
 * credenziali (`getDeviceCredentials`, `credenzialeSnmpApparato`, il poll ARP)
 * legge prima i binding creati da `creaApparato`, e il client del router si
 * collega a `port`. Il wizard diceva «Router aggiornato» e il sistema
 * continuava con la voce e la porta di prima.
 *
 * Qui, in una transazione: le colonne, la porta della voce principale e i due
 * binding che rispecchiano le colonne (il principale e quello SNMP separato)
 * sostituiti dai nuovi. Gli altri binding dell'apparato (aggiunti dalla sua
 * pagina) non si toccano; un binding già uguale a quello voluto resta com'è,
 * con l'esito della sua prova. Va chiamata nel contesto del cliente
 * (`withTenant`): senza, è un errore e non si scrive niente.
 */
import { z } from "zod";
// Tutto da `db-tenant` (import statico): la transazione e le scritture devono
// passare dalla stessa istanza e dalla stessa connessione del cliente.
import {
  addDeviceCredentialBinding,
  deleteDeviceCredentialBinding,
  getCredentialById,
  getCurrentTenantCode,
  getDeviceCredentialBindings,
  getNetworkDeviceById,
  getTenantDb,
  updateNetworkDevice,
  type DeviceCredentialBinding,
} from "@/lib/db-tenant";
import { NetworkDeviceSchema } from "@/lib/validators";
import { portaCredenziale } from "@/lib/credentials/porte";
import { etichettaTipo, tipiPerProtocollo } from "@/lib/credentials/tipi";
import { portaVocePrincipale, tipoBindingPerProtocollo } from "@/lib/devices/binding-apparato";
import { ACCESSI_ROUTER, usaSnmpSeparato } from "./corpi";
import type { RouterDelWizard } from "./progresso-store";
import type { NetworkDevice } from "@/types";

const CODICI_ACCESSO = ACCESSI_ROUTER.map((a) => a.value) as [string, ...string[]];

/** Campi sconosciuti rifiutati: un refuso (o una community in linea) non passa in silenzio. */
const SchemaModificaRouter = z.strictObject({
  device_id: z.number().int().positive(),
  name: z.string().trim().min(1, "Nome del router vuoto").max(100).optional(),
  host: z.string().trim().min(1, "L'IP del router non può restare vuoto").max(2000).optional(),
  vendor: NetworkDeviceSchema.shape.vendor.optional(),
  protocol: z.enum(CODICI_ACCESSO, { error: "Accesso non valido: SSH, SNMP v2c o SNMP v3" }).optional(),
  credential_id: z.number().int().positive().optional(),
  snmp_credential_id: z.number().int().positive().nullable().optional(),
});

export type EsitoModificaRouter =
  | { ok: true; router: RouterDelWizard }
  | { ok: false; status: 400 | 404; error: string };

interface Voluto {
  credential_id: number;
  protocol_type: string;
  port: number;
}

class Rifiuto extends Error {}

function voceDellArchivio(id: number): NonNullable<ReturnType<typeof getCredentialById>> {
  const voce = getCredentialById(id);
  if (!voce) throw new Rifiuto(`La credenziale ${id} non c'è nell'archivio`);
  return voce;
}

export function routerDelWizard(d: NetworkDevice): RouterDelWizard {
  return {
    id: d.id,
    name: d.name,
    host: d.host,
    vendor: d.vendor,
    protocol: d.protocol,
    credential_id: d.credential_id ?? null,
    snmp_credential_id: d.snmp_credential_id ?? null,
  };
}

export function modificaRouterDelWizard(corpo: unknown): EsitoModificaRouter {
  const tenantCode = getCurrentTenantCode();
  if (!tenantCode) throw new Error("Modifica del router del wizard fuori dal contesto di un cliente");
  const parsed = SchemaModificaRouter.safeParse(corpo);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const errore = issue.code === "unrecognized_keys" ? `Campo non ammesso: «${issue.keys.join("», «")}»` : issue.message;
    return { ok: false, status: 400, error: errore };
  }
  const c = parsed.data;
  const prima = getNetworkDeviceById(c.device_id);
  if (!prima) return { ok: false, status: 404, error: "Il router registrato dal wizard non c'è più" };

  try {
    getTenantDb(tenantCode).transaction(() => aggiorna(prima, c))();
  } catch (e) {
    if (e instanceof Rifiuto) return { ok: false, status: 400, error: e.message };
    throw e;
  }
  const dopo = getNetworkDeviceById(c.device_id);
  if (!dopo) return { ok: false, status: 404, error: "Il router registrato dal wizard non c'è più" };
  return { ok: true, router: routerDelWizard(dopo) };
}

function aggiorna(prima: NetworkDevice, c: z.infer<typeof SchemaModificaRouter>): void {
  const protocollo = c.protocol ?? prima.protocol;
  const credenziale = c.credential_id ?? prima.credential_id ?? null;
  // Con accesso SNMP la voce SNMP separata non serve: la principale è già SNMP.
  const snmpPrima = usaSnmpSeparato(prima.protocol) ? (prima.snmp_credential_id ?? null) : null;
  const snmpDopo = usaSnmpSeparato(protocollo)
    ? c.snmp_credential_id !== undefined
      ? c.snmp_credential_id
      : snmpPrima
    : null;
  const cambiaPrincipale = protocollo !== prima.protocol || credenziale !== (prima.credential_id ?? null);
  const cambiaSnmp = snmpDopo !== (prima.snmp_credential_id ?? null);

  const campi: Partial<NetworkDevice> = {};
  if (c.name !== undefined) campi.name = c.name;
  if (c.host !== undefined) campi.host = c.host;
  if (c.vendor !== undefined) campi.vendor = c.vendor;

  const bindings = getDeviceCredentialBindings(prima.id);
  const usati = new Set<number>();
  const ordineInCima = bindings.length ? Math.min(...bindings.map((b) => b.sort_order)) - 1 : 0;

  /** Il binding che rispecchia le colonne di prima: per id della voce, o in linea se la colonna era vuota. */
  const speculare = (protocolType: string, credId: number | null): DeviceCredentialBinding | undefined =>
    bindings.find(
      (b) => !usati.has(b.id) && b.protocol_type === protocolType && (credId != null ? b.credential_id === credId : b.credential_id == null),
    );

  const sostituisci = (vecchio: DeviceCredentialBinding | undefined, voluto: Voluto | null) => {
    if (voluto) {
      const uguale = bindings.find(
        (b) => !usati.has(b.id) && b.protocol_type === voluto.protocol_type && b.credential_id === voluto.credential_id && b.port === voluto.port,
      );
      if (uguale) {
        usati.add(uguale.id);
        if (vecchio && vecchio.id !== uguale.id) {
          usati.add(vecchio.id);
          deleteDeviceCredentialBinding(vecchio.id);
        }
        return;
      }
    }
    if (vecchio) {
      usati.add(vecchio.id);
      deleteDeviceCredentialBinding(vecchio.id);
    }
    if (voluto) {
      addDeviceCredentialBinding({ device_id: prima.id, ...voluto, sort_order: vecchio?.sort_order ?? ordineInCima });
    }
  };

  if (cambiaPrincipale) {
    if (credenziale == null) throw new Rifiuto("Scegli la credenziale del router dall'archivio");
    const voce = voceDellArchivio(credenziale);
    if (!tipiPerProtocollo(protocollo).includes(voce.credential_type)) {
      throw new Rifiuto(`La credenziale «${voce.name}» (${etichettaTipo(voce.credential_type)}) non vale per l'accesso scelto`);
    }
    const porta = portaVocePrincipale(voce, protocollo);
    campi.protocol = protocollo as NetworkDevice["protocol"];
    campi.credential_id = credenziale;
    campi.port = porta;
    // Come il PUT dell'apparato: con una voce d'archivio utente e password in linea non valgono più.
    campi.username = null;
    campi.encrypted_password = null;
    sostituisci(speculare(tipoBindingPerProtocollo(prima.protocol), prima.credential_id ?? null), {
      credential_id: credenziale,
      protocol_type: tipoBindingPerProtocollo(protocollo),
      port: porta,
    });
  }

  if (cambiaSnmp) {
    let voluto: Voluto | null = null;
    if (snmpDopo != null) {
      const voce = voceDellArchivio(snmpDopo);
      if (!tipiPerProtocollo("snmp").includes(voce.credential_type)) {
        throw new Rifiuto(`La voce per porte e LLDP dev'essere SNMP: «${voce.name}» è ${etichettaTipo(voce.credential_type)}`);
      }
      voluto = { credential_id: snmpDopo, protocol_type: "snmp", port: portaCredenziale(voce, "snmp") };
    }
    // Il binding SNMP separato di prima (anche la community in linea del vecchio wizard, se la si sostituisce).
    const vecchio = usaSnmpSeparato(prima.protocol) && (snmpPrima != null || voluto) ? speculare("snmp", snmpPrima) : undefined;
    sostituisci(vecchio, voluto);
    campi.snmp_credential_id = snmpDopo;
  }

  if (Object.keys(campi).length) updateNetworkDevice(prima.id, campi);
}
