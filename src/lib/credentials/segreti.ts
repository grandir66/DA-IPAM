/**
 * Un lettore solo dei segreti dell'archivio (tappa 2 credenziali, T3, 15/10).
 *
 * Prima sette funzioni leggevano i segreti, ognuna con le sue regole di tipo e
 * di colonna. SNMPv3 si leggeva a metà: getDeviceSnmpV3Credentials prendeva la
 * chiave da `encrypted_password` e ignorava livello, protocolli e chiave di
 * privacy; getCredentialCommunityString dava la community rimasta in una voce
 * passata da v2c a v3. Qui una voce si legge in un modo solo, e i lettori di
 * `db.ts` e `db-tenant.ts` sono involucri di una riga delle funzioni `…Db` in
 * fondo al file.
 *
 * Regole:
 * - il tipo della voce deve valere per l'uso (`tipiPerProtocollo`; per `ldap`
 *   vale `ad`, per i controller `unifi` / `omada`), altrimenti un rifiuto che
 *   dice nome e tipo;
 * - `snmp` senza `security_level` → community (prima `encrypted_password`,
 *   poi `encrypted_username`, come oggi); `snmp_v3`, o `snmp` con
 *   `security_level` → v3, mai una community;
 * - formato v3 «vecchio» (`snmp` senza livello, con utente e password, chiesto
 *   per un apparato v3): authNoPriv/MD5 con la chiave da `encrypted_password`,
 *   segnato `formatoVecchio`. Il chiamante che sceglie per un apparato registra
 *   `cred_v3_vecchia` (il motore, T8); qui non si registra niente, perché lo
 *   leggono anche la fotografia e le prove;
 * - i valori escono come sono stati salvati. Chi oggi li ripulisce dagli spazi
 *   (le coppie di login, il v3) lo fa nel suo involucro, così nessuna scelta di
 *   oggi cambia.
 *
 * Schema di partenza: nella 2a `auth_method`, `encrypted_private_key` ed
 * `encrypted_key_passphrase` non esistono ancora (nascono nel T11), e in un
 * DEFAULT mai riaperto mancano anche `port` e le colonne SNMPv3. La riga si
 * legge con SELECT * e ogni colonna che non c'è vale come assente:
 * `auth_method` assente = il primo metodo del tipo.
 *
 * Un rifiuto non contiene mai il segreto: solo nome, tipo e cosa manca.
 *
 * Non importa né `db.ts` né `db-tenant.ts`: riceve l'handle.
 */
import type Database from "better-sqlite3";
import { safeDecrypt } from "@/lib/crypto";
import type { SnmpV3CredentialRecord } from "@/lib/protocols/snmpv3";
import { campiRichiesti, etichettaTipo, METODI_PER_TIPO, normalizzaTipo, tipiPerProtocollo, type MetodoAccesso, type TipoCredenziale } from "./tipi";

export type Segreto =
  | { forma: "utente"; username: string; password: string }
  | { forma: "chiave_ssh"; username: string; privateKey: string; passphrase: string | null }
  | { forma: "community"; community: string }
  | { forma: "v3"; record: SnmpV3CredentialRecord }
  | { forma: "token"; tokenId: string | null; token: string }
  | { forma: "chiave_api"; chiave: string }
  | { forma: "client"; clientId: string; clientSecret: string };

export type UsoSegreto = "ssh" | "winrm" | "snmp" | "api" | "ldap" | "controller_unifi" | "controller_omada";

/**
 * Esito di una lettura. `credentialId` è null solo per un binding inline
 * (`leggiSegretoInline`), che non ha una voce d'archivio. `tipo` è il codice
 * della voce com'è nel DB, in minuscolo (`linux` compreso). `motivo` è in
 * italiano, col nome della voce, mai col segreto.
 */
export type EsitoSegreto =
  | { ok: true; credentialId: number | null; nome: string; tipo: string; segreto: Segreto; port: number | null; formatoVecchio?: true }
  | { ok: false; motivo: string };

export interface OpzioniLettura {
  /**
   * La voce si chiede per un apparato SNMPv3 (getDeviceSnmpV3Credentials): una
   * `snmp` senza livello con utente e password è il formato v3 «vecchio».
   */
  apparatoV3?: boolean;
}

const NOME_USO: Record<UsoSegreto, string> = {
  ssh: "SSH",
  winrm: "WinRM",
  snmp: "SNMP",
  api: "API",
  ldap: "LDAP (Active Directory)",
  controller_unifi: "il controller UniFi",
  controller_omada: "il controller Omada",
};

function tipiPerUso(uso: UsoSegreto): string[] {
  if (uso === "ldap") return ["ad"];
  if (uso === "controller_unifi") return ["unifi"];
  if (uso === "controller_omada") return ["omada"];
  return tipiPerProtocollo(uso);
}

type Riga = Record<string, unknown>;

/** Valore testuale di una colonna; colonna assente, NULL o non testo → null. */
function testo(riga: Riga, colonna: string): string | null {
  const v = riga[colonna];
  return typeof v === "string" ? v : null;
}

type Campo = { ok: true; valore: string | null } | { ok: false; motivo: string };

/**
 * Decifra una colonna. Assente o vuota → `valore: null`; non decifrabile →
 * rifiuto (un segreto rotto non è un segreto assente).
 */
function decifra(riga: Riga, colonna: string, chi: string, cosa: string): Campo {
  const cifrato = testo(riga, colonna);
  if (!cifrato) return { ok: true, valore: null };
  const chiaro = safeDecrypt(cifrato);
  if (chiaro == null) return { ok: false, motivo: `${chi}: ${cosa} non si decifra (ENCRYPTION_KEY diversa da quella che l'ha cifrata?)` };
  return { ok: true, valore: chiaro };
}

/** Come `decifra`, ma il valore è obbligatorio: vuoto o di soli spazi → rifiuto. */
function richiesto(riga: Riga, colonna: string, chi: string, cosa: string): { ok: true; valore: string } | { ok: false; motivo: string } {
  const c = decifra(riga, colonna, chi, cosa);
  if (!c.ok) return c;
  if (!c.valore?.trim()) return { ok: false, motivo: `${chi} non ha ${cosa}` };
  return { ok: true, valore: c.valore };
}

function rifiuto(motivo: string): EsitoSegreto {
  return { ok: false, motivo };
}

function porta(riga: Riga): number | null {
  const p = riga.port;
  return typeof p === "number" ? p : null;
}

function utente(riga: Riga, chi: string): { ok: true; segreto: Segreto } | { ok: false; motivo: string } {
  const u = richiesto(riga, "encrypted_username", chi, "l'utente");
  if (!u.ok) return u;
  const p = richiesto(riga, "encrypted_password", chi, "la password");
  if (!p.ok) return p;
  return { ok: true, segreto: { forma: "utente", username: u.valore, password: p.valore } };
}

/** v3 dalle colonne della voce: livello, protocolli, chiave d'autenticazione e di privacy. */
function v3(riga: Riga, chi: string, livello: string): { ok: true; segreto: Segreto } | { ok: false; motivo: string } {
  let campi: string[];
  try {
    campi = campiRichiesti("snmp_v3", "utente_v3", livello);
  } catch (e) {
    // Solo il livello sconosciuto arriva qui: il metodo è fisso e vale per snmp_v3.
    return { ok: false, motivo: `${chi}: ${(e as Error).message}` };
  }
  const u = richiesto(riga, "encrypted_username", chi, "l'utente SNMPv3");
  if (!u.ok) return u;
  const auth = campi.includes("auth_key")
    ? richiesto(riga, "encrypted_auth_key", chi, "la chiave di autenticazione SNMPv3")
    : decifra(riga, "encrypted_auth_key", chi, "la chiave di autenticazione SNMPv3");
  if (!auth.ok) return auth;
  const priv = campi.includes("priv_key")
    ? richiesto(riga, "encrypted_priv_key", chi, "la chiave di privacy SNMPv3")
    : decifra(riga, "encrypted_priv_key", chi, "la chiave di privacy SNMPv3");
  if (!priv.ok) return priv;
  return {
    ok: true,
    segreto: {
      forma: "v3",
      record: {
        username: u.valore,
        securityLevel: livello,
        authProtocol: testo(riga, "auth_protocol"),
        authKey: auth.valore,
        privProtocol: testo(riga, "priv_protocol"),
        privKey: priv.valore,
      },
    },
  };
}

/** Community di una `snmp` senza livello: `encrypted_password`, poi `encrypted_username` (com'era). */
function community(riga: Riga, chi: string): { ok: true; segreto: Segreto } | { ok: false; motivo: string } {
  const colonna = testo(riga, "encrypted_password") ? "encrypted_password" : "encrypted_username";
  const c = richiesto(riga, colonna, chi, "la community");
  if (!c.ok) return c;
  return { ok: true, segreto: { forma: "community", community: c.valore } };
}

/**
 * Formato v3 «vecchio»: utente e password tutti e due presenti e leggibili.
 * Null quando non lo è (la voce resta una community, come oggi).
 */
function v3Vecchio(riga: Riga): Segreto | null {
  const u = testo(riga, "encrypted_username");
  const p = testo(riga, "encrypted_password");
  if (!u || !p) return null;
  const username = safeDecrypt(u);
  const authKey = safeDecrypt(p);
  if (!username?.trim() || !authKey?.trim()) return null;
  return {
    forma: "v3",
    record: { username, securityLevel: "authNoPriv", authProtocol: "MD5", authKey, privProtocol: null, privKey: null },
  };
}

function segretoPerMetodo(
  riga: Riga,
  chi: string,
  tipo: TipoCredenziale,
  metodo: MetodoAccesso,
): { ok: true; segreto: Segreto } | { ok: false; motivo: string } {
  switch (metodo) {
    case "password":
    case "utente":
      return utente(riga, chi);
    case "chiave": {
      if (tipo !== "ssh") {
        const k = richiesto(riga, "encrypted_password", chi, "la chiave API");
        if (!k.ok) return k;
        return { ok: true, segreto: { forma: "chiave_api", chiave: k.valore } };
      }
      const u = richiesto(riga, "encrypted_username", chi, "l'utente");
      if (!u.ok) return u;
      const k = richiesto(riga, "encrypted_private_key", chi, "la chiave privata");
      if (!k.ok) return k;
      const f = decifra(riga, "encrypted_key_passphrase", chi, "la passphrase della chiave");
      if (!f.ok) return f;
      return { ok: true, segreto: { forma: "chiave_ssh", username: u.valore, privateKey: k.valore, passphrase: f.valore || null } };
    }
    case "token": {
      const id = decifra(riga, "encrypted_username", chi, "l'id del token");
      if (!id.ok) return id;
      const t = richiesto(riga, "encrypted_password", chi, "il token");
      if (!t.ok) return t;
      return { ok: true, segreto: { forma: "token", tokenId: id.valore?.trim() ? id.valore : null, token: t.valore } };
    }
    case "client": {
      const id = richiesto(riga, "encrypted_username", chi, "il client id");
      if (!id.ok) return id;
      const s = richiesto(riga, "encrypted_password", chi, "il client secret");
      if (!s.ok) return s;
      return { ok: true, segreto: { forma: "client", clientId: id.valore, clientSecret: s.valore } };
    }
    case "community":
      return community(riga, chi);
    case "utente_v3":
      return v3(riga, chi, testo(riga, "security_level")?.trim() || "authPriv");
  }
}

/**
 * Legge il segreto di una voce d'archivio per un uso. Non lancia: ogni
 * problema (voce assente, tipo che non vale, campo mancante o non
 * decifrabile) è un `ok: false` col motivo.
 */
export function leggiSegretoDb(dbh: Database.Database, credentialId: number, uso: UsoSegreto, opzioni: OpzioniLettura = {}): EsitoSegreto {
  const riga = dbh.prepare("SELECT * FROM credentials WHERE id = ?").get(credentialId) as Riga | undefined;
  if (!riga) return rifiuto(`La credenziale #${credentialId} non esiste`);
  const nome = testo(riga, "name") ?? `#${credentialId}`;
  const codice = (testo(riga, "credential_type") ?? "").trim().toLowerCase();
  if (!tipiPerUso(uso).includes(codice)) {
    return rifiuto(`La credenziale «${nome}» è di tipo ${etichettaTipo(codice) || "sconosciuto"}, non vale per ${NOME_USO[uso]}`);
  }
  const tipo = normalizzaTipo(codice);
  if (!tipo) return rifiuto(`La credenziale «${nome}» ha un tipo sconosciuto («${codice}»)`);

  const base = { ok: true as const, credentialId, nome, tipo: codice, port: porta(riga) };
  const chi = `La credenziale «${nome}»`;
  const livello = testo(riga, "security_level")?.trim() || null;

  if (tipo === "snmp" || tipo === "snmp_v3") {
    if (tipo === "snmp_v3" || livello) {
      const r = v3(riga, chi, livello ?? "authPriv");
      return r.ok ? { ...base, segreto: r.segreto } : rifiuto(r.motivo);
    }
    if (opzioni.apparatoV3) {
      const vecchio = v3Vecchio(riga);
      if (vecchio) return { ...base, segreto: vecchio, formatoVecchio: true };
    }
    const r = community(riga, chi);
    return r.ok ? { ...base, segreto: r.segreto } : rifiuto(r.motivo);
  }

  const metodi = METODI_PER_TIPO[tipo];
  const scritto = testo(riga, "auth_method")?.trim() || null;
  const metodo = (scritto ?? metodi[0]) as MetodoAccesso;
  if (!metodi.includes(metodo)) {
    return rifiuto(`La credenziale «${nome}» ha un metodo d'accesso non valido per ${etichettaTipo(tipo)} («${scritto}»)`);
  }
  const r = segretoPerMetodo(riga, chi, tipo, metodo);
  return r.ok ? { ...base, segreto: r.segreto } : rifiuto(r.motivo);
}

/**
 * I campi segreti di una voce, coi nomi del KV di OpenBao (da-vault): `username`, `password`, `private_key`,
 * `key_passphrase`, `auth_key`, `priv_key`. Una colonna vuota non c'è.
 */
export type CampoSegreto = "username" | "password" | "private_key" | "key_passphrase" | "auth_key" | "priv_key";

export const COLONNA_DEL_CAMPO: Readonly<Record<CampoSegreto, string>> = {
  username: "encrypted_username",
  password: "encrypted_password",
  private_key: "encrypted_private_key",
  key_passphrase: "encrypted_key_passphrase",
  auth_key: "encrypted_auth_key",
  priv_key: "encrypted_priv_key",
};

const COSA_DEL_CAMPO: Readonly<Record<CampoSegreto, string>> = {
  username: "l'utente",
  password: "la password",
  private_key: "la chiave privata",
  key_passphrase: "la passphrase della chiave",
  auth_key: "la chiave di autenticazione SNMPv3",
  priv_key: "la chiave di privacy SNMPv3",
};

export type EsitoCampi =
  | { ok: true; credentialId: number; nome: string; tipo: string; port: number | null; campi: Partial<Record<CampoSegreto, string>> }
  | { ok: false; motivo: string };

/**
 * Tutti i campi segreti di una voce in chiaro (da-vault): la verifica della ricifra (stessi campi prima e dopo), la
 * «mostra password», l'esportazione KeePass, la migrazione verso OpenBao. Non guarda tipo né metodo: dà quello che
 * c'è. Un campo che non si decifra è un rifiuto col nome della voce, mai col valore.
 */
export function campiVoceDb(dbh: Database.Database, credentialId: number): EsitoCampi {
  const riga = dbh.prepare("SELECT * FROM credentials WHERE id = ?").get(credentialId) as Riga | undefined;
  if (!riga) return { ok: false, motivo: `La credenziale #${credentialId} non esiste` };
  const nome = testo(riga, "name") ?? `#${credentialId}`;
  const chi = `La credenziale «${nome}»`;
  const campi: Partial<Record<CampoSegreto, string>> = {};
  for (const campo of Object.keys(COLONNA_DEL_CAMPO) as CampoSegreto[]) {
    const c = decifra(riga, COLONNA_DEL_CAMPO[campo], chi, COSA_DEL_CAMPO[campo]);
    if (!c.ok) return c;
    if (c.valore !== null && c.valore !== "") campi[campo] = c.valore;
  }
  return { ok: true, credentialId, nome, tipo: (testo(riga, "credential_type") ?? "").trim().toLowerCase(), port: porta(riga), campi };
}

/** Tipo d'archivio che corrisponde al protocollo di un binding inline. */
function tipoDelBinding(protocollo: string): string {
  if (protocollo === "snmp") return "snmp";
  if (protocollo === "winrm") return "windows";
  if (protocollo === "api" || protocollo === "redfish" || protocollo === "onvif") return "api";
  return "ssh";
}

/**
 * Segreto scritto dentro un binding (`inline_username`,
 * `inline_encrypted_password`), senza voce d'archivio: community per SNMP,
 * utente e password per gli altri protocolli. L'utente inline è in chiaro.
 */
export function leggiSegretoInline(b: { protocol_type: string; inline_username: string | null; inline_encrypted_password: string | null }): EsitoSegreto {
  const nome = "credenziale nel binding";
  const base = { ok: true as const, credentialId: null, nome, tipo: tipoDelBinding(b.protocol_type), port: null };
  const chi = "La credenziale scritta nel binding";
  const riga: Riga = { encrypted_password: b.inline_encrypted_password };
  const p = richiesto(riga, "encrypted_password", chi, b.protocol_type === "snmp" ? "la community" : "la password");
  if (!p.ok) return rifiuto(p.motivo);
  if (b.protocol_type === "snmp") return { ...base, segreto: { forma: "community", community: p.valore } };
  if (!b.inline_username?.trim()) return rifiuto(`${chi} non ha l'utente`);
  return { ...base, segreto: { forma: "utente", username: b.inline_username, password: p.valore } };
}

/**
 * Accesso SSH da una voce: utente più password, oppure utente più chiave
 * privata (con la passphrase, se è cifrata). È la forma che il trasporto ssh2
 * (`SshOptions`) e l'acquisizione (`getDeviceCredentials`) ricevono dalla
 * tappa 2, T14 (D6 = (a)).
 */
export type AccessoSsh = { username: string; password?: string; privateKey?: string; passphrase?: string };

/** Opzioni di connessione SSH (ssh2) da un segreto: password o chiave. Altre forme → null. */
export function opzioniSsh(s: Segreto): AccessoSsh | null {
  if (s.forma === "utente") return { username: s.username, password: s.password };
  if (s.forma === "chiave_ssh") {
    return s.passphrase ? { username: s.username, privateKey: s.privateKey, passphrase: s.passphrase } : { username: s.username, privateKey: s.privateKey };
  }
  return null;
}

/**
 * Il rifiuto dei percorsi SSH che non usano la chiave (D6 = (a): il ponte
 * paramiko delle patch e dell'inventario Linux, il terminale web). `percorso`
 * comincia con la preposizione: «dal terminale SSH». Niente ripiego su
 * un'altra voce: la voce scelta è quella, e si dice perché non va.
 */
export function chiaveNonSupportata(percorso: string, nomeVoce?: string | null): string {
  return `Credenziale a chiave non supportata ${percorso}: usa una credenziale con password${nomeVoce ? ` (la voce «${nomeVoce}» è a chiave)` : ""}`;
}

/** Il nome di una voce, per i messaggi; null senza voce o se non c'è. */
export function nomeVoceDb(dbh: Database.Database, credentialId: number | null): string | null {
  if (credentialId == null) return null;
  const r = dbh.prepare("SELECT name FROM credentials WHERE id = ?").get(credentialId) as { name: string | null } | undefined;
  return r?.name ?? null;
}

export type EsitoAccessoSsh = { ok: true; accesso: AccessoSsh; port: number | null } | { ok: false; motivo: string };

/**
 * L'accesso SSH di una voce `ssh` (o `linux`) con la porta della voce: utente
 * e password ripuliti dagli spazi come in getSshLinuxCredentialPair, oppure
 * utente ripulito e chiave com'è (T14). Il rifiuto dice perché.
 */
export function accessoSshDb(dbh: Database.Database, credentialId: number): EsitoAccessoSsh {
  const e = leggiSegretoDb(dbh, credentialId, "ssh");
  if (!e.ok) return e;
  if (e.segreto.forma === "utente") {
    return { ok: true, accesso: { username: e.segreto.username.trim(), password: e.segreto.password.trim() }, port: e.port };
  }
  if (e.segreto.forma === "chiave_ssh") {
    const a = opzioniSsh(e.segreto) as AccessoSsh;
    return { ok: true, accesso: { ...a, username: a.username.trim() }, port: e.port };
  }
  return { ok: false, motivo: `La credenziale «${e.nome}» non ha un accesso SSH (utente con password o chiave)` };
}

// ── Involucri: le letture di oggi, una funzione pura ciascuna ─────────────
// db.ts le chiama con getDb(), db-tenant.ts con db(). Ognuna tiene il
// comportamento del lettore che sostituisce: tipo, ripulitura dagli spazi,
// valori restituiti.

const USO_PER_TIPO_ATTESO = { windows: "winrm", linux: "ssh", api: "api" } as const satisfies Record<string, UsoSegreto>;

/**
 * getCredentialLoginPair: utente e password, ripuliti, solo se la voce è
 * esattamente del tipo atteso (una `ssh` non vale come «api» né come «linux»).
 */
export function coppiaLoginDb(
  dbh: Database.Database,
  credentialId: number,
  tipoAtteso: keyof typeof USO_PER_TIPO_ATTESO,
): { username: string; password: string } | null {
  const e = leggiSegretoDb(dbh, credentialId, USO_PER_TIPO_ATTESO[tipoAtteso]);
  if (!e.ok || e.tipo !== tipoAtteso || e.segreto.forma !== "utente") return null;
  return { username: e.segreto.username.trim(), password: e.segreto.password.trim() };
}

/** getSshLinuxCredentialPair: voce `ssh` o `linux` con password, ripulita, con la porta della voce. */
export function coppiaSshDb(dbh: Database.Database, credentialId: number): { username: string; password: string; port: number | null } | null {
  const e = leggiSegretoDb(dbh, credentialId, "ssh");
  if (!e.ok || e.segreto.forma !== "utente") return null;
  return { username: e.segreto.username.trim(), password: e.segreto.password.trim(), port: e.port };
}

/** getCredentialCommunityString: la community com'è salvata; una v3 non ne ha. */
export function communityDb(dbh: Database.Database, credentialId: number): string | null {
  const e = leggiSegretoDb(dbh, credentialId, "snmp");
  return e.ok && e.segreto.forma === "community" ? e.segreto.community : null;
}

function ripulito(v: string | null | undefined): string | null {
  return v == null ? null : v.trim();
}

/**
 * Il lettore v3 della 2a (getDeviceSnmpV3Credentials, tolto nel T8: ora
 * l'acquisizione legge da `credenzialeSnmpApparatoDb` del motore, binding
 * compresi): la prima voce v3 fra le due colonne dell'apparato (con protocollo
 * SNMP prima `credential_id`, altrimenti prima `snmp_credential_id`), col
 * record completo e ripulito. Resta per misure-2a.ts, che misura la 2a.
 */
export function v3ApparatoDb(
  dbh: Database.Database,
  // Le colonne vecchie di `network_devices`, lette dalla riga: il tipo `NetworkDevice` non le porta più (T26).
  device: { protocol: string; credential_id?: number | null; snmp_credential_id?: number | null },
): SnmpV3CredentialRecord | null {
  const snmpPrincipale = device.protocol === "snmp_v2" || device.protocol === "snmp_v3";
  const ids = snmpPrincipale ? [device.credential_id, device.snmp_credential_id] : [device.snmp_credential_id, device.credential_id];
  for (const id of ids) {
    if (!id) continue;
    const e = leggiSegretoDb(dbh, id, "snmp", { apparatoV3: true });
    if (!e.ok || e.segreto.forma !== "v3") continue;
    const r = e.segreto.record;
    return {
      username: r.username.trim(),
      securityLevel: r.securityLevel,
      authProtocol: r.authProtocol ?? null,
      authKey: ripulito(r.authKey),
      privProtocol: r.privProtocol ?? null,
      privKey: ripulito(r.privKey),
    };
  }
  return null;
}
