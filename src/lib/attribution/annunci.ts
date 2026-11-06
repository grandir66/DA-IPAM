// Cosa un apparato dice di sé sulla rete (06/11/2026). Incidente: al 72729 due Cisco SG200-26 con SNMP spento
// stavano `unknown` mentre si annunciavano col CDP ogni 60 secondi. Qui si raccolgono quegli annunci per l'attribuzione.
//
// Due provenienze con due regole diverse:
// - il sensore trunk (`trunk_vicini`): l'apparato parla in prima persona e non passa da `device_neighbors`;
// - i vicini letti via SNMP (`device_neighbors`, source `snmp`): sono una lettura in più, e l'ADR 0018 vuole che una
//   lettura in più non cambi le classificazioni da sola. Quindi solo a interruttore acceso, per cliente, e con una
//   query propria: `NEIGHBORS_MODEL_SOURCES_SQL` resta com'è.
//
// Modulo a parte perché lo usano le tre facciate dei segnali (db.ts, db-tenant.ts, recompute.ts): un solo posto.
import type Database from "better-sqlite3";
import type { CategorySlug } from "./taxonomy";

export const CHIAVE_VICINI_SNMP = "riconoscimento.vicini_snmp";

export interface Annuncio {
  protocollo: string;
  piattaforma: string | null;
  capacita: string | null;
}

/**
 * Un sistema operativo nella descrizione. `lldpd` su un Linux annuncia bridge e router (i nodi Proxmox, T2-b): le
 * capacità di un server non dicono il suo mestiere e la descrizione non è un modello.
 */
export const SISTEMA_OPERATIVO = /\b(linux|debian|ubuntu|proxmox|windows|vmware|esxi|freebsd|truenas)\b/i;

/** Il mestiere dalle capacità annunciate. Non autoritativo: un apparato può dichiararne più d'uno. */
export function categoriaDaCapacita(capacita: string | null, descrizione: string | null): CategorySlug | null {
  if (!capacita) return null;
  if (descrizione && SISTEMA_OPERATIVO.test(descrizione)) return null;
  const c = new Set(capacita.split(",").map((x) => x.trim()));
  if (c.has("telephone")) return "voip.phone";
  if (c.has("wlan-ap")) return "network.access_point";
  // Uno switch L3 e un router con le porte in bridge dicono la stessa cosa: si resta sul livello che si sa.
  if (c.has("router") && c.has("bridge")) return "network";
  if (c.has("router")) return "network.router";
  if (c.has("bridge")) return "network.switch";
  return null;
}

function viciniSnmpAccesi(dbh: Database.Database): boolean {
  const r = dbh.prepare("SELECT value FROM tenant_settings WHERE key = ?").get(CHIAVE_VICINI_SNMP) as { value: string } | undefined;
  return r?.value === "1";
}

/**
 * Gli annunci di un host, più recenti prima. Il database del hub non ha queste tabelle: «no such table» vuol dire
 * nessun annuncio, ogni altro errore risale (lo prende chi ricalcola l'attribuzione, che lo scrive nel log).
 */
export function annunciDelHost(dbh: Database.Database, hostId: number): Annuncio[] {
  try {
    const dalTrunk = dbh.prepare(
      `SELECT protocollo, piattaforma, capacita FROM trunk_vicini
       WHERE host_id = ? AND (piattaforma IS NOT NULL OR capacita IS NOT NULL)
       ORDER BY ultima_vista DESC LIMIT 5`,
    ).all(hostId) as Annuncio[];
    if (!viciniSnmpAccesi(dbh)) return dalTrunk;
    const daiVicini = dbh.prepare(
      `SELECT dn.protocol AS protocollo, dn.remote_platform AS piattaforma, dn.remote_caps AS capacita
       FROM device_neighbors dn, hosts h
       WHERE h.id = ? AND dn.source = 'snmp'
         AND ((dn.remote_mac IS NOT NULL AND dn.remote_mac = h.mac) OR (dn.remote_ip IS NOT NULL AND dn.remote_ip = h.ip))
         AND (dn.remote_platform IS NOT NULL OR dn.remote_caps IS NOT NULL)
         AND dn.timestamp >= datetime('now', '-2 days')
       ORDER BY dn.timestamp DESC LIMIT 5`,
    ).all(hostId) as Annuncio[];
    return [...dalTrunk, ...daiVicini];
  } catch (e) {
    if (e instanceof Error && /no such (table|column)/.test(e.message)) return [];
    throw e;
  }
}
