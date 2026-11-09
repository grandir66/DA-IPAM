/**
 * Lato tecnico creato alla classificazione (Riccardo, 09/11/2026): quando una persona classifica un oggetto che non è
 * ancora apparato con un tipo che si legge in SNMP (stampante, UPS, switch, firewall…), DA-IPAM crea da solo la riga di
 * `network_devices` invece di lasciarla a «Rendi apparato» a mano.
 *
 * Forma meno invadente, senza interfaccia nuova: si crea **solo** se sull'host c'è già una credenziale SNMP validata
 * (una prova riuscita, `host_credentials.validated = 1`), quindi l'apparato nasce leggibile. Senza credenziale non
 * succede niente: l'oggetto resta da rendere apparato a mano. Le scelte sono quelle della finestra «Rendi apparato»
 * (`proponiApparato` + `corpoCreazione`) con il protocollo SNMP della credenziale, e la creazione passa da
 * `creaApparato`, come la finestra: stessa validazione, stessi binding, stesso rifiuto di un IP già apparato.
 *
 * Solo dalle rotte delle scelte dell'utente: le classificazioni automatiche (scansione, attribuzione) non creano apparati.
 * Modulo separato da `classification/scrivi.ts` perché `creaApparato` chiama già quello.
 */
import { getDb } from "@/lib/db";
import { canonicalizza } from "@/lib/classification/canonico";
import { proponiApparato, riallineaAlProtocollo, type CredenzialeArchivio, type HostPerProposta, type ProtocolloApparato } from "./proposta-apparato";
import { corpoCreazione } from "./rendi-apparato";
import { creaApparato } from "./crea-apparato";

/** Classificazioni che si leggono in SNMP: per queste l'apparato nasce dalla classificazione. */
export const CLASSI_APPARATO_DA_SNMP: ReadonlySet<string> = new Set([
  "switch", "router", "firewall", "access_point", "stampante", "multifunzione", "scanner", "ups",
]);

export type MotivoNonCreato = "classe_non_snmp" | "gia_apparato" | "nessuna_credenziale_snmp" | "rifiutato";

export type EsitoApparatoDaClassificazione =
  | { creato: true; deviceId: number; nome: string }
  | { creato: false; motivo: MotivoNonCreato; dettaglio?: string };

/**
 * Il corpo di `POST /api/devices` per l'host appena classificato, o il motivo per cui non si crea. Funzione pura.
 * `host.classification` deve già essere quella scelta.
 */
export function corpoApparatoDaClassificazione(
  host: HostPerProposta,
  archivio: CredenzialeArchivio[],
): { corpo: Record<string, unknown> } | { motivo: Exclude<MotivoNonCreato, "gia_apparato" | "rifiutato"> } {
  const classe = canonicalizza(host.classification).classificazione;
  if (!CLASSI_APPARATO_DA_SNMP.has(classe)) return { motivo: "classe_non_snmp" };

  const validata = (host.host_credentials ?? []).find((hc) => {
    if (hc.validated !== 1 || hc.protocol_type !== "snmp") return false;
    const tipo = archivio.find((c) => c.id === hc.credential_id)?.credential_type;
    return tipo === "snmp" || tipo === "snmp_v3";
  });
  if (!validata) return { motivo: "nessuna_credenziale_snmp" };

  const protocollo: ProtocolloApparato =
    archivio.find((c) => c.id === validata.credential_id)?.credential_type === "snmp_v3" ? "snmp_v3" : "snmp_v2";
  const scelta = { ...host, classification: classe, classification_manual: 1 };
  const p = riallineaAlProtocollo(proponiApparato(scelta, archivio), protocollo, archivio, scelta);
  const corpo = corpoCreazione(
    { classificazione: classe, piattaforma: p.vendor, variante: null, ruoli: [], protocollo, porta: p.port },
    { nome: p.name, ip: host.ip, credentialId: p.credentialId ?? String(validata.credential_id), snmpCredentialId: null, scanTargetProposto: p.scanTarget },
  );
  return { corpo };
}

/** Crea l'apparato per l'host `hostId` se la sua classificazione e le sue credenziali lo permettono. Non lancia. */
export function creaApparatoDaClassificazione(hostId: number): EsitoApparatoDaClassificazione {
  try {
    const db = getDb();
    const host = db.prepare("SELECT * FROM hosts WHERE id = ?").get(hostId) as (HostPerProposta & { id: number }) | undefined;
    if (!host) return { creato: false, motivo: "rifiutato", dettaglio: "host non trovato" };
    const gia =
      db.prepare("SELECT 1 FROM network_devices WHERE host_id = ? OR host = ? LIMIT 1").get(hostId, host.ip);
    if (gia) return { creato: false, motivo: "gia_apparato" };
    host.host_credentials = db
      .prepare("SELECT credential_id, protocol_type, port, validated, validated_at FROM host_credentials WHERE host_id = ? ORDER BY sort_order, id")
      .all(hostId) as HostPerProposta["host_credentials"];
    const archivio = db.prepare("SELECT id, name, credential_type, port FROM credentials").all() as CredenzialeArchivio[];

    const r = corpoApparatoDaClassificazione(host, archivio);
    if ("motivo" in r) return { creato: false, motivo: r.motivo };
    const esito = creaApparato(r.corpo);
    if (!esito.ok) return { creato: false, motivo: esito.status === 409 ? "gia_apparato" : "rifiutato", dettaglio: esito.error };
    return { creato: true, deviceId: esito.device.id, nome: esito.device.name };
  } catch (e) {
    console.error(`[apparato-da-classificazione] host ${hostId}: creazione fallita:`, e);
    return { creato: false, motivo: "rifiutato", dettaglio: e instanceof Error ? e.message : String(e) };
  }
}
