// scripts/credenziali/appoggio-fotografia.ts
/**
 * Lettori della fotografia delle scelte (tappa 2 credenziali, T1 del piano
 * 2026-10-15-tappa2-archivio-credenziali).
 *
 * Si carica SOLO con `await import()` da `fotografia-scelte.ts` o `misure-2a.ts`,
 * DOPO che lo script ha spostato DA_INVENT_DATA_DIR e DA_IPAM_HUB_DB_PATH su
 * --dati: db-tenant e db-hub fissano i percorsi quando si caricano. Qui
 * db-tenant si importa staticamente (ADR 0002: l'import dinamico vietato è
 * quello di db-tenant stesso, non di un modulo che lo importa).
 *
 * Lettori di oggi (2a): getDeviceCredentials, getDeviceCommunityString,
 * getDeviceSnmpV3Credentials per gli apparati; resolveCredentialsForDb e
 * buildSnmpCommunitiesForHost per gli host; le catene 2-4 per le reti;
 * collectEdgeCredentialsForNetwork per l'anteprima edge;
 * loadWinrmCredentialsForHost per le patch. Lo script cambia lettori nel T8 e
 * nel T26, con lo stesso formato di riga.
 *
 * Dalla 2a un apparato snmp_v3 senza una v3 leggibile ha la riga snmp senza
 * scelta: le sessioni v3 non ripiegano più sulla community (T4).
 *
 * Quei lettori non dicono QUALE voce hanno scelto. La provenienza (id della voce
 * e livello) si ricostruisce qui con le stesse query, e si controlla contro
 * l'uscita vera: se il segreto ricostruito non è quello del lettore, la riga
 * dice `lettore_vecchio:discorde`, senza id, e lo script la conta. L'impronta è
 * sempre quella del segreto restituito dal lettore vero. I segreti in chiaro
 * restano in memoria: escono solo come impronta.
 */
import fs from "node:fs";
import type Database from "better-sqlite3";
import {
  buildSnmpCommunitiesForHost,
  buildSnmpCommunitiesForNetwork,
  cartellaTenant,
  closeAllTenantDbs,
  closeTenantDb,
  getCredentialById,
  getCredentialCommunityString,
  getCredentialLoginPair,
  getDeviceCommunityString,
  getDeviceCredentials,
  getDeviceSnmpV3Credentials,
  getEffectiveSnmpPort,
  getOrderedDetectCredentialIds,
  getOrderedSshLinuxCredentialIds,
  getSshLinuxCredentialPair,
  getTenantDb,
  withTenant,
  type DeviceCredentialBinding,
} from "../../src/lib/db-tenant";
import { closeHubDb, getHubDbPath } from "../../src/lib/db-hub";
import { safeDecrypt } from "../../src/lib/crypto";
import { resolveCredentialsForDb, type ResolveTarget } from "../../src/lib/credentials/resolve";
import { collectEdgeCredentialsForNetwork } from "../../src/lib/vuln/edge-credentials-bridge";
import { loadWinrmCredentialsForHost } from "../../src/lib/patch/credentials";
import { resolveDeviceAcquisition } from "../../src/lib/devices/device-acquisition-resolve";
import {
  chiaroDaParti,
  FONTE_LETTORE_VECCHIO,
  IMPRONTA_ILLEGGIBILE,
  impronta,
  type RigaFotografia,
  type SceltaFotografia,
} from "../../src/lib/credentials/fotografia";
import type { NetworkDevice } from "../../src/types";
import type { SnmpV3CredentialRecord } from "../../src/lib/protocols/snmpv3";

export { cartellaTenant, getHubDbPath };

const CODICE_TENANT = /^([A-Za-z0-9_-]{1,64})\.db$/;

/** Codici dei tenant presenti nella cartella dei tenant (file `<codice>.db`). */
export function elencaTenant(): string[] {
  return fs
    .readdirSync(cartellaTenant())
    .map((f) => CODICE_TENANT.exec(f)?.[1])
    .filter((c): c is string => !!c)
    .sort();
}

export function chiudiTutto(): void {
  closeAllTenantDbs();
  closeHubDb();
}

/** Provenienza ricostruita di una scelta: id della voce (null = inline o ripiego), livello, segreto in memoria. */
export interface Provenienza {
  credential_id: number | null;
  livello: string;
  parti: string[] | null;
}

const NESSUNA: Provenienza = { credential_id: null, livello: "nessuna", parti: null };

export type ProtocolloApparato = "ssh" | "winrm" | "api" | "snmp";

/** Protocollo principale di un apparato, come lo legge l'acquisizione di oggi. */
export function protocolloPrincipale(device: NetworkDevice): ProtocolloApparato {
  if (device.protocol === "snmp_v2" || device.protocol === "snmp_v3") return "snmp";
  if (device.protocol === "winrm") return "winrm";
  if (device.protocol === "api") return "api";
  return "ssh";
}

function primoBinding(dbh: Database.Database, deviceId: number, protocollo: string): DeviceCredentialBinding | undefined {
  // Stessa query di getDeviceCredentials / getDeviceCommunityString (db-tenant.ts).
  return dbh.prepare(`
    SELECT * FROM device_credential_bindings
    WHERE device_id = ? AND protocol_type = ?
    ORDER BY sort_order LIMIT 1
  `).get(deviceId, protocollo) as DeviceCredentialBinding | undefined;
}

/** Provenienza di getDeviceCredentials: binding → colonna credential_id → colonne utente/password. */
export function provenienzaLogin(dbh: Database.Database, device: NetworkDevice): Provenienza {
  const proto = device.protocol === "winrm" ? "winrm" : device.protocol === "api" ? "api" : "ssh";
  const b = primoBinding(dbh, device.id, proto);
  if (b) {
    if (b.credential_id) {
      const c = getCredentialById(b.credential_id);
      if (c?.encrypted_username && c?.encrypted_password) {
        const u = safeDecrypt(c.encrypted_username);
        const p = safeDecrypt(c.encrypted_password);
        if (u && p) return { credential_id: c.id, livello: "binding", parti: [u, p] };
      }
    } else if (b.inline_username && b.inline_encrypted_password) {
      const p = safeDecrypt(b.inline_encrypted_password);
      if (p) return { credential_id: null, livello: "binding_inline", parti: [b.inline_username, p] };
    }
  }
  if (device.credential_id) {
    const c = getCredentialById(device.credential_id);
    if (c?.encrypted_username && c?.encrypted_password) {
      const u = safeDecrypt(c.encrypted_username);
      const p = safeDecrypt(c.encrypted_password);
      if (u && p) return { credential_id: c.id, livello: "colonna", parti: [u, p] };
      return NESSUNA;
    }
  }
  if (device.username && device.encrypted_password) {
    const p = safeDecrypt(device.encrypted_password);
    if (p) return { credential_id: null, livello: "colonna_inline", parti: [device.username, p] };
    return NESSUNA;
  }
  return NESSUNA;
}

function colonneSnmpInOrdine(device: NetworkDevice): Array<number | null> {
  const isSnmpPrimary = device.protocol === "snmp_v2" || device.protocol === "snmp_v3";
  return isSnmpPrimary ? [device.credential_id, device.snmp_credential_id] : [device.snmp_credential_id, device.credential_id];
}

/** Provenienza di getDeviceCommunityString: binding → colonne → community_string → «public». */
export function provenienzaCommunity(dbh: Database.Database, device: NetworkDevice): Provenienza {
  const b = primoBinding(dbh, device.id, "snmp");
  if (b) {
    if (b.credential_id) {
      const com = getCredentialCommunityString(b.credential_id);
      if (com) return { credential_id: b.credential_id, livello: "binding", parti: [com] };
    } else if (b.inline_encrypted_password) {
      const s = safeDecrypt(b.inline_encrypted_password);
      if (s?.trim()) return { credential_id: null, livello: "binding_inline", parti: [s] };
    }
  }
  for (const id of colonneSnmpInOrdine(device)) {
    if (!id) continue;
    const com = getCredentialCommunityString(id);
    if (com) return { credential_id: id, livello: "colonna", parti: [com] };
  }
  if (device.community_string) {
    const s = safeDecrypt(device.community_string);
    if (s && s.trim()) return { credential_id: null, livello: "community_string", parti: [s] };
    return { credential_id: null, livello: "community_string_non_cifrata", parti: [device.community_string] };
  }
  return { credential_id: null, livello: "public", parti: ["public"] };
}

/**
 * Parti del segreto v3 per l'impronta: utente e chiave d'autenticazione, più la
 * chiave di privacy quando c'è. Il formato vecchio (authNoPriv/MD5) resta
 * [utente, chiave], come nella fotografia del T1.
 */
function partiV3(r: SnmpV3CredentialRecord): string[] {
  return [r.username, r.authKey ?? "", ...(r.privKey ? [r.privKey] : [])];
}

function chiaroRipulito(cifrato: string | null): string | null {
  const s = cifrato ? safeDecrypt(cifrato) : null;
  return s?.trim() ? s.trim() : null;
}

/**
 * Provenienza di getDeviceSnmpV3Credentials. Dal T3 la voce con
 * `security_level` è una v3 completa (chiavi in `encrypted_auth_key` e
 * `encrypted_priv_key`, livello «v3_completa»); senza livello, con utente e
 * password, è il formato vecchio (livello «v3», come nel T1).
 */
export function provenienzaV3(device: NetworkDevice): Provenienza {
  const isSnmpPrimary = device.protocol === "snmp_v2" || device.protocol === "snmp_v3";
  const ids = isSnmpPrimary ? [device.credential_id, device.snmp_credential_id] : [device.snmp_credential_id, device.credential_id];
  for (const id of ids) {
    if (!id) continue;
    const c = getCredentialById(id);
    if (!c || String(c.credential_type || "").toLowerCase() !== "snmp") continue;
    const u = chiaroRipulito(c.encrypted_username);
    const livello = c.security_level?.trim() || null;
    if (livello) {
      const auth = chiaroRipulito(c.encrypted_auth_key);
      const priv = chiaroRipulito(c.encrypted_priv_key);
      const completa = livello === "noAuthNoPriv" || (livello === "authNoPriv" && !!auth) || (livello === "authPriv" && !!auth && !!priv);
      if (u && completa) {
        return { credential_id: id, livello: "v3_completa", parti: partiV3({ username: u, securityLevel: livello, authKey: auth, privKey: priv }) };
      }
      continue;
    }
    const k = chiaroRipulito(c.encrypted_password);
    if (u && k) return { credential_id: id, livello: "v3", parti: [u, k] };
  }
  return NESSUNA;
}

/** «Ha SNMP?» come lo calcola getDeviceInfo oggi (device-info.ts, il percorso principale dell'acquisizione). */
export function haSnmpOggi(dbh: Database.Database, device: NetworkDevice): boolean {
  const v3 = getDeviceSnmpV3Credentials(device);
  const conBinding = !!dbh
    .prepare("SELECT 1 FROM device_credential_bindings WHERE device_id = ? AND protocol_type = 'snmp' LIMIT 1")
    .get(device.id);
  return (
    !!device.community_string ||
    device.protocol === "snmp_v2" ||
    device.protocol === "snmp_v3" ||
    (device.snmp_credential_id ? !!getCredentialCommunityString(device.snmp_credential_id) || !!v3 : false) ||
    (device.credential_id ? !!getCredentialCommunityString(device.credential_id) : false) ||
    conBinding
  );
}

export interface VoceCatenaSnmp {
  community: string;
  credential_id: number | null;
  port: number | null;
  livello: string;
}

/** Provenienza di buildSnmpCommunitiesFor{Network,Host}: voci SNMP del motore, community della rete, public/private. */
export function provenienzaCatenaSnmp(dbh: Database.Database, target: ResolveTarget): VoceCatenaSnmp[] {
  const voci: VoceCatenaSnmp[] = [];
  for (const r of resolveCredentialsForDb(dbh, target, "snmp")) {
    // Il motore per host dà sempre una voce; il tipo ammette null per gli apparati (T7).
    if (r.credential_id == null) continue;
    const com = getCredentialCommunityString(r.credential_id);
    if (com?.trim()) voci.push({ community: com.trim(), credential_id: r.credential_id, port: r.port, livello: r.source });
  }
  const rete = dbh.prepare("SELECT snmp_community FROM networks WHERE id = ?").get(target.networkId) as
    | { snmp_community: string | null }
    | undefined;
  for (const parte of (rete?.snmp_community ?? "").split(",").map((x) => x.trim()).filter(Boolean)) {
    voci.push({ community: parte, credential_id: null, port: null, livello: "community_rete" });
  }
  voci.push({ community: "public", credential_id: null, port: null, livello: "public" });
  voci.push({ community: "private", credential_id: null, port: null, livello: "public" });
  const visti = new Set<string>();
  return voci.filter((v) => (visti.has(v.community) ? false : (visti.add(v.community), true)));
}

/** Provenienza di loadWinrmCredentialsForHost: righe host WinRM, poi l'account WinRM dell'AD. */
export function provenienzaPatch(dbh: Database.Database, hostId: number): Provenienza {
  type Riga = { cid: number; host_ip: string | null; encrypted_username: string | null; encrypted_password: string | null };
  let livello = "host";
  let r = dbh.prepare(
    `SELECT hc.credential_id AS cid, h.ip AS host_ip, c.encrypted_username, c.encrypted_password
       FROM host_credentials hc
       JOIN credentials c ON c.id = hc.credential_id
       JOIN hosts h ON h.id = hc.host_id
      WHERE hc.host_id = ? AND hc.protocol_type = 'winrm'
      ORDER BY hc.validated DESC, hc.sort_order ASC, hc.id ASC
      LIMIT 1`
  ).get(hostId) as Riga | undefined;
  if (!r) {
    livello = "ripiego_ad";
    r = dbh.prepare(
      `SELECT ai.winrm_credential_id AS cid, h.ip AS host_ip, c.encrypted_username, c.encrypted_password
         FROM ad_integrations ai
         JOIN credentials c ON c.id = ai.winrm_credential_id
         JOIN hosts h ON h.id = ?
        WHERE ai.enabled = 1 AND ai.winrm_credential_id IS NOT NULL
        ORDER BY ai.id ASC
        LIMIT 1`
    ).get(hostId) as Riga | undefined;
  }
  if (!r || !r.host_ip || !r.encrypted_username || !r.encrypted_password) return NESSUNA;
  const u = safeDecrypt(r.encrypted_username);
  const p = safeDecrypt(r.encrypted_password);
  if (!u || !p) return NESSUNA;
  return { credential_id: r.cid, livello, parti: [u, p] };
}

const stesseParti = (a: string[] | null, b: string[] | null): boolean =>
  !!a && !!b && a.length === b.length && a.every((x, i) => x === b[i]);

interface Contesto {
  chiave: string;
  discordi: number;
}

const fonte = (livello: string) => `${FONTE_LETTORE_VECCHIO}:${livello}`;

/**
 * Scelta dall'uscita del lettore vero (`vero`, il segreto in parti) e dalla
 * provenienza ricostruita. Se le due non tornano, la riga resta senza id e con
 * fonte `discorde`, e si conta: mai una provenienza indovinata.
 */
function scelta(ctx: Contesto, vero: string[] | null, prov: Provenienza, port: number | null): SceltaFotografia | null {
  if (!vero) {
    if (prov.parti) ctx.discordi += 1;
    return null;
  }
  const imp = impronta(chiaroDaParti(...vero), ctx.chiave);
  if (stesseParti(vero, prov.parti)) {
    return { credential_id: prov.credential_id, port, fonte: fonte(prov.livello), impronta: imp };
  }
  ctx.discordi += 1;
  return { credential_id: null, port, fonte: fonte("discorde"), impronta: imp };
}

function improntaVoce(ctx: Contesto, parti: string[] | null): string {
  return parti ? impronta(chiaroDaParti(...parti), ctx.chiave) : IMPRONTA_ILLEGGIBILE;
}

function coppiaSsh(id: number): string[] | null {
  const p = getSshLinuxCredentialPair(id);
  return p ? [p.username, p.password] : null;
}

function coppiaWindows(id: number): string[] | null {
  const p = getCredentialLoginPair(id, "windows");
  return p ? [p.username, p.password] : null;
}

/** Righe della catena SNMP (host o rete): lettore vero + provenienza; se non tornano, tutte senza id. */
function catenaSnmp(ctx: Contesto, vera: string[], prov: VoceCatenaSnmp[]): Array<{ community: string; scelta: SceltaFotografia }> {
  const torna = vera.length === prov.length && vera.every((c, i) => c === prov[i].community);
  if (!torna) ctx.discordi += 1;
  return vera.map((c, i) => ({
    community: c,
    scelta: torna
      ? { credential_id: prov[i].credential_id, port: prov[i].port, fonte: fonte(prov[i].livello), impronta: impronta(chiaroDaParti(c), ctx.chiave) }
      : { credential_id: null, port: null, fonte: fonte("discorde"), impronta: impronta(chiaroDaParti(c), ctx.chiave) },
  }));
}

export interface EsitoTenant {
  righe: RigaFotografia[];
  /** Righe la cui provenienza ricostruita non torna col lettore vero. */
  discordi: number;
  /** Voci con un segreto cifrato, e quante si decifrano con la ENCRYPTION_KEY data. */
  cifrate: { totali: number; leggibili: number };
}

/** Prova della chiave: con una ENCRYPTION_KEY sbagliata la fotografia sarebbe tutta «nessuna scelta». */
function provaChiave(dbh: Database.Database): EsitoTenant["cifrate"] {
  const righe = dbh.prepare("SELECT encrypted_password FROM credentials WHERE encrypted_password IS NOT NULL").all() as Array<{
    encrypted_password: string;
  }>;
  let leggibili = 0;
  for (const r of righe) if (safeDecrypt(r.encrypted_password) !== null) leggibili += 1;
  return { totali: righe.length, leggibili };
}

/** La fotografia di un tenant, dentro withTenant, coi lettori di questa versione. */
export function fotografaTenant(code: string, encryptionKey: string): EsitoTenant {
  try {
    return withTenant(code, () => fotografaDentro(code, encryptionKey));
  } finally {
    closeTenantDb(code);
  }
}

function fotografaDentro(code: string, encryptionKey: string): EsitoTenant {
  const dbh = getTenantDb(code);
  const cifrate = provaChiave(dbh);
  if (cifrate.totali > 0 && cifrate.leggibili === 0) {
    throw new Error(
      `Tenant ${code}: la ENCRYPTION_KEY non decifra nessuna delle ${cifrate.totali} credenziali (chiave sbagliata o ambiente non caricato)`
    );
  }
  const ctx: Contesto = { chiave: encryptionKey, discordi: 0 };
  const righe: RigaFotografia[] = [];

  // ── Apparati: protocollo principale e snmp ──
  const apparati = dbh.prepare("SELECT * FROM network_devices ORDER BY id").all() as NetworkDevice[];
  for (const d of apparati) {
    const principale = protocolloPrincipale(d);
    const piano = resolveDeviceAcquisition(d).module;
    const haSnmp = haSnmpOggi(dbh, d);
    if (principale !== "snmp") {
      const vero = getDeviceCredentials(d);
      righe.push({
        tenant: code,
        oggetto: "apparato",
        chiave: `${d.id}:${principale}`,
        nome: d.name,
        scelta: scelta(ctx, vero ? [vero.username, vero.password] : null, provenienzaLogin(dbh, d), d.port ?? null),
        piano,
        haSnmp,
      });
    }
    const portaSnmp = getEffectiveSnmpPort(d);
    let sceltaSnmp: SceltaFotografia | null;
    if (d.protocol === "snmp_v3") {
      // Dal T4 un apparato snmp_v3 senza una v3 leggibile non legge più la
      // community: le sessioni danno «Credenziale SNMPv3 assente o
      // illeggibile». Nessuna scelta, così --confronta col T1 mostra
      // «community → nessuna» per ognuno (revisione della 2a).
      const cred = getDeviceSnmpV3Credentials(d);
      sceltaSnmp = cred ? scelta(ctx, partiV3(cred), provenienzaV3(d), portaSnmp) : null;
    } else {
      sceltaSnmp = scelta(ctx, [getDeviceCommunityString(d)], provenienzaCommunity(dbh, d), portaSnmp);
    }
    righe.push({
      tenant: code,
      oggetto: "apparato",
      chiave: `${d.id}:snmp`,
      nome: d.name,
      scelta: sceltaSnmp,
      ...(principale === "snmp" ? { piano, haSnmp } : {}),
    });
  }

  // ── Host: ssh, winrm, snmp ──
  type RigaHost = { id: number; network_id: number; ip: string; hostname: string | null; custom_name: string | null };
  const hosts = dbh.prepare("SELECT id, network_id, ip, hostname, custom_name FROM hosts ORDER BY id").all() as RigaHost[];
  for (const h of hosts) {
    const nome = h.custom_name || h.hostname || h.ip;
    const bersaglio: ResolveTarget = { hostId: h.id, networkId: h.network_id, ip: h.ip };
    for (const proto of ["ssh", "winrm"] as const) {
      let s: SceltaFotografia | null = null;
      for (const c of resolveCredentialsForDb(dbh, bersaglio, proto)) {
        if (c.credential_id == null) continue;
        const parti = proto === "ssh" ? coppiaSsh(c.credential_id) : coppiaWindows(c.credential_id);
        if (!parti) continue;
        s = { credential_id: c.credential_id, port: c.port, fonte: fonte(c.source), impronta: improntaVoce(ctx, parti) };
        break;
      }
      righe.push({ tenant: code, oggetto: "host", chiave: `${h.id}:${proto}`, nome, scelta: s });
    }
    const vera = buildSnmpCommunitiesForHost(h.network_id, h.id);
    const prima = catenaSnmp(ctx, vera, provenienzaCatenaSnmp(dbh, { hostId: h.id, networkId: h.network_id }))[0];
    righe.push({
      tenant: code,
      oggetto: "host",
      chiave: `${h.id}:snmp`,
      nome,
      scelta: prima ? { ...prima.scelta, port: prima.scelta.port ?? 161 } : null,
    });
  }

  // ── Reti: catene 2-4; anteprima edge ──
  const reti = dbh.prepare("SELECT id, name FROM networks ORDER BY id").all() as Array<{ id: number; name: string }>;
  for (const n of reti) {
    const nelMotore = (proto: "winrm" | "ssh") =>
      new Set(resolveCredentialsForDb(dbh, { networkId: n.id }, proto).map((r) => r.credential_id));
    const motoreWin = nelMotore("winrm");
    getOrderedDetectCredentialIds(n.id, "windows").forEach((id, i) => {
      righe.push({
        tenant: code,
        oggetto: "rete",
        chiave: `${n.id}:winrm:${i}`,
        nome: n.name,
        scelta: { credential_id: id, port: null, fonte: fonte(motoreWin.has(id) ? "catena" : "chiave_hub"), impronta: improntaVoce(ctx, coppiaWindows(id)) },
      });
    });
    const motoreSsh = nelMotore("ssh");
    getOrderedSshLinuxCredentialIds(n.id).forEach((id, i) => {
      const p = getSshLinuxCredentialPair(id);
      righe.push({
        tenant: code,
        oggetto: "rete",
        chiave: `${n.id}:ssh:${i}`,
        nome: n.name,
        scelta: {
          credential_id: id,
          port: p ? (p.port ?? 22) : null,
          fonte: fonte(motoreSsh.has(id) ? "catena" : "chiave_hub"),
          impronta: improntaVoce(ctx, p ? [p.username, p.password] : null),
        },
      });
    });
    catenaSnmp(ctx, buildSnmpCommunitiesForNetwork(n.id), provenienzaCatenaSnmp(dbh, { networkId: n.id })).forEach((v, i) => {
      righe.push({ tenant: code, oggetto: "rete", chiave: `${n.id}:snmp:${i}`, nome: n.name, scelta: v.scelta });
    });

    const posizione: Record<string, number> = {};
    for (const t of collectEdgeCredentialsForNetwork(n.id).transfer) {
      const i = posizione[t.slot] ?? 0;
      posizione[t.slot] = i + 1;
      const parti = t.cred_type === "snmp" ? [t.community ?? ""] : [t.login ?? "", t.password ?? "", t.domain ?? ""];
      righe.push({
        tenant: code,
        oggetto: "edge",
        chiave: `${n.id}:${t.slot}:${i}`,
        nome: n.name,
        scelta: { credential_id: t.ipam_credential_id ?? null, port: null, fonte: fonte("edge"), impronta: improntaVoce(ctx, parti) },
      });
    }
  }

  // ── Patch: host Windows (o con una riga WinRM) ──
  // os_info «windows» è la stessa regola della colonna generata os_family (db-tenant-schema.ts),
  // scritta su os_info perché un DB nato prima di os_family non ha la colonna.
  const daPatchare = dbh.prepare(
    `SELECT h.id, h.ip, h.hostname, h.custom_name FROM hosts h
      WHERE LOWER(COALESCE(h.os_info, '')) LIKE '%windows%'
         OR EXISTS (SELECT 1 FROM host_credentials hc WHERE hc.host_id = h.id AND hc.protocol_type = 'winrm')
      ORDER BY h.id`
  ).all() as Array<{ id: number; ip: string; hostname: string | null; custom_name: string | null }>;
  for (const h of daPatchare) {
    const vero = loadWinrmCredentialsForHost(dbh, h.id);
    righe.push({
      tenant: code,
      oggetto: "patch",
      chiave: `${h.id}:winrm`,
      nome: h.custom_name || h.hostname || h.ip,
      scelta: scelta(ctx, vero ? [vero.username, vero.password] : null, provenienzaPatch(dbh, h.id), vero?.port ?? null),
    });
  }

  return { righe, discordi: ctx.discordi, cifrate };
}
