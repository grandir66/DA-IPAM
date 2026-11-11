/**
 * Cambio di inquilino su un indirizzo (Riccardo, 11/11/2026: «il mio Samsung S25 viene rilevato come stampante…
 * un cambio di IP, che dovrebbe essere automaticamente corretto»).
 *
 * In `hosts` la riga è l'indirizzo (rete + IP), non l'apparato. Quando un apparato diverso prende quell'indirizzo, la
 * riga cambia MAC e nome ma teneva tutto il resto dell'inquilino di prima: dati SNMP, sistema, produttore, porte. Il
 * ricalcolo rileggeva quei dati a ogni giro e li riconfermava: sull'hub 533 un telefono risultava «stampante Kyocera»
 * con confidenza 90, un altro indirizzo «telefono Fanvil».
 *
 * Qui: si decide se il MAC nuovo è davvero un altro apparato, e in quel caso si svuotano i dati d'identità di quello
 * di prima e si ritirano le sue evidenze. Restano le scelte di una persona (classe a mano, nome dato a mano, note,
 * codice d'inventario). I dati svuotati li riporta il giro successivo, se l'apparato risponde.
 *
 * Nasce spento, un interruttore per cliente (`CHIAVE_CAMBIO_INQUILINO`).
 */
import type Database from "better-sqlite3";
import { recomputeAttributionForDb } from "@/lib/attribution/recompute";

export const CHIAVE_CAMBIO_INQUILINO = "riconoscimento.cambio_inquilino";
/** Un MAC su più righe di così è un router che risponde per altri (proxy ARP), non un apparato. */
export const MAX_RIGHE_STESSO_MAC = 4;

function esa(mac: string | null | undefined): string {
  return (mac ?? "").replace(/[^0-9a-fA-F]/g, "").toUpperCase();
}

/** MAC «privato»: amministrato localmente, quindi casuale (telefoni, portatili, contenitori). Non ha un produttore. */
export function macPrivato(mac: string | null | undefined): boolean {
  const h = esa(mac);
  return h.length === 12 && "26AE".includes(h[1]);
}

/** MAC di un indirizzo condiviso fra più apparati (VRRP, HSRP): passa da uno all'altro senza che cambi nessuno. */
export function macVirtuale(mac: string | null | undefined): boolean {
  const h = esa(mac);
  return h.startsWith("00005E0001") || h.startsWith("00005E0002") || h.startsWith("00000C07AC") || h.startsWith("00000C9FF");
}

export function cambioInquilinoAcceso(db: Database.Database): boolean {
  const r = db.prepare("SELECT value FROM tenant_settings WHERE key = ?").get(CHIAVE_CAMBIO_INQUILINO) as { value: string } | undefined;
  return r?.value === "1";
}

export function impostaCambioInquilino(db: Database.Database, acceso: boolean): void {
  db.prepare(
    `INSERT INTO tenant_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
  ).run(CHIAVE_CAMBIO_INQUILINO, acceso ? "1" : "0");
}

export type MotivoStessoApparato =
  | "manca_un_mac" | "stesso_mac" | "mac_virtuale" | "mac_su_molte_righe" | "altro_indirizzo_dello_stesso_apparato" | "stesso_nome";

interface RigaPrima { mac: string | null; hostname: string | null; physical_device_id: number | null }

function righeConMac(db: Database.Database, mac: string): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM hosts WHERE REPLACE(REPLACE(UPPER(mac), ':', ''), '-', '') = ?").get(esa(mac)) as { n: number }).n;
}

/** Il MAC nuovo è quello di un'altra riga dello stesso apparato (stesso gruppo o stesso apparato fisico)? */
function macDelloStessoApparato(db: Database.Database, hostId: number, prima: RigaPrima, macNuovo: string): boolean {
  const altre = db.prepare(
    `SELECT h.mac FROM hosts h
     WHERE h.id != ? AND h.mac IS NOT NULL AND (
       (? IS NOT NULL AND h.physical_device_id = ?)
       OR h.id IN (SELECT m2.host_id FROM multihomed_links m1 JOIN multihomed_links m2 ON m2.group_id = m1.group_id WHERE m1.host_id = ?)
     )`,
  ).all(hostId, prima.physical_device_id, prima.physical_device_id, hostId) as Array<{ mac: string }>;
  return altre.some((r) => esa(r.mac) === esa(macNuovo));
}

/**
 * Il MAC che arriva su questa riga è di un altro apparato? `nomeNuovo` è il nome che arriva insieme al MAC (DHCP):
 * se è lo stesso di prima, è lo stesso apparato che ha cambiato MAC casuale.
 */
export function eCambioDiInquilino(
  db: Database.Database,
  hostId: number,
  macNuovo: string | null | undefined,
  nomeNuovo?: string | null,
): { cambio: true } | { cambio: false; motivo: MotivoStessoApparato } {
  const prima = db.prepare("SELECT mac, hostname, physical_device_id FROM hosts WHERE id = ?").get(hostId) as RigaPrima | undefined;
  const no = (motivo: MotivoStessoApparato) => ({ cambio: false as const, motivo });
  if (!prima || esa(prima.mac).length !== 12 || esa(macNuovo).length !== 12) return no("manca_un_mac");
  if (esa(prima.mac) === esa(macNuovo)) return no("stesso_mac");
  if (macVirtuale(prima.mac) || macVirtuale(macNuovo)) return no("mac_virtuale");
  const nome = nomeNuovo?.trim().toLowerCase();
  if (nome && nome === prima.hostname?.trim().toLowerCase()) return no("stesso_nome");
  if (righeConMac(db, macNuovo as string) > MAX_RIGHE_STESSO_MAC || righeConMac(db, prima.mac as string) > MAX_RIGHE_STESSO_MAC) return no("mac_su_molte_righe");
  if (macDelloStessoApparato(db, hostId, prima, macNuovo as string)) return no("altro_indirizzo_dello_stesso_apparato");
  return { cambio: true };
}

/**
 * Svuota i dati d'identità dell'inquilino di prima e ritira le sue evidenze non manuali. Non tocca: MAC, stato,
 * date, nome dato a mano, classe scelta a mano, note, codice d'inventario, host noto. Poi ricalcola il riconoscimento.
 */
export function svuotaInquilino(
  db: Database.Database,
  hostId: number,
  opts: { tieniNome?: boolean; nowIso?: string } = {},
): void {
  const nowIso = opts.nowIso ?? new Date().toISOString();
  // `tieniNome`: nella bonifica delle righe già sporche il nome è quello dell'apparato di ADESSO (arrivato col suo
  // DHCP) e va tenuto. L'11/11 sull'hub 533 la prima bonifica l'ha tolto a 16 righe: rimesso dalla copia.
  const nome = opts.tieniNome ? 1 : 0;
  db.transaction(() => {
    db.prepare(
      `UPDATE hosts SET vendor = NULL, os_info = NULL, model = NULL, serial_number = NULL, firmware = NULL,
         device_manufacturer = NULL, detection_json = NULL, snmp_data = NULL, open_ports = NULL,
         hostname = CASE WHEN ? = 1 OR hostname_source = 'manual' THEN hostname ELSE NULL END,
         hostname_source = CASE WHEN ? = 1 OR hostname_source = 'manual' THEN hostname_source ELSE NULL END,
         classification = CASE WHEN IFNULL(classification_manual, 0) = 1 THEN classification ELSE NULL END,
         classification_reason = CASE WHEN IFNULL(classification_manual, 0) = 1 THEN classification_reason ELSE NULL END,
         classification_json = CASE WHEN IFNULL(classification_manual, 0) = 1 THEN classification_json ELSE NULL END,
         server_roles = CASE WHEN IFNULL(classification_manual, 0) = 1 THEN server_roles ELSE NULL END,
         updated_at = datetime('now')
       WHERE id = ?`,
    ).run(nome, nome, hostId);
    db.prepare(
      `UPDATE attribution_evidence SET expires_at = ?
       WHERE host_id = ? AND source != 'manual' AND superseded_by IS NULL AND (expires_at IS NULL OR expires_at > ?)`,
    ).run(nowIso, hostId, nowIso);
  })();
  recomputeAttributionForDb(db, hostId, "scan");
}

/**
 * Da chiamare quando arriva un MAC su una riga che esiste già, PRIMA di scrivere il MAC nuovo. Spento → non fa niente.
 * Rende true se ha svuotato. Nel registro va solo l'id della riga, mai indirizzi o nomi.
 */
export function cambioInquilinoSeServe(
  db: Database.Database,
  hostId: number,
  macNuovo: string | null | undefined,
  nomeNuovo?: string | null,
): boolean {
  if (!cambioInquilinoAcceso(db)) return false;
  if (!eCambioDiInquilino(db, hostId, macNuovo, nomeNuovo).cambio) return false;
  svuotaInquilino(db, hostId);
  console.info(`[inquilino] host ${hostId}: MAC di un altro apparato, dati di prima svuotati`);
  return true;
}

/**
 * Nome che un telefono, un tablet, un orologio o un Mac si dà da solo in DHCP. Serve solo alla bonifica delle righe
 * già sporche: lì è l'unico segno sicuro che i dati rimasti sono di un altro apparato (un iPhone non è «HP Inc.»).
 */
const NOME_PERSONALE = /^(iphone|ipad|watch|apple-?watch|mac|macbook[\w-]*|imac|galaxy[\w-]*|s2\d[\w-]*|pixel[\w-]*|fairphone[\w-]*|android-[0-9a-f]+|redmi[\w-]*|oneplus[\w-]*|xiaomi[\w-]*|huawei[\w-]*)$/i;

export function nomePersonale(nome: string | null | undefined): boolean {
  const corto = (nome ?? "").trim().split(".")[0];
  return NOME_PERSONALE.test(corto);
}

export interface RigaEreditata {
  id: number; ip: string; nome: string | null; mac: string; produttore: string | null; snmp: boolean;
  classe: string | null; categoria: string | null; a_mano: boolean;
  /** true = si può svuotare senza guardarla; false = va letta da una persona (vedi `perche`). */
  sicura: boolean;
  perche: "nome_personale" | "mac_su_molte_righe" | "nome_non_personale";
}

/**
 * Le righe già sporche da prima: MAC privato (che non ha un produttore) ma con un produttore o dei dati SNMP.
 * Non basta per svuotare (prova a vuoto dell'11/11 sull'hub 533, 30 righe): hanno un MAC privato anche i NAS con le
 * schede in coppia (DA-ADRA, SynologyNAS, con dati SNMP veri), le macchine virtuali, e un MAC condiviso da sette
 * righe. È `sicura` solo la riga che si chiama come un apparato personale e il cui MAC non sta su troppe righe.
 */
export function righeEreditate(db: Database.Database): RigaEreditata[] {
  const righe = db.prepare(
    `SELECT id, ip, COALESCE(NULLIF(custom_name, ''), hostname) AS nome, hostname, mac, vendor, snmp_data, classification, attr_category, classification_manual
     FROM hosts WHERE mac IS NOT NULL
       AND ((vendor IS NOT NULL AND TRIM(vendor) != '') OR (snmp_data IS NOT NULL AND TRIM(snmp_data) != ''))
     ORDER BY network_id, ip`,
  ).all() as Array<{ id: number; ip: string; nome: string | null; hostname: string | null; mac: string; vendor: string | null; snmp_data: string | null; classification: string | null; attr_category: string | null; classification_manual: number | null }>;
  return righe.filter((r) => macPrivato(r.mac)).map((r) => {
    const perche: RigaEreditata["perche"] = righeConMac(db, r.mac) > MAX_RIGHE_STESSO_MAC ? "mac_su_molte_righe"
      : nomePersonale(r.hostname) ? "nome_personale" : "nome_non_personale";
    return {
      id: r.id, ip: r.ip, nome: r.nome, mac: r.mac, produttore: r.vendor?.trim() || null, snmp: !!r.snmp_data?.trim(),
      classe: r.classification, categoria: r.attr_category, a_mano: r.classification_manual === 1,
      sicura: perche === "nome_personale", perche,
    };
  });
}
