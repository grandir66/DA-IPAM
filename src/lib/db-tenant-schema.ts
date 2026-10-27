/**
 * Schema SQL per i database tenant (spoke).
 * Ogni tenant ha il proprio SQLite con tutte le tabelle operative.
 * Le tabelle hub (users, settings, nmap_profiles, snmp_vendor_profiles,
 * device_fingerprint_rules, fingerprint_classification_map, sysobj_lookup, snmp_oid_library)
 * risiedono solo nel DB centrale.
 */

import type Database from "better-sqlite3";
import { SCHEDULED_JOB_TYPES_CHECK_SQL } from "./scheduled-job-types";

/**
 * MDM (passo 3 del piano di solidità, 16/10): `last_attempt_at` = ultimo tentativo
 * di sincronizzazione, riuscito o no; `last_success_at` = ultima riuscita.
 * `last_sync_at` resta com'era (aggiornato a ogni tentativo) per chi lo legge già.
 *
 * Le colonne stanno anche nella CREATE di `mdm_config` qui sotto (DB nuovi); sui DB
 * esistenti le aggiunge `assicuraColonneMdmConfig`, `ALTER TABLE ADD COLUMN`
 * idempotente, solo additiva. La chiama `integrations/mdm-config.ts` all'apertura
 * della connessione: così la migrazione non tocca `db-tenant.ts` (fermo fino alla
 * pubblicazione di `tappa3b/nucleo`, dopo il 20/10).
 */
export const COLONNE_NUOVE_MDM_CONFIG: ReadonlyArray<readonly [string, string]> = [
  ["last_attempt_at", "ALTER TABLE mdm_config ADD COLUMN last_attempt_at TEXT"],
  ["last_success_at", "ALTER TABLE mdm_config ADD COLUMN last_success_at TEXT"],
];

/** Aggiunge a `mdm_config` le colonne che mancano; restituisce quelle aggiunte. Ripetibile. */
export function assicuraColonneMdmConfig(db: Database.Database): string[] {
  const colonne = new Set(
    (db.prepare("PRAGMA table_info(mdm_config)").all() as Array<{ name: string }>).map((c) => c.name),
  );
  // Tabella assente (DB molto vecchio): la crea lo schema all'apertura, non questa funzione.
  if (colonne.size === 0) return [];
  const aggiunte: string[] = [];
  for (const [nome, ddl] of COLONNE_NUOVE_MDM_CONFIG) {
    if (colonne.has(nome)) continue;
    db.exec(ddl);
    aggiunte.push(nome);
  }
  return aggiunte;
}

/**
 * Sensore trunk (25/10): i protocolli in cui il sensore ha visto l'indirizzo (ARP, DHCP, mDNS, LLDP…),
 * separati da virgola. Sui DB esistenti la aggiunge `assicuraColonnaProtocolliTrunk`, idempotente e solo additiva,
 * chiamata da `trunk/sensore-trunk.ts` alla prima lettura o scrittura.
 */
export function assicuraColonnaProtocolliTrunk(db: Database.Database): boolean {
  const colonne = new Set(
    (db.prepare("PRAGMA table_info(trunk_osservazioni)").all() as Array<{ name: string }>).map((c) => c.name),
  );
  if (colonne.size === 0 || colonne.has("protocolli")) return false;
  db.exec("ALTER TABLE trunk_osservazioni ADD COLUMN protocolli TEXT");
  return true;
}

/**
 * Rilievi di sicurezza dal trunk (25/10): i server DHCP visti per VLAN, copiati da `/vlan` del sensore
 * (JSON: `[{mac, ip, ultima_vista}]`). Stesso schema di `assicuraColonnaProtocolliTrunk`: idempotente, solo additiva.
 */
export function assicuraColonnaServerDhcpTrunk(db: Database.Database): boolean {
  const colonne = new Set(
    (db.prepare("PRAGMA table_info(trunk_vlan)").all() as Array<{ name: string }>).map((c) => c.name),
  );
  if (colonne.size === 0 || colonne.has("server_dhcp")) return false;
  db.exec("ALTER TABLE trunk_vlan ADD COLUMN server_dhcp TEXT NOT NULL DEFAULT '[]'");
  return true;
}

/**
 * Topologia T2 (spec 2026-10-14 §13.5.7): i fatti delle letture in più, uno per lettore (la fonte sta nella chiave:
 * due lettori dello stesso apparato non si sovrascrivono, ADR 0009 punto 4). Le stesse CREATE stanno qui e nella
 * migrazione (`migrateTopologyCavi`, db-tenant.ts); gli indici solo nella migrazione. Nessun CHECK: i valori li valida
 * TypeScript (un valore nuovo non deve chiedere una ricostruzione, vietata con le chiavi esterne). `lag_state`
 * ('attivo' | 'riserva') è lo stato del membro di un bond letto dall'host (§13.5.5), che il DDL della spec non aveva.
 */
export const DDL_TOPOLOGY_CAVI: ReadonlyArray<readonly [string, string]> = [
  ["topology_port_facts", `CREATE TABLE IF NOT EXISTS topology_port_facts (
  device_id INTEGER NOT NULL REFERENCES network_devices(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  port_key TEXT NOT NULL,
  port_name TEXT NOT NULL,
  port_index INTEGER,
  if_kind TEXT,
  running INTEGER,
  in_bridge INTEGER,
  bridge TEXT,
  lag_group TEXT,
  lag_partner TEXT,
  lag_state TEXT,
  stp_role TEXT,
  stp_state TEXT,
  designated_bridge TEXT,
  designated_port TEXT,
  path_cost INTEGER,
  edge INTEGER,
  point_to_point INTEGER,
  sending_rstp INTEGER,
  bpdu_rx INTEGER,
  first_seen TEXT NOT NULL DEFAULT (datetime('now')),
  seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (device_id, source, port_key)
)`],
  ["topology_bridge_facts", `CREATE TABLE IF NOT EXISTS topology_bridge_facts (
  device_id INTEGER NOT NULL REFERENCES network_devices(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  bridge_name TEXT NOT NULL DEFAULT '',
  instance INTEGER NOT NULL DEFAULT 0,
  protocol TEXT,
  priority INTEGER,
  bridge_id TEXT,
  root_id TEXT,
  regional_root_id TEXT,
  region_name TEXT,
  region_revision INTEGER,
  config_digest TEXT,
  vlans TEXT,
  root_port TEXT,
  root_path_cost INTEGER,
  first_seen TEXT NOT NULL DEFAULT (datetime('now')),
  seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (device_id, source, bridge_name, instance)
)`],
  ["topology_device_macs", `CREATE TABLE IF NOT EXISTS topology_device_macs (
  device_id INTEGER NOT NULL REFERENCES network_devices(id) ON DELETE CASCADE,
  mac TEXT NOT NULL,
  source TEXT NOT NULL,
  port_key TEXT,
  seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (device_id, mac)
)`],
];

/**
 * Scheda MikroTik (piano 2026-10-21, Task 3): colonne nuove su tabelle che esistono già, scritte dalle letture che girano
 * già (interfacce, ARP, vicini). Solo `ALTER TABLE … ADD COLUMN` (`migrateSchedaMikrotik`, db-tenant.ts): nessuna
 * ricostruzione, nessun CHECK. Una voce per colonna: [tabella, colonna, tipo]. I Task 8 e 10 aggiungono un livello ciascuno.
 */
export const COLONNE_SCHEDA_MK_V1: ReadonlyArray<readonly [tabella: string, colonna: string, ddl: string]> = [
  ["device_interfaces", "mtu", "INTEGER"],
  ["device_interfaces", "disabled", "INTEGER"],
  ["arp_entries", "status", "TEXT"],
  ["arp_entries", "dynamic", "INTEGER"],
  ["device_neighbors", "remote_version", "TEXT"],
];
/**
 * Livello 2 (Task 8, ADR 0027): bridge, porte dei bridge e bond di un MikroTik, gli attributi che la lettura della topologia
 * riceve già (MK3, MK4, MK8). Una fotografia per apparato (l'ultima lettura buona), separata dalle tabelle `topology_*`: la
 * mappa legge quelle, la scheda queste. Nessun CHECK, nessun indice in più (la chiave primaria comincia da device_id). Le
 * CREATE stanno SOLO nella migrazione (`migrateSchedaMikrotik`), non in TENANT_SCHEMA_SQL: lo schema gira prima e le
 * creerebbe fuori dalla transazione, senza riga nel journal; così il journal dice quando sono nate. Senza `IF NOT EXISTS`:
 * la migrazione le crea solo dopo averle cercate, e un oggetto con lo stesso nome (una vista) deve far fallire, non passare muto.
 */
export const DDL_SCHEDA_MK_V2: ReadonlyArray<readonly [string, string]> = [
  ["mikrotik_bridge", `CREATE TABLE mikrotik_bridge (
  device_id INTEGER NOT NULL REFERENCES network_devices(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  mac_address TEXT, mtu TEXT, actual_mtu INTEGER, l2mtu INTEGER, arp TEXT, arp_timeout TEXT,
  protocol_mode TEXT, priority TEXT, fast_forward INTEGER, igmp_snooping INTEGER, dhcp_snooping INTEGER,
  vlan_filtering INTEGER, pvid INTEGER, frame_types TEXT, ingress_filtering INTEGER, ether_type TEXT,
  ageing_time TEXT, forward_delay TEXT, max_message_age TEXT, comment TEXT, running INTEGER, disabled INTEGER,
  seen_at TEXT NOT NULL,
  PRIMARY KEY (device_id, name)
)`],
  ["mikrotik_bridge_port", `CREATE TABLE mikrotik_bridge_port (
  device_id INTEGER NOT NULL REFERENCES network_devices(id) ON DELETE CASCADE,
  interface TEXT NOT NULL,
  bridge TEXT NOT NULL,
  pvid INTEGER, priority TEXT, path_cost INTEGER, internal_path_cost INTEGER,
  edge TEXT, point_to_point TEXT, horizon TEXT, hw INTEGER, hw_offload INTEGER, frame_types TEXT, ingress_filtering INTEGER,
  bpdu_guard INTEGER, trusted INTEGER, inactive INTEGER, disabled INTEGER, dynamic INTEGER, comment TEXT,
  seen_at TEXT NOT NULL,
  PRIMARY KEY (device_id, interface)
)`],
  ["mikrotik_bond", `CREATE TABLE mikrotik_bond (
  device_id INTEGER NOT NULL REFERENCES network_devices(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  mode TEXT, slaves TEXT, transmit_hash_policy TEXT, mlag_id TEXT, link_monitoring TEXT,
  mii_interval TEXT, lacp_rate TEXT, mtu INTEGER, comment TEXT, running INTEGER, disabled INTEGER,
  seen_at TEXT NOT NULL,
  PRIMARY KEY (device_id, name)
)`],
];
/**
 * Livello 3 (Task 10, ADR 0027): VLAN dei bridge, interfacce VLAN, DNS e utenti di un MikroTik, dalla lettura
 * `mikrotik_scheda` (spenta di default, quattro comandi in sola lettura). Una fotografia per apparato come il livello 2; liste
 * (tagged, server DNS…) come testo con le virgole. `mikrotik_bridge_vlan` non ha un nome: `pos` = ordine di lettura.
 * `mikrotik_user` la legge solo l'admin (GET /api/devices/[id]/mikrotik-utenti); nessuna password. Stesse regole del
 * livello 2: solo nella migrazione, senza `IF NOT EXISTS`.
 */
export const DDL_SCHEDA_MK_V3: ReadonlyArray<readonly [string, string]> = [
  ["mikrotik_bridge_vlan", `CREATE TABLE mikrotik_bridge_vlan (
  device_id INTEGER NOT NULL REFERENCES network_devices(id) ON DELETE CASCADE,
  pos INTEGER NOT NULL, bridge TEXT NOT NULL, vlan_ids TEXT NOT NULL, tagged TEXT, untagged TEXT, current_tagged TEXT,
  current_untagged TEXT, dynamic INTEGER, disabled INTEGER, comment TEXT, seen_at TEXT NOT NULL,
  PRIMARY KEY (device_id, pos)
)`],
  ["mikrotik_vlan", `CREATE TABLE mikrotik_vlan (
  device_id INTEGER NOT NULL REFERENCES network_devices(id) ON DELETE CASCADE,
  name TEXT NOT NULL, vlan_id INTEGER, interface TEXT, mtu INTEGER, mac_address TEXT, running INTEGER, disabled INTEGER,
  comment TEXT, seen_at TEXT NOT NULL,
  PRIMARY KEY (device_id, name)
)`],
  ["mikrotik_dns", `CREATE TABLE mikrotik_dns (
  device_id INTEGER PRIMARY KEY REFERENCES network_devices(id) ON DELETE CASCADE,
  servers TEXT, dynamic_servers TEXT, allow_remote_requests INTEGER, cache_size TEXT, cache_used TEXT,
  max_concurrent_queries INTEGER, use_doh_server TEXT, seen_at TEXT NOT NULL
)`],
  ["mikrotik_user", `CREATE TABLE mikrotik_user (
  device_id INTEGER NOT NULL REFERENCES network_devices(id) ON DELETE CASCADE,
  name TEXT NOT NULL, grp TEXT, address TEXT, last_logged_in TEXT, disabled INTEGER, comment TEXT,
  seen_at TEXT NOT NULL,
  PRIMARY KEY (device_id, name)
)`],
];
/** Segno in `tenant_settings`: dice fin dove è arrivato lo schema (`done:<data>:v<versione>`); la migrazione non lo consulta. */
export const SEGNO_SCHEDA_MK = "scheda_mikrotik_v21";
/** Versione dello schema della scheda: 1 = COLONNE_SCHEDA_MK_V1, 2 = DDL_SCHEDA_MK_V2, 3 = DDL_SCHEDA_MK_V3. */
export const VERSIONE_SCHEDA_MK = 3;

/**
 * Principale del cluster fisico scelto a mano (piano 2026-10-22 accorpamento, Task 3): in Discovery un apparato fisico ha
 * una riga sola. NULL = vale la regola (apparato gestito, poi IP più basso, `devices/cluster-discovery.ts`); torna NULL se
 * l'host esce dal cluster o è cancellato. Come le colonne della scheda MikroTik non sta in `physical_devices` qui sotto: la
 * crea solo la migrazione (`migrateClusterPrincipale`), così tenant nuovi e vecchi passano dalla stessa strada.
 */
export const COLONNA_CLUSTER_PRINCIPALE = ["physical_devices", "primary_host_id", "INTEGER REFERENCES hosts(id) ON DELETE SET NULL"] as const;
/** L'indice serve all'ON DELETE SET NULL: senza, ogni host cancellato scorre tutta `physical_devices`. */
export const INDICE_CLUSTER_PRINCIPALE = ["idx_physical_devices_primary_host", "CREATE INDEX IF NOT EXISTS idx_physical_devices_primary_host ON physical_devices(primary_host_id)"] as const;
/** Segno in `tenant_settings` (`done:<data>:v<versione>`); la migrazione non lo consulta. */
export const SEGNO_CLUSTER_PRINCIPALE = "cluster_principale_v21";
export const VERSIONE_CLUSTER_PRINCIPALE = 1;

/**
 * VLAN degli switch via SNMP (piano 2026-10-22 accorpamento, Task 8, ADR 0029): VLAN con il nome, porte di ogni VLAN (egress,
 * untagged; untagged NULL = lo switch non lo dichiara e la U si deduce dal PVID), PVID di ogni porta, e come è andata l'ultima
 * lettura buona. Una fotografia per apparato, separata da `switch_ports.vlan` (il giro ARP la scrive, la mappa la legge): la
 * scheda dello switch legge queste. Porte per ifIndex, come le dà `devices/snmp-vlan.ts`. Come la scheda MikroTik: le CREATE
 * stanno SOLO nella migrazione (`migrateSwitchVlan`), senza `IF NOT EXISTS`, nessun CHECK, nessun indice in più.
 * `ordine_bit` e `porte_senza_mappa` (Task 7, «Correzioni») dicono alla tab VLAN quando la matrice è dedotta.
 */
export const DDL_SWITCH_VLAN_V1: ReadonlyArray<readonly [string, string]> = [
  ["switch_vlan", `CREATE TABLE switch_vlan (
  device_id INTEGER NOT NULL REFERENCES network_devices(id) ON DELETE CASCADE,
  vlan_id INTEGER NOT NULL, nome TEXT,
  PRIMARY KEY (device_id, vlan_id)
)`],
  ["switch_vlan_porte", `CREATE TABLE switch_vlan_porte (
  device_id INTEGER NOT NULL REFERENCES network_devices(id) ON DELETE CASCADE,
  vlan_id INTEGER NOT NULL, if_index INTEGER NOT NULL, egress INTEGER NOT NULL, untagged INTEGER,
  PRIMARY KEY (device_id, vlan_id, if_index)
)`],
  ["switch_porta_pvid", `CREATE TABLE switch_porta_pvid (
  device_id INTEGER NOT NULL REFERENCES network_devices(id) ON DELETE CASCADE,
  if_index INTEGER NOT NULL, pvid INTEGER NOT NULL,
  PRIMARY KEY (device_id, if_index)
)`],
  ["switch_vlan_lettura", `CREATE TABLE switch_vlan_lettura (
  device_id INTEGER PRIMARY KEY REFERENCES network_devices(id) ON DELETE CASCADE,
  letto_il TEXT NOT NULL, tabella TEXT NOT NULL, mappa_porte TEXT NOT NULL, n_vlan INTEGER NOT NULL,
  ordine_bit TEXT NOT NULL, porte_senza_mappa INTEGER NOT NULL
)`],
];
/** Segno in `tenant_settings` (`done:<data>:v<versione>`); la migrazione non lo consulta. */
export const SEGNO_SWITCH_VLAN = "switch_vlan_v21";
export const VERSIONE_SWITCH_VLAN = 1;

/**
 * VLAN native delle porte dal controller UniFi (piano 2026-10-22 accorpamento, Task 13, ADR 0029): dove l'SNMP non dichiara
 * gli untagged (la ProMax), la nativa che il controller dà per porta. Fotografia per apparato, scritta dalla sync UniFi
 * (solo con la lettura `switch_vlan` accesa) e separata dalle tabelle SNMP: la lettura oraria SNMP le riscrive intere e
 * cancellerebbe il completamento. Porte per ifIndex (= `port_idx` del controller). Come le altre: CREATE solo nella
 * migrazione (`migrateSwitchVlanNativa`), senza `IF NOT EXISTS`, nessun CHECK, nessun indice in più.
 */
export const DDL_SWITCH_VLAN_NATIVA: ReadonlyArray<readonly [string, string]> = [
  ["switch_vlan_nativa", `CREATE TABLE switch_vlan_nativa (
  device_id INTEGER NOT NULL REFERENCES network_devices(id) ON DELETE CASCADE,
  if_index INTEGER NOT NULL, vlan_id INTEGER NOT NULL, letto_il TEXT NOT NULL,
  PRIMARY KEY (device_id, if_index)
)`],
];
export const SEGNO_SWITCH_VLAN_NATIVA = "switch_vlan_nativa_v21";
export const VERSIONE_SWITCH_VLAN_NATIVA = 1;

/**
 * LibreNMS come fonte di dati (piano 2026-10-22 LibreNMS, task 2; spec `specs/2026-10-22-librenms-fonte-dati-design.md`):
 * la fotografia dell'ultima lettura buona di ogni parte dell'API di LibreNMS locale (apparati, porte, vicini, VLAN, MAC per
 * porta, ARP, sensori, inventario), come ADR 0027/0029, più `librenms_lettura` (come è andata ogni parte) e
 * `librenms_rifiuto` (gli apparati che LibreNMS ha rifiutato all'aggiunta, col motivo: senza `force_add` un rifiuto non
 * lascia una riga in `librenms_host_map`). Chiavi di LibreNMS, nessuna FOREIGN KEY (spec §4.4: la maggior parte degli
 * oggetti di LibreNMS sono host senza apparato), nessun CHECK. Date `YYYY-MM-DD HH:MM:SS` UTC per `letto_il`, `tentato_il`
 * e `il`; le date di LibreNMS (`last_polled`, `aggiornato_il`, `visto_il`) restano come le dà la sua API. CREATE solo nella
 * migrazione (`migrateLibrenmsFonte`), senza `IF NOT EXISTS` (ADR 0029 §4). La mappa non le legge (spec §4.3).
 */
export const DDL_LIBRENMS_FONTE_V1: ReadonlyArray<readonly [string, string]> = [
  ["librenms_apparato", `CREATE TABLE librenms_apparato (
  librenms_device_id INTEGER PRIMARY KEY, ip TEXT, hostname TEXT, sysname TEXT, os TEXT, hardware TEXT, version TEXT,
  serial TEXT, status INTEGER, last_polled TEXT, last_discovered TEXT, letto_il TEXT NOT NULL
)`],
  ["librenms_porta", `CREATE TABLE librenms_porta (
  librenms_device_id INTEGER NOT NULL, port_id INTEGER NOT NULL, if_index INTEGER, if_name TEXT, if_alias TEXT, if_type TEXT,
  oper_status TEXT, admin_status TEXT, speed INTEGER, mac TEXT, vlan INTEGER, letto_il TEXT NOT NULL,
  PRIMARY KEY (librenms_device_id, port_id)
)`],
  ["librenms_vicino", `CREATE TABLE librenms_vicino (
  librenms_device_id INTEGER NOT NULL, link_id INTEGER NOT NULL, local_port_id INTEGER, protocol TEXT, remote_hostname TEXT,
  remote_port TEXT, remote_platform TEXT, remote_device_id INTEGER, remote_port_id INTEGER, letto_il TEXT NOT NULL,
  PRIMARY KEY (librenms_device_id, link_id)
)`],
  ["librenms_vlan", `CREATE TABLE librenms_vlan (
  librenms_device_id INTEGER NOT NULL, vlan_id INTEGER NOT NULL, nome TEXT, letto_il TEXT NOT NULL,
  PRIMARY KEY (librenms_device_id, vlan_id)
)`],
  ["librenms_mac_porta", `CREATE TABLE librenms_mac_porta (
  librenms_device_id INTEGER NOT NULL, port_id INTEGER NOT NULL, mac TEXT NOT NULL, vlan_id INTEGER, visto_il TEXT,
  letto_il TEXT NOT NULL, PRIMARY KEY (librenms_device_id, port_id, mac)
)`],
  ["librenms_arp", `CREATE TABLE librenms_arp (
  librenms_device_id INTEGER NOT NULL, port_id INTEGER, mac TEXT NOT NULL, ip TEXT NOT NULL, letto_il TEXT NOT NULL,
  PRIMARY KEY (librenms_device_id, mac, ip)
)`],
  ["librenms_sensore", `CREATE TABLE librenms_sensore (
  sensor_id INTEGER PRIMARY KEY, librenms_device_id INTEGER NOT NULL, classe TEXT NOT NULL, descrizione TEXT, valore REAL,
  limite_basso REAL, limite_alto REAL, aggiornato_il TEXT, letto_il TEXT NOT NULL
)`],
  ["librenms_inventario", `CREATE TABLE librenms_inventario (
  librenms_device_id INTEGER NOT NULL, ent_index INTEGER NOT NULL, classe TEXT, nome TEXT, descrizione TEXT, modello TEXT,
  seriale TEXT, firmware TEXT, contenuto_in INTEGER, letto_il TEXT NOT NULL, PRIMARY KEY (librenms_device_id, ent_index)
)`],
  ["librenms_lettura", `CREATE TABLE librenms_lettura (
  parte TEXT PRIMARY KEY, esito TEXT NOT NULL, righe INTEGER, letto_il TEXT, tentato_il TEXT NOT NULL, codice TEXT
)`],
  ["librenms_rifiuto", `CREATE TABLE librenms_rifiuto (
  ip TEXT PRIMARY KEY, host_id INTEGER, network_device_id INTEGER, codice TEXT NOT NULL, motivo TEXT NOT NULL, il TEXT NOT NULL
)`],
];
export const INDICI_LIBRENMS_FONTE_V1: ReadonlyArray<readonly [string, string]> = [
  ["idx_librenms_apparato_ip", "CREATE INDEX idx_librenms_apparato_ip ON librenms_apparato(ip)"],
  ["idx_librenms_sensore_device", "CREATE INDEX idx_librenms_sensore_device ON librenms_sensore(librenms_device_id)"],
];
/** Segno in `tenant_settings` (`done:<data>:v<versione>`); la migrazione non lo consulta. */
export const SEGNO_LIBRENMS_FONTE = "librenms_fonte_v21";
export const VERSIONE_LIBRENMS_FONTE = 1;

/**
 * Oggetti esclusi dall'aggiunta automatica in LibreNMS (Riccardo 22/10: candidati tutti gli oggetti con SNMP verificato,
 * con un'esclusione per oggetto «Non aggiungere a LibreNMS»). Chiave l'IP come `librenms_rifiuto`: è quello che va in
 * LibreNMS, per un host e per il suo apparato. Vale solo per il giro automatico: un'aggiunta chiesta a mano passa. Nasce
 * SOLO nella migrazione (`migrateLibrenmsEsclusione`), senza `IF NOT EXISTS`; se manca il giro non aggiunge da solo
 * nessun oggetto SNMP (non può sapere chi è escluso) e lo dice nell'esito.
 */
export const DDL_LIBRENMS_ESCLUSIONE: ReadonlyArray<readonly [string, string]> = [
  ["librenms_esclusione", `CREATE TABLE librenms_esclusione (
  ip TEXT PRIMARY KEY, host_id INTEGER, network_device_id INTEGER, il TEXT NOT NULL
)`],
];
/** Segno in `tenant_settings` (`done:<data>:v<versione>`); la migrazione non lo consulta. */
export const SEGNO_LIBRENMS_ESCLUSIONE = "librenms_esclusione_v21";
export const VERSIONE_LIBRENMS_ESCLUSIONE = 1;

/** Unioni e separazioni a mano (ADR 0021): le scrivono solo le rotte /api/topology/unioni; mai cancellate (tolto_*: la storia).
 *  Membri come id della mappa, senza chiavi esterne né CHECK. Indici solo nella migrazione. */
export const DDL_TOPOLOGY_UNIONI: ReadonlyArray<readonly [string, string]> = [
  ["topology_unioni", `CREATE TABLE IF NOT EXISTS topology_unioni (
  id INTEGER PRIMARY KEY AUTOINCREMENT, gruppo INTEGER NOT NULL, membro TEXT NOT NULL,
  creato_da TEXT NOT NULL, creato_il TEXT NOT NULL DEFAULT (datetime('now')), tolto_da TEXT, tolto_il TEXT)`],
  ["topology_separazioni", `CREATE TABLE IF NOT EXISTS topology_separazioni (
  id INTEGER PRIMARY KEY AUTOINCREMENT, membro TEXT NOT NULL, altro TEXT NOT NULL,
  creato_da TEXT NOT NULL, creato_il TEXT NOT NULL DEFAULT (datetime('now')), tolto_da TEXT, tolto_il TEXT)`],
];
/** Sulle sole righe attive: un membro attivo in un gruppo solo, una coppia attiva una volta; le tolte restano accanto. */
export const INDICI_TOPOLOGY_UNIONI: ReadonlyArray<readonly [string, string]> = [
  ["idx_topology_unioni_membro_attivo", "CREATE UNIQUE INDEX idx_topology_unioni_membro_attivo ON topology_unioni(membro) WHERE tolto_il IS NULL"],
  ["idx_topology_unioni_gruppo", "CREATE INDEX idx_topology_unioni_gruppo ON topology_unioni(gruppo) WHERE tolto_il IS NULL"],
  ["idx_topology_separazioni_coppia_attiva", "CREATE UNIQUE INDEX idx_topology_separazioni_coppia_attiva ON topology_separazioni(membro, altro) WHERE tolto_il IS NULL"],
];

/** Archivio degli host tolti dalla pulizia (piano 2026-10-20, scelta A): l'istantanea JSON della riga di `hosts`, poi
 *  l'host si cancella con un DELETE diretto. Le scrive solo `hosts/pulizia-archivio.ts`; via dopo 90 giorni; una riga
 *  recuperata resta finché esiste il suo host (lo protegge dalla pulizia), poi segue i 90 giorni. Senza chiavi esterne: la riga deve sopravvivere all'host, e anche alla sua rete (il recupero lo dice).
 *  Gemella delle unioni: la tabella nasce anche dallo schema, gli indici solo nella migrazione (`migrateHostsArchivio`). */
export const DDL_HOSTS_ARCHIVIO: ReadonlyArray<readonly [string, string]> = [
  ["hosts_archivio", `CREATE TABLE IF NOT EXISTS hosts_archivio (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  host_id_originale INTEGER NOT NULL,
  network_id INTEGER NOT NULL,
  ip TEXT NOT NULL,
  mac_hex TEXT,
  nome TEXT NOT NULL,
  motivo TEXT NOT NULL CHECK(motivo IN ('assente', 'cambio_ip')),
  dettaglio TEXT,
  ultima_vista TEXT,
  istantanea TEXT NOT NULL,
  archiviato_il TEXT NOT NULL DEFAULT (datetime('now')),
  archiviato_da TEXT NOT NULL,
  recuperato_il TEXT, recuperato_da TEXT, nuovo_host_id INTEGER)`],
];
export const INDICI_HOSTS_ARCHIVIO: ReadonlyArray<readonly [string, string]> = [
  ["idx_hosts_archivio_mac", "CREATE INDEX idx_hosts_archivio_mac ON hosts_archivio(mac_hex)"],
  ["idx_hosts_archivio_il", "CREATE INDEX idx_hosts_archivio_il ON hosts_archivio(archiviato_il)"],
];

/** Ultimo esito per apparato dei job `apparati_scelti` (piano 2026-10-22 scansione automatica, Task 1): una riga per job e
 *  apparato, niente storico. `stato` (ok | parziale | errore | escluso | saltato) e `motivo` (codici: TOLTO, SENZA_CREDENZIALE,
 *  CREDENZIALE_NON_PROVATA, …) si validano nel codice, nessun CHECK: un codice nuovo non chiede una ricostruzione. Niente
 *  chiavi esterne: la v11 ricostruisce `scheduled_jobs`; le righe di un job si cancellano con il job e gli orfani a ogni giro.
 *  `giro_il` in UTC. Gemella di hosts_archivio: la tabella nasce anche dallo schema, l'indice solo nella migrazione
 *  (`migraApparatiScelti`). */
export const DDL_JOB_APPARATI_ESITI: ReadonlyArray<readonly [string, string]> = [
  ["job_apparati_esiti", `CREATE TABLE IF NOT EXISTS job_apparati_esiti (
  job_id INTEGER NOT NULL,
  device_id INTEGER NOT NULL,
  giro_il TEXT NOT NULL,
  stato TEXT NOT NULL,
  letture TEXT NOT NULL DEFAULT '{}',
  motivo TEXT,
  PRIMARY KEY (job_id, device_id))`],
];
export const INDICI_JOB_APPARATI_ESITI: ReadonlyArray<readonly [string, string]> = [
  ["idx_job_apparati_esiti_device", "CREATE INDEX idx_job_apparati_esiti_device ON job_apparati_esiti(device_id)"],
];
export const SEGNO_APPARATI_SCELTI = "apparati_scelti_v21";
export const VERSIONE_APPARATI_SCELTI = 1;

/**
 * Coda degli invii verso l'hub DA-Vul-can (piano 2026-10-22 invio AD e inventario, Task 2; modello `upload_queue.py`
 * della sonda). Dati del cliente che escono → DB del tenant. Una riga per invio (AD Health di un run, fotografia
 * dell'inventario); `corpo_gz` è il JSON gzip e si svuota quando la riga esce dalla coda (inviato, scartato, superato).
 * `sha256` del JSON non compresso (lo stesso che calcola l'hub per il doppione). `esito_il` è l'ora dell'ultimo esito
 * (aggiunta al DDL del piano: serve a «ultimo errore» e ai 90 giorni di pulizia). Date nella forma di SQLite, confrontate
 * come stringhe con `datetime('now')`. `vulcan_stato` è la riga unica del flusso: battito, ping, sospensione per
 * l'impronta di un gettone (mai il gettone). Tutto nasce SOLO nella migrazione (`migrateVulcanCoda`), senza
 * `IF NOT EXISTS`: un oggetto omonimo fa fallire la migrazione invece di passare muto. Fuori dal trasferimento
 * (EXCLUDED_TENANT_TABLES): la coda e la sospensione valgono per questa istanza e il suo gettone, e la coda
 * contiene i dati del cliente non ancora inviati.
 */
export const DDL_VULCAN: ReadonlyArray<readonly [string, string]> = [
  ["vulcan_coda", `CREATE TABLE vulcan_coda (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL CHECK (tipo IN ('ad-health', 'inventario')),
  rif TEXT,
  corpo_gz BLOB NOT NULL,
  byte_json INTEGER NOT NULL,
  oggetti INTEGER,
  sha256 TEXT NOT NULL,
  stato TEXT NOT NULL DEFAULT 'in_attesa'
    CHECK (stato IN ('in_attesa', 'inviato', 'scartato', 'fallito', 'superato')),
  tentativi INTEGER NOT NULL DEFAULT 0,
  prossimo_tentativo TEXT NOT NULL DEFAULT (datetime('now')),
  preso_fino TEXT,
  ultimo_esito TEXT,
  ultimo_errore TEXT,
  esito_il TEXT,
  risposta_id TEXT,
  creato_il TEXT NOT NULL DEFAULT (datetime('now')),
  inviato_il TEXT,
  UNIQUE (tipo, sha256)
)`],
  ["vulcan_stato", `CREATE TABLE vulcan_stato (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  battito_il TEXT, battito_esito TEXT, battito_dettaglio TEXT,
  ping_il TEXT, ping_esito TEXT, ping_dettaglio TEXT,
  sospeso_gettone TEXT,
  sospeso_motivo TEXT,
  aggiornato_il TEXT NOT NULL DEFAULT (datetime('now'))
)`],
];
export const INDICI_VULCAN: ReadonlyArray<readonly [string, string]> = [
  ["idx_vulcan_coda_attesa", "CREATE INDEX idx_vulcan_coda_attesa ON vulcan_coda(stato, prossimo_tentativo)"],
];
/** Segno in `tenant_settings` (`done:<data>:v<versione>`); la migrazione non lo consulta. */
export const SEGNO_VULCAN = "vulcan_coda_v21";
export const VERSIONE_VULCAN = 1;

/**
 * Assegnatari NIS2 da AD e utente prevalente dei PC (piano 2026-10-23-assegnatari-da-ad, passo 1).
 *
 * - `asset_assignees`: il legame con l'utente AD (integrazione + objectGUID, unico), nome e cognome separati, reparto,
 *   ruolo, cellulare, origine (`manuale` | `ad`), stato in AD e il giorno in cui è risultato disattivato la prima volta;
 * - `ad_users`: gli attributi in più letti dalla sync (givenName, sn, mobile, company, manager, employeeID, ufficio);
 * - `inventory_assets.proposta_assegnatario_off`: «PC condiviso, non proporre» (tavola ⑬);
 * - `host_accessi_utente`: chi si è collegato a un host, un conteggio per account, fonte e giorno. La scrive il giro
 *   orario `assegnatari/job.ts` (Wazuh, WinRM) e l'ingresso dell'agente GLPI; la pulizia a 90 giorni sta nel giro.
 *
 * Tutto additivo e solo nella migrazione (`migrateAssegnatariAd`), come le tabelle della coda qui sopra.
 */
export const COLONNE_ASSEGNATARI_AD: ReadonlyArray<readonly [tabella: string, colonna: string, ddl: string]> = [
  ["asset_assignees", "ad_integration_id", "INTEGER REFERENCES ad_integrations(id) ON DELETE SET NULL"],
  ["asset_assignees", "ad_object_guid", "TEXT"],
  ["asset_assignees", "nome", "TEXT"],
  ["asset_assignees", "cognome", "TEXT"],
  ["asset_assignees", "reparto", "TEXT"],
  ["asset_assignees", "ruolo", "TEXT"],
  ["asset_assignees", "cellulare", "TEXT"],
  ["asset_assignees", "origine", "TEXT NOT NULL DEFAULT 'manuale'"],
  ["asset_assignees", "ad_abilitato", "INTEGER"],
  ["asset_assignees", "ad_disattivato_il", "TEXT"],
  ["ad_users", "given_name", "TEXT"],
  ["ad_users", "surname", "TEXT"],
  ["ad_users", "mobile", "TEXT"],
  ["ad_users", "company", "TEXT"],
  ["ad_users", "manager_dn", "TEXT"],
  ["ad_users", "employee_id", "TEXT"],
  ["ad_users", "office", "TEXT"],
  ["inventory_assets", "proposta_assegnatario_off", "INTEGER NOT NULL DEFAULT 0"],
];
export const DDL_ASSEGNATARI_AD: ReadonlyArray<readonly [string, string]> = [
  ["host_accessi_utente", `CREATE TABLE host_accessi_utente (
  host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  account TEXT NOT NULL,
  fonte TEXT NOT NULL CHECK (fonte IN ('wazuh_tastiera', 'wazuh_rete', 'winrm', 'glpi')),
  giorno TEXT NOT NULL,
  conteggio INTEGER NOT NULL DEFAULT 0,
  ultimo TEXT,
  PRIMARY KEY (host_id, account, fonte, giorno)
)`],
];
export const INDICI_ASSEGNATARI_AD: ReadonlyArray<readonly [string, string]> = [
  ["idx_asset_assignees_ad_guid", "CREATE UNIQUE INDEX idx_asset_assignees_ad_guid ON asset_assignees(ad_integration_id, ad_object_guid) WHERE ad_object_guid IS NOT NULL"],
  ["idx_host_accessi_utente_account", "CREATE INDEX idx_host_accessi_utente_account ON host_accessi_utente(account, giorno)"],
  ["idx_host_accessi_utente_giorno", "CREATE INDEX idx_host_accessi_utente_giorno ON host_accessi_utente(giorno)"],
];
export const SEGNO_ASSEGNATARI_AD = "assegnatari_ad_v21";
export const VERSIONE_ASSEGNATARI_AD = 1;

/**
 * da-vault (piano 2026-10-23):
 * - `credentials.credential_ref` (passo 6): il percorso del segreto in OpenBao (`clienti/<codcli>/…`), accanto alle
 *   colonne cifrate. Si legge solo con `DA_VAULT_OPENBAO=1`; NULL = la voce si legge dalle colonne (doppia lettura);
 * - `vault_visualizzazioni` (passo 10): chi ha visto una password o esportato l'archivio, e quando. Niente chiave
 *   esterna sulla credenziale: il registro resta anche se la voce si elimina (col nome di allora).
 *
 * Tutto additivo e solo nella migrazione (`migrateVault`), come gli assegnatari qui sopra.
 */
export const COLONNE_VAULT: ReadonlyArray<readonly [tabella: string, colonna: string, ddl: string]> = [
  ["credentials", "credential_ref", "TEXT"],
];
export const DDL_VAULT: ReadonlyArray<readonly [string, string]> = [
  ["vault_visualizzazioni", `CREATE TABLE vault_visualizzazioni (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  utente_id TEXT,
  utente TEXT NOT NULL,
  azione TEXT NOT NULL,
  credential_id INTEGER,
  credenziale TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`],
];
export const INDICI_VAULT: ReadonlyArray<readonly [string, string]> = [
  ["idx_vault_visualizzazioni_data", "CREATE INDEX idx_vault_visualizzazioni_data ON vault_visualizzazioni(created_at)"],
];
export const SEGNO_VAULT = "vault_v21";
export const VERSIONE_VAULT = 1;

/**
 * Pannello Zabbix in sola lettura (passo 7.4-7.5 del piano di solidità, 16/10; API del centro in DA-Zabbix,
 * `docs/2026-10-16-api-lettura-per-cliente-design.md`). Dati del cliente → DB del tenant.
 *
 * - `zabbix_lettura_config`: riga unica. Indirizzo del centro, chiave di lettura cifrata (`zl1.<id>.<segreto>`:
 *   `chiave_id` è la sola parte pubblica), impronta TLS facoltativa, codice cliente atteso nelle risposte, nome del
 *   proxy della macchina (facoltativo: se vuoto si legge `Hostname=` dal file del proxy), interruttore, e lo stato
 *   dei tentativi (fallimenti consecutivi, prossimo tentativo, ultimo errore, ultima lettura buona) che regge
 *   l'attesa crescente anche dopo un riavvio.
 * - `zabbix_abbinamenti`: solo gli abbinamenti **verificati** da una persona (§5 dell'API). `host_id` senza chiave
 *   esterna: un host tolto da DA-IPAM lascia una riga orfana che la lettura ignora (JOIN), e una ricostruzione di
 *   `hosts` non la cancella a cascata. Proposti, ambigui e persi si calcolano a ogni lettura e non si salvano.
 *
 * Tabelle nuove con `CREATE TABLE IF NOT EXISTS` dentro `TENANT_SCHEMA_SQL`, che gira a ogni apertura: sui DB
 * esistenti nascono alla prima apertura dopo l'aggiornamento. `assicuraTabelleZabbixLettura` rifà le stesse CREATE
 * (ripetibile) per chi apre un DB senza passare da `getTenantDb` (prove).
 */
export const DDL_ZABBIX_LETTURA: ReadonlyArray<readonly [string, string]> = [
  ["zabbix_lettura_config", `CREATE TABLE IF NOT EXISTS zabbix_lettura_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  base_url TEXT NOT NULL,
  chiave_enc TEXT NOT NULL,
  chiave_id TEXT NOT NULL,
  impronta TEXT,
  codcli TEXT NOT NULL,
  proxy_locale TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  fallimenti INTEGER NOT NULL DEFAULT 0,
  prossimo_tentativo TEXT,
  ultimo_errore TEXT,
  ultima_lettura_ok TEXT,
  aggiornato_il TEXT NOT NULL DEFAULT (datetime('now')),
  aggiornato_da TEXT
)`],
  ["zabbix_abbinamenti", `CREATE TABLE IF NOT EXISTS zabbix_abbinamenti (
  hostid TEXT PRIMARY KEY,
  host_id INTEGER NOT NULL,
  ip TEXT NOT NULL,
  confermato_da TEXT NOT NULL,
  confermato_il TEXT NOT NULL DEFAULT (datetime('now'))
)`],
  ["idx_zabbix_abbinamenti_host", "CREATE INDEX IF NOT EXISTS idx_zabbix_abbinamenti_host ON zabbix_abbinamenti(host_id)"],
];

/** Crea le tabelle del pannello Zabbix se mancano. Ripetibile, solo additiva. */
export function assicuraTabelleZabbixLettura(db: Database.Database): void {
  for (const [, ddl] of DDL_ZABBIX_LETTURA) db.exec(ddl);
}

/**
 * Acquisizione modulare (collector JSON 1.0, piano 2026-10-21 §5 C1-C2; schema in
 * `docs/proposte/2026-10-22-collector-snapshot-schema.md`, adattato alla decisione 4 della tavola C1). Dati del
 * cliente → DB del tenant. Nessuna colonna su `network_devices` (si ricostruisce da `sqlite_master`).
 *
 * - `acquisition_snapshots`: gli snapshot letti, immutabili (solo INSERT e la cancellazione della retention D5),
 *   JSON gzip già ripulito dei segreti. `credenziali` = i NOMI delle voci usate per protocollo, mai segreti.
 * - `acquisition_source_choices`: solo la scelta fatta nel caso dubbio (due collector possibili, o nessuna
 *   credenziale compatibile). La fonte si ricava da sola dal prodotto e dalle credenziali assegnate; questa riga
 *   c'è solo dove una persona ha deciso. `scelta` = id del catalogo oppure `classica` (acquisizione di sempre).
 * - `acquisition_changes`: cosa ha cambiato nell'apparato ciascuno snapshot (campo, prima, dopo, esito); va via
 *   con lo snapshot.
 *
 * Niente CHECK sui valori (collector, stato, esito): un valore nuovo non deve chiedere una ricostruzione. Le stesse
 * CREATE stanno dentro `TENANT_SCHEMA_SQL`, che gira a ogni apertura; `assicuraTabelleAcquisizioneModulare` le rifà
 * per chi apre un DB senza `getTenantDb` (prove).
 */
export const DDL_ACQUISIZIONE_MODULARE: ReadonlyArray<readonly [string, string]> = [
  ["acquisition_snapshots", `CREATE TABLE IF NOT EXISTS acquisition_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id INTEGER NOT NULL REFERENCES network_devices(id) ON DELETE CASCADE,
  collector TEXT NOT NULL,
  collector_version TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  status TEXT NOT NULL,
  section_status TEXT NOT NULL,
  warning_count INTEGER NOT NULL DEFAULT 0,
  credenziali TEXT NOT NULL DEFAULT '{}',
  requested_by INTEGER,
  requested_by_name TEXT,
  trigger TEXT NOT NULL DEFAULT 'manual',
  payload BLOB NOT NULL,
  payload_bytes INTEGER NOT NULL,
  payload_gzip_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`],
  ["idx_acq_snap_device_time", "CREATE INDEX IF NOT EXISTS idx_acq_snap_device_time ON acquisition_snapshots(device_id, finished_at DESC, id DESC)"],
  ["acquisition_source_choices", `CREATE TABLE IF NOT EXISTS acquisition_source_choices (
  device_id INTEGER PRIMARY KEY REFERENCES network_devices(id) ON DELETE CASCADE,
  scelta TEXT NOT NULL,
  chosen_by INTEGER,
  chosen_by_name TEXT,
  chosen_at TEXT NOT NULL DEFAULT (datetime('now'))
)`],
  ["acquisition_changes", `CREATE TABLE IF NOT EXISTS acquisition_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_id INTEGER NOT NULL REFERENCES acquisition_snapshots(id) ON DELETE CASCADE,
  device_id INTEGER NOT NULL REFERENCES network_devices(id) ON DELETE CASCADE,
  destinazione TEXT NOT NULL,
  chiave TEXT NOT NULL,
  campo TEXT NOT NULL,
  prima TEXT,
  dopo TEXT,
  esito TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`],
  ["idx_acq_changes_snapshot", "CREATE INDEX IF NOT EXISTS idx_acq_changes_snapshot ON acquisition_changes(snapshot_id, id)"],
];

/** Crea le tabelle dell'acquisizione modulare se mancano. Ripetibile, solo additiva. */
export function assicuraTabelleAcquisizioneModulare(db: Database.Database): void {
  for (const [, ddl] of DDL_ACQUISIZIONE_MODULARE) db.exec(ddl);
}

export const TENANT_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS networks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cidr TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  gateway TEXT,
  vlan_id INTEGER,
  location TEXT DEFAULT '',
  snmp_community TEXT,
  dns_server TEXT,
  targeting_mode TEXT DEFAULT 'full_subnet',
  assessment_enabled INTEGER NOT NULL DEFAULT 0,
  assessment_profile_id TEXT,
  probes_enabled INTEGER DEFAULT 1,
  location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
  location_set_by TEXT,
  location_set_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS hosts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  network_id INTEGER NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  ip TEXT NOT NULL,
  mac TEXT,
  vendor TEXT,
  hostname TEXT,
  dns_forward TEXT,
  dns_reverse TEXT,
  custom_name TEXT,
  classification TEXT DEFAULT 'unknown',
  server_roles TEXT,
  inventory_code TEXT,
  notes TEXT DEFAULT '',
  status TEXT DEFAULT 'unknown' CHECK(status IN ('online', 'offline', 'unknown')),
  open_ports TEXT,
  os_info TEXT,
  model TEXT,
  serial_number TEXT,
  firmware TEXT,
  device_manufacturer TEXT,
  detection_json TEXT,
  snmp_data TEXT,
  known_host INTEGER DEFAULT 0,
  classification_manual INTEGER DEFAULT 0,
  classification_reason TEXT,
  classification_json TEXT,
  last_response_time_ms INTEGER,
  monitor_ports TEXT,
  hostname_source TEXT,
  conflict_flags TEXT,
  ip_assignment TEXT DEFAULT 'unknown',
  last_seen TEXT,
  first_seen TEXT,
  physical_device_id INTEGER REFERENCES physical_devices(id) ON DELETE SET NULL,
  host_source TEXT DEFAULT 'scan',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  -- Famiglia OS derivata da os_info via keyword matching (Windows/Linux/Apple/Unknown).
  -- GENERATED VIRTUAL: si auto-aggiorna quando os_info cambia; indicizzata per
  -- filtri rapidi su /software e /vulnerabilities. Nessun trigger da mantenere.
  os_family TEXT GENERATED ALWAYS AS (
    CASE
      WHEN os_info IS NULL OR TRIM(os_info) = '' THEN 'Unknown'
      WHEN LOWER(os_info) LIKE '%windows%' THEN 'Windows'
      WHEN LOWER(os_info) LIKE '%android%' THEN 'Android'
      WHEN LOWER(os_info) LIKE 'ios%' OR LOWER(os_info) LIKE '%ipados%'
        OR LOWER(os_info) LIKE '%iphone%' OR LOWER(os_info) LIKE '%ipad%' THEN 'iOS'
      WHEN LOWER(os_info) LIKE '%macos%' OR LOWER(os_info) LIKE '%mac os%'
        OR LOWER(os_info) LIKE '%darwin%' OR LOWER(os_info) LIKE '%osx%' THEN 'Apple'
      WHEN LOWER(os_info) LIKE '%linux%' OR LOWER(os_info) LIKE '%ubuntu%'
        OR LOWER(os_info) LIKE '%debian%' OR LOWER(os_info) LIKE '%centos%'
        OR LOWER(os_info) LIKE '%rhel%' OR LOWER(os_info) LIKE '%red hat%'
        OR LOWER(os_info) LIKE '%fedora%' OR LOWER(os_info) LIKE '%alpine%'
        OR LOWER(os_info) LIKE '%suse%' OR LOWER(os_info) LIKE '%arch%'
        OR LOWER(os_info) LIKE '%rocky%' OR LOWER(os_info) LIKE '%almalinux%' THEN 'Linux'
      ELSE 'Unknown'
    END
  ) VIRTUAL,
  UNIQUE(network_id, ip)
);

CREATE TABLE IF NOT EXISTS scan_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  host_id INTEGER REFERENCES hosts(id) ON DELETE CASCADE,
  network_id INTEGER REFERENCES networks(id) ON DELETE CASCADE,
  scan_type TEXT NOT NULL CHECK(scan_type IN ('ping', 'snmp', 'nmap', 'arp', 'dns', 'windows', 'ssh', 'network_discovery', 'credential_validate', 'fast', 'ipam_full', 'scan_icmp', 'scan_nmap_base', 'scan_snmp_verify', 'scan_naabu', 'scan_enrich')),
  status TEXT NOT NULL,
  ports_open TEXT,
  raw_output TEXT,
  duration_ms INTEGER,
  timestamp TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('online', 'offline')),
  response_time_ms INTEGER,
  checked_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS host_classification_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  classification TEXT,
  confidence INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  evidence_json TEXT,
  conflicts_json TEXT,
  attr_vendor TEXT,
  attr_category TEXT,
  attr_os TEXT,
  trigger TEXT NOT NULL CHECK(trigger IN ('scan','apply','manual','backfill'))
);
CREATE INDEX IF NOT EXISTS idx_host_class_hist_host ON host_classification_history(host_id, at DESC);

CREATE TABLE IF NOT EXISTS credentials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  -- Tappa 2c credenziali (ADR 0017): niente CHECK sul tipo. I tipi validi
  -- stanno in src/lib/credentials/tipi.ts e li controlla il CRUD: un tipo nuovo
  -- non chiede di ricostruire la tabella più referenziata del tenant.
  credential_type TEXT NOT NULL,
  -- Metodo d'accesso (tipi.ts, METODI_PER_TIPO); NULL = il primo del tipo.
  auth_method TEXT,
  encrypted_username TEXT,
  encrypted_password TEXT,
  -- Chiave SSH (metodo «chiave») e la sua passphrase, facoltativa.
  encrypted_private_key TEXT,
  encrypted_key_passphrase TEXT,
  -- SNMPv3 completo (Fase 4b Task 2, §7.1): niente CHECK sui protocolli (non
  -- estendibili senza migrazione, vedi ADR pattern rebuild) — validati in
  -- TypeScript da buildV3Options (src/lib/protocols/snmpv3.ts).
  encrypted_auth_key TEXT,
  auth_protocol TEXT,
  encrypted_priv_key TEXT,
  priv_protocol TEXT,
  security_level TEXT,
  -- Porta propria (tappa 1 credenziali, 15/10): NULL = porta standard del
  -- protocollo (DEFAULT_PORTS in src/lib/credentials/resolve.ts).
  port INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS network_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  host TEXT NOT NULL,
  device_type TEXT NOT NULL CHECK(device_type IN ('router', 'switch', 'firewall', 'hypervisor', 'access_point', 'nas', 'server')),
  vendor TEXT NOT NULL CHECK(vendor IN ('mikrotik', 'ubiquiti', 'hp', 'cisco', 'omada', 'stormshield', 'proxmox', 'vmware', 'linux', 'windows', 'synology', 'qnap', 'other', 'apple')),
  vendor_subtype TEXT CHECK(vendor_subtype IN ('procurve', 'comware')),
  protocol TEXT NOT NULL CHECK(protocol IN ('ssh', 'snmp_v2', 'snmp_v3', 'api', 'winrm')),
  credential_id INTEGER REFERENCES credentials(id) ON DELETE SET NULL,
  snmp_credential_id INTEGER REFERENCES credentials(id) ON DELETE SET NULL,
  username TEXT,
  encrypted_password TEXT,
  community_string TEXT,
  api_token TEXT,
  api_url TEXT,
  port INTEGER DEFAULT 22,
  enabled INTEGER DEFAULT 1,
  classification TEXT,
  server_roles TEXT,
  -- 1 = classificazione scelta a mano: scansioni e attribuzione non la toccano (tappa 5, 21/10).
  classification_manual INTEGER NOT NULL DEFAULT 0,
  sysname TEXT,
  sysdescr TEXT,
  model TEXT,
  firmware TEXT,
  serial_number TEXT,
  part_number TEXT,
  last_info_update TEXT,
  last_device_info_json TEXT,
  stp_info TEXT,
  last_proxmox_scan_at TEXT,
  last_proxmox_scan_result TEXT,
  scan_target TEXT CHECK(scan_target IN ('proxmox', 'vmware', 'windows', 'linux', 'macos')),
  product_profile TEXT,
  use_for_arp_poll INTEGER NOT NULL DEFAULT 0,
  physical_device_id INTEGER REFERENCES physical_devices(id) ON DELETE SET NULL,
  location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
  location_set_by TEXT,
  location_set_at TEXT,
  topology_role TEXT,
  topology_hidden INTEGER NOT NULL DEFAULT 0,
  controller_mac TEXT,
  uplink_mac TEXT,
  uplink_remote_port INTEGER,
  uplink_seen_at TEXT,
  -- Versione SNMP a community ('1' | '2c'). NULL = non rilevata: ogni punto parla come prima
  -- (src/lib/protocols/snmp-sessione.ts). snmp_version_fissata = 1: scelta a mano, la discovery non la tocca.
  snmp_version TEXT CHECK(snmp_version IN ('1', '2c')),
  snmp_version_fissata INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Identità fisica di un device. Aggrega N network_devices/hosts visibili in subnet diverse
-- ma che rappresentano lo stesso chassis. Anchor: serial_number > primary_mac > sys_object_id+sysname > sysname.
CREATE TABLE IF NOT EXISTS physical_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor TEXT,
  model TEXT,
  serial_number TEXT,
  primary_mac TEXT,
  sys_object_id TEXT,
  sysname TEXT,
  manufacturer TEXT,
  identity_confidence INTEGER NOT NULL DEFAULT 0,
  identity_anchor TEXT,
  first_seen TEXT DEFAULT (datetime('now')),
  last_seen TEXT DEFAULT (datetime('now')),
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_physical_devices_serial ON physical_devices(serial_number) WHERE serial_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_physical_devices_mac ON physical_devices(primary_mac) WHERE primary_mac IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_physical_devices_sysname ON physical_devices(sysname) WHERE sysname IS NOT NULL;

-- Interfacce fisiche/logiche di un physical_device. MAC è il discriminante principale.
-- is_virtual_mac=1 per VRRP/HSRP/CARP (00:00:5E:00:01:xx, etc) — escluso dal matching identità.
CREATE TABLE IF NOT EXISTS device_interfaces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  physical_device_id INTEGER NOT NULL REFERENCES physical_devices(id) ON DELETE CASCADE,
  ifname TEXT NOT NULL,
  ifindex INTEGER,
  mac TEXT,
  status TEXT CHECK(status IN ('up','down','unknown')) DEFAULT 'unknown',
  speed_mbps INTEGER,
  type TEXT,
  is_virtual_mac INTEGER NOT NULL DEFAULT 0,
  alias TEXT,
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(physical_device_id, ifname)
);
CREATE INDEX IF NOT EXISTS idx_device_interfaces_device ON device_interfaces(physical_device_id);
CREATE INDEX IF NOT EXISTS idx_device_interfaces_mac ON device_interfaces(mac) WHERE mac IS NOT NULL;

-- IP assegnati a un'interfaccia. IPv4+IPv6 (family). scope per scartare link-local/host dal multihomed.
CREATE TABLE IF NOT EXISTS device_interface_addresses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  interface_id INTEGER NOT NULL REFERENCES device_interfaces(id) ON DELETE CASCADE,
  ip TEXT NOT NULL,
  prefix INTEGER,
  family INTEGER NOT NULL DEFAULT 4 CHECK(family IN (4,6)),
  scope TEXT CHECK(scope IN ('global','link','host','unknown')) DEFAULT 'global',
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(interface_id, ip)
);
CREATE INDEX IF NOT EXISTS idx_device_interface_addresses_iface ON device_interface_addresses(interface_id);
CREATE INDEX IF NOT EXISTS idx_device_interface_addresses_ip ON device_interface_addresses(ip);

CREATE TABLE IF NOT EXISTS network_router (
  network_id INTEGER NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  router_id INTEGER NOT NULL REFERENCES network_devices(id) ON DELETE CASCADE,
  PRIMARY KEY (network_id)
);

CREATE TABLE IF NOT EXISTS arp_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id INTEGER NOT NULL REFERENCES network_devices(id) ON DELETE CASCADE,
  host_id INTEGER REFERENCES hosts(id) ON DELETE SET NULL,
  mac TEXT NOT NULL,
  ip TEXT,
  interface_name TEXT,
  timestamp TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mac_port_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id INTEGER NOT NULL REFERENCES network_devices(id) ON DELETE CASCADE,
  mac TEXT NOT NULL,
  port_name TEXT NOT NULL,
  vlan INTEGER,
  port_status TEXT CHECK(port_status IN ('up', 'down')),
  speed TEXT,
  timestamp TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS switch_ports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id INTEGER NOT NULL REFERENCES network_devices(id) ON DELETE CASCADE,
  port_index INTEGER NOT NULL,
  port_name TEXT NOT NULL,
  status TEXT CHECK(status IN ('up', 'down', 'disabled')),
  speed TEXT,
  duplex TEXT,
  vlan INTEGER,
  poe_status TEXT,
  poe_power_mw INTEGER,
  mac_count INTEGER DEFAULT 0,
  is_trunk INTEGER DEFAULT 0,
  single_mac TEXT,
  single_mac_vendor TEXT,
  single_mac_ip TEXT,
  single_mac_hostname TEXT,
  host_id INTEGER REFERENCES hosts(id) ON DELETE SET NULL,
  trunk_neighbor_name TEXT,
  trunk_neighbor_port TEXT,
  trunk_primary_device_id INTEGER REFERENCES network_devices(id) ON DELETE SET NULL,
  trunk_primary_name TEXT,
  stp_state TEXT,
  is_uplink INTEGER NOT NULL DEFAULT 0,
  timestamp TEXT DEFAULT (datetime('now')),
  UNIQUE(device_id, port_index)
);

CREATE TABLE IF NOT EXISTS scheduled_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  network_id INTEGER REFERENCES networks(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL CHECK(${SCHEDULED_JOB_TYPES_CHECK_SQL}),
  interval_minutes INTEGER NOT NULL DEFAULT 60,
  last_run TEXT,
  next_run TEXT,
  enabled INTEGER DEFAULT 1,
  config TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mac_ip_mapping (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mac_normalized TEXT NOT NULL UNIQUE,
  mac_display TEXT NOT NULL,
  ip TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('arp', 'dhcp', 'host', 'switch')),
  source_device_id INTEGER REFERENCES network_devices(id) ON DELETE SET NULL,
  network_id INTEGER REFERENCES networks(id) ON DELETE SET NULL,
  host_id INTEGER REFERENCES hosts(id) ON DELETE SET NULL,
  vendor TEXT,
  hostname TEXT,
  first_seen TEXT DEFAULT (datetime('now')),
  last_seen TEXT DEFAULT (datetime('now')),
  previous_ip TEXT
);

-- Sensore trunk (2026-10-24): copia di quanto il sensore vede sulla porta trunk
-- (VLAN, MAC, IP, nome). Si riempie solo con tenant_settings.trunk_lettura = '1'.
CREATE TABLE IF NOT EXISTS trunk_osservazioni (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vid INTEGER NOT NULL,
  mac_normalized TEXT NOT NULL,
  mac_display TEXT NOT NULL,
  ip TEXT NOT NULL DEFAULT '',
  nome TEXT,
  fonte_nome TEXT,
  protocolli TEXT,
  passivo INTEGER NOT NULL DEFAULT 0,
  attivo INTEGER NOT NULL DEFAULT 0,
  prima_vista TEXT NOT NULL,
  ultima_vista TEXT NOT NULL,
  UNIQUE(vid, mac_normalized, ip)
);

CREATE TABLE IF NOT EXISTS trunk_vlan (
  vid INTEGER PRIMARY KEY,
  vista INTEGER NOT NULL DEFAULT 0,
  dichiarata INTEGER NOT NULL DEFAULT 0,
  mac INTEGER NOT NULL DEFAULT 0,
  reti TEXT NOT NULL DEFAULT '[]',
  server_dhcp TEXT NOT NULL DEFAULT '[]',
  ultima_vista TEXT,
  aggiornato TEXT NOT NULL
);

-- Apparati di rete che si annunciano sul trunk con CDP o LLDP (25/10), copiati da /vicini del sensore.
CREATE TABLE IF NOT EXISTS trunk_vicini (
  protocollo TEXT NOT NULL,
  sistema TEXT NOT NULL,
  porta TEXT NOT NULL,
  vid INTEGER NOT NULL DEFAULT 0,
  indirizzo TEXT,
  vlan_nativa INTEGER,
  ultima_vista TEXT NOT NULL,
  PRIMARY KEY (protocollo, sistema, porta)
);

-- Rilievi di sicurezza della rete osservata (25/10): allarmi, esposizioni e novità calcolati da DA-IPAM
-- sui fatti del sensore. Una riga per chiave (tipo + oggetto): si aggiorna a ogni lettura, si chiude
-- (chiuso_il) quando la condizione sparisce, «preso in carico» resta. La colonna fonte lascia la porta aperta
-- a una sonda con porta specchio. Nessun CHECK: i valori li valida TypeScript (trunk/rilievi.ts).
CREATE TABLE IF NOT EXISTS rete_rilievi (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chiave TEXT NOT NULL UNIQUE,
  fonte TEXT NOT NULL DEFAULT 'sensore-trunk',
  tipo TEXT NOT NULL,
  categoria TEXT NOT NULL,
  gravita TEXT NOT NULL,
  vid INTEGER,
  mac TEXT,
  ip TEXT,
  descrizione TEXT NOT NULL,
  dettaglio TEXT,
  prima_vista TEXT,
  ultima_vista TEXT,
  rilevato_il TEXT NOT NULL,
  aggiornato_il TEXT NOT NULL,
  chiuso_il TEXT,
  preso_in_carico INTEGER NOT NULL DEFAULT 0,
  preso_da TEXT,
  preso_il TEXT
);
CREATE INDEX IF NOT EXISTS idx_rete_rilievi_aperti ON rete_rilievi(chiuso_il, categoria, gravita);
CREATE INDEX IF NOT EXISTS idx_rete_rilievi_mac ON rete_rilievi(mac);

CREATE TABLE IF NOT EXISTS mac_ip_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mac_normalized TEXT NOT NULL,
  ip TEXT NOT NULL,
  source TEXT NOT NULL,
  changed_at TEXT DEFAULT (datetime('now'))
);

-- Le catene vecchie (network_host_credentials, host_detect_credential) non
-- nascono più dalla 2g credenziali (T27): nei DB di prima le toglie
-- scripts/credenziali/pulizia-t2.ts, con backup e conferma; un bundle di prima
-- le porta in tabelle temporanee (converti-catene.ts, conCateneDelBundle).

-- CREDENTIAL SYSTEM v2: subnet-first, lista unificata
CREATE TABLE IF NOT EXISTS network_credentials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  network_id INTEGER NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  credential_id INTEGER NOT NULL REFERENCES credentials(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(network_id, credential_id)
);

CREATE TABLE IF NOT EXISTS host_credentials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  credential_id INTEGER NOT NULL REFERENCES credentials(id) ON DELETE CASCADE,
  protocol_type TEXT NOT NULL CHECK(protocol_type IN ('ssh', 'snmp', 'winrm', 'api', 'redfish', 'onvif')),
  port INTEGER NOT NULL,
  validated INTEGER NOT NULL DEFAULT 0,
  validated_at TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  auto_detected INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  -- Stato fallimenti/backoff (fase 1b credenziali, §7.5). fail_count/backoff_until
  -- azzerati da recordCredentialSuccess, incrementati da recordCredentialFailure
  -- (backoff esponenziale: min(2^fail_count * 5min, 24h)). last_attempt_at e
  -- backoff_until sono ISO-8601 UTC (new Date().toISOString(), NON datetime('now')
  -- SQLite) — stesso invariante di attribution_evidence.expires_at, vedi
  -- normalizeExpiresAt in src/lib/attribution/evidence.ts.
  fail_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  last_attempt_at TEXT,
  backoff_until TEXT,
  UNIQUE(host_id, credential_id, protocol_type, port)
);

-- Dispositivi multi-homed
-- is_primary: per ogni group_id esattamente UN record ha is_primary=1; sugli altri
-- vengono saltate le scan costose (SNMP query, test cred, software inventory) per
-- evitare di interrogare 5 volte lo stesso device fisico tramite IP differenti.
-- Auto-pick: vedi recomputeMultihomedLinks() in db-tenant.ts.
CREATE TABLE IF NOT EXISTS multihomed_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id TEXT NOT NULL,
  host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  -- v0.2.639 audit B8: aggiunto 'physical_device'. Workaround precedente
  -- usava 'serial_number' con match_value="physical_device:<id>" e impediva
  -- una statistica per anchor type pulita.
  match_type TEXT NOT NULL CHECK(match_type IN ('serial_number', 'sysname', 'hostname', 'ad_dns', 'physical_device')),
  match_value TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(host_id)
);

-- Device credential bindings (sistema tabellare multi-credenziale)
CREATE TABLE IF NOT EXISTS device_credential_bindings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id INTEGER NOT NULL REFERENCES network_devices(id) ON DELETE CASCADE,
  credential_id INTEGER REFERENCES credentials(id) ON DELETE CASCADE,
  protocol_type TEXT NOT NULL CHECK(protocol_type IN ('ssh', 'snmp', 'winrm', 'api', 'redfish', 'onvif')),
  port INTEGER NOT NULL DEFAULT 22,
  sort_order INTEGER NOT NULL DEFAULT 0,
  inline_username TEXT,
  inline_encrypted_password TEXT,
  test_status TEXT NOT NULL DEFAULT 'untested' CHECK(test_status IN ('success', 'failed', 'untested')),
  test_message TEXT,
  tested_at TEXT,
  auto_detected INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(device_id, credential_id, protocol_type, port)
);

-- Assegnatari asset
CREATE TABLE IF NOT EXISTS asset_assignees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  note TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Ubicazioni
CREATE TABLE IF NOT EXISTS locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  parent_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
  address TEXT,
  head_device_id INTEGER REFERENCES network_devices(id) ON DELETE SET NULL,
  head_set_by TEXT,
  head_set_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Inventario asset
CREATE TABLE IF NOT EXISTS inventory_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id TEXT UNIQUE,
  asset_tag TEXT,
  serial_number TEXT,
  network_device_id INTEGER REFERENCES network_devices(id) ON DELETE SET NULL,
  host_id INTEGER REFERENCES hosts(id) ON DELETE SET NULL,
  hostname TEXT,
  nome_prodotto TEXT,
  categoria TEXT CHECK(categoria IN ('Desktop', 'Laptop', 'Server', 'Switch', 'Firewall', 'NAS', 'Stampante', 'VM', 'Licenza', 'Access Point', 'Router', 'Other') OR categoria IS NULL),
  marca TEXT,
  modello TEXT,
  part_number TEXT,
  sede TEXT,
  reparto TEXT,
  utente_assegnatario_id INTEGER,
  asset_assignee_id INTEGER REFERENCES asset_assignees(id) ON DELETE SET NULL,
  location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
  posizione_fisica TEXT,
  data_assegnazione TEXT,
  data_acquisto TEXT,
  data_installazione TEXT,
  data_dismissione TEXT,
  stato TEXT CHECK(stato IN ('Attivo', 'In magazzino', 'In riparazione', 'Dismesso', 'Rubato') OR stato IS NULL),
  fine_garanzia TEXT,
  fine_supporto TEXT,
  vita_utile_prevista INTEGER,
  sistema_operativo TEXT,
  versione_os TEXT,
  cpu TEXT,
  ram_gb INTEGER,
  storage_gb INTEGER,
  storage_tipo TEXT CHECK(storage_tipo IN ('SSD', 'HDD', 'NVMe') OR storage_tipo IS NULL),
  mac_address TEXT,
  ip_address TEXT,
  vlan INTEGER,
  firmware_version TEXT,
  prezzo_acquisto REAL,
  fornitore TEXT,
  numero_ordine TEXT,
  numero_fattura TEXT,
  valore_attuale REAL,
  metodo_ammortamento TEXT CHECK(metodo_ammortamento IN ('Lineare', 'Quote decrescenti') OR metodo_ammortamento IS NULL),
  centro_di_costo TEXT,
  crittografia_disco INTEGER DEFAULT 0,
  antivirus TEXT,
  gestito_da_mdr INTEGER DEFAULT 0,
  classificazione_dati TEXT CHECK(classificazione_dati IN ('Pubblico', 'Interno', 'Confidenziale', 'Riservato') OR classificazione_dati IS NULL),
  in_scope_gdpr INTEGER DEFAULT 0,
  -- ── NIS2 Fase 3: tracking sync automatico da host/discovery ──
  auto_sync_discovery INTEGER DEFAULT 1,
  last_sync_at TEXT,
  last_sync_source TEXT,
  -- ── NIS2 Fase 2: checklist protezione (art. 21 Misure tecniche e organizzative) ──
  backup_configurato INTEGER DEFAULT 0,
  backup_ultimo_test TEXT,
  patching_automatico INTEGER DEFAULT 0,
  mfa_admin INTEGER DEFAULT 0,
  log_centralizzati INTEGER DEFAULT 0,
  hardening_baseline INTEGER DEFAULT 0,
  dr_plan_documentato INTEGER DEFAULT 0,
  incident_response_documentata INTEGER DEFAULT 0,
  -- ── NIS2 Fase 1: categoria normativa, dual ownership, criticità, dati trattati ──
  categoria_nis2 TEXT CHECK(categoria_nis2 IN ('workstation', 'server', 'rete', 'storage', 'mobile', 'iot', 'supporto_rimovibile', 'servizio_cloud', 'applicazione', 'altro') OR categoria_nis2 IS NULL),
  business_owner_id INTEGER REFERENCES asset_assignees(id) ON DELETE SET NULL,
  technical_owner_id INTEGER REFERENCES asset_assignees(id) ON DELETE SET NULL,
  criticita_nis2 TEXT CHECK(criticita_nis2 IN ('bassa', 'media', 'alta', 'critica') OR criticita_nis2 IS NULL),
  dati_trattati TEXT CHECK(dati_trattati IN ('nessuno', 'personali', 'sensibili', 'finanziari', 'sanitari', 'infrastruttura_critica', 'altro') OR dati_trattati IS NULL),
  supporto_rimovibile INTEGER DEFAULT 0,
  data_review_nis2 TEXT,
  in_scope_nis2 INTEGER DEFAULT 0,
  ultimo_audit TEXT,
  contratto_supporto TEXT,
  tipo_garanzia TEXT,
  contatto_supporto TEXT,
  ultimo_intervento TEXT,
  prossima_manutenzione TEXT,
  note_tecniche TEXT,
  technical_data TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);


-- ── NIS2 Fase 4: catalogo servizi e dipendenze su asset (art. 21, §12.4.2a) ──
CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  stato TEXT NOT NULL DEFAULT 'attivo' CHECK(stato IN ('attivo', 'in_dismissione', 'dismesso')),
  criticita_servizio TEXT CHECK(criticita_servizio IN ('bassa', 'media', 'alta', 'critica') OR criticita_servizio IS NULL),
  in_scope_nis2 INTEGER NOT NULL DEFAULT 0,
  rto_minutes INTEGER,
  rpo_minutes INTEGER,
  business_owner_id INTEGER REFERENCES asset_assignees(id) ON DELETE SET NULL,
  technical_owner_id INTEGER REFERENCES asset_assignees(id) ON DELETE SET NULL,
  sla_url TEXT,
  note TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS service_asset_dependencies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  asset_id INTEGER NOT NULL REFERENCES inventory_assets(id) ON DELETE CASCADE,
  dependency_type TEXT NOT NULL DEFAULT 'primario' CHECK(dependency_type IN ('primario', 'secondario', 'supporto')),
  note TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(service_id, asset_id)
);

CREATE INDEX IF NOT EXISTS idx_service_asset_deps_service ON service_asset_dependencies(service_id);
CREATE INDEX IF NOT EXISTS idx_service_asset_deps_asset ON service_asset_dependencies(asset_id);

-- Licenze software
CREATE TABLE IF NOT EXISTS licenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  serial TEXT,
  seats INTEGER NOT NULL DEFAULT 1,
  category TEXT,
  expiration_date TEXT,
  purchase_cost REAL,
  min_amt INTEGER DEFAULT 0,
  fornitore TEXT,
  note TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Posti licenza
CREATE TABLE IF NOT EXISTS license_seats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  license_id INTEGER NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
  asset_type TEXT CHECK(asset_type IN ('inventory_asset', 'host')),
  asset_id INTEGER,
  asset_assignee_id INTEGER REFERENCES asset_assignees(id) ON DELETE SET NULL,
  assigned_at TEXT DEFAULT (datetime('now')),
  note TEXT
);

-- Audit log inventario
CREATE TABLE IF NOT EXISTS inventory_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id INTEGER NOT NULL REFERENCES inventory_assets(id) ON DELETE CASCADE,
  user_id INTEGER,
  action TEXT NOT NULL CHECK(action IN ('create', 'update', 'delete')),
  field_name TEXT,
  old_value TEXT,
  new_value TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Proxmox hosts
CREATE TABLE IF NOT EXISTS proxmox_hosts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER DEFAULT 8006,
  credential_id INTEGER REFERENCES credentials(id) ON DELETE SET NULL,
  enabled INTEGER DEFAULT 1,
  last_scan_at TEXT,
  last_scan_result TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Active Directory
CREATE TABLE IF NOT EXISTS ad_integrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  dc_host TEXT NOT NULL,
  domain TEXT NOT NULL,
  base_dn TEXT NOT NULL,
  encrypted_username TEXT NOT NULL,
  encrypted_password TEXT NOT NULL,
  use_ssl INTEGER NOT NULL DEFAULT 1,
  port INTEGER NOT NULL DEFAULT 636,
  enabled INTEGER NOT NULL DEFAULT 1,
  winrm_credential_id INTEGER REFERENCES credentials(id) ON DELETE SET NULL,
  dhcp_leases_count INTEGER DEFAULT 0,
  last_sync_at TEXT,
  last_sync_status TEXT,
  computers_count INTEGER DEFAULT 0,
  users_count INTEGER DEFAULT 0,
  groups_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  -- Tappa 2f credenziali: l'account LDAP è una voce d'archivio (tipo «ad»).
  -- In fondo, come la aggiunge l'ALTER di getTenantDb ai DB di prima.
  credential_id INTEGER REFERENCES credentials(id) ON DELETE SET NULL,
  UNIQUE(dc_host, domain)
);

CREATE TABLE IF NOT EXISTS ad_computers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  integration_id INTEGER NOT NULL REFERENCES ad_integrations(id) ON DELETE CASCADE,
  object_guid TEXT NOT NULL,
  sam_account_name TEXT NOT NULL,
  dns_host_name TEXT,
  display_name TEXT,
  distinguished_name TEXT NOT NULL,
  operating_system TEXT,
  operating_system_version TEXT,
  last_logon_at TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  host_id INTEGER REFERENCES hosts(id) ON DELETE SET NULL,
  ip_address TEXT,
  ou TEXT,
  raw_data TEXT,
  synced_at TEXT DEFAULT (datetime('now')),
  UNIQUE(integration_id, object_guid)
);

CREATE TABLE IF NOT EXISTS ad_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  integration_id INTEGER NOT NULL REFERENCES ad_integrations(id) ON DELETE CASCADE,
  object_guid TEXT NOT NULL,
  sam_account_name TEXT NOT NULL,
  user_principal_name TEXT,
  display_name TEXT,
  email TEXT,
  department TEXT,
  title TEXT,
  phone TEXT,
  ou TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_logon_at TEXT,
  password_last_set_at TEXT,
  raw_data TEXT,
  synced_at TEXT DEFAULT (datetime('now')),
  UNIQUE(integration_id, object_guid)
);

CREATE TABLE IF NOT EXISTS ad_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  integration_id INTEGER NOT NULL REFERENCES ad_integrations(id) ON DELETE CASCADE,
  object_guid TEXT NOT NULL,
  sam_account_name TEXT NOT NULL,
  display_name TEXT,
  description TEXT,
  distinguished_name TEXT NOT NULL,
  group_type INTEGER,
  member_guids TEXT,
  synced_at TEXT DEFAULT (datetime('now')),
  UNIQUE(integration_id, object_guid)
);

CREATE TABLE IF NOT EXISTS ad_dhcp_leases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  integration_id INTEGER NOT NULL REFERENCES ad_integrations(id) ON DELETE CASCADE,
  scope_id TEXT NOT NULL,
  scope_name TEXT,
  ip_address TEXT NOT NULL,
  mac_address TEXT NOT NULL,
  hostname TEXT,
  lease_expires TEXT,
  address_state TEXT,
  description TEXT,
  -- v0.2.659: ultima volta che il client DHCP è stato visto attivo.
  -- Per Microsoft DHCP: calcolato lato PowerShell come (LeaseExpiryTime - LeaseDuration).
  -- Per i lease "expired" o reservation inattive, è null.
  -- Permette di filtrare lease "vivi" vs relitti vecchi.
  last_seen TEXT,
  last_synced TEXT DEFAULT (datetime('now')),
  UNIQUE(integration_id, ip_address)
);

-- DHCP Leases (unified)
CREATE TABLE IF NOT EXISTS dhcp_leases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type TEXT NOT NULL CHECK(source_type IN ('mikrotik', 'windows', 'cisco', 'other')),
  source_device_id INTEGER REFERENCES network_devices(id) ON DELETE CASCADE,
  source_name TEXT,
  server_name TEXT,
  scope_id TEXT,
  scope_name TEXT,
  ip_address TEXT NOT NULL,
  mac_address TEXT NOT NULL,
  hostname TEXT,
  status TEXT,
  lease_start TEXT,
  lease_expires TEXT,
  description TEXT,
  dynamic_lease INTEGER,
  -- v0.2.659: ultimo "visto" dal DHCP server. Per Mikrotik viene da
  -- last-seen RouterOS convertito in ISO timestamp. Per Windows DHCP
  -- viene calcolato lato PowerShell come LeaseExpiryTime - LeaseDuration.
  -- Filtrare last_seen > datetime now -N days per nascondere relitti.
  last_seen TEXT,
  host_id INTEGER REFERENCES hosts(id) ON DELETE SET NULL,
  network_id INTEGER REFERENCES networks(id) ON DELETE SET NULL,
  last_synced TEXT DEFAULT (datetime('now')),
  UNIQUE(source_device_id, ip_address)
);

-- Analytics: eventi anomalia rilevati automaticamente
CREATE TABLE IF NOT EXISTS anomaly_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  host_id         INTEGER REFERENCES hosts(id) ON DELETE CASCADE,
  network_id      INTEGER REFERENCES networks(id) ON DELETE CASCADE,
  anomaly_type    TEXT NOT NULL CHECK(anomaly_type IN ('mac_flip','new_unknown_host','port_change','uptime_anomaly','latency_anomaly')),
  severity        TEXT NOT NULL DEFAULT 'medium' CHECK(severity IN ('low','medium','high')),
  description     TEXT NOT NULL,
  detail_json     TEXT,
  acknowledged    INTEGER NOT NULL DEFAULT 0,
  acknowledged_at TEXT,
  acknowledged_by TEXT,
  detected_at     TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at     TEXT
);

-- Analytics: feedback correzione classificazione dispositivi
CREATE TABLE IF NOT EXISTS classification_feedback (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  host_id                  INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  corrected_classification TEXT NOT NULL,
  previous_classification  TEXT,
  feature_snapshot_json    TEXT,
  fingerprint_device_label TEXT,
  fingerprint_confidence   REAL,
  corrected_by             TEXT,
  created_at               TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Neighbors LLDP/CDP/MNDP
CREATE TABLE IF NOT EXISTS device_neighbors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id INTEGER NOT NULL REFERENCES network_devices(id) ON DELETE CASCADE,
  local_port TEXT NOT NULL,
  remote_device_name TEXT NOT NULL DEFAULT '',
  remote_port TEXT NOT NULL DEFAULT '',
  protocol TEXT NOT NULL CHECK(protocol IN ('lldp', 'cdp', 'mndp', 'unknown')),
  remote_ip TEXT,
  remote_mac TEXT,
  remote_platform TEXT,
  first_seen TEXT,
  source TEXT NOT NULL DEFAULT 'device',
  timestamp TEXT DEFAULT (datetime('now')),
  UNIQUE(device_id, local_port, remote_device_name, remote_port)
);
${DDL_TOPOLOGY_CAVI.map(([, ddl]) => `${ddl};`).join("\n\n")}

-- Routing table
CREATE TABLE IF NOT EXISTS routing_table (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id INTEGER NOT NULL REFERENCES network_devices(id) ON DELETE CASCADE,
  destination TEXT NOT NULL,
  gateway TEXT,
  interface_name TEXT,
  protocol TEXT NOT NULL CHECK(protocol IN ('connected', 'static', 'ospf', 'bgp', 'rip', 'other')),
  metric INTEGER,
  distance INTEGER,
  active INTEGER DEFAULT 1,
  timestamp TEXT DEFAULT (datetime('now')),
  UNIQUE(device_id, destination, gateway, interface_name)
);

CREATE TABLE IF NOT EXISTS librenms_host_map (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  network_id INTEGER NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  host_ip TEXT NOT NULL,
  librenms_device_id INTEGER NOT NULL,
  librenms_hostname TEXT,
  last_synced_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_status TEXT,
  UNIQUE(network_id, host_ip)
);

-- ───────────────────────────────────────────────────────────────────────────
-- Integrazione Wazuh (da-wazuh.domarc.it) — singleton hub-side, ma i dati
-- vengono mirrorati nel tenant DB filtrati per match con gli host del tenant.
-- Match agent ↔ host avviene per IP (preferito), mac normalizzato, hostname.
-- Tabelle additive: nessun ALTER, ogni sync upserta per agent_id.
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wazuh_agent (
  agent_id TEXT PRIMARY KEY,             -- Wazuh agent id (es. "001", "042")
  host_id INTEGER REFERENCES hosts(id) ON DELETE SET NULL,
  name TEXT,                             -- Wazuh agent name (di solito hostname)
  ip TEXT,                               -- IP di registrazione lato Wazuh
  mac TEXT,                              -- MAC normalizzato lowercase aa:bb:cc:dd:ee:ff (da syscollector)
  hostname TEXT,                         -- hostname riportato da syscollector/os
  os_platform TEXT,                      -- "windows"|"ubuntu"|"centos"|"darwin"|...
  os_name TEXT,                          -- nome OS leggibile
  os_version TEXT,
  os_arch TEXT,
  agent_version TEXT,                    -- es. "Wazuh v4.7.5"
  status TEXT,                           -- active|disconnected|pending|never_connected
  node_name TEXT,                        -- manager node
  manager_host TEXT,
  last_keep_alive TEXT,
  registered_at TEXT,
  synced_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS wazuh_hw (
  agent_id TEXT PRIMARY KEY REFERENCES wazuh_agent(agent_id) ON DELETE CASCADE,
  board_serial TEXT,
  board_vendor TEXT,
  board_product TEXT,
  cpu_name TEXT,
  cpu_cores INTEGER,
  cpu_mhz REAL,
  ram_total_kb INTEGER,
  ram_free_kb INTEGER,
  scan_time TEXT,
  synced_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS wazuh_os (
  agent_id TEXT PRIMARY KEY REFERENCES wazuh_agent(agent_id) ON DELETE CASCADE,
  hostname TEXT,
  architecture TEXT,
  os_name TEXT,
  os_version TEXT,
  os_codename TEXT,
  os_major TEXT,
  os_minor TEXT,
  os_build TEXT,
  os_platform TEXT,
  sysname TEXT,
  release TEXT,
  version_full TEXT,
  scan_time TEXT,
  synced_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS wazuh_software (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL REFERENCES wazuh_agent(agent_id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  version TEXT,
  vendor TEXT,
  architecture TEXT,
  format TEXT,                           -- "deb"|"rpm"|"win"|"pkg"|...
  source TEXT,
  install_time TEXT,
  description TEXT,
  scan_time TEXT,
  synced_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(agent_id, name, version, architecture)
);

CREATE TABLE IF NOT EXISTS wazuh_vuln (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL REFERENCES wazuh_agent(agent_id) ON DELETE CASCADE,
  cve TEXT NOT NULL,
  severity TEXT,                         -- Low|Medium|High|Critical|Untriaged
  cvss2_score REAL,
  cvss3_score REAL,
  package_name TEXT,
  package_version TEXT,
  package_architecture TEXT,
  status TEXT,                           -- VALID|PENDING|SOLVED|OBSOLETE
  detection_time TEXT,
  published TEXT,
  updated TEXT,
  condition_ TEXT,
  title TEXT,
  external_references TEXT,
  scan_time TEXT,
  synced_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(agent_id, cve, package_name, package_version)
);

-- Porte in ascolto (syscollector/{id}/ports filtrato state=listening).
-- Una riga per (agent_id, protocol, local_ip, local_port). Replace su ogni sync.
CREATE TABLE IF NOT EXISTS wazuh_ports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL REFERENCES wazuh_agent(agent_id) ON DELETE CASCADE,
  protocol TEXT,                         -- tcp|udp|tcp6|udp6
  local_ip TEXT,
  local_port INTEGER,
  state TEXT,                            -- listening|established (memorizziamo solo listening)
  process TEXT,
  pid INTEGER,
  scan_time TEXT,
  synced_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(agent_id, protocol, local_ip, local_port)
);

-- Hotfix Windows (syscollector/{id}/hotfixes). Vuoto/404 per agent Linux.
CREATE TABLE IF NOT EXISTS wazuh_hotfix (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL REFERENCES wazuh_agent(agent_id) ON DELETE CASCADE,
  hotfix TEXT NOT NULL,                  -- es. "KB5012170"
  scan_time TEXT,
  synced_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(agent_id, hotfix)
);

-- Interfacce di rete (syscollector/{id}/netiface). Una riga per (agent_id, name).
CREATE TABLE IF NOT EXISTS wazuh_netiface (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL REFERENCES wazuh_agent(agent_id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  mac TEXT,
  type TEXT,                             -- ethernet|loopback|wireless|...
  state TEXT,                            -- up|down|unknown
  mtu INTEGER,
  scan_time TEXT,
  synced_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(agent_id, name)
);

-- Indirizzi IP (syscollector/{id}/netaddr). Multipli per interfaccia (IPv4 + IPv6).
CREATE TABLE IF NOT EXISTS wazuh_netaddr (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL REFERENCES wazuh_agent(agent_id) ON DELETE CASCADE,
  iface TEXT,
  proto TEXT,                            -- ipv4|ipv6
  address TEXT NOT NULL,
  netmask TEXT,
  broadcast TEXT,
  scan_time TEXT,
  synced_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(agent_id, iface, address)
);

-- Processi in esecuzione (syscollector/{id}/processes). Snapshot ultima scansione:
-- DELETE+INSERT per agent_id ad ogni sync (PID si ricicla, niente storico utile).
-- Volume tipico Windows: ~150-250 righe per agent.
CREATE TABLE IF NOT EXISTS wazuh_process (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL REFERENCES wazuh_agent(agent_id) ON DELETE CASCADE,
  pid INTEGER NOT NULL,
  ppid INTEGER,
  name TEXT,
  cmd TEXT,                              -- comando completo con path
  argvs TEXT,                            -- argomenti
  vm_size INTEGER,                       -- virtual memory KB
  resident_size INTEGER,                 -- resident size (campo 'size')
  priority INTEGER,
  nlwp INTEGER,                          -- num threads
  start_time INTEGER,                    -- unix epoch
  utime INTEGER,
  stime INTEGER,
  scan_time TEXT,
  synced_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(agent_id, pid)
);

-- Servizi (syscollector/{id}/services). Wazuh ≥ 4.13. Snapshot.
-- Su Windows ~150-300 servizi, su Linux ~30-80 unit systemd.
CREATE TABLE IF NOT EXISTS wazuh_service (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL REFERENCES wazuh_agent(agent_id) ON DELETE CASCADE,
  service_id TEXT NOT NULL,              -- nome servizio (es. "Dnscache", "ssh.service")
  enabled TEXT,                          -- "true"/"false"/" " (Wazuh raw)
  start_type TEXT,                       -- auto|manual|disabled|boot|system
  service_type TEXT,                     -- own|share|kernel_driver|...
  exit_code INTEGER,
  process_pid INTEGER,
  process_executable TEXT,
  process_args TEXT,
  scan_time TEXT,
  synced_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(agent_id, service_id)
);

-- Routing/protocol config (syscollector/{id}/netproto). Tipicamente 2-3 righe per agent.
CREATE TABLE IF NOT EXISTS wazuh_netproto (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL REFERENCES wazuh_agent(agent_id) ON DELETE CASCADE,
  iface TEXT,
  type TEXT,                             -- ipv4|ipv6
  gateway TEXT,
  dhcp TEXT,                             -- enabled|disabled|unknown
  metric TEXT,
  scan_time TEXT,
  synced_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(agent_id, iface, type)
);

-- ───────────────────────────────────────────────────────────────────────────
-- Integrazione Scanner-Edge (DA-Vul-can) — singleton applicativo per tenant.
-- DA-IPAM consuma /api/v1/cve dello scanner-edge sulla stessa LAN cliente,
-- archivia findings storici per match con hosts via IP. Token cifrato AES-GCM.
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vuln_scanners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  token_encrypted TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  last_sync_at TEXT,
  last_error TEXT,
  -- SPKI pin (TOFU) formato RFC 7469 "sha256/<base64>". Quando settato
  -- ogni chiamata HTTPS verifica che il cert presentato abbia lo stesso
  -- pin. NULL = primo contatto non ancora avvenuto OR edge in HTTP legacy.
  cert_pin TEXT,
  -- Fingerprint sha256 del cert intero (DER). Solo UI diagnostica.
  cert_fingerprint TEXT,
  -- v0.2.638 audit B7: contatore errori consecutivi + timestamp auto-disable.
  -- Dopo 5 errori consecutivi il cron auto-disabilita lo scanner (enabled=0)
  -- per evitare retry muti per ore (es. TOFU pin mismatch).
  consecutive_errors INTEGER DEFAULT 0,
  auto_disabled_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vuln_scan_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scanner_id INTEGER NOT NULL REFERENCES vuln_scanners(id) ON DELETE CASCADE,
  -- id LOCALE dell'edge: riparte da 1 se l'edge viene ricostruito → NON usarlo
  -- da solo come chiave di dedup (collide con lo storico). Vedi edge_scan_uid.
  edge_scan_id INTEGER,
  -- UUID Greenbone (gvm_report_id): stabile e globalmente unico. Chiave di
  -- dedup preferita quando l'edge la espone.
  edge_scan_uid TEXT,
  network_id INTEGER REFERENCES networks(id) ON DELETE SET NULL,
  started_at TEXT,
  finished_at TEXT,
  finding_count INTEGER DEFAULT 0,
  status TEXT,
  pulled_at TEXT DEFAULT (datetime('now')),
  UNIQUE(scanner_id, edge_scan_id)
);

CREATE TABLE IF NOT EXISTS vuln_findings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  host_id INTEGER REFERENCES hosts(id) ON DELETE SET NULL,
  scan_run_id INTEGER NOT NULL REFERENCES vuln_scan_runs(id) ON DELETE CASCADE,
  ip TEXT NOT NULL,
  mac TEXT,
  hostname TEXT,
  port TEXT,
  service TEXT,
  cve_id TEXT,
  cvss_score REAL,
  cvss_vector TEXT,
  severity TEXT,
  nvt_oid TEXT,
  nvt_name TEXT,
  description TEXT,
  scanned_at TEXT NOT NULL
);

-- ───────────────────────────────────────────────────────────────────────────
-- Tenant settings (key/value) — config per-tenant (retention, soglie, ecc.)
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenant_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- I rilievi ATTUALI, per host (Riccardo, 27/10/2026 sera): per ogni IP quelli della sua ultima scansione
-- buona, cioè l'ultima in cui l'IP compare con almeno una riga (anche solo informativa, «Log»). Un host
-- spento all'ultima scansione tiene i rilievi della precedente; un rilievo sparisce solo quando una
-- scansione successiva dello stesso IP non lo trova più. vuln_findings resta l'archivio; elenco host,
-- scheda, patch e cruscotto leggono da qui. Ricreata a ogni apertura: la 0.9.923 la definiva per rete.
DROP VIEW IF EXISTS vuln_findings_attuali;
CREATE VIEW vuln_findings_attuali AS
  SELECT f.* FROM vuln_findings f
   WHERE f.scan_run_id = (
     SELECT MAX(f2.scan_run_id) FROM vuln_findings f2
       JOIN vuln_scan_runs r ON r.id = f2.scan_run_id
      WHERE f2.ip = f.ip
        AND COALESCE(r.status, 'done') NOT IN ('error', 'failed', 'stopped', 'interrupted'))
     -- Host spariti (Riccardo, 28/10/2026): se l'host non è visto da più di 90 giorni (né dal discovery,
     -- hosts.last_seen, né da una scansione) i suoi rilievi non sono attuali: fuori da viste, esportazioni
     -- e conteggi, restano nell'archivio (pulsante «precedenti»). Le date sono ISO o «AAAA-MM-GG hh:mm:ss».
     AND MAX(COALESCE(julianday(f.scanned_at), 0),
             COALESCE((SELECT MAX(julianday(h.last_seen)) FROM hosts h
                        WHERE h.id = f.host_id OR h.ip = f.ip), 0)) >= julianday('now') - 90;

-- ───────────────────────────────────────────────────────────────────────────
-- Software Inventory — scan applicativo on-demand per host (Windows/Linux).
-- Snapshot immutabili: ogni scan = righe nuove. Diff ricostruito a query time.
-- Vedi docs/plans/software-inventory.md.
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS software_scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  host_id INTEGER REFERENCES hosts(id) ON DELETE CASCADE,
  device_id INTEGER REFERENCES network_devices(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL CHECK(status IN ('running','ok','error','timeout','cancelled')),
  os_family TEXT NOT NULL CHECK(os_family IN ('windows','linux')),
  probe TEXT NOT NULL,
  apps_count INTEGER DEFAULT 0,
  timeout_ms INTEGER NOT NULL DEFAULT 60000,
  attempt INTEGER NOT NULL DEFAULT 1,
  triggered_by_user_id INTEGER,
  triggered_by TEXT NOT NULL DEFAULT 'manual',
  error_message TEXT,
  credential_id INTEGER REFERENCES credentials(id) ON DELETE SET NULL,
  CHECK ((host_id IS NOT NULL AND device_id IS NULL) OR (host_id IS NULL AND device_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS software_inventory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id INTEGER NOT NULL REFERENCES software_scans(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  version TEXT,
  publisher TEXT,
  install_date TEXT,
  install_location TEXT,
  source TEXT NOT NULL,
  architecture TEXT,
  size_bytes INTEGER
);

CREATE TABLE IF NOT EXISTS software_scan_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id INTEGER NOT NULL REFERENCES software_scans(id) ON DELETE CASCADE,
  ts TEXT NOT NULL,
  level TEXT NOT NULL CHECK(level IN ('info','warn','error','debug')),
  step TEXT,
  message TEXT NOT NULL,
  details TEXT
);

-- v0.2.632: Classification custom per-tenant. Sotto-categorie utente di un built-in.
-- Eredita icona e macro-categoria dal parent_slug (che DEVE essere un built-in,
-- validato lato API — qui CHECK solo formato base). Lo slug è PK e immutabile
-- una volta creato perché referenziato da hosts.classification.
CREATE TABLE IF NOT EXISTS device_classifications_custom (
  slug TEXT PRIMARY KEY NOT NULL,
  label TEXT NOT NULL,
  parent_slug TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (length(slug) >= 2 AND length(slug) <= 64),
  CHECK (slug GLOB '[a-z]*'),
  CHECK (length(label) >= 1 AND length(label) <= 80)
);

-- ============================================================================
-- MDM (Headwind) — modulo gestione device mobili. Connettore pull verso hmdm-server.
-- I mobili confluiscono in hosts (first-class) via merge per serial/imei/number.
-- ============================================================================
CREATE TABLE IF NOT EXISTS mdm_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  base_url TEXT,
  username TEXT,
  password_encrypted TEXT,
  jwt_cached TEXT,
  jwt_expires_at TEXT,
  user_field TEXT DEFAULT 'description',
  enabled INTEGER DEFAULT 0,
  last_sync_at TEXT,
  last_error TEXT,
  consecutive_errors INTEGER DEFAULT 0,
  last_attempt_at TEXT,
  last_success_at TEXT
);
CREATE TABLE IF NOT EXISTS mobile_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hmdm_device_id TEXT UNIQUE,
  host_id INTEGER REFERENCES hosts(id) ON DELETE SET NULL,
  label TEXT,
  last_seen_at TEXT,
  last_sync_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS mobile_device_inventory (
  device_id INTEGER PRIMARY KEY REFERENCES mobile_devices(id) ON DELETE CASCADE,
  serial TEXT,
  model TEXT,
  os_family TEXT,
  os_version TEXT,
  user_profile TEXT,
  imei TEXT,
  imei2 TEXT,
  phone TEXT,
  cpu TEXT,
  battery_level INTEGER,
  snapshot_sha256 TEXT,
  last_inventory_at TEXT
);
CREATE TABLE IF NOT EXISTS mobile_device_apps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id INTEGER NOT NULL REFERENCES mobile_devices(id) ON DELETE CASCADE,
  package_name TEXT NOT NULL,
  app_name TEXT,
  version_name TEXT,
  first_seen TEXT,
  last_seen TEXT,
  UNIQUE(device_id, package_name)
);
CREATE TABLE IF NOT EXISTS mobile_inventory_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id INTEGER NOT NULL REFERENCES mobile_devices(id) ON DELETE CASCADE,
  changed_at TEXT DEFAULT (datetime('now')),
  change_type TEXT NOT NULL,
  field TEXT,
  old_value TEXT,
  new_value TEXT
);

-- ============================================================================
-- Edge scan schedule (builder DA-IPAM): config leggibile per ricostruire il
-- builder in modifica + cron derivato inviato all'edge.
-- ============================================================================
CREATE TABLE IF NOT EXISTS edge_scan_schedules (
  network_id INTEGER PRIMARY KEY REFERENCES networks(id) ON DELETE CASCADE,
  job_name TEXT,
  frequency TEXT,
  at_time TEXT,
  days_of_week TEXT,
  day_of_month INTEGER,
  cron_expr TEXT,
  profile TEXT,
  targeting_mode TEXT,
  enabled INTEGER DEFAULT 1,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- ============================================================================
-- MeshCentral RMM (modulo opt-in; tabelle vivono anche se feature OFF, vuote)
-- mc_config = singleton config cifrata per-tenant (pattern mdm_config).
-- mc_node/mc_remote_session/mc_node_bind = spec §6.
-- ============================================================================
CREATE TABLE IF NOT EXISTS mc_config (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  server_url      TEXT,
  domain          TEXT,
  mesh_id         TEXT,
  service_user    TEXT,
  login_token_key_encrypted TEXT,
  admin_user      TEXT,
  admin_pass_encrypted TEXT,
  updated_at      TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS mc_node (
  node_id        TEXT PRIMARY KEY,
  host_id        INTEGER REFERENCES hosts(id) ON DELETE SET NULL,
  mesh_id        TEXT NOT NULL,
  name           TEXT,
  rname          TEXT,
  primary_ip     TEXT,
  primary_mac    TEXT,
  osdesc         TEXT,
  conn           INTEGER DEFAULT 0,
  last_connect   TEXT,
  match_status   TEXT,
  synced_at      TEXT DEFAULT (datetime('now')),
  created_at     TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS mc_remote_session (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  host_id          INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  node_id          TEXT REFERENCES mc_node(node_id) ON DELETE SET NULL,
  operator         TEXT NOT NULL,
  mesh_user        TEXT NOT NULL,
  viewmode         INTEGER,
  token_expire_min INTEGER,
  token_once       INTEGER DEFAULT 1,
  status           TEXT DEFAULT 'minted',
  created_at       TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS mc_node_bind (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  node_id     TEXT NOT NULL,
  host_id     INTEGER NOT NULL,
  operator    TEXT NOT NULL,
  created_at  TEXT DEFAULT (datetime('now'))
);

-- Audit esecuzione comandi remoti (Fase 2 RMM). L'OUTPUT non si salva mai: puo'
-- contenere password/token (un 'cat .env' basta) e finirebbe in chiaro nel DB e
-- nei backup. Restano comando, operatore ed esito.
-- NB: duplicato di MC_SCHEMA_SQL (integrations/meshcentral/schema.ts) — le due
-- copie DEVONO restare allineate; lo verifica tenant-schema-wiring.test.ts, che
-- itera MC_TABLES invece di una lista scritta a mano.
CREATE TABLE IF NOT EXISTS mc_command_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  host_id     INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  node_id     TEXT REFERENCES mc_node(node_id) ON DELETE SET NULL,
  operator    TEXT NOT NULL,
  command     TEXT NOT NULL,
  shell       TEXT NOT NULL DEFAULT 'auto',
  run_as_user INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'ok',
  error       TEXT,
  created_at  TEXT DEFAULT (datetime('now'))
);

-- Attribution v2 (spec §4.2): evidenze append-only per host/dimensione.
-- NB: 'source' e 'phase' senza CHECK deliberatamente — il vocabolario è chiuso
-- a livello TypeScript (AttributionSource/AttributionPhase) e crescerà nelle fasi 2-5;
-- i CHECK SQLite non sono estendibili senza rebuild della tabella.
CREATE TABLE IF NOT EXISTS attribution_evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  phase TEXT NOT NULL,
  dimension TEXT NOT NULL CHECK(dimension IN ('vendor','category','os')),
  claim TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0,
  weight REAL NOT NULL DEFAULT 0,
  raw_value TEXT,
  observed_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT,
  superseded_by INTEGER REFERENCES attribution_evidence(id) ON DELETE SET NULL
);

-- Topologia: posizioni salvate dei nodi della mappa (per vista/tenant)
CREATE TABLE IF NOT EXISTS topology_position (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  view TEXT NOT NULL DEFAULT 'default',
  node_id TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 1,
  structure_sig TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(view, node_id)
);

-- Topologia: correzioni manuali dei collegamenti (aggiungi/ignora), vincono sui
-- dati letti dagli apparati. Stessa definizione della migrazione runtime
-- (migrateTopologyPhase1 in db-tenant.ts).
CREATE TABLE IF NOT EXISTS topology_link_overrides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL CHECK(action IN ('add', 'ignore')),
  a_node TEXT NOT NULL,
  a_port TEXT NOT NULL DEFAULT '',
  b_node TEXT NOT NULL,
  b_port TEXT NOT NULL DEFAULT '',
  note TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Topologia: unioni e separazioni a mano (ADR 0021). Stesse CREATE della migrazione
-- runtime (migrateTopologyUnioni in db-tenant.ts), che aggiunge gli indici.
${DDL_TOPOLOGY_UNIONI.map(([, ddl]) => `${ddl};`).join("\n\n")}

-- Archivio degli host tolti dalla pulizia (piano 2026-10-20). Stessa CREATE della migrazione
-- runtime (migrateHostsArchivio in db-tenant.ts), che aggiunge gli indici.
${DDL_HOSTS_ARCHIVIO.map(([, ddl]) => `${ddl};`).join("\n\n")}

-- Ultimo esito per apparato dei job apparati_scelti (piano 2026-10-22). Stessa CREATE della
-- migrazione runtime (migraApparatiScelti in db-tenant.ts), che aggiunge l'indice.
${DDL_JOB_APPARATI_ESITI.map(([, ddl]) => `${ddl};`).join("\n\n")}

-- Controller di rete (UniFi, poi Omada): uno per riga, nel DB del cliente.
-- Prima la configurazione era una sola, nelle impostazioni globali dell'hub
-- (integration_unifi_*): vedi ADR 0007. I segreti sono cifrati come nell'hub
-- (AES-GCM iv:tag:enc). vendor/kind senza CHECK: si validano in TypeScript
-- (src/lib/controllers/types.ts), così Omada non chiede un rebuild.
CREATE TABLE IF NOT EXISTS network_controllers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  vendor TEXT NOT NULL,
  kind TEXT NOT NULL,
  url TEXT NOT NULL,
  site TEXT NOT NULL DEFAULT 'default',
  username TEXT NOT NULL DEFAULT '',
  password_enc TEXT NOT NULL DEFAULT '',
  api_key_enc TEXT NOT NULL DEFAULT '',
  cert_pin TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_run_at TEXT,
  last_ok INTEGER,
  last_message TEXT,
  last_devices INTEGER,
  last_ports INTEGER,
  last_neighbors INTEGER,
  origin TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Tappa 2f credenziali: i segreti sono una voce d'archivio (tipo «unifi»);
  -- le colonne qui sopra restano piene fino alla 2g. In fondo, come la
  -- aggiunge l'ALTER di getTenantDb ai DB di prima.
  credential_id INTEGER REFERENCES credentials(id) ON DELETE SET NULL
);

-- Storico delle letture di un controller: le ultime 50 per controller
-- (la potatura la fa recordControllerRun, non una buona intenzione).
CREATE TABLE IF NOT EXISTS network_controller_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  controller_id INTEGER NOT NULL REFERENCES network_controllers(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  trigger TEXT NOT NULL,
  triggered_by TEXT,
  ok INTEGER NOT NULL,
  total INTEGER NOT NULL DEFAULT 0,
  added INTEGER NOT NULL DEFAULT 0,
  updated INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  ports INTEGER NOT NULL DEFAULT 0,
  neighbors INTEGER NOT NULL DEFAULT 0,
  message TEXT,
  errors_json TEXT NOT NULL DEFAULT '[]',
  skipped_reasons_json TEXT NOT NULL DEFAULT '[]',
  offline_json TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_controller_runs_controller ON network_controller_runs(controller_id, id);

-- Pannello Zabbix in sola lettura (passo 7.4): vedi DDL_ZABBIX_LETTURA.
${DDL_ZABBIX_LETTURA.map(([, ddl]) => `${ddl};`).join("\n\n")}

-- Acquisizione modulare (collector JSON 1.0): vedi DDL_ACQUISIZIONE_MODULARE.
${DDL_ACQUISIZIONE_MODULARE.map(([, ddl]) => `${ddl};`).join("\n\n")}
`;

export const TENANT_INDEXES_SQL = `
-- Hosts
CREATE INDEX IF NOT EXISTS idx_hosts_network ON hosts(network_id);
CREATE INDEX IF NOT EXISTS idx_hosts_status ON hosts(status);
CREATE INDEX IF NOT EXISTS idx_hosts_ip ON hosts(ip);
CREATE INDEX IF NOT EXISTS idx_hosts_mac ON hosts(mac);
CREATE INDEX IF NOT EXISTS idx_hosts_network_ip ON hosts(network_id, ip);
CREATE INDEX IF NOT EXISTS idx_hosts_hostname ON hosts(hostname);
CREATE INDEX IF NOT EXISTS idx_hosts_custom_name ON hosts(custom_name);
CREATE INDEX IF NOT EXISTS idx_hosts_vendor ON hosts(vendor);
CREATE INDEX IF NOT EXISTS idx_hosts_network_status ON hosts(network_id, status);
CREATE INDEX IF NOT EXISTS idx_hosts_os_family ON hosts(os_family);
CREATE INDEX IF NOT EXISTS idx_hosts_known_status ON hosts(known_host, status);
CREATE INDEX IF NOT EXISTS idx_hosts_network_mac ON hosts(network_id, mac);

-- Scan History
CREATE INDEX IF NOT EXISTS idx_scan_history_host ON scan_history(host_id);
CREATE INDEX IF NOT EXISTS idx_scan_history_network ON scan_history(network_id);

-- Status History
CREATE INDEX IF NOT EXISTS idx_status_history_host ON status_history(host_id);
CREATE INDEX IF NOT EXISTS idx_status_history_checked ON status_history(checked_at);
CREATE INDEX IF NOT EXISTS idx_status_history_checked_host ON status_history(checked_at DESC, host_id);

-- ARP
CREATE INDEX IF NOT EXISTS idx_arp_entries_device ON arp_entries(device_id);
CREATE INDEX IF NOT EXISTS idx_arp_entries_mac ON arp_entries(mac);
CREATE INDEX IF NOT EXISTS idx_arp_entries_mac_timestamp ON arp_entries(mac, timestamp DESC);

-- MAC Port
CREATE INDEX IF NOT EXISTS idx_mac_port_entries_device ON mac_port_entries(device_id);
CREATE INDEX IF NOT EXISTS idx_mac_port_entries_mac ON mac_port_entries(mac);
CREATE INDEX IF NOT EXISTS idx_mac_port_entries_device_mac ON mac_port_entries(device_id, mac);
-- v0.2.645 audit perf DB2: index composito per "ultimo entry per mac".
-- Sostituisce il pattern ROW_NUMBER() OVER (PARTITION BY mac) full-scan in
-- getAllHostsEnriched con JOIN su (mac, MAX(timestamp)) seek-only.
CREATE INDEX IF NOT EXISTS idx_mac_port_entries_mac_ts ON mac_port_entries(mac, timestamp DESC);

-- Network Router
CREATE INDEX IF NOT EXISTS idx_network_router_network ON network_router(network_id);
CREATE INDEX IF NOT EXISTS idx_network_router_router ON network_router(router_id);

-- Switch Ports
CREATE INDEX IF NOT EXISTS idx_switch_ports_device ON switch_ports(device_id);

-- Network Devices
CREATE INDEX IF NOT EXISTS idx_network_devices_credential ON network_devices(credential_id);
CREATE INDEX IF NOT EXISTS idx_network_devices_host ON network_devices(host);
CREATE INDEX IF NOT EXISTS idx_network_devices_device_type ON network_devices(device_type);
CREATE INDEX IF NOT EXISTS idx_network_devices_product_profile ON network_devices(product_profile);

-- MAC IP Mapping
CREATE INDEX IF NOT EXISTS idx_mac_ip_mapping_mac ON mac_ip_mapping(mac_normalized);
CREATE INDEX IF NOT EXISTS idx_mac_ip_mapping_ip ON mac_ip_mapping(ip);
CREATE INDEX IF NOT EXISTS idx_mac_ip_history_mac ON mac_ip_history(mac_normalized);

-- Scheduled Jobs
CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_enabled_next ON scheduled_jobs(enabled, next_run);

-- Network Credentials v2
CREATE INDEX IF NOT EXISTS idx_network_credentials_net ON network_credentials(network_id, sort_order);

-- Host Credentials v2
CREATE INDEX IF NOT EXISTS idx_host_credentials_host ON host_credentials(host_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_host_credentials_validated ON host_credentials(host_id, validated);

-- Multihomed Links
CREATE INDEX IF NOT EXISTS idx_multihomed_links_group ON multihomed_links(group_id);
CREATE INDEX IF NOT EXISTS idx_multihomed_links_host ON multihomed_links(host_id);

-- Device Credential Bindings
CREATE INDEX IF NOT EXISTS idx_dcb_device ON device_credential_bindings(device_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_dcb_credential ON device_credential_bindings(credential_id);

-- Inventory
CREATE INDEX IF NOT EXISTS idx_inventory_assets_network_device ON inventory_assets(network_device_id);
CREATE INDEX IF NOT EXISTS idx_inventory_assets_host ON inventory_assets(host_id);
CREATE INDEX IF NOT EXISTS idx_inventory_assets_asset_tag ON inventory_assets(asset_tag);
CREATE INDEX IF NOT EXISTS idx_inventory_assets_serial ON inventory_assets(serial_number);
CREATE INDEX IF NOT EXISTS idx_inventory_assets_stato ON inventory_assets(stato);
CREATE INDEX IF NOT EXISTS idx_inventory_assets_fine_garanzia ON inventory_assets(fine_garanzia);
CREATE INDEX IF NOT EXISTS idx_inventory_assets_asset_assignee ON inventory_assets(asset_assignee_id);
CREATE INDEX IF NOT EXISTS idx_inventory_assets_location ON inventory_assets(location_id);

-- Asset Assignees / Locations
CREATE INDEX IF NOT EXISTS idx_locations_parent ON locations(parent_id);

-- License Seats
CREATE INDEX IF NOT EXISTS idx_license_seats_license ON license_seats(license_id);
CREATE INDEX IF NOT EXISTS idx_license_seats_asset ON license_seats(asset_type, asset_id);
CREATE INDEX IF NOT EXISTS idx_license_seats_assignee ON license_seats(asset_assignee_id);

-- Audit Log
CREATE INDEX IF NOT EXISTS idx_inventory_audit_log_asset ON inventory_audit_log(asset_id);
CREATE INDEX IF NOT EXISTS idx_inventory_audit_log_created ON inventory_audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_inventory_audit_log_asset_created ON inventory_audit_log(asset_id, created_at DESC);

-- Proxmox
CREATE INDEX IF NOT EXISTS idx_proxmox_hosts_credential ON proxmox_hosts(credential_id);

-- AD
CREATE INDEX IF NOT EXISTS idx_ad_computers_integration ON ad_computers(integration_id);
CREATE INDEX IF NOT EXISTS idx_ad_computers_host ON ad_computers(host_id);
CREATE INDEX IF NOT EXISTS idx_ad_computers_dns ON ad_computers(dns_host_name);
CREATE INDEX IF NOT EXISTS idx_ad_users_integration ON ad_users(integration_id);
CREATE INDEX IF NOT EXISTS idx_ad_users_upn ON ad_users(user_principal_name);
CREATE INDEX IF NOT EXISTS idx_ad_users_email ON ad_users(email);
CREATE INDEX IF NOT EXISTS idx_ad_groups_integration ON ad_groups(integration_id);
CREATE INDEX IF NOT EXISTS idx_ad_dhcp_leases_integration ON ad_dhcp_leases(integration_id);
CREATE INDEX IF NOT EXISTS idx_ad_dhcp_leases_mac ON ad_dhcp_leases(mac_address);

-- DHCP Leases
CREATE INDEX IF NOT EXISTS idx_dhcp_leases_source ON dhcp_leases(source_type, source_device_id);
CREATE INDEX IF NOT EXISTS idx_dhcp_leases_mac ON dhcp_leases(mac_address);
CREATE INDEX IF NOT EXISTS idx_dhcp_leases_ip ON dhcp_leases(ip_address);
CREATE INDEX IF NOT EXISTS idx_dhcp_leases_host ON dhcp_leases(host_id);
CREATE INDEX IF NOT EXISTS idx_dhcp_leases_network ON dhcp_leases(network_id);

-- Anomaly Events
CREATE INDEX IF NOT EXISTS idx_anomaly_events_host     ON anomaly_events(host_id);
CREATE INDEX IF NOT EXISTS idx_anomaly_events_network  ON anomaly_events(network_id);
CREATE INDEX IF NOT EXISTS idx_anomaly_events_type     ON anomaly_events(anomaly_type);
CREATE INDEX IF NOT EXISTS idx_anomaly_events_detected ON anomaly_events(detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_anomaly_events_ack      ON anomaly_events(acknowledged, detected_at DESC);

-- Classification Feedback
CREATE INDEX IF NOT EXISTS idx_classification_feedback_host    ON classification_feedback(host_id);
CREATE INDEX IF NOT EXISTS idx_classification_feedback_class   ON classification_feedback(corrected_classification);
CREATE INDEX IF NOT EXISTS idx_classification_feedback_created ON classification_feedback(created_at DESC);

-- Neighbors / Routes
CREATE INDEX IF NOT EXISTS idx_device_neighbors_device ON device_neighbors(device_id);
CREATE INDEX IF NOT EXISTS idx_device_neighbors_remote ON device_neighbors(remote_device_name);
CREATE INDEX IF NOT EXISTS idx_topology_position_view ON topology_position(view);
CREATE INDEX IF NOT EXISTS idx_routing_table_device ON routing_table(device_id);
CREATE INDEX IF NOT EXISTS idx_routing_table_dest ON routing_table(destination);

-- LibreNMS host map
CREATE INDEX IF NOT EXISTS idx_librenms_host_map_network ON librenms_host_map(network_id);
CREATE INDEX IF NOT EXISTS idx_librenms_host_map_ip ON librenms_host_map(host_ip);

-- Wazuh
CREATE INDEX IF NOT EXISTS idx_wazuh_agent_host ON wazuh_agent(host_id);
CREATE INDEX IF NOT EXISTS idx_wazuh_agent_ip ON wazuh_agent(ip);
CREATE INDEX IF NOT EXISTS idx_wazuh_agent_mac ON wazuh_agent(mac);
CREATE INDEX IF NOT EXISTS idx_wazuh_agent_hostname ON wazuh_agent(hostname);
CREATE INDEX IF NOT EXISTS idx_wazuh_software_agent ON wazuh_software(agent_id);
CREATE INDEX IF NOT EXISTS idx_wazuh_software_name ON wazuh_software(name);
CREATE INDEX IF NOT EXISTS idx_wazuh_vuln_agent ON wazuh_vuln(agent_id);
CREATE INDEX IF NOT EXISTS idx_wazuh_vuln_cve ON wazuh_vuln(cve);
CREATE INDEX IF NOT EXISTS idx_wazuh_vuln_severity ON wazuh_vuln(severity);
CREATE INDEX IF NOT EXISTS idx_wazuh_ports_agent ON wazuh_ports(agent_id);
CREATE INDEX IF NOT EXISTS idx_wazuh_hotfix_agent ON wazuh_hotfix(agent_id);
CREATE INDEX IF NOT EXISTS idx_wazuh_netiface_agent ON wazuh_netiface(agent_id);
CREATE INDEX IF NOT EXISTS idx_wazuh_netaddr_agent ON wazuh_netaddr(agent_id);
CREATE INDEX IF NOT EXISTS idx_wazuh_netaddr_address ON wazuh_netaddr(address);
CREATE INDEX IF NOT EXISTS idx_wazuh_process_agent ON wazuh_process(agent_id);
CREATE INDEX IF NOT EXISTS idx_wazuh_process_name ON wazuh_process(name);
CREATE INDEX IF NOT EXISTS idx_wazuh_service_agent ON wazuh_service(agent_id);
CREATE INDEX IF NOT EXISTS idx_wazuh_service_enabled ON wazuh_service(agent_id, enabled);
CREATE INDEX IF NOT EXISTS idx_wazuh_netproto_agent ON wazuh_netproto(agent_id);

-- Vulnerability findings (scanner-edge integration)
CREATE INDEX IF NOT EXISTS idx_vuln_findings_host ON vuln_findings(host_id, scanned_at DESC);
CREATE INDEX IF NOT EXISTS idx_vuln_findings_ip ON vuln_findings(ip, scanned_at DESC);
CREATE INDEX IF NOT EXISTS idx_vuln_findings_ip_run ON vuln_findings(ip, scan_run_id);
CREATE INDEX IF NOT EXISTS idx_vuln_findings_severity ON vuln_findings(severity);
CREATE INDEX IF NOT EXISTS idx_vuln_findings_cve ON vuln_findings(cve_id);
CREATE INDEX IF NOT EXISTS idx_vuln_scan_runs_scanner ON vuln_scan_runs(scanner_id, finished_at DESC);

-- Software Inventory
CREATE INDEX IF NOT EXISTS idx_software_scans_host ON software_scans(host_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_software_scans_device ON software_scans(device_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_software_scans_status ON software_scans(status);
CREATE INDEX IF NOT EXISTS idx_software_inventory_scan ON software_inventory(scan_id);
CREATE INDEX IF NOT EXISTS idx_software_inventory_name_version ON software_inventory(name, version);
CREATE INDEX IF NOT EXISTS idx_software_scan_logs_scan ON software_scan_logs(scan_id, ts);

-- Aggregazioni globali (pagine /vulnerabilities e /software)
CREATE INDEX IF NOT EXISTS idx_vuln_findings_cve_severity ON vuln_findings(cve_id, severity);
CREATE INDEX IF NOT EXISTS idx_vuln_findings_nvt_severity ON vuln_findings(nvt_oid, severity) WHERE cve_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_vuln_findings_severity_cvss ON vuln_findings(severity, cvss_score DESC);
CREATE INDEX IF NOT EXISTS idx_wazuh_vuln_cve_severity ON wazuh_vuln(cve, severity);
CREATE INDEX IF NOT EXISTS idx_wazuh_vuln_status_severity ON wazuh_vuln(status, severity);
CREATE INDEX IF NOT EXISTS idx_wazuh_software_name_version ON wazuh_software(name, version);

-- Tombstone IP esclusi (vedi db-schema.ts per i dettagli).
CREATE TABLE IF NOT EXISTS excluded_ips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  network_id INTEGER NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  ip TEXT NOT NULL,
  excluded_at TEXT NOT NULL DEFAULT (datetime('now')),
  reason TEXT,
  excluded_by TEXT,
  UNIQUE(network_id, ip)
);
CREATE INDEX IF NOT EXISTS idx_excluded_ips_network_ip ON excluded_ips(network_id, ip);

-- v0.2.632: Classification custom — unique label case-insensitive per evitare
-- collisioni cognitive (Server PG / server pg) nelle UI.
CREATE UNIQUE INDEX IF NOT EXISTS idx_dcc_label_ci ON device_classifications_custom(lower(label));
CREATE INDEX IF NOT EXISTS idx_dcc_parent ON device_classifications_custom(parent_slug);

-- v0.2.634 audit B4: indici mancanti su filtri/aggregazioni frequenti.
-- - hosts(classification): filtro chip discovery + countHostsByClassification (DELETE custom)
-- - hosts(physical_device_id): cluster multihomed UI (objects/[id] tab cluster)
-- - network_devices(classification): join refresh + apply-classifications
-- - network_devices(physical_device_id): merge fisico devices/cluster lookup
CREATE INDEX IF NOT EXISTS idx_hosts_classification ON hosts(classification);
CREATE INDEX IF NOT EXISTS idx_hosts_physical_device_id ON hosts(physical_device_id);
CREATE INDEX IF NOT EXISTS idx_network_devices_classification ON network_devices(classification);
CREATE INDEX IF NOT EXISTS idx_network_devices_physical_device_id ON network_devices(physical_device_id);

-- v0.2.641 audit perf (DB3/DB9/DB12):
-- - scan_history(timestamp DESC): "recent activity" dashboard + scan card per-host
--   prima full-scan (80-150ms), ora index seek (~5ms).
-- - wazuh_vuln(agent_id, severity): counter dashboard "Critical/High per agent"
--   prima scan-filter dopo idx_agent (15ms × 2 sev × N agent), ora index composito.
-- - ad_computers(host_id, dns_host_name): covering index per JOIN
--   MAX(dns_host_name) ... GROUP BY host_id in getHostsByNetworkWithDevices /
--   getAllHostsEnriched (30ms -> 5ms per pagina rete).
CREATE INDEX IF NOT EXISTS idx_scan_history_timestamp ON scan_history(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_wazuh_vuln_agent_severity ON wazuh_vuln(agent_id, severity);
CREATE INDEX IF NOT EXISTS idx_ad_computers_host_dns ON ad_computers(host_id, dns_host_name);

-- MDM (Headwind)
CREATE INDEX IF NOT EXISTS idx_mobile_hist_dev ON mobile_inventory_history(device_id, changed_at);
CREATE INDEX IF NOT EXISTS idx_mobile_apps_dev ON mobile_device_apps(device_id);
CREATE INDEX IF NOT EXISTS idx_mobile_devices_host ON mobile_devices(host_id);

-- MeshCentral RMM
CREATE INDEX IF NOT EXISTS idx_mc_node_host ON mc_node(host_id);
CREATE INDEX IF NOT EXISTS idx_mc_node_mesh ON mc_node(mesh_id);
CREATE INDEX IF NOT EXISTS idx_mc_remote_session_host_ts ON mc_remote_session(host_id, created_at DESC);

-- Attribution v2 (spec §4.2)
CREATE INDEX IF NOT EXISTS idx_attr_evidence_host ON attribution_evidence(host_id, dimension);
CREATE INDEX IF NOT EXISTS idx_attr_evidence_active ON attribution_evidence(host_id, superseded_by) WHERE superseded_by IS NULL;
`;
