// scripts/credenziali/appoggio-misure.ts
/**
 * Misure della 2a (tappa 2 credenziali, T1 «Sul server» del piano
 * 2026-10-15-tappa2-archivio-credenziali): solo conteggi, in sola lettura,
 * sulla COPIA dei dati. Nessun segreto esce: i segreti si confrontano in
 * memoria e si stampa solo «uguale» / «diverso».
 *
 * Si carica SOLO con `await import()` da `misure-2a.ts`, dopo lo spostamento
 * dell'ambiente su --dati (stesso ordine di fotografia-scelte.ts).
 *
 * Misure:
 *   - #31 / D3: dove puntano le due chiavi globali dell'hub in ogni tenant, e
 *     in quante reti l'id manca dalla catena (N per il cliente A, reti dell'hub
 *     che con D3 = (a) la perdono);
 *   - D5: apparati che oggi ricevono «public» come ripiego;
 *   - D8: usi di ogni voce, per ogni colonna figlia di `credentials` (ricavate
 *     da PRAGMA foreign_key_list, non da un elenco fisso) e chiavi dell'hub;
 *   - D1b: apparati senza fonte propria che riceverebbero un candidato dai
 *     livelli 6-11 (righe host validate, catena della rete, catene vecchie,
 *     chiave dell'hub), e di che tipo;
 *   - 2e: colonne degli apparati contro i binding (utente/password, colonna
 *     SNMP, colonna non SNMP, community_string) e binding inline.
 */
import type Database from "better-sqlite3";
import { closeTenantDb, getCredentialCommunityString, getTenantDb, withTenant } from "../../src/lib/db-tenant";
import { getActiveTenants, getSetting } from "../../src/lib/db-hub";
import { safeDecrypt } from "../../src/lib/crypto";
import { resolveCredentialsForDb, type CredProtocol } from "../../src/lib/credentials/resolve";
// La misura di D1b chiede cosa riceverebbero gli apparati con la regola NUOVA
// tipo ↔ protocollo: è quella di tipi.ts (T2), non una copia.
import { tipiPerProtocollo } from "../../src/lib/credentials/tipi";
import { haSnmpOggi, protocolloPrincipale, provenienzaCommunity, type ProtocolloApparato } from "./appoggio-fotografia";
import type { NetworkDevice } from "../../src/types";

export { cartellaTenant, chiudiTutto, elencaTenant, getHubDbPath } from "./appoggio-fotografia";

/** Ruoli delle catene vecchie per protocollo (come legacyRolesForProtocol di resolve.ts). */
const RUOLI_VECCHI: Record<ProtocolloApparato, string[]> = {
  ssh: ["ssh", "linux"],
  winrm: ["windows"],
  snmp: ["snmp"],
  api: [],
};

type Righe = string[];

function idImpostato(chiave: string): number | null {
  const v = getSetting(chiave)?.trim();
  if (!v) return null;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function misureHub(): Righe {
  return [
    `tenant attivi nell'hub: ${getActiveTenants().length}`,
    `chiave Windows dell'hub (host_windows_credential_id): ${idImpostato("host_windows_credential_id") ? "impostata" : "non impostata"}`,
    `chiave Linux dell'hub (host_linux_credential_id): ${idImpostato("host_linux_credential_id") ? "impostata" : "non impostata"}`,
  ];
}

const conta = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
const elenco = (m: Map<string, number>) =>
  m.size === 0 ? "—" : [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, n]) => `${k} ${n}`).join(", ");

function tipoVoce(dbh: Database.Database, id: number): string | null {
  const r = dbh.prepare("SELECT credential_type FROM credentials WHERE id = ?").get(id) as { credential_type: string } | undefined;
  return r ? String(r.credential_type).toLowerCase() : null;
}

/** #31 / D3: le due chiavi dell'hub nelle catene delle reti del tenant. */
function misuraChiaviHub(dbh: Database.Database): Righe {
  const out: Righe = [];
  const reti = dbh.prepare("SELECT id FROM networks").all() as Array<{ id: number }>;
  const casi: Array<{ nome: string; chiave: string; proto: CredProtocol; giusti: string[] }> = [
    { nome: "Windows", chiave: "host_windows_credential_id", proto: "winrm", giusti: ["windows"] },
    { nome: "Linux", chiave: "host_linux_credential_id", proto: "ssh", giusti: ["ssh", "linux"] },
  ];
  for (const c of casi) {
    const id = idImpostato(c.chiave);
    if (id == null) {
      out.push(`[#31/D3] chiave ${c.nome}: non impostata nell'hub`);
      continue;
    }
    const tipo = tipoVoce(dbh, id);
    if (tipo == null) {
      out.push(`[#31/D3] chiave ${c.nome}: l'id NON esiste in questo tenant (reti ${reti.length}: nessuna la riceve con la 2b)`);
      continue;
    }
    const giusto = c.giusti.includes(tipo);
    let gia = 0;
    for (const n of reti) {
      if (resolveCredentialsForDb(dbh, { networkId: n.id }, c.proto).some((r) => r.credential_id === id)) gia += 1;
    }
    const manca = reti.length - gia;
    out.push(
      `[#31/D3] chiave ${c.nome}: esiste, tipo ${tipo} (${giusto ? "giusto" : "SBAGLIATO"}); reti ${reti.length}, già in catena ${gia}, manca ${manca}` +
        (giusto ? ` → N = ${manca} (copiate con D3 = (a) se il tenant è l'unico attivo, altrimenti reti che la perdono)` : " → non si copia (tipo sbagliato)")
    );
  }
  return out;
}

/** D5: apparati che oggi ricevono «public» come ripiego. */
function misuraPublic(dbh: Database.Database, apparati: NetworkDevice[]): Righe {
  let pub = 0;
  let snmpPrincipale = 0;
  let conHaSnmp = 0;
  const perVendor = new Map<string, number>();
  for (const d of apparati) {
    if (provenienzaCommunity(dbh, d).livello !== "public") continue;
    pub += 1;
    if (protocolloPrincipale(d) === "snmp") snmpPrincipale += 1;
    if (haSnmpOggi(dbh, d)) conHaSnmp += 1;
    conta(perVendor, d.vendor);
  }
  return [
    `[D5] apparati ${apparati.length}; con «public» di ripiego ${pub} (protocollo SNMP principale ${snmpPrincipale}, «ha SNMP?» vero ${conHaSnmp}); per vendor: ${elenco(perVendor)}`,
  ];
}

/** D8: usi di ogni voce per colonna figlia di `credentials`, più le chiavi dell'hub. */
function misuraUsi(dbh: Database.Database): Righe {
  const tabelle = dbh.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{ name: string }>;
  const figli: Array<{ tabella: string; colonna: string }> = [];
  for (const t of tabelle) {
    const fks = dbh.prepare(`PRAGMA foreign_key_list("${t.name.replace(/"/g, '""')}")`).all() as Array<{ table: string; from: string }>;
    for (const fk of fks) if (fk.table === "credentials") figli.push({ tabella: t.name, colonna: fk.from });
  }
  const usi = new Map<number, Map<string, number>>();
  for (const f of figli) {
    const q = `SELECT "${f.colonna}" AS id, COUNT(*) AS n FROM "${f.tabella}" WHERE "${f.colonna}" IS NOT NULL GROUP BY "${f.colonna}"`;
    for (const r of dbh.prepare(q).all() as Array<{ id: number; n: number }>) {
      const m = usi.get(r.id) ?? new Map<string, number>();
      m.set(`${f.tabella}.${f.colonna}`, r.n);
      usi.set(r.id, m);
    }
  }
  const hubWin = idImpostato("host_windows_credential_id");
  const hubLin = idImpostato("host_linux_credential_id");
  const voci = dbh.prepare("SELECT id, credential_type FROM credentials ORDER BY id").all() as Array<{ id: number; credential_type: string }>;
  const out: Righe = [`[D8] colonne figlie di credentials: ${figli.length} (${figli.map((f) => `${f.tabella}.${f.colonna}`).join(", ")}); voci ${voci.length}`];
  let senza = 0;
  for (const v of voci) {
    const m = usi.get(v.id) ?? new Map<string, number>();
    if (v.id === hubWin) m.set("chiave_hub_windows", 1);
    if (v.id === hubLin) m.set("chiave_hub_linux", 1);
    if (m.size === 0) senza += 1;
    out.push(`[D8]   #${v.id} ${v.credential_type}: ${m.size === 0 ? "nessun uso" : [...m.entries()].map(([k, n]) => `${k}=${n}`).join(", ")}`);
  }
  out.push(`[D8] voci senza nessun uso: ${senza}`);
  return out;
}

/** Il binding di un apparato ha una fonte utilizzabile (voce o inline completo)? */
function bindingPropri(dbh: Database.Database, deviceId: number, proto: string): Array<{ credential_id: number | null; inline_username: string | null; inline_encrypted_password: string | null }> {
  return dbh
    .prepare(
      `SELECT credential_id, inline_username, inline_encrypted_password FROM device_credential_bindings
        WHERE device_id = ? AND protocol_type = ? ORDER BY sort_order, id`
    )
    .all(deviceId, proto) as Array<{ credential_id: number | null; inline_username: string | null; inline_encrypted_password: string | null }>;
}

function haFontePropria(dbh: Database.Database, d: NetworkDevice, proto: ProtocolloApparato): boolean {
  const bindings = bindingPropri(dbh, d.id, proto);
  if (bindings.some((b) => b.credential_id != null || !!b.inline_encrypted_password)) return true;
  if (proto === "snmp") {
    if (d.snmp_credential_id != null || !!d.community_string?.trim()) return true;
    return d.credential_id != null && tipoVoce(dbh, d.credential_id) === "snmp";
  }
  return d.credential_id != null || (!!d.username && !!d.encrypted_password);
}

/** D1b: apparati senza fonte propria che riceverebbero un candidato dai livelli 6-11. */
function misuraD1b(dbh: Database.Database, apparati: NetworkDevice[]): Righe {
  const out: Righe = [];
  const inTipi = (tipi: string[]) => tipi.map(() => "?").join(",");
  const hubWin = idImpostato("host_windows_credential_id");
  const hubLin = idImpostato("host_linux_credential_id");
  for (const proto of ["ssh", "winrm", "api", "snmp"] as const) {
    const tipi = tipiPerProtocollo(proto);
    const ruoli = RUOLI_VECCHI[proto];
    let senzaFonte = 0;
    let senzaHost = 0;
    let daHost = 0;
    let daRete = 0;
    let daVecchie = 0;
    let daHub = 0;
    let almenoUno = 0;
    const tipoPrimo = new Map<string, number>();
    for (const d of apparati) {
      // SNMP vale per tutti gli apparati; gli altri protocolli solo come principale.
      if (proto !== "snmp" && protocolloPrincipale(d) !== proto) continue;
      if (haFontePropria(dbh, d, proto)) continue;
      senzaFonte += 1;
      if (d.host_id == null) {
        senzaHost += 1;
        continue;
      }
      const rete = (dbh.prepare("SELECT network_id FROM hosts WHERE id = ?").get(d.host_id) as { network_id: number } | undefined)?.network_id ?? null;
      const candidati: string[] = [];
      const host = dbh.prepare(
        `SELECT c.credential_type AS t FROM host_credentials hc JOIN credentials c ON c.id = hc.credential_id
          WHERE hc.host_id = ? AND hc.protocol_type = ? AND hc.validated = 1 AND c.credential_type IN (${inTipi(tipi)})
          ORDER BY hc.sort_order, hc.id LIMIT 1`
      ).get(d.host_id, proto, ...tipi) as { t: string } | undefined;
      if (host) { daHost += 1; candidati.push(host.t); }
      if (rete != null) {
        const r = dbh.prepare(
          `SELECT c.credential_type AS t FROM network_credentials nc JOIN credentials c ON c.id = nc.credential_id
            WHERE nc.network_id = ? AND c.credential_type IN (${inTipi(tipi)}) ORDER BY nc.sort_order, nc.id LIMIT 1`
        ).get(rete, ...tipi) as { t: string } | undefined;
        if (r) { daRete += 1; candidati.push(r.t); }
        let vecchia: string | null = null;
        if (ruoli.length > 0) {
          const pin = dbh.prepare(
            `SELECT c.credential_type AS t FROM host_detect_credential hdc JOIN credentials c ON c.id = hdc.credential_id
              WHERE hdc.host_id = ? AND hdc.role IN (${inTipi(ruoli)}) AND c.credential_type IN (${inTipi(tipi)}) LIMIT 1`
          ).get(d.host_id, ...ruoli, ...tipi) as { t: string } | undefined;
          const lista = dbh.prepare(
            `SELECT c.credential_type AS t FROM network_host_credentials nhc JOIN credentials c ON c.id = nhc.credential_id
              WHERE nhc.network_id = ? AND nhc.role IN (${inTipi(ruoli)}) AND c.credential_type IN (${inTipi(tipi)})
              ORDER BY nhc.sort_order, nhc.id LIMIT 1`
          ).get(rete, ...ruoli, ...tipi) as { t: string } | undefined;
          vecchia = pin?.t ?? lista?.t ?? null;
        }
        if (vecchia) { daVecchie += 1; candidati.push(vecchia); }
        const idHub = proto === "ssh" ? hubLin : proto === "winrm" ? hubWin : null;
        const tipoHub = idHub != null ? tipoVoce(dbh, idHub) : null;
        if (tipoHub && tipi.includes(tipoHub)) { daHub += 1; candidati.push(tipoHub); }
      }
      if (candidati.length > 0) {
        almenoUno += 1;
        conta(tipoPrimo, candidati[0]);
      }
    }
    out.push(
      `[D1b] ${proto}: apparati senza fonte propria ${senzaFonte} (senza host_id ${senzaHost}) → candidati da righe host validate ${daHost}, ` +
        `catena della rete ${daRete}, catene vecchie ${daVecchie}, chiave dell'hub ${daHub}; almeno uno ${almenoUno}; tipo del primo: ${elenco(tipoPrimo)}`
    );
  }
  return out;
}

/** Segreto di un binding in memoria: [utente, password] dalla voce o dall'inline; null se illeggibile. */
function segretoBindingLogin(b: { credential_id: number | null; inline_username: string | null; inline_encrypted_password: string | null }, dbh: Database.Database): string[] | null {
  if (b.credential_id != null) {
    const c = dbh.prepare("SELECT encrypted_username, encrypted_password FROM credentials WHERE id = ?").get(b.credential_id) as
      | { encrypted_username: string | null; encrypted_password: string | null }
      | undefined;
    if (!c?.encrypted_username || !c.encrypted_password) return null;
    const u = safeDecrypt(c.encrypted_username);
    const p = safeDecrypt(c.encrypted_password);
    return u && p ? [u, p] : null;
  }
  if (!b.inline_username || !b.inline_encrypted_password) return null;
  const p = safeDecrypt(b.inline_encrypted_password);
  return p ? [b.inline_username, p] : null;
}

function communityBinding(b: { credential_id: number | null; inline_encrypted_password: string | null }): string | null {
  if (b.credential_id != null) return getCredentialCommunityString(b.credential_id);
  if (!b.inline_encrypted_password) return null;
  const s = safeDecrypt(b.inline_encrypted_password);
  return s?.trim() ? s : null;
}

/** 2e: colonne degli apparati contro i binding; binding inline. */
function misura2e(dbh: Database.Database, apparati: NetworkDevice[]): Righe {
  const out: Righe = [];
  // a. utente/password in colonna contro i binding del protocollo che getDeviceCredentials legge.
  const col = { n: 0, conBinding: 0, uguale: 0, diverso: 0, senzaBinding: 0, illeggibili: 0 };
  const colPerProto = new Map<string, number>();
  // b. colonna SNMP (snmp_credential_id, o credential_id verso una voce snmp).
  const snmpCol = { n: 0, conBindingStessaVoce: 0, senza: 0 };
  // c. credential_id verso una voce non snmp.
  const altraCol = { n: 0, conBindingStessoProto: 0, conBindingAltroProto: 0, senza: 0 };
  const altraPerTipo = new Map<string, number>();
  // d. community_string in colonna.
  const com = { n: 0, uguale: 0, diversa: 0, senzaBinding: 0 };
  for (const d of apparati) {
    const protoLogin = d.protocol === "winrm" ? "winrm" : d.protocol === "api" ? "api" : "ssh";
    if (d.username && d.encrypted_password) {
      col.n += 1;
      conta(colPerProto, protoLogin);
      const p = safeDecrypt(d.encrypted_password);
      const bindings = bindingPropri(dbh, d.id, protoLogin);
      if (!p) col.illeggibili += 1;
      else if (bindings.length === 0) col.senzaBinding += 1;
      else {
        col.conBinding += 1;
        if (bindings.some((b) => { const s = segretoBindingLogin(b, dbh); return !!s && s[0] === d.username && s[1] === p; })) col.uguale += 1;
        else col.diverso += 1;
      }
    }
    const vociSnmp = new Set<number>();
    if (d.snmp_credential_id != null) vociSnmp.add(d.snmp_credential_id);
    const tipoCol = d.credential_id != null ? tipoVoce(dbh, d.credential_id) : null;
    if (d.credential_id != null && tipoCol === "snmp") vociSnmp.add(d.credential_id);
    if (vociSnmp.size > 0) {
      snmpCol.n += 1;
      const legate = new Set(bindingPropri(dbh, d.id, "snmp").map((b) => b.credential_id));
      if ([...vociSnmp].every((v) => legate.has(v))) snmpCol.conBindingStessaVoce += 1;
      else snmpCol.senza += 1;
    }
    if (d.credential_id != null && tipoCol !== "snmp") {
      altraCol.n += 1;
      conta(altraPerTipo, `${tipoCol ?? "voce assente"} su ${d.protocol}`);
      const tutti = dbh.prepare("SELECT protocol_type FROM device_credential_bindings WHERE device_id = ? AND credential_id = ?").all(d.id, d.credential_id) as Array<{ protocol_type: string }>;
      if (tutti.some((b) => b.protocol_type === protoLogin)) altraCol.conBindingStessoProto += 1;
      else if (tutti.length > 0) altraCol.conBindingAltroProto += 1;
      else altraCol.senza += 1;
    }
    if (d.community_string) {
      com.n += 1;
      const s = safeDecrypt(d.community_string);
      const valore = s && s.trim() ? s : d.community_string;
      const legate = bindingPropri(dbh, d.id, "snmp");
      if (legate.length === 0) com.senzaBinding += 1;
      else if (legate.some((b) => communityBinding(b) === valore)) com.uguale += 1;
      else com.diversa += 1;
    }
  }
  out.push(
    `[2e] utente/password in colonna: ${col.n} (${elenco(colPerProto)}) → con binding dello stesso protocollo ${col.conBinding} ` +
      `(uguale ${col.uguale}, diverso ${col.diverso}), senza binding ${col.senzaBinding}, password illeggibile ${col.illeggibili}`
  );
  out.push(`[2e] colonna SNMP verso una voce: ${snmpCol.n} → già con binding snmp alla stessa voce ${snmpCol.conBindingStessaVoce}, senza ${snmpCol.senza}`);
  out.push(
    `[2e] credential_id verso una voce non SNMP: ${altraCol.n} (${elenco(altraPerTipo)}) → binding alla stessa voce sul protocollo letto ${altraCol.conBindingStessoProto}, ` +
      `solo su un altro protocollo ${altraCol.conBindingAltroProto}, nessun binding alla voce ${altraCol.senza}`
  );
  out.push(`[2e] community_string in colonna: ${com.n} → uguale a un binding snmp ${com.uguale}, diversa ${com.diversa}, senza binding snmp ${com.senzaBinding}`);

  const inline = dbh.prepare(
    `SELECT protocol_type AS p,
            SUM(CASE WHEN inline_encrypted_password IS NOT NULL AND (protocol_type = 'snmp' OR inline_username IS NOT NULL) THEN 1 ELSE 0 END) AS completi,
            COUNT(*) AS n
       FROM device_credential_bindings WHERE credential_id IS NULL GROUP BY protocol_type ORDER BY protocol_type`
  ).all() as Array<{ p: string; completi: number; n: number }>;
  out.push(`[2e] binding inline: ${inline.length === 0 ? "nessuno" : inline.map((r) => `${r.p} ${r.n} (completi ${r.completi})`).join(", ")}`);
  return out;
}

/** Tutte le misure di un tenant, dentro withTenant. */
export function misureTenant(code: string): Righe {
  try {
    return withTenant(code, () => {
      const dbh = getTenantDb(code);
      const apparati = dbh.prepare("SELECT * FROM network_devices ORDER BY id").all() as NetworkDevice[];
      return [
        ...misuraChiaviHub(dbh),
        ...misuraPublic(dbh, apparati),
        ...misuraUsi(dbh),
        ...misuraD1b(dbh, apparati),
        ...misura2e(dbh, apparati),
      ];
    });
  } finally {
    closeTenantDb(code);
  }
}
