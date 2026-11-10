/**
 * Apparato creato da solo (Riccardo, 10/11/2026: «automatizzare … la trasformazione in device se le credenziali
 * funzionano»). Allarga `apparato-da-classificazione.ts` del 09/11, che crea solo quando una persona classifica e solo
 * con SNMP. Le risposte di Riccardo del 10/11:
 * - vale anche la classe decisa dal motore, se la categoria è sicura (`attr_confidence_category` ≥ 80) o scelta a mano;
 * - valgono SNMP, SSH e WinRM, e «se l'apparato risponde a più protocolli devono essere registrati tutti»: ogni
 *   credenziale validata sull'host diventa un binding dell'apparato;
 * - nessuna esclusione per tipo o stato (anche postazioni, VM, host spenti);
 * - un interruttore per tenant, che nasce **spento** (`CHIAVE_APPARATI_AUTOMATICI`).
 *
 * Le scelte sono quelle della finestra «Rendi apparato» (`proponiApparato` + `corpoCreazione`) e la creazione passa
 * da `creaApparato`: stessa validazione, stesso rifiuto di un IP già apparato. Misura sull'hub 533: 38 host con una
 * credenziale validata non erano apparato, e con le regole del 09/11 nessuno lo sarebbe diventato.
 */
import type Database from "better-sqlite3";
import { addDeviceCredentialBinding, getDb } from "@/lib/db";
import { canonicalizza } from "@/lib/classification/canonico";
import { tipiCredenzialePerProtocollo } from "@/lib/credential-protocol-map";
import { proponiApparato, riallineaAlProtocollo, type CredenzialeArchivio, type HostPerProposta, type ProtocolloApparato } from "./proposta-apparato";
import { corpoCreazione } from "./rendi-apparato";
import { creaApparato } from "./crea-apparato";

export const CHIAVE_APPARATI_AUTOMATICI = "apparati.automatici";
export const CONFIDENZA_MINIMA = 80;

type HostAutomatico = HostPerProposta & { id: number; attr_confidence_category?: number | null };
type Legame = { credential_id: number; protocol_type: string; port: number };

export type MotivoNonAutomatico = "senza_classe" | "categoria_incerta" | "nessuna_credenziale";
export interface PianoApparato { corpo: Record<string, unknown>; altri: Legame[] }

export function apparatiAutomaticiAccesi(db: Database.Database): boolean {
  const r = db.prepare("SELECT value FROM tenant_settings WHERE key = ?").get(CHIAVE_APPARATI_AUTOMATICI) as { value: string } | undefined;
  return r?.value === "1";
}

export function impostaApparatiAutomatici(db: Database.Database, acceso: boolean): void {
  db.prepare(
    `INSERT INTO tenant_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
  ).run(CHIAVE_APPARATI_AUTOMATICI, acceso ? "1" : "0");
}

/** Protocollo dell'apparato per una credenziale validata sull'host, dal tipo della voce in archivio. */
function protocolloDi(legame: Legame, archivio: CredenzialeArchivio[]): ProtocolloApparato | null {
  const tipo = archivio.find((c) => c.id === legame.credential_id)?.credential_type ?? "";
  if (legame.protocol_type === "ssh") return "ssh";
  if (legame.protocol_type === "winrm") return "winrm";
  if (legame.protocol_type === "snmp") return tipo === "snmp_v3" ? "snmp_v3" : "snmp_v2";
  return null;
}

/** Cosa si creerebbe per l'host, o perché no. Funzione pura. */
export function pianoApparatoAutomatico(host: HostAutomatico, archivio: CredenzialeArchivio[]): PianoApparato | { motivo: MotivoNonAutomatico } {
  const classe = canonicalizza(host.classification).classificazione;
  if (!classe || classe === "unknown") return { motivo: "senza_classe" };
  if (host.classification_manual !== 1 && (host.attr_confidence_category ?? 0) < CONFIDENZA_MINIMA) return { motivo: "categoria_incerta" };

  const validate = (host.host_credentials ?? []).filter((hc) => {
    if (hc.validated !== 1) return false;
    const p = protocolloDi(hc, archivio);
    const tipo = archivio.find((c) => c.id === hc.credential_id)?.credential_type ?? "";
    return p !== null && tipiCredenzialePerProtocollo(p).includes(tipo);
  });
  if (validate.length === 0) return { motivo: "nessuna_credenziale" };

  const scelta = { ...host, classification: classe };
  let p = proponiApparato(scelta, archivio);
  if (!p.credentialId) {
    // La proposta vuole un protocollo senza credenziale validata: si passa al primo che ne ha una (ssh, winrm, snmp).
    const ordine = ["ssh", "winrm", "snmp"];
    const prima = [...validate].sort((a, b) => ordine.indexOf(a.protocol_type) - ordine.indexOf(b.protocol_type))[0];
    p = riallineaAlProtocollo(p, protocolloDi(prima, archivio) as ProtocolloApparato, archivio, scelta);
  }
  if (!p.credentialId) return { motivo: "nessuna_credenziale" };

  const corpo = corpoCreazione(
    { classificazione: classe, piattaforma: p.vendor, variante: null, ruoli: [], protocollo: p.protocol, porta: p.port },
    { nome: p.name, ip: host.ip, credentialId: p.credentialId, snmpCredentialId: p.snmpCredentialId, scanTargetProposto: p.scanTarget },
  );
  const giaLegate = new Set([p.credentialId, p.snmpCredentialId].filter(Boolean).map(Number));
  const altri = validate
    .filter((hc) => !giaLegate.has(hc.credential_id))
    .map((hc) => ({ credential_id: hc.credential_id, protocol_type: hc.protocol_type, port: hc.port }));
  return { corpo, altri };
}

export interface RigaAutomatica {
  hostId: number; ip: string; classe: string | null;
  esito: "creato" | "da_creare" | "saltato";
  nome?: string; protocollo?: string; legami?: number; motivo?: string;
}

/**
 * Passa gli host con una credenziale validata che non sono apparato. `applica: false` è la prova a vuoto: dice cosa
 * creerebbe, coi nomi, e non scrive. Non guarda l'interruttore: lo guarda chi la chiama (`apparatiAutomaticiDopoScansione`).
 */
export function creaApparatiAutomatici(opz: { applica: boolean }): RigaAutomatica[] {
  const db = getDb();
  const archivio = db.prepare("SELECT id, name, credential_type, port FROM credentials").all() as CredenzialeArchivio[];
  const host = db.prepare(
    `SELECT h.* FROM hosts h
     WHERE EXISTS (SELECT 1 FROM host_credentials hc WHERE hc.host_id = h.id AND hc.validated = 1)
       AND NOT EXISTS (SELECT 1 FROM network_devices d WHERE d.host_id = h.id OR d.host = h.ip)
     ORDER BY h.id`,
  ).all() as HostAutomatico[];
  const leggiLegami = db.prepare(
    "SELECT credential_id, protocol_type, port, validated, validated_at FROM host_credentials WHERE host_id = ? ORDER BY sort_order, id",
  );
  const righe: RigaAutomatica[] = [];
  for (const h of host) {
    const base = { hostId: h.id, ip: h.ip, classe: h.classification ?? null };
    try {
      h.host_credentials = leggiLegami.all(h.id) as HostPerProposta["host_credentials"];
      const piano = pianoApparatoAutomatico(h, archivio);
      if ("motivo" in piano) { righe.push({ ...base, esito: "saltato", motivo: piano.motivo }); continue; }
      const descr = { nome: String(piano.corpo.name), protocollo: String(piano.corpo.protocol), legami: 1 + (piano.corpo.snmp_credential_id ? 1 : 0) + piano.altri.length };
      if (!opz.applica) { righe.push({ ...base, esito: "da_creare", ...descr }); continue; }
      const esito = creaApparato(piano.corpo);
      if (!esito.ok) { righe.push({ ...base, esito: "saltato", motivo: esito.error }); continue; }
      for (const l of piano.altri) {
        try {
          addDeviceCredentialBinding({ device_id: esito.device.id, credential_id: l.credential_id, protocol_type: l.protocol_type as "ssh" | "snmp" | "winrm", port: l.port });
        } catch (e) {
          console.error(`[apparato-automatico] host ${h.id}: legame ${l.protocol_type} non scritto:`, e instanceof Error ? e.message : e);
        }
      }
      righe.push({ ...base, esito: "creato", ...descr, nome: esito.device.name });
    } catch (e) {
      console.error(`[apparato-automatico] host ${h.id}: creazione fallita:`, e);
      righe.push({ ...base, esito: "saltato", motivo: e instanceof Error ? e.message : String(e) });
    }
  }
  return righe;
}

/** Aggancio dei giri di scansione: con l'interruttore spento non fa niente. Non lancia. */
export function apparatiAutomaticiDopoScansione(): void {
  try {
    if (!apparatiAutomaticiAccesi(getDb())) return;
    const creati = creaApparatiAutomatici({ applica: true }).filter((r) => r.esito === "creato");
    if (creati.length > 0) console.warn(`[apparato-automatico] creati ${creati.length} apparati: ${creati.map((r) => `${r.nome} (${r.ip})`).join(", ")}`);
  } catch (e) {
    console.error("[apparato-automatico] giro non riuscito:", e);
  }
}
