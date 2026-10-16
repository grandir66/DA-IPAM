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
 * Lettori di questa versione (2b):
 * - apparati: il motore unico, con le stesse funzioni dell'acquisizione
 *   (`sceltaLoginApparatoDb`, `credenzialeSnmpApparatoDb`, `haSnmpApparatoDb`)
 *   chiamate con `registra: false`, così la fotografia non scrive ripieghi. La
 *   riga dice la voce, la porta e la fonte del motore (`device_binding`,
 *   `device_column`, `snmp_ripiego`…): per questo il confronto con la 2a si fa
 *   senza `--con-fonte`;
 * - patch (dal T9): il motore con le fonti delle patch (`sceltaWinrmPatchDb`,
 *   righe host fuori fermo, poi l'account WinRM dell'AD), con `registra:
 *   false`; la riga dice la fonte del motore (`host_validated`, `ad_fallback`…);
 * - host: resolveCredentialsForDb e buildSnmpCommunitiesForHost; reti: le
 *   catene 2-4; anteprima edge: collectEdgeCredentialsForNetwork. Dalla 2b sono
 *   involucri del motore che registrano i ripieghi: qui si chiamano con
 *   `registra: false` (SENZA_REGISTRO). Cambiano nel T26, con lo stesso formato
 *   di riga.
 *
 * Un apparato snmp_v3 senza una v3 leggibile ha la riga snmp senza scelta: le
 * sessioni v3 non ripiegano sulla community (T4).
 *
 * I lettori vecchi di host e reti non dicono QUALE voce hanno scelto. La
 * provenienza (id della voce e livello) si ricostruisce qui con le stesse query,
 * e si controlla contro l'uscita vera: se non torna, la riga dice
 * `lettore_vecchio:discorde`, senza id, e lo script la conta. Le ricostruzioni
 * degli apparati della 2a (provenienzaCommunity, provenienzaV3, haSnmpOggi)
 * restano per misure-2a.ts. I segreti in chiaro restano in memoria: escono solo
 * come impronta.
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
  getOrderedDetectCredentialIds,
  getOrderedSshLinuxCredentialIds,
  accessoSshCredenziale,
  getTenantDb,
  withTenant,
  type DeviceCredentialBinding,
} from "../../src/lib/db-tenant";
import { closeHubDb, getHubDbPath } from "../../src/lib/db-hub";
import { safeDecrypt } from "../../src/lib/crypto";
import {
  credenzialeSnmpApparatoDb,
  haSnmpApparatoDb,
  resolveCredentialsForDb,
  sceltaLoginApparatoDb,
  type ResolveTarget,
} from "../../src/lib/credentials/resolve";
import { opzioniSsh, v3ApparatoDb, type AccessoSsh } from "../../src/lib/credentials/segreti";
import { collectEdgeCredentialsForNetwork } from "../../src/lib/vuln/edge-credentials-bridge";
import { sceltaWinrmPatchDb } from "../../src/lib/patch/credentials";
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

/** La fotografia è una verifica: i lettori di host, reti ed edge non scrivono ripieghi. */
const SENZA_REGISTRO = { registra: false } as const;

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

/** «Ha SNMP?» come lo calcolava getDeviceInfo nella 2a (per misure-2a.ts; dalla 2b la fotografia usa haSnmpApparatoDb). */
export function haSnmpOggi(dbh: Database.Database, device: NetworkDevice): boolean {
  const v3 = v3ApparatoDb(dbh, device);
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

interface Contesto {
  chiave: string;
  discordi: number;
}

const fonte = (livello: string) => `${FONTE_LETTORE_VECCHIO}:${livello}`;

function improntaVoce(ctx: Contesto, parti: string[] | null): string {
  return parti ? impronta(chiaroDaParti(...parti), ctx.chiave) : IMPRONTA_ILLEGGIBILE;
}

/**
 * Le parti dell'impronta di un accesso SSH: utente e password come prima (stessa impronta di prima per le voci a
 * password), utente, chiave e passphrase per una voce a chiave (T14: l'acquisizione e la discovery la usano).
 */
function partiAccesso(a: AccessoSsh): string[] {
  return a.privateKey ? [a.username, a.privateKey, a.passphrase ?? ""] : [a.username, a.password ?? ""];
}

function coppiaSsh(id: number): string[] | null {
  const e = accessoSshCredenziale(id);
  return e.ok ? partiAccesso(e.accesso) : null;
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
    // «Ha SNMP?» e piano come li calcola l'acquisizione dalla 2b (getDeviceInfo, rotta query): protocollo SNMP o una
    // fonte SNMP dell'apparato; il piano riceve haSnmpApparato.
    const haSnmpProprio = haSnmpApparatoDb(dbh, d);
    const piano = resolveDeviceAcquisition(d, haSnmpProprio).module;
    const haSnmp = principale === "snmp" || haSnmpProprio;
    if (principale !== "snmp") {
      const s = sceltaLoginApparatoDb(dbh, d, { registra: false });
      const accesso = s.ok ? opzioniSsh(s.segreto) : null;
      righe.push({
        tenant: code,
        oggetto: "apparato",
        chiave: `${d.id}:${principale}`,
        nome: d.name,
        scelta:
          s.ok && accesso
            ? {
                credential_id: s.candidato.credential_id,
                port: s.candidato.port,
                fonte: s.candidato.source,
                impronta: improntaVoce(ctx, partiAccesso(accesso)),
              }
            : null,
        piano,
        haSnmp,
      });
    }
    // Un apparato snmp_v3 senza una v3 leggibile: nessuna scelta (T4), come nella 2a.
    const c = credenzialeSnmpApparatoDb(dbh, d, { registra: false });
    const sceltaSnmp: SceltaFotografia | null = c.ok
      ? {
          credential_id: c.credential_id,
          port: c.port,
          fonte: c.fonte,
          impronta: improntaVoce(ctx, c.cred.forma === "v3" ? partiV3(c.cred.record) : [c.cred.community]),
        }
      : null;
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
    const vera = buildSnmpCommunitiesForHost(h.network_id, h.id, null, SENZA_REGISTRO);
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
    getOrderedDetectCredentialIds(n.id, "windows", SENZA_REGISTRO).forEach((id, i) => {
      righe.push({
        tenant: code,
        oggetto: "rete",
        chiave: `${n.id}:winrm:${i}`,
        nome: n.name,
        scelta: { credential_id: id, port: null, fonte: fonte(motoreWin.has(id) ? "catena" : "chiave_hub"), impronta: improntaVoce(ctx, coppiaWindows(id)) },
      });
    });
    const motoreSsh = nelMotore("ssh");
    getOrderedSshLinuxCredentialIds(n.id, SENZA_REGISTRO).forEach((id, i) => {
      const p = accessoSshCredenziale(id);
      righe.push({
        tenant: code,
        oggetto: "rete",
        chiave: `${n.id}:ssh:${i}`,
        nome: n.name,
        scelta: {
          credential_id: id,
          port: p.ok ? (p.port ?? 22) : null,
          fonte: fonte(motoreSsh.has(id) ? "catena" : "chiave_hub"),
          impronta: improntaVoce(ctx, p.ok ? partiAccesso(p.accesso) : null),
        },
      });
    });
    catenaSnmp(ctx, buildSnmpCommunitiesForNetwork(n.id, null, SENZA_REGISTRO), provenienzaCatenaSnmp(dbh, { networkId: n.id })).forEach((v, i) => {
      righe.push({ tenant: code, oggetto: "rete", chiave: `${n.id}:snmp:${i}`, nome: n.name, scelta: v.scelta });
    });

    const posizione: Record<string, number> = {};
    for (const t of collectEdgeCredentialsForNetwork(n.id, SENZA_REGISTRO).transfer) {
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
    // La stessa scelta di loadWinrmCredentialsForHost, che senza IP non dà niente.
    const s = h.ip ? sceltaWinrmPatchDb(dbh, h.id, { registra: false }) : null;
    righe.push({
      tenant: code,
      oggetto: "patch",
      chiave: `${h.id}:winrm`,
      nome: h.custom_name || h.hostname || h.ip,
      scelta:
        s?.ok && s.segreto.forma === "utente"
          ? {
              credential_id: s.candidato.credential_id,
              port: s.candidato.port,
              fonte: s.candidato.source,
              impronta: improntaVoce(ctx, [s.segreto.username, s.segreto.password]),
            }
          : null,
    });
  }

  return { righe, discordi: ctx.discordi, cifrate };
}
