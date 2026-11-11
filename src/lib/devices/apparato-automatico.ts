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
import { aggiungiAlleLettureAutomatiche } from "./letture-automatiche";

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

  /* Una VM non è il suo hypervisor (hub 533, 10/11/2026): la scheda di rete virtuale porta il produttore «Proxmox», la
   * proposta ne faceva un nodo Proxmox VE e «da-sns» (192.168.4.42) nasceva hypervisor con letture da Proxmox. Nella
   * finestra lo corregge una persona, qui nessuno: se la classe non è hypervisor, il produttore dell'hypervisor non
   * decide la piattaforma — la decide la famiglia del sistema operativo. */
  const eHypervisor = (v: string | null | undefined) => /proxmox|vmware|qemu|hyper-v|xen|nutanix/i.test(v ?? "");
  const scelta = classe === "hypervisor" ? { ...host, classification: classe } : {
    ...host, classification: classe,
    inferred_vendor: eHypervisor(host.inferred_vendor) ? null : host.inferred_vendor,
    device_manufacturer: eHypervisor(host.device_manufacturer) ? null : host.device_manufacturer,
    vendor: eHypervisor(host.vendor) ? null : host.vendor,
    inferred_scan_target: eHypervisor(host.inferred_scan_target) ? null : host.inferred_scan_target,
  };
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
  /* Una postazione non è uno switch: la tabella degli apparati non ha un tipo «postazione» e il ripiego del profilo
   * dava `switch` (quattro PC sull'hub). Il tipo meno sbagliato è `server`; la classe resta quella vera. */
  if (corpo.device_type === "switch" && classe !== "switch") corpo.device_type = "server";
  const giaLegate = new Set([p.credentialId, p.snmpCredentialId].filter(Boolean).map(Number));
  const altri = validate
    .filter((hc) => !giaLegate.has(hc.credential_id))
    .map((hc) => ({ credential_id: hc.credential_id, protocol_type: hc.protocol_type, port: hc.port }));
  return { corpo, altri };
}

export interface RigaAutomatica {
  hostId: number; ip: string; classe: string | null;
  esito: "creato" | "da_creare" | "saltato";
  nome?: string; protocollo?: string; legami?: number; motivo?: string; deviceId?: number;
}

/**
 * Passa gli host con una credenziale validata che non sono apparato. `applica: false` è la prova a vuoto: dice cosa
 * creerebbe, coi nomi, e non scrive. Non guarda l'interruttore: lo guarda chi la chiama (`apparatiAutomaticiDopoScansione`).
 */
export function creaApparatiAutomatici(opz: { applica: boolean }): RigaAutomatica[] {
  const db = getDb();
  const archivio = db.prepare("SELECT id, name, credential_type, port FROM credentials").all() as CredenzialeArchivio[];
  /* Un apparato con più IP è UN apparato (Riccardo, 10/11: «il motore per collassare gli IP multipli c'è già»). Il
   * motore è `multihomed_links`: stesso `group_id` = stesso apparecchio (seriale, sysName…), `is_primary` = l'IP che
   * riceve le scansioni. Per gruppo nasce un apparato solo, dall'IP primario se è fra i candidati; gli altri si saltano
   * col motivo. Prova a vuoto sull'hub 533: «DA-RT-CORE» su quattro reti, due nodi Proxmox senza nome su due. */
  const host = db.prepare(
    `SELECT h.*, ml.group_id AS gruppo,
            EXISTS (SELECT 1 FROM multihomed_links m2 JOIN hosts h2 ON h2.id = m2.host_id
                    JOIN network_devices d2 ON d2.host_id = h2.id OR d2.host = h2.ip
                    WHERE m2.group_id = ml.group_id) AS gruppo_con_apparato
     FROM hosts h LEFT JOIN multihomed_links ml ON ml.host_id = h.id
     WHERE EXISTS (SELECT 1 FROM host_credentials hc WHERE hc.host_id = h.id AND hc.validated = 1)
       AND NOT EXISTS (SELECT 1 FROM network_devices d WHERE d.host_id = h.id OR d.host = h.ip)
     GROUP BY h.id
     ORDER BY COALESCE(MAX(ml.is_primary), 0) DESC, h.id`,
  ).all() as Array<HostAutomatico & { gruppo: string | null; gruppo_con_apparato: number }>;
  const leggiLegami = db.prepare(
    "SELECT credential_id, protocol_type, port, validated, validated_at FROM host_credentials WHERE host_id = ? ORDER BY sort_order, id",
  );
  const gruppiFatti = new Set<string>();
  const righe: RigaAutomatica[] = [];
  for (const h of host) {
    const base = { hostId: h.id, ip: h.ip, classe: h.classification ?? null };
    try {
      if (h.gruppo && h.gruppo_con_apparato === 1) { righe.push({ ...base, esito: "saltato", motivo: "altro IP di un apparato che c'è già" }); continue; }
      h.host_credentials = leggiLegami.all(h.id) as HostPerProposta["host_credentials"];
      const piano = pianoApparatoAutomatico(h, archivio);
      if ("motivo" in piano) { righe.push({ ...base, esito: "saltato", motivo: piano.motivo }); continue; }
      const descr = { nome: String(piano.corpo.name), protocollo: String(piano.corpo.protocol), legami: 1 + (piano.corpo.snmp_credential_id ? 1 : 0) + piano.altri.length };
      if (h.gruppo && gruppiFatti.has(h.gruppo)) { righe.push({ ...base, esito: "saltato", motivo: "altro IP di un apparato di questo giro" }); continue; }
      if (h.gruppo) gruppiFatti.add(h.gruppo);
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
      righe.push({ ...base, esito: "creato", ...descr, nome: esito.device.name, deviceId: esito.device.id });
    } catch (e) {
      console.error(`[apparato-automatico] host ${h.id}: creazione fallita:`, e);
      righe.push({ ...base, esito: "saltato", motivo: e instanceof Error ? e.message : String(e) });
    }
  }
  return righe;
}

/** Gli apparati appena creati entrano nel job delle letture automatiche (`letture-automatiche.ts`). Id dei job toccati. */
export function mettiInLettura(righe: readonly RigaAutomatica[]): number[] {
  const ids = righe.filter((r) => r.esito === "creato" && r.deviceId != null).map((r) => r.deviceId as number);
  return aggiungiAlleLettureAutomatiche(getDb(), ids);
}

/**
 * Aggancio dei giri di scansione: con l'interruttore spento non fa niente. Non lancia. Restituisce i job «Lettura
 * apparati» toccati: chi chiama (nel server) ricarica lo scheduler e lancia il primo giro.
 */
export function apparatiAutomaticiDopoScansione(): number[] {
  try {
    if (!apparatiAutomaticiAccesi(getDb())) return [];
    const righe = creaApparatiAutomatici({ applica: true });
    const creati = righe.filter((r) => r.esito === "creato");
    if (creati.length === 0) return [];
    console.warn(`[apparato-automatico] creati ${creati.length} apparati: ${creati.map((r) => `${r.nome} (${r.ip})`).join(", ")}`);
    return mettiInLettura(righe);
  } catch (e) {
    console.error("[apparato-automatico] giro non riuscito:", e);
    return [];
  }
}
