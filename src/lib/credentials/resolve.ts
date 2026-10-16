/**
 * Il motore unico delle credenziali (fase 1b attribuzione v2, §7; allargato
 * nella tappa 2 credenziali, T7, 16/10).
 *
 * Sceglie quale credenziale usare per un host, per un apparato o per una rete,
 * per un protocollo. Prima della tappa 2 l'acquisizione degli apparati
 * sceglieva fuori da qui: il primo binding in ordine anche se fallito, poi le
 * colonne di `network_devices` senza guardare il tipo (una voce `windows`
 * diventava il login SSH di un apparato snmp_v2), e «public» in silenzio.
 * Ogni candidato dice da dove viene (`source`).
 *
 * Dalla 2g (T26, D9 rivista da Riccardo il 16/10) il motore legge solo
 * l'archivio: niente più binding inline, colonne di `network_devices`, catene
 * vecchie (`network_host_credentials`, `host_detect_credential`) né chiavi «di
 * default» dell'hub. Le conversioni 2c-2f le hanno portate in binding, lista
 * della rete e righe host; un apparato che la 2e ha lasciato (sull'hub due,
 * accettati da Riccardo) resta senza credenziale finché una prova non
 * riesce. La conversione della 2e, che gira ancora su dati vecchi (bundle di
 * prima, appliance che arrivano da prima della 2e), ricostruisce la scelta di
 * prima con `fontiVecchie`: è l'unico innesto, e lo passa solo lei.
 *
 * Ordine per un apparato (D1 = (a)):
 *   1. binding d'archivio riusciti;            2. binding d'archivio non provati
 *      (per l'apparato provvisorio, la voce scelta nella finestra);
 *   3. righe host validate;                    4. righe host non validate fuori fermo;
 *   5. catena della rete;                      6. ripiego AD (solo WinRM, con l'opzione);
 *   7. per SNMP, «public» (`snmp_ripiego`, D5), mai a un apparato con una voce v3.
 * Un binding fallito si salta finché una prova non riesce (D10 = (a)). Un
 * apparato senza `host_id` non ha i livelli 3-6.
 *
 * Ordine per un host: righe validate, binding riusciti dell'apparato
 * collegato, righe non validate, binding non provati, rete, ripiego AD.
 *
 * Regole comuni: ogni livello con una voce passa da `tipiPerProtocollo`; si
 * deduplica per (voce o binding, porta); le righe in fermo (`backoff_until`
 * futuro) si saltano salvo `includeBackoff`.
 *
 * Le funzioni `…Db` prendono l'handle e non importano né `db.ts` né
 * `db-tenant.ts`: le gemelle dei due file ne sono involucri. Il solo `require`
 * di `db-tenant` (lecito, vedi `no-dynamic-db-tenant-import.test.ts`) serve a
 * trovare il tenant corrente per `resolveCredentialsFor` e per l'etichetta del
 * registro.
 */
import type Database from "better-sqlite3";

import { registraRipiego, type CasoRipiego } from "@/lib/db-maintenance/ripieghi";
import { V3_ASSENTE, type CredenzialeSnmp } from "@/lib/protocols/snmp-sessione";
import type { NetworkDevice, VociProvvisorie } from "@/types";
import { DEFAULT_PORTS, portaCredenziale, type CredProtocol } from "./porte";
import { leggiSegretoDb, opzioniSsh, type AccessoSsh, type Segreto, type UsoSegreto } from "./segreti";
import { normalizzaTipo, portaVoceValePer, tipiPerProtocollo } from "./tipi";

export { DEFAULT_PORTS, portaCredenziale };
export type { CredProtocol };

export interface ResolveTarget {
  hostId?: number;
  deviceId?: number;
  ip?: string;
  networkId: number;
}

/**
 * `fonte_vecchia`: un candidato che il motore non legge più dalla 2g e che
 * gli passa, con `fontiVecchie`, solo la conversione della 2e (T19) per
 * ricostruire la scelta di prima.
 */
export type ResolvedCredentialSource =
  | "device_binding"
  | "host_validated"
  | "host_unvalidated"
  | "network_chain"
  | "ad_fallback"
  | "snmp_ripiego"
  | "fonte_vecchia";

/**
 * Un candidato. `credential_id` è null per le fonti senza voce d'archivio
 * («public», e fra le fonti vecchie binding inline e colonne col segreto);
 * `binding_id` è quello del binding da cui viene; `device_id` è l'apparato del
 * bersaglio. `tipo` è il codice della voce com'è nel DB, null senza voce.
 * `etichetta` solo per `fonte_vecchia`: come la chiama chi l'ha data.
 */
export interface ResolvedCredential {
  credential_id: number | null;
  binding_id: number | null;
  device_id: number | null;
  protocol: CredProtocol;
  port: number;
  source: ResolvedCredentialSource;
  tipo: string | null;
  validated: boolean;
  fail_count: number;
  backoff_until: string | null;
  etichetta?: string;
}

export interface ResolveOptions {
  /** Include anche le credenziali con backoff_until futuro (default: escluse). */
  includeBackoff?: boolean;
  /** Tronca il risultato a N candidati (applicato dopo l'ordinamento/dedup). */
  limit?: number;
}

export interface OpzioniMotore extends ResolveOptions {
  /** Limita le fonti (le patch: righe host e ripiego AD, niente catena di rete). */
  fonti?: readonly ResolvedCredentialSource[];
  /** Ripiego sull'account WinRM dell'AD, solo per WinRM (D4). */
  conAdFallback?: boolean;
  /** Default true. False per controlli, fotografia e prova a vuoto: non registrano ripieghi. */
  registra?: boolean;
  /**
   * Solo per la conversione della 2e (T19), che deve ricostruire la scelta
   * del codice di prima della 2g su dati non ancora convertiti: i candidati
   * che il motore non legge più (binding inline, colonne dell'apparato), dopo
   * i binding d'archivio e prima di host, rete e «public». Nessun altro lo
   * passa; per entrare, `fonti` deve contenere `fonte_vecchia`.
   */
  fontiVecchie?: FontiVecchie;
}

/** Lettura del segreto di un candidato: il segreto, o il perché no. */
export type LetturaCandidato = { ok: true; segreto: Segreto; formatoVecchio?: boolean } | { ok: false; motivo: string };

/** Un candidato che il motore non legge più, col suo lettore (vedi `fontiVecchie`). */
export interface CandidatoVecchio {
  /** Come lo chiama chi lo dà: «binding inline», «colonna con la voce», «colonne col segreto». */
  etichetta: string;
  credential_id: number | null;
  binding_id: number | null;
  tipo: string | null;
  /** La porta propria; quella usata segue la regola di D11 come per gli altri candidati. */
  porta: number;
  validated: boolean;
  leggi: () => LetturaCandidato;
}

export interface FontiVecchie {
  /** I candidati per un protocollo, nell'ordine in cui il codice di prima li provava. */
  candidati: (protocol: CredProtocol) => CandidatoVecchio[];
  /** Una voce v3 fra le fonti vecchie: il «public» non vale (D5). */
  conV3: boolean;
}

/** Le fonti dell'apparato: i suoi binding d'archivio (e, per l'apparato provvisorio, la voce scelta). */
export const FONTI_APPARATO: readonly ResolvedCredentialSource[] = Object.freeze(["device_binding"] as const);

/**
 * Acquisizione, «ha SNMP?», LibreNMS e Omada (D1b = (a)): le fonti
 * dell'apparato e, per SNMP v1/v2c senza nessuna di quelle, il «public» di
 * oggi. Mai host, rete o hub.
 */
export const FONTI_ACQUISIZIONE: readonly ResolvedCredentialSource[] = Object.freeze([...FONTI_APPARATO, "snmp_ripiego"] as const);

export type SceltaSegreto =
  | { ok: true; candidato: ResolvedCredential; segreto: Segreto }
  | { ok: false; motivo: string };

/** Il caso del registro per ogni ripiego dichiarato; le altre fonti non si registrano. */
const CASO_PER_FONTE: Partial<Record<ResolvedCredentialSource, CasoRipiego>> = {
  snmp_ripiego: "cred_public",
};

const NOME_PROTOCOLLO: Record<CredProtocol, string> = {
  ssh: "SSH",
  winrm: "WinRM",
  snmp: "SNMP",
  api: "API",
  redfish: "Redfish",
  onvif: "ONVIF",
};

function usoPer(protocol: CredProtocol): UsoSegreto {
  if (protocol === "ssh" || protocol === "winrm" || protocol === "snmp") return protocol;
  return "api";
}

/** La porta propria di una voce vale solo per un protocollo suo (revisione della 2a). */
function portaVoce(tipo: string | null, port: number | null, protocol: CredProtocol): number {
  return portaVoceValePer(tipo, protocol) ? portaCredenziale({ port }, protocol) : DEFAULT_PORTS[protocol];
}

function ammesso(tipi: readonly string[], tipo: string | null): boolean {
  return tipo != null && tipi.includes(tipo);
}

function segnaposti(n: number): string {
  return Array.from({ length: n }, () => "?").join(",");
}

// ── Letture delle fonti ────────────────────────────────────────────────────

interface StatoRigaHost {
  credential_id: number;
  port: number;
  validated: number;
  fail_count: number;
  backoff_until: string | null;
}

interface RigaHost extends StatoRigaHost {
  credential_type: string;
}

interface RigaBinding {
  id: number;
  credential_id: number | null;
  port: number;
  test_status: string;
  credential_type: string | null;
}

interface VoceTrovata {
  credential_id: number;
  port: number | null;
  credential_type: string;
}

/** Stato di fallimento di tutte le righe host del protocollo, per (voce, porta). */
function statoRigheHost(dbh: Database.Database, hostId: number | null, protocol: CredProtocol): Map<string, StatoRigaHost> {
  const mappa = new Map<string, StatoRigaHost>();
  if (hostId == null) return mappa;
  const righe = dbh
    .prepare(
      `SELECT credential_id, port, validated, fail_count, backoff_until
       FROM host_credentials WHERE host_id = ? AND protocol_type = ?`
    )
    .all(hostId, protocol) as StatoRigaHost[];
  for (const r of righe) mappa.set(`${r.credential_id}:${r.port}`, r);
  return mappa;
}

function righeHost(dbh: Database.Database, hostId: number, protocol: CredProtocol, tipi: readonly string[]): RigaHost[] {
  return dbh
    .prepare(
      `SELECT hc.credential_id, hc.port, hc.validated, hc.fail_count, hc.backoff_until, c.credential_type
       FROM host_credentials hc
       JOIN credentials c ON c.id = hc.credential_id
       WHERE hc.host_id = ? AND hc.protocol_type = ? AND c.credential_type IN (${segnaposti(tipi.length)})
       ORDER BY hc.sort_order ASC, hc.id ASC`
    )
    .all(hostId, protocol, ...tipi) as RigaHost[];
}

/** Binding del protocollo, falliti esclusi (D10 = (a)); la voce può mancare (inline o orfano: il motore li salta). */
function bindingNonFalliti(dbh: Database.Database, deviceId: number, protocol: CredProtocol): RigaBinding[] {
  return dbh
    .prepare(
      `SELECT b.id, b.credential_id, b.port, b.test_status, c.credential_type
       FROM device_credential_bindings b
       LEFT JOIN credentials c ON c.id = b.credential_id
       WHERE b.device_id = ? AND b.protocol_type = ? AND b.test_status != 'failed'
       ORDER BY b.sort_order ASC, b.id ASC`
    )
    .all(deviceId, protocol) as RigaBinding[];
}

function vociRete(dbh: Database.Database, networkId: number, tipi: readonly string[]): VoceTrovata[] {
  return dbh
    .prepare(
      `SELECT nc.credential_id, c.port, c.credential_type
       FROM network_credentials nc
       JOIN credentials c ON c.id = nc.credential_id
       WHERE nc.network_id = ? AND c.credential_type IN (${segnaposti(tipi.length)})
       ORDER BY nc.sort_order ASC, nc.id ASC`
    )
    .all(networkId, ...tipi) as VoceTrovata[];
}

function leggiVoce(dbh: Database.Database, id: number): VoceTrovata | null {
  const r = dbh.prepare(`SELECT * FROM credentials WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  if (!r) return null;
  return {
    credential_id: id,
    port: typeof r.port === "number" ? r.port : null,
    credential_type: typeof r.credential_type === "string" ? r.credential_type : "",
  };
}

/**
 * Account WinRM della prima integrazione AD attiva (per id dell'integrazione)
 * che ne ha uno, come il loader delle patch prima del T9; col filtro di tipo.
 * L'alias non si chiama `id`: in SQLite `ORDER BY id` userebbe l'alias, cioè
 * l'id della voce, e con due integrazioni sceglierebbe l'altra.
 */
function voceAd(dbh: Database.Database, tipi: readonly string[]): VoceTrovata | null {
  const r = dbh
    .prepare(
      `SELECT ai.winrm_credential_id AS cid FROM ad_integrations ai
       WHERE ai.enabled = 1 AND ai.winrm_credential_id IS NOT NULL
       ORDER BY ai.id ASC LIMIT 1`
    )
    .get() as { cid: number } | undefined;
  if (!r) return null;
  const v = leggiVoce(dbh, r.cid);
  return v && ammesso(tipi, v.credential_type) ? v : null;
}

// ── Raccolta dei candidati ─────────────────────────────────────────────────

interface Proposta {
  source: ResolvedCredentialSource;
  credential_id: number | null;
  binding_id?: number | null;
  tipo: string | null;
  port: number;
  /** Il fermo dell'host vale per questo livello. */
  conFermo: boolean;
  /** Validata per un motivo suo (binding riuscito); altrimenti dallo stato della riga host. */
  validated?: boolean;
  /** Stato della riga host da cui viene; altrimenti cercato per (voce, porta). */
  stato?: StatoRigaHost;
  /** Solo per `fonte_vecchia`: il nome e il lettore che dà chi lo passa. */
  etichetta?: string;
  leggi?: () => LetturaCandidato;
}

/** Il lettore di ogni candidato `fonte_vecchia`, fuori dall'oggetto (che resta un dato). */
const lettoriVecchi = new WeakMap<ResolvedCredential, () => LetturaCandidato>();

function nuovaRaccolta(
  protocol: CredProtocol,
  deviceId: number | null,
  stati: Map<string, StatoRigaHost>,
  opts: OpzioniMotore
): { aggiungi: (p: Proposta) => void; risultati: ResolvedCredential[] } {
  const risultati: ResolvedCredential[] = [];
  const visti = new Set<string>();
  const adesso = new Date().toISOString();
  const aggiungi = (p: Proposta): void => {
    if (opts.fonti && !opts.fonti.includes(p.source)) return;
    const chiave =
      p.credential_id != null
        ? `v${p.credential_id}:${p.port}`
        : p.binding_id != null
          ? `b${p.binding_id}:${p.port}`
          : `${p.source}:${p.etichetta ?? ""}:${p.port}`;
    if (visti.has(chiave)) return;
    visti.add(chiave);
    const stato = p.stato ?? (p.credential_id != null ? stati.get(`${p.credential_id}:${p.port}`) : undefined);
    const backoffUntil = stato?.backoff_until ?? null;
    if (p.conFermo && !opts.includeBackoff && backoffUntil && backoffUntil > adesso) return;
    const r: ResolvedCredential = {
      credential_id: p.credential_id,
      binding_id: p.binding_id ?? null,
      device_id: deviceId,
      protocol,
      port: p.port,
      source: p.source,
      tipo: p.tipo,
      validated: p.validated ?? stato?.validated === 1,
      fail_count: stato?.fail_count ?? 0,
      backoff_until: backoffUntil,
      ...(p.etichetta != null ? { etichetta: p.etichetta } : {}),
    };
    if (p.leggi) lettoriVecchi.set(r, p.leggi);
    risultati.push(r);
  };
  return { aggiungi, risultati };
}

function tronca(r: ResolvedCredential[], opts: OpzioniMotore): ResolvedCredential[] {
  return opts.limit != null ? r.slice(0, opts.limit) : r;
}

// ── Motore per un host ─────────────────────────────────────────────────────

/**
 * Risolve il device collegato a un host (bridge host→device) o l'host
 * collegato a un device (bridge device→host): prima la FK
 * `network_devices.host_id`, poi l'indirizzo su `host`.
 */
function bridgeIds(
  dbh: Database.Database,
  hostId: number | null,
  deviceId: number | null,
  ip: string | undefined
): { hostId: number | null; deviceId: number | null } {
  let resolvedDeviceId = deviceId;
  let resolvedHostId = hostId;

  if (resolvedHostId != null && resolvedDeviceId == null) {
    const byFk = dbh
      .prepare(`SELECT id FROM network_devices WHERE host_id = ? ORDER BY id LIMIT 1`)
      .get(resolvedHostId) as { id: number } | undefined;
    if (byFk) {
      resolvedDeviceId = byFk.id;
    } else if (ip) {
      const byIp = dbh
        .prepare(`SELECT id FROM network_devices WHERE host = ? ORDER BY id LIMIT 1`)
        .get(ip) as { id: number } | undefined;
      resolvedDeviceId = byIp?.id ?? null;
    }
  }

  if (resolvedDeviceId != null && resolvedHostId == null) {
    const byFk = dbh
      .prepare(`SELECT host_id FROM network_devices WHERE id = ?`)
      .get(resolvedDeviceId) as { host_id: number | null } | undefined;
    resolvedHostId = byFk?.host_id ?? null;
  }

  return { hostId: resolvedHostId, deviceId: resolvedDeviceId };
}

/**
 * Candidati per un host (o una rete), nell'ordine di oggi:
 *   1. righe host validate;           2. binding riusciti dell'apparato collegato;
 *   3. righe host non validate;       4. binding non provati;
 *   5. catena della rete;             6. ripiego AD (WinRM, con `conAdFallback`).
 * Tutti col filtro di tipo e col fermo. Dalla 2g niente catene vecchie né
 * chiave dell'hub, anche in un tenant senza il segno della 2d (T26). Non
 * registra: è una lista, sceglie chi la usa (`scegliSegretoHostDb`, o la
 * discovery, che dalla 2d prova questa catena per ogni host: D2 = (a)).
 */
export function resolveCredentialsForDb(
  dbh: Database.Database,
  target: ResolveTarget,
  protocol: CredProtocol,
  opts: OpzioniMotore = {}
): ResolvedCredential[] {
  const { hostId, deviceId } = bridgeIds(dbh, target.hostId ?? null, target.deviceId ?? null, target.ip);
  const tipi = tipiPerProtocollo(protocol);
  const { aggiungi, risultati } = nuovaRaccolta(protocol, deviceId, statoRigheHost(dbh, hostId, protocol), opts);

  const righe = hostId != null ? righeHost(dbh, hostId, protocol, tipi) : [];
  const binding =
    deviceId != null ? bindingNonFalliti(dbh, deviceId, protocol).filter((b) => b.credential_id != null && ammesso(tipi, b.credential_type)) : [];
  const daRiga = (r: RigaHost, source: ResolvedCredentialSource): Proposta => ({
    source,
    credential_id: r.credential_id,
    tipo: r.credential_type,
    port: r.port,
    conFermo: true,
    stato: r,
  });
  const daBinding = (b: RigaBinding): Proposta => ({
    source: "device_binding",
    credential_id: b.credential_id,
    binding_id: b.id,
    tipo: b.credential_type,
    port: b.port,
    conFermo: true,
  });

  for (const r of righe) if (r.validated === 1) aggiungi(daRiga(r, "host_validated"));
  for (const b of binding) if (b.test_status === "success") aggiungi(daBinding(b));
  for (const r of righe) if (r.validated !== 1) aggiungi(daRiga(r, "host_unvalidated"));
  for (const b of binding) if (b.test_status === "untested") aggiungi(daBinding(b));
  livelliComuni(dbh, aggiungi, { networkId: target.networkId, protocol, tipi, opts, porta: (p) => p });

  return tronca(risultati, opts);
}

/** Livelli dalla catena della rete in giù, uguali per host e apparati. */
function livelliComuni(
  dbh: Database.Database,
  aggiungi: (p: Proposta) => void,
  c: {
    networkId: number | null;
    protocol: CredProtocol;
    tipi: readonly string[];
    opts: OpzioniMotore;
    porta: (propria: number) => number;
  }
): void {
  const daVoce = (v: VoceTrovata, source: ResolvedCredentialSource): Proposta => ({
    source,
    credential_id: v.credential_id,
    tipo: v.credential_type,
    port: c.porta(portaVoce(v.credential_type, v.port, c.protocol)),
    conFermo: true,
  });
  if (c.networkId != null) for (const v of vociRete(dbh, c.networkId, c.tipi)) aggiungi(daVoce(v, "network_chain"));
  if (c.opts.conAdFallback && c.protocol === "winrm") {
    const ad = voceAd(dbh, c.tipi);
    // Porta 5985 come il ripiego di oggi delle patch: 5986 vuole un certificato sul bersaglio.
    if (ad) aggiungi({ source: "ad_fallback", credential_id: ad.credential_id, tipo: ad.credential_type, port: c.porta(DEFAULT_PORTS.winrm), conFermo: true });
  }
}

/** Prima credenziale utilizzabile secondo `resolveCredentialsForDb`, o null. */
export function resolveCredentialForDb(
  dbh: Database.Database,
  target: ResolveTarget,
  protocol: CredProtocol
): ResolvedCredential | null {
  const [first] = resolveCredentialsForDb(dbh, target, protocol, { limit: 1 });
  return first ?? null;
}

// ── Motore per un apparato ─────────────────────────────────────────────────

interface Apparato {
  id: number;
  name: string;
  protocol: string | null;
  port: number | null;
  host_id: number | null;
  /** Solo per l'apparato provvisorio (id 0, mai salvato): le voci scelte nella finestra. */
  voci: VociProvvisorie | null;
}

/** Riga dell'apparato con SELECT *: in un DEFAULT mai riaperto `host_id` può mancare. */
function leggiApparato(dbh: Database.Database, deviceId: number): Apparato | null {
  const r = dbh.prepare(`SELECT * FROM network_devices WHERE id = ?`).get(deviceId) as Record<string, unknown> | undefined;
  if (!r) return null;
  const num = (k: string): number | null => (typeof r[k] === "number" ? (r[k] as number) : null);
  const str = (k: string): string | null => (typeof r[k] === "string" ? (r[k] as string) : null);
  return {
    id: deviceId,
    name: str("name") ?? `#${deviceId}`,
    protocol: str("protocol"),
    port: num("port"),
    host_id: num("host_id"),
    voci: null,
  };
}

/** Protocollo principale dell'apparato nel vocabolario delle credenziali. */
function protocolloPrincipale(p: string | null): CredProtocol | null {
  if (p === "ssh" || p === "winrm" || p === "api") return p;
  if (p === "snmp_v2" || p === "snmp_v3") return "snmp";
  return null;
}

/** Il protocollo di login dell'acquisizione (getDeviceCredentials): winrm, api, altrimenti ssh. */
function protocolloLogin(p: string | null): CredProtocol {
  return p === "winrm" ? "winrm" : p === "api" ? "api" : "ssh";
}

/**
 * Le voci scelte nella finestra di un apparato provvisorio, nell'ordine in cui
 * le provava la prova di prima (quando stavano nelle colonne dell'oggetto): per
 * SNMP, con un apparato SNMP, prima quella del protocollo principale.
 */
function vociProvvisorie(app: Apparato, protocol: CredProtocol): number[] {
  if (!app.voci) return [];
  const { principale, snmp } = app.voci;
  if (protocol !== "snmp") return principale != null ? [principale] : [];
  const ids = protocolloPrincipale(app.protocol) === "snmp" ? [principale, snmp] : [snmp, principale];
  return ids.filter((id): id is number => id != null);
}

/** Una voce SNMP è v3 col tipo `snmp_v3` o con un livello di sicurezza. */
export function voceSnmpV3Db(dbh: Database.Database, id: number): boolean {
  const r = dbh.prepare(`SELECT * FROM credentials WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  if (!r) return false;
  const tipo = normalizzaTipo(typeof r.credential_type === "string" ? r.credential_type : null);
  const livello = typeof r.security_level === "string" ? r.security_level.trim() : "";
  return tipo === "snmp_v3" || (tipo === "snmp" && livello !== "");
}

/** D5: «public» mai a un apparato che ha una sua voce v3 (binding, voce provvisoria o, per la 2e, fonte vecchia). */
function apparatoConV3(dbh: Database.Database, app: Apparato, binding: RigaBinding[], opts: OpzioniMotore): boolean {
  if (opts.fontiVecchie?.conV3) return true;
  const ids = new Set<number>(vociProvvisorie(app, "snmp"));
  for (const b of binding) if (b.credential_id != null) ids.add(b.credential_id);
  for (const id of ids) if (voceSnmpV3Db(dbh, id)) return true;
  return false;
}

/**
 * `portaPropria`: ogni candidato con la porta sua, anche per il protocollo
 * principale. Serve all'SSH di Proxmox, dove `device.port` è la porta dell'API
 * anche quando il protocollo dell'apparato è `ssh` (riga 15 del piano).
 */
function candidatiApparato(
  dbh: Database.Database,
  app: Apparato,
  protocol: CredProtocol,
  opts: OpzioniMotore,
  portaPropria = false
): ResolvedCredential[] {
  const tipi = tipiPerProtocollo(protocol);
  const hostId = app.host_id;
  const host =
    hostId != null ? (dbh.prepare(`SELECT network_id FROM hosts WHERE id = ?`).get(hostId) as { network_id: number | null } | undefined) : undefined;
  // Un host_id che punta a un host che non c'è: come senza host.
  const conHost = host != null;
  const { aggiungi, risultati } = nuovaRaccolta(protocol, app.id, statoRigheHost(dbh, conHost ? hostId : null, protocol), opts);

  // D11 = (a): per il protocollo principale (non SNMP) la porta dell'apparato;
  // per SNMP e per gli altri protocolli (l'SSH di Proxmox) quella del candidato.
  const portaApparato = !portaPropria && protocol !== "snmp" && protocol === protocolloPrincipale(app.protocol) ? app.port : null;
  const porta = (propria: number): number => portaApparato ?? propria;
  // SNMP (D11 = (a)): la porta del binding o della voce, altrimenti 161, anche su un apparato SNMP. `device.port`
  // non vale per SNMP: può essere la porta SSH rimasta (F3), e prima del T8 sette lettori su otto usavano la 161.
  const predefinita = DEFAULT_PORTS[protocol];

  // Binding falliti esclusi (D10); quelli senza voce (inline, orfani) il motore non li legge più (2g).
  const binding = bindingNonFalliti(dbh, app.id, protocol);
  const conVoce = binding.filter((b) => b.credential_id != null && ammesso(tipi, b.credential_type));
  // 1-2. binding d'archivio: riusciti, poi non provati.
  for (const b of conVoce) {
    if (b.test_status === "success") {
      aggiungi({ source: "device_binding", credential_id: b.credential_id, binding_id: b.id, tipo: b.credential_type, port: porta(b.port), conFermo: false, validated: true });
    }
  }
  for (const b of conVoce) {
    if (b.test_status === "untested") {
      aggiungi({ source: "device_binding", credential_id: b.credential_id, binding_id: b.id, tipo: b.credential_type, port: porta(b.port), conFermo: false });
    }
  }
  // 2. per l'apparato provvisorio, la voce scelta nella finestra: un binding non ancora provato.
  for (const id of vociProvvisorie(app, protocol)) {
    const v = leggiVoce(dbh, id);
    if (v && ammesso(tipi, v.credential_type)) {
      const propria = portaVoceValePer(v.credential_type, protocol) && v.port != null ? v.port : predefinita;
      aggiungi({ source: "device_binding", credential_id: id, tipo: v.credential_type, port: porta(propria), conFermo: false });
    }
  }
  // Solo per la conversione della 2e: le fonti di prima, dove le provava il codice di prima.
  for (const v of opts.fontiVecchie?.candidati(protocol) ?? []) {
    aggiungi({
      source: "fonte_vecchia",
      credential_id: v.credential_id,
      binding_id: v.binding_id,
      tipo: v.tipo,
      port: porta(v.porta),
      conFermo: false,
      validated: v.validated,
      etichetta: v.etichetta,
      leggi: v.leggi,
    });
  }

  // 3-6. host e rete (e ripiego AD): solo con un host.
  if (conHost && hostId != null) {
    const righe = righeHost(dbh, hostId, protocol, tipi);
    for (const r of righe) {
      if (r.validated === 1) aggiungi({ source: "host_validated", credential_id: r.credential_id, tipo: r.credential_type, port: porta(r.port), conFermo: true, stato: r });
    }
    for (const r of righe) {
      if (r.validated !== 1) aggiungi({ source: "host_unvalidated", credential_id: r.credential_id, tipo: r.credential_type, port: porta(r.port), conFermo: true, stato: r });
    }
    livelliComuni(dbh, aggiungi, { networkId: host?.network_id ?? null, protocol, tipi, opts, porta });
  }

  // 7. «public» (D5), ultimo.
  if (protocol === "snmp" && !apparatoConV3(dbh, app, binding, opts)) {
    aggiungi({ source: "snmp_ripiego", credential_id: null, tipo: null, port: predefinita, conFermo: false });
  }
  return tronca(risultati, opts);
}

/**
 * Candidati per un apparato, nell'ordine D1 = (a) (vedi testa del file). Non
 * registra: le verifiche (fotografia, prova a vuoto) la usano con
 * `leggiSegretoDb`. Apparato inesistente → lista vuota.
 */
export function credenzialiApparatoDb(
  dbh: Database.Database,
  deviceId: number,
  protocol: CredProtocol,
  opts: OpzioniMotore = {}
): ResolvedCredential[] {
  const app = leggiApparato(dbh, deviceId);
  return app ? candidatiApparato(dbh, app, protocol, opts) : [];
}

// ── Scelta col segreto ─────────────────────────────────────────────────────

function leggiCandidato(dbh: Database.Database, c: ResolvedCredential, apparatoV3: boolean): LetturaCandidato {
  if (c.source === "snmp_ripiego") return { ok: true, segreto: { forma: "community", community: "public" } };
  if (c.source === "fonte_vecchia") {
    const leggi = lettoriVecchi.get(c);
    return leggi ? leggi() : { ok: false, motivo: `Candidato «${c.etichetta ?? c.source}» senza lettore` };
  }
  if (c.credential_id == null) return { ok: false, motivo: `Candidato ${c.source} senza voce d'archivio` };
  const e = leggiSegretoDb(dbh, c.credential_id, usoPer(c.protocol), { apparatoV3 });
  return e.ok ? { ok: true, segreto: e.segreto, formatoVecchio: e.formatoVecchio === true } : { ok: false, motivo: e.motivo };
}

/** Tenant dell'etichetta del registro. Fuori da un contesto tenant: null. */
function codiceTenantCorrente(): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getCurrentTenantCode } = require("@/lib/db-tenant") as typeof import("@/lib/db-tenant");
    return getCurrentTenantCode();
  } catch (e) {
    // L'etichetta è facoltativa e il registro non deve mai fermare la scelta;
    // il guasto però si vede.
    console.error("[credentials] tenant corrente non leggibile per il registro dei ripieghi:", e);
    return null;
  }
}

function registra(casi: Iterable<CasoRipiego | undefined>): void {
  const unici = new Set<CasoRipiego>();
  for (const c of casi) if (c) unici.add(c);
  if (unici.size === 0) return;
  const tenant = codiceTenantCorrente();
  for (const caso of unici) registraRipiego(caso, tenant);
}

/**
 * Il primo candidato il cui segreto si legge (e, con `accetta`, ha la forma
 * che serve a chi chiama: un rifiuto è un motivo, e si passa al candidato
 * dopo). Nessun candidato, o nessuno buono: un motivo che li elenca tutti, mai
 * una scelta muta.
 */
function scegli(
  dbh: Database.Database,
  candidati: ResolvedCredential[],
  c: {
    apparatoV3: boolean;
    opts: OpzioniMotore;
    protocol: CredProtocol;
    perChi: string;
    accetta?: (s: Segreto) => string | null;
  }
): SceltaSegreto {
  const nome = NOME_PROTOCOLLO[c.protocol];
  if (candidati.length === 0) return { ok: false, motivo: `Nessuna credenziale ${nome} per ${c.perChi}` };
  const motivi: string[] = [];
  for (const cand of candidati) {
    const l = leggiCandidato(dbh, cand, c.apparatoV3);
    if (!l.ok) {
      motivi.push(l.motivo);
      continue;
    }
    const rifiuto = c.accetta?.(l.segreto) ?? null;
    if (rifiuto) {
      motivi.push(rifiuto);
      continue;
    }
    if (c.opts.registra !== false) registra([CASO_PER_FONTE[cand.source], l.formatoVecchio ? "cred_v3_vecchia" : undefined]);
    return { ok: true, candidato: cand, segreto: l.segreto };
  }
  return { ok: false, motivo: `Nessuna credenziale ${nome} utilizzabile per ${c.perChi}: ${motivi.join("; ")}` };
}

/**
 * La credenziale da usare per un apparato, col segreto: il primo candidato
 * (`credenzialiApparatoDb`) il cui segreto si legge. Registra il ripiego
 * quando la scelta è il «public» dichiarato (D5) o una v3 nel formato
 * vecchio, salvo `registra: false`.
 */
export function scegliSegretoApparatoDb(
  dbh: Database.Database,
  deviceId: number,
  protocol: CredProtocol,
  opts: OpzioniMotore = {}
): SceltaSegreto {
  const app = leggiApparato(dbh, deviceId);
  if (!app) return { ok: false, motivo: `L'apparato #${deviceId} non esiste` };
  return scegliPerApparato(dbh, app, protocol, opts);
}

function scegliPerApparato(
  dbh: Database.Database,
  app: Apparato,
  protocol: CredProtocol,
  opts: OpzioniMotore,
  accetta?: (s: Segreto) => string | null
): SceltaSegreto {
  return scegli(dbh, candidatiApparato(dbh, app, protocol, opts), {
    apparatoV3: protocol === "snmp" && app.protocol === "snmp_v3",
    opts,
    protocol,
    perChi: `l'apparato «${app.name}»`,
    accetta,
  });
}

/**
 * La credenziale da usare per un host (o una rete), col segreto: il primo
 * candidato di `resolveCredentialsForDb` il cui segreto si legge. Registra
 * come `scegliSegretoApparatoDb`.
 */
export function scegliSegretoHostDb(
  dbh: Database.Database,
  target: ResolveTarget,
  protocol: CredProtocol,
  opts: OpzioniMotore = {}
): SceltaSegreto {
  const candidati = resolveCredentialsForDb(dbh, target, protocol, opts);
  const ip =
    target.ip ??
    (target.hostId != null ? (dbh.prepare(`SELECT ip FROM hosts WHERE id = ?`).get(target.hostId) as { ip: string } | undefined)?.ip : undefined);
  const perChi = target.hostId != null ? `l'host ${ip ?? `#${target.hostId}`}` : `la rete #${target.networkId}`;
  return scegli(dbh, candidati, { apparatoV3: false, opts, protocol, perChi });
}

// ── Acquisizione degli apparati (T8) ───────────────────────────────────────
// Le funzioni sotto sono quelle che l'acquisizione chiama (getDeviceCredentials,
// credenzialeSnmpApparato, haSnmpApparato, portaSshApparato sono loro involucri
// di una riga), e la fotografia le chiama con `registra: false`. Tutte con
// FONTI_ACQUISIZIONE (D1b = (a)): mai host, rete o hub.

/**
 * I campi di un apparato che l'acquisizione passa al motore. Un apparato
 * salvato (id > 0) si rilegge dal DB. Uno provvisorio (la prova dalla
 * finestra, id 0, mai salvato) vale per l'oggetto: le voci scelte nella
 * finestra (`voci_provvisorie`, una per il protocollo principale e una per
 * SNMP), nessun binding, nessun host. Fino alla 2g le voci stavano nelle
 * colonne dell'oggetto, che il motore non legge più (T26).
 */
export type ApparatoInAcquisizione = Pick<NetworkDevice, "id" | "name" | "protocol" | "port" | "voci_provvisorie">;

function apparatoDi(dbh: Database.Database, device: ApparatoInAcquisizione): Apparato | null {
  if (device.id > 0) return leggiApparato(dbh, device.id);
  return {
    id: device.id,
    name: device.name || "apparato provvisorio",
    protocol: device.protocol ?? null,
    port: device.port ?? null,
    host_id: null,
    voci: device.voci_provvisorie ?? null,
  };
}

const nonEsiste = (device: ApparatoInAcquisizione): { ok: false; motivo: string } => ({
  ok: false,
  motivo: `L'apparato «${device.name}» (#${device.id}) non esiste`,
});

/**
 * Login dell'acquisizione (getDeviceCredentials) per il protocollo di login
 * dell'apparato (winrm, api, altrimenti ssh). Un binding fallito si salta
 * (D10 = (a)); la porta resta quella dell'apparato (D11 = (a)).
 *
 * Forme (T14, D6 = (a)):
 * - ssh: utente con password o con chiave, nell'ordine dei candidati;
 * - winrm: utente e password;
 * - api: prima utente e password (l'API li vuole); solo se nessun candidato
 *   li ha, una voce SSH a chiave. È l'SSH di Proxmox (voce `ssh` legata
 *   all'API, regola della tappa 1): con la chiave l'SSH entra, l'API no, e
 *   chi chiama lo dice. Così una voce a chiave non prende mai il posto di una
 *   con password che oggi fa funzionare l'API.
 *
 * `fonti` (default FONTI_ACQUISIZIONE) e `fontiVecchie` servono solo alla
 * conversione della 2e, che ricostruisce la scelta di prima della 2g:
 * l'acquisizione non li passa.
 */
export function sceltaLoginApparatoDb(
  dbh: Database.Database,
  device: ApparatoInAcquisizione,
  opts: Pick<OpzioniMotore, "registra" | "fonti" | "fontiVecchie"> = {}
): SceltaSegreto {
  const app = apparatoDi(dbh, device);
  if (!app) return nonEsiste(device);
  const protocollo = protocolloLogin(app.protocol);
  const motore: OpzioniMotore = { fonti: opts.fonti ?? FONTI_ACQUISIZIONE, registra: opts.registra, fontiVecchie: opts.fontiVecchie };
  if (protocollo === "ssh") {
    return scegliPerApparato(dbh, app, "ssh", motore, (s) =>
      s.forma === "utente" || s.forma === "chiave_ssh" ? null : `l'apparato «${app.name}» accede con utente e password o con una chiave SSH`
    );
  }
  const conPassword = scegliPerApparato(dbh, app, protocollo, motore, (s) =>
    s.forma === "utente" ? null : `l'apparato «${app.name}» per ${NOME_PROTOCOLLO[protocollo]} accede solo con utente e password`
  );
  if (conPassword.ok || protocollo !== "api") return conPassword;
  const conChiave = scegliPerApparato(dbh, app, "api", motore, (s) => (s.forma === "chiave_ssh" ? null : "nessuna chiave SSH"));
  return conChiave.ok ? conChiave : conPassword;
}

/** getDeviceCredentials: l'accesso di `sceltaLoginApparatoDb` (password o chiave), o null senza una credenziale buona. */
export function loginApparatoDb(dbh: Database.Database, device: ApparatoInAcquisizione): AccessoSsh | null {
  const s = sceltaLoginApparatoDb(dbh, device);
  return s.ok ? opzioniSsh(s.segreto) : null;
}

/** `etichetta` solo per una `fonte_vecchia` (conversione della 2e). */
export type SceltaSnmpApparato =
  | { ok: true; cred: CredenzialeSnmp; port: number; fonte: ResolvedCredentialSource; credential_id: number | null; etichetta?: string }
  | { ok: false; motivo: string };

/**
 * La credenziale SNMP dell'acquisizione, al posto di getDeviceCommunityString
 * e getDeviceSnmpV3Credentials: binding d'archivio (riusciti, poi non
 * provati), poi «public» dichiarato (D5), mai a un apparato con una voce v3.
 * Un apparato `snmp_v3` accetta solo una v3: senza, «Credenziale SNMPv3
 * assente o illeggibile», mai la community (T4). La porta è quella del
 * candidato (D11 = (a)): 161, o quella del binding o della voce. Il record v3
 * esce ripulito dagli spazi, come lo dava getDeviceSnmpV3Credentials.
 * `fonti` e `fontiVecchie` come in `sceltaLoginApparatoDb`: solo per la 2e.
 */
export function credenzialeSnmpApparatoDb(
  dbh: Database.Database,
  device: ApparatoInAcquisizione,
  opts: Pick<OpzioniMotore, "registra" | "fonti" | "fontiVecchie"> = {}
): SceltaSnmpApparato {
  const app = apparatoDi(dbh, device);
  if (!app) return nonEsiste(device);
  const soloV3 = app.protocol === "snmp_v3";
  const motore: OpzioniMotore = { fonti: opts.fonti ?? FONTI_ACQUISIZIONE, registra: opts.registra, fontiVecchie: opts.fontiVecchie };
  const s = scegliPerApparato(dbh, app, "snmp", motore, (seg) => {
    if (seg.forma !== "community" && seg.forma !== "v3") return `l'apparato «${app.name}»: credenziale non SNMP`;
    return soloV3 && seg.forma !== "v3" ? `l'apparato «${app.name}» è SNMPv3: una community non vale` : null;
  });
  if (!s.ok) return { ok: false, motivo: soloV3 ? `${V3_ASSENTE}: ${s.motivo}` : s.motivo };
  const base = {
    ok: true as const,
    port: s.candidato.port,
    fonte: s.candidato.source,
    credential_id: s.candidato.credential_id,
    ...(s.candidato.etichetta != null ? { etichetta: s.candidato.etichetta } : {}),
  };
  if (s.segreto.forma === "v3") {
    const r = s.segreto.record;
    const pulito = (v: string | null | undefined): string | null => (v == null ? null : v.trim());
    return {
      ...base,
      cred: {
        forma: "v3",
        record: {
          username: r.username.trim(),
          securityLevel: r.securityLevel,
          authProtocol: r.authProtocol ?? null,
          authKey: pulito(r.authKey),
          privProtocol: r.privProtocol ?? null,
          privKey: pulito(r.privKey),
        },
      },
    };
  }
  if (s.segreto.forma === "community") return { ...base, cred: { forma: "community", community: s.segreto.community } };
  return { ok: false, motivo: `l'apparato «${app.name}»: credenziale non SNMP` };
}

export type SceltaTokenApi =
  | { ok: true; token: string; fonte: ResolvedCredentialSource; credential_id: number | null }
  | { ok: false; motivo: string };

/**
 * Il token dell'API di un apparato (client Omada, tappa 2e, T20): una voce
 * `api` col metodo `token` legata all'apparato, coi binding nell'ordine
 * dell'acquisizione (falliti saltati). Prima il client leggeva solo la
 * colonna `api_token`, che la 2e svuota: sarebbe partito «Bearer » vuoto.
 * Dalla 2g (T26) la colonna non si legge più nemmeno come ripiego.
 */
export function tokenApiApparatoDb(
  dbh: Database.Database,
  device: ApparatoInAcquisizione,
  opts: Pick<OpzioniMotore, "registra"> = {}
): SceltaTokenApi {
  const app = apparatoDi(dbh, device);
  if (!app) return nonEsiste(device);
  const s = scegliPerApparato(dbh, app, "api", { fonti: FONTI_ACQUISIZIONE, registra: opts.registra }, (seg) =>
    seg.forma === "token" ? null : `l'apparato «${app.name}» per l'API vuole un token`
  );
  if (s.ok && s.segreto.forma === "token") return { ok: true, token: s.segreto.token, fonte: s.candidato.source, credential_id: s.candidato.credential_id };
  return { ok: false, motivo: `Nessun token API per l'apparato «${app.name}»${s.ok ? "" : `: ${s.motivo}`}` };
}

/**
 * «Ha SNMP?» dell'acquisizione: vero solo con una fonte SNMP dell'apparato
 * (binding d'archivio non falliti, o la voce provvisoria), mai con la catena
 * della rete o col ripiego. Non legge segreti e non registra. Dalla 2g una
 * `community_string` rimasta nella colonna non conta più (T26).
 */
export function haSnmpApparatoDb(dbh: Database.Database, device: ApparatoInAcquisizione): boolean {
  const app = apparatoDi(dbh, device);
  return app != null && candidatiApparato(dbh, app, "snmp", { fonti: FONTI_APPARATO, limit: 1 }).length > 0;
}

/**
 * Porta SSH di Proxmox, dove `device.port` è la porta dell'API (443/8006)
 * anche con protocollo `ssh`: quella propria del primo candidato SSH
 * dell'apparato con una porta valida (binding, o la voce provvisoria),
 * altrimenti 22. Mai `device.port`.
 */
export function portaSshApparatoDb(dbh: Database.Database, device: ApparatoInAcquisizione): number {
  const app = apparatoDi(dbh, device);
  if (!app) return DEFAULT_PORTS.ssh;
  const valida = (p: number): boolean => Number.isInteger(p) && p > 0 && p <= 65535;
  return candidatiApparato(dbh, app, "ssh", { fonti: FONTI_APPARATO }, true).find((c) => valida(c.port))?.port ?? DEFAULT_PORTS.ssh;
}

// ── Liste per la discovery e le catene ─────────────────────────────────────

/**
 * Community SNMP da provare per un host o una rete, con la fonte di ognuna:
 * voci del motore (community, mai v3), poi l'override del profilo o della
 * scansione, la community della rete, «public» e «private». Le ultime tre sono
 * ripieghi dichiarati (D5) e si registrano come `cred_public`. Senza doppioni,
 * nell'ordine.
 */
export function communitySnmpDb(
  dbh: Database.Database,
  target: ResolveTarget,
  override: string | null,
  opts: Pick<OpzioniMotore, "registra"> = {}
): Array<{ community: string; fonte: ResolvedCredentialSource }> {
  const out: Array<{ community: string; fonte: ResolvedCredentialSource }> = [];
  const viste = new Set<string>();
  const aggiungi = (valore: string | null | undefined, fonte: ResolvedCredentialSource): void => {
    const t = valore?.trim();
    if (!t || viste.has(t)) return;
    viste.add(t);
    out.push({ community: t, fonte });
  };
  for (const c of resolveCredentialsForDb(dbh, target, "snmp")) {
    if (c.credential_id == null) continue;
    const e = leggiSegretoDb(dbh, c.credential_id, "snmp");
    if (e.ok && e.segreto.forma === "community") aggiungi(e.segreto.community, c.source);
  }
  const elenco = (s: string | null | undefined): string[] => (s ? s.split(",") : []);
  for (const p of elenco(override)) aggiungi(p, "snmp_ripiego");
  const rete = dbh.prepare(`SELECT snmp_community FROM networks WHERE id = ?`).get(target.networkId) as { snmp_community: string | null } | undefined;
  for (const p of elenco(rete?.snmp_community)) aggiungi(p, "snmp_ripiego");
  aggiungi("public", "snmp_ripiego");
  aggiungi("private", "snmp_ripiego");
  if (opts.registra !== false) registra(out.map((c) => CASO_PER_FONTE[c.fonte]));
  return out;
}

/**
 * Catena di una rete per la discovery e l'anteprima edge: gli id delle voci
 * del motore (la lista della rete), senza doppioni. Dalla 2g niente catene
 * vecchie né chiave dell'hub (T26).
 */
export function catenaReteDb(dbh: Database.Database, networkId: number, protocol: CredProtocol, opts: OpzioniMotore = {}): number[] {
  const ids: number[] = [];
  const visti = new Set<number>();
  const casi: Array<CasoRipiego | undefined> = [];
  for (const c of resolveCredentialsForDb(dbh, { networkId }, protocol, opts)) {
    if (c.credential_id == null || visti.has(c.credential_id)) continue;
    visti.add(c.credential_id);
    ids.push(c.credential_id);
    casi.push(CASO_PER_FONTE[c.source]);
  }
  if (opts.registra !== false) registra(casi);
  return ids;
}

// ── Funzioni col tenant corrente ───────────────────────────────────────────

/**
 * Risolve il DB del tenant corrente (AsyncLocalStorage di db-tenant.ts) senza
 * import statico: db-tenant.ts importa questo modulo, e un import statico qui
 * creerebbe un ciclo.
 */
function getCurrentTenantDb(): Database.Database | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getCurrentTenantCode, getTenantDb } = require("@/lib/db-tenant") as typeof import("@/lib/db-tenant");
    const code = getCurrentTenantCode();
    if (!code) return null;
    return getTenantDb(code);
  } catch {
    return null;
  }
}

/**
 * Candidati per un host nel tenant corrente (vedi `resolveCredentialsForDb`).
 * Non lancia mai: su qualunque errore (tenant assente, DB non raggiungibile,
 * query fallita) ritorna array vuoto.
 */
export function resolveCredentialsFor(
  target: ResolveTarget,
  protocol: CredProtocol,
  opts?: OpzioniMotore
): ResolvedCredential[] {
  try {
    const dbh = getCurrentTenantDb();
    if (!dbh) return [];
    return resolveCredentialsForDb(dbh, target, protocol, opts);
  } catch (e) {
    console.error("[credentials] resolveCredentialsFor fallito:", e);
    return [];
  }
}

/** Prima credenziale utilizzabile, o null. */
export function resolveCredentialFor(
  target: Parameters<typeof resolveCredentialsFor>[0],
  protocol: CredProtocol
): ResolvedCredential | null {
  const [first] = resolveCredentialsFor(target, protocol, { limit: 1 });
  return first ?? null;
}
