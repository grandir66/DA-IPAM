/**
 * Chi scrive le credenziali di un apparato scrive solo binding d'archivio
 * (tappa 2e credenziali, T20, 16/10).
 *
 * Dopo la conversione della 2e (T19) le colonne di `network_devices`
 * (`credential_id`, `snmp_credential_id`, `username` + `encrypted_password`,
 * `community_string`, `api_token`) e i binding inline sono vuoti, e la 2g
 * smetterà di leggerli. Chi scriveva lì scrive qui:
 * - una voce scelta per un protocollo (modifica in blocco, modifica del
 *   singolo, assegnazione ai router delle reti) va in testa ai binding di quel
 *   protocollo, non provata; i binding che ci sono restano con la loro storia
 *   di prova. Con D1 = (a) si usa prima degli altri non provati ma dopo i
 *   riusciti: per sostituire una credenziale che funziona la si toglie dalla
 *   tabella dell'apparato (interfaccia, punto 8). Se era già legata con un
 *   binding fallito, resta fallito (D10 = (a)) e l'esito lo dice (`falliti`);
 * - «Nessuna» toglie i binding di quel protocollo, e svuota le colonne che il
 *   motore leggerebbe per lui (un apparato lasciato dalla 2e le ha ancora):
 *   solo dopo una conferma che ne dice il numero (409 con la domanda);
 * - utente e password, community, token scritti a mano diventano una voce
 *   `«<nome apparato> · <protocollo>»` più il binding;
 * - nella tabella dell'apparato «Nuova» crea la voce; la modifica di utente e
 *   password aggiorna la voce se è solo di quel binding, altrimenti ne crea una
 *   dell'apparato, così una voce condivisa non cambia per gli altri;
 * - «Usata adesso» è la scelta del motore (acquisizione, D1b = (a)), calcolata
 *   senza registrare ripieghi.
 *
 * Modulo con l'handle del DB esplicito: non importa né `db.ts` né
 * `db-tenant.ts`. Le rotte lo chiamano con `getDb()` (modello: T13).
 */
import type Database from "better-sqlite3";
import type { z } from "zod";
import { safeDecrypt } from "@/lib/crypto";
import type { CredentialSchema } from "@/lib/validators";
import { tipoBindingPerProtocollo } from "@/lib/devices/binding-apparato";
import type { FonteUsata, UsataAdesso } from "@/lib/devices/usata-adesso";
import { creaVoceDb, modificaVoceDb } from "./archivio";
import { DEFAULT_PORTS, type CredProtocol } from "./porte";
import { credenzialeSnmpApparatoDb, haSnmpApparatoDb, sceltaLoginApparatoDb, type ApparatoInAcquisizione, type ResolvedCredentialSource } from "./resolve";
import { erroreVocePerProtocollo, normalizzaTipo, portaVoceValePer, tipiPerProtocollo, type TipoCredenziale } from "./tipi";
import { totaleUsi, usiCredenzialeDb } from "./usi";

type DatiCredenziale = z.infer<typeof CredentialSchema>;

export const NOME_PROTOCOLLO: Readonly<Record<CredProtocol, string>> = {
  ssh: "SSH",
  snmp: "SNMP",
  winrm: "WinRM",
  api: "API",
  redfish: "Redfish",
  onvif: "ONVIF",
};

/** Conferma chiesta prima di togliere binding («Nessuna»). */
export interface ConfermaRimozione {
  domanda: string;
  binding: number;
  apparati: number;
  riusciti: number;
}

/** Un rifiuto con lo stato HTTP che la rotta risponde; 409 con `conferma` = serve l'ok dell'utente. */
export class RifiutoCredenziali extends Error {
  constructor(
    messaggio: string,
    readonly stato: 400 | 404 | 409 = 400,
    readonly conferma: ConfermaRimozione | null = null,
  ) {
    super(messaggio);
    this.name = "RifiutoCredenziali";
  }
}

interface Apparato {
  id: number;
  name: string;
  protocol: string | null;
  port: number | null;
  device_type: string | null;
}

interface Voce {
  id: number;
  name: string;
  credential_type: string;
  port: number | null;
}

export interface RigaBinding {
  id: number;
  device_id: number;
  credential_id: number | null;
  protocol_type: CredProtocol;
  port: number;
  sort_order: number;
  inline_username: string | null;
  inline_encrypted_password: string | null;
  test_status: "success" | "failed" | "untested";
  test_message: string | null;
  tested_at: string | null;
  auto_detected: number;
  created_at: string;
  credential_name: string | null;
  credential_type: string | null;
}

function leggiApparato(dbh: Database.Database, id: number): Apparato | null {
  return (dbh.prepare("SELECT id, name, protocol, port, device_type FROM network_devices WHERE id = ?").get(id) as Apparato | undefined) ?? null;
}

function apparatoOppure404(dbh: Database.Database, id: number): Apparato {
  const app = leggiApparato(dbh, id);
  if (!app) throw new RifiutoCredenziali("Dispositivo non trovato", 404);
  return app;
}

function leggiVoce(dbh: Database.Database, id: number): Voce | undefined {
  return dbh.prepare("SELECT id, name, credential_type, port FROM credentials WHERE id = ?").get(id) as Voce | undefined;
}

function leggiBinding(dbh: Database.Database, id: number): RigaBinding | undefined {
  return dbh
    .prepare(
      `SELECT dcb.*, c.name AS credential_name, c.credential_type
       FROM device_credential_bindings dcb LEFT JOIN credentials c ON c.id = dcb.credential_id
       WHERE dcb.id = ?`,
    )
    .get(id) as RigaBinding | undefined;
}

/** Il protocollo di login dell'apparato, come lo usa l'acquisizione (winrm, api, altrimenti ssh). */
function protocolloLogin(p: string | null): CredProtocol {
  return p === "winrm" ? "winrm" : p === "api" ? "api" : "ssh";
}

/** Il tipo della voce che nasce per un protocollo. */
function tipoPerProtocollo(p: CredProtocol): TipoCredenziale {
  if (p === "snmp") return "snmp";
  if (p === "winrm") return "windows";
  if (p === "ssh") return "ssh";
  return "api";
}

/** Il protocollo del tipo di una voce (F2: una Windows su un apparato SSH va su WinRM). */
function protocolloDelTipo(tipo: string): CredProtocol | null {
  switch (normalizzaTipo(tipo)) {
    case "ssh":
      return "ssh";
    case "windows":
      return "winrm";
    case "api":
      return "api";
    case "snmp":
    case "snmp_v3":
      return "snmp";
    default:
      return null;
  }
}

const portaValida = (p: number | null | undefined): p is number => p != null && Number.isInteger(p) && p > 0 && p <= 65535;

/**
 * Porta di un binding nuovo, con le regole della conversione (T19):
 * - SNMP: la porta della voce, altrimenti 161; mai `device.port` (F3);
 * - il protocollo principale dell'apparato: `device.port` (D11 = (a); per un
 *   Proxmox `api` anche con una voce `ssh`, F1);
 * - un altro protocollo: la porta della voce se vale per lui, altrimenti lo standard.
 */
export function portaBinding(app: { protocol: string | null; port: number | null }, p: CredProtocol, voce: Pick<Voce, "credential_type" | "port"> | null): number {
  if (p === "snmp") return voce && portaValida(voce.port) && portaVoceValePer(voce.credential_type, "snmp") ? voce.port : DEFAULT_PORTS.snmp;
  if (app.protocol != null && tipoBindingPerProtocollo(app.protocol) === p && portaValida(app.port)) return app.port;
  if (voce && portaValida(voce.port) && portaVoceValePer(voce.credential_type, p)) return voce.port;
  return DEFAULT_PORTS[p];
}

// ── Voci nuove col nome dell'apparato ───────────────────────────────────────

/** `«<nome> · <protocollo>»`; se il nome c'è già, `« (apparato #id)»` (e un numero, se serve ancora). */
export function nomeVoceApparatoDb(dbh: Database.Database, app: { id: number; name: string }, p: CredProtocol): string {
  const base = `${app.name} · ${NOME_PROTOCOLLO[p]}`;
  const preso = (n: string): boolean => dbh.prepare("SELECT 1 FROM credentials WHERE name = ?").get(n) != null;
  let nome = base;
  if (preso(nome)) nome = `${base} (apparato #${app.id})`;
  for (let i = 2; preso(nome); i++) nome = `${base} (apparato #${app.id}, ${i})`;
  return nome;
}

/** Segreto in chiaro scritto dall'utente. SNMP: `password` è la community. */
export interface SegretoInChiaro {
  username?: string | null;
  password?: string | null;
  /** Token API (voce `api`, metodo `token`). */
  token?: string | null;
}

/**
 * Crea la voce dell'apparato per un protocollo, con le regole delle API
 * (`creaVoceDb`: campi richiesti per tipo e metodo). La porta va sulla voce
 * solo se non è lo standard del protocollo. Un campo mancante è un 400.
 */
function creaVoceApparatoDb(dbh: Database.Database, app: Apparato, p: CredProtocol, s: SegretoInChiaro, porta: number | null): { id: number; nome: string } {
  const nome = nomeVoceApparatoDb(dbh, app, p);
  const conToken = s.token != null;
  const dati: DatiCredenziale = {
    name: nome,
    credential_type: tipoPerProtocollo(p),
    auth_method: conToken ? "token" : null,
    username: p === "snmp" || conToken ? undefined : (s.username ?? undefined),
    password: (conToken ? s.token : s.password) ?? undefined,
    port: porta != null && porta !== DEFAULT_PORTS[p] ? porta : null,
  };
  const esito = creaVoceDb(dbh, dati);
  if (!esito.ok) throw new RifiutoCredenziali(esito.errore, 400);
  return { id: esito.vista.id, nome };
}

// ── Binding ─────────────────────────────────────────────────────────────────

/**
 * Lega una voce all'apparato su un protocollo. La voce deve valere per il
 * protocollo (400 altrimenti). Se è già legata su quel protocollo non si
 * duplica: in testa ci va quel binding, con la sua storia di prova.
 * - `inTesta`: `sort_order` = minimo dell'apparato − 1, prima di tutti;
 * - altrimenti in coda (massimo + 1), come la tabella dell'apparato.
 */
function legaVoceDb(
  dbh: Database.Database,
  app: Apparato,
  p: CredProtocol,
  credentialId: number,
  opzioni: { inTesta: boolean; porta?: number },
): { binding_id: number; nuovo: boolean; spostato: boolean } {
  const voce = leggiVoce(dbh, credentialId);
  const errore = erroreVocePerProtocollo(credentialId, voce, p);
  if (errore || !voce) throw new RifiutoCredenziali(errore ?? `La credenziale #${credentialId} non esiste nell'archivio`, 400);
  const ordini = dbh
    .prepare("SELECT COALESCE(MIN(sort_order), 1) AS minimo, COALESCE(MAX(sort_order), -1) AS massimo FROM device_credential_bindings WHERE device_id = ?")
    .get(app.id) as { minimo: number; massimo: number };
  const esistente = dbh
    .prepare("SELECT id FROM device_credential_bindings WHERE device_id = ? AND credential_id = ? AND protocol_type = ? ORDER BY sort_order, id LIMIT 1")
    .get(app.id, credentialId, p) as { id: number } | undefined;
  if (esistente) {
    if (!opzioni.inTesta) return { binding_id: esistente.id, nuovo: false, spostato: false };
    const primo = dbh
      .prepare("SELECT id FROM device_credential_bindings WHERE device_id = ? AND protocol_type = ? ORDER BY sort_order, id LIMIT 1")
      .get(app.id, p) as { id: number };
    if (primo.id === esistente.id) return { binding_id: esistente.id, nuovo: false, spostato: false };
    dbh.prepare("UPDATE device_credential_bindings SET sort_order = ? WHERE id = ?").run(ordini.minimo - 1, esistente.id);
    return { binding_id: esistente.id, nuovo: false, spostato: true };
  }
  const r = dbh
    .prepare("INSERT INTO device_credential_bindings (device_id, credential_id, protocol_type, port, sort_order) VALUES (?, ?, ?, ?, ?)")
    .run(app.id, credentialId, p, opzioni.porta ?? portaBinding(app, p, voce), opzioni.inTesta ? ordini.minimo - 1 : ordini.massimo + 1);
  return { binding_id: Number(r.lastInsertRowid), nuovo: true, spostato: false };
}

type CampoVoce = "credential_id" | "snmp_credential_id";

/** Il protocollo di un campo: la voce principale va sul protocollo dell'apparato, quella SNMP su SNMP. */
function protocolloDelCampo(campo: CampoVoce, app: Apparato): CredProtocol {
  return campo === "snmp_credential_id" ? "snmp" : tipoBindingPerProtocollo(app.protocol ?? "ssh");
}

/** Colonne che il motore legge per quel campo e protocollo: con «Nessuna» si svuotano (apparati lasciati dalla 2e). */
function colonneDelCampo(campo: CampoVoce, p: CredProtocol): string[] {
  if (campo === "snmp_credential_id") return ["snmp_credential_id", "community_string"];
  const colonne = ["credential_id", "username", "encrypted_password"];
  if (p === "snmp") colonne.push("community_string");
  if (p === "api") colonne.push("api_token");
  return colonne;
}

function colonneApparato(dbh: Database.Database): Set<string> {
  return new Set((dbh.prepare("PRAGMA table_info(network_devices)").all() as Array<{ name: string }>).map((c) => c.name));
}

interface Rimozione {
  device_id: number;
  protocollo: CredProtocol;
  binding: number;
  riusciti: number;
}

function daTogliere(dbh: Database.Database, deviceId: number, p: CredProtocol): Rimozione {
  const r = dbh
    .prepare(
      "SELECT COUNT(*) AS n, COALESCE(SUM(test_status = 'success'), 0) AS ok FROM device_credential_bindings WHERE device_id = ? AND protocol_type = ?",
    )
    .get(deviceId, p) as { n: number; ok: number };
  return { device_id: deviceId, protocollo: p, binding: r.n, riusciti: r.ok };
}

const plurale = (n: number, uno: string, molti: string): string => `${n} ${n === 1 ? uno : molti}`;

/** «Togli 12 binding WinRM da 20 apparati, di cui 5 riusciti?»; null se non c'è niente da togliere. */
export function domandaRimozione(rimozioni: readonly Rimozione[]): ConfermaRimozione | null {
  const piene = rimozioni.filter((r) => r.binding > 0);
  const binding = piene.reduce((s, r) => s + r.binding, 0);
  if (binding === 0) return null;
  const riusciti = piene.reduce((s, r) => s + r.riusciti, 0);
  const apparati = new Set(piene.map((r) => r.device_id)).size;
  const perProtocollo = new Map<CredProtocol, number>();
  for (const r of piene) perProtocollo.set(r.protocollo, (perProtocollo.get(r.protocollo) ?? 0) + r.binding);
  const quali =
    perProtocollo.size === 1
      ? `${binding} binding ${NOME_PROTOCOLLO[[...perProtocollo.keys()][0]]}`
      : `${binding} binding (${[...perProtocollo].map(([p, n]) => `${NOME_PROTOCOLLO[p]} ${n}`).join(", ")})`;
  const di = riusciti === 0 ? "nessuno riuscito" : `di cui ${plurale(riusciti, "riuscito", "riusciti")}`;
  return { domanda: `Togli ${quali} da ${plurale(apparati, "apparato", "apparati")}, ${di}?`, binding, apparati, riusciti };
}

function togli(dbh: Database.Database, app: Apparato, campo: CampoVoce, p: CredProtocol, colonne: Set<string>): number {
  const tolti = dbh.prepare("DELETE FROM device_credential_bindings WHERE device_id = ? AND protocol_type = ?").run(app.id, p).changes;
  const daSvuotare = colonneDelCampo(campo, p).filter((c) => colonne.has(c));
  if (daSvuotare.length > 0) dbh.prepare(`UPDATE network_devices SET ${daSvuotare.map((c) => `${c} = NULL`).join(", ")} WHERE id = ?`).run(app.id);
  return tolti;
}

// ── Scelte di voci (in blocco, singolo, router delle reti) ──────────────────

/** Una voce per campo: numero = la voce, `null` = «Nessuna», assente = non modificare. */
export interface SceltaVoci {
  credential_id?: number | null;
  snmp_credential_id?: number | null;
}

export interface EsitoScelte {
  /** Binding nuovi. */
  aggiunti: number;
  /** Binding che c'erano già con quella voce, portati in testa. */
  spostati: number;
  /** Binding tolti da «Nessuna». */
  tolti: number;
  vociNuove: Array<{ id: number; nome: string; device_id: number; protocollo: CredProtocol }>;
  /** Apparati su cui la voce non vale per il protocollo (solo in blocco: nel singolo è un 400). */
  saltati: Array<{ device_id: number; nome: string; motivo: string }>;
  /**
   * Apparati su cui la voce scelta era già legata con un binding fallito: resta
   * fallito, quindi il motore lo salta finché una prova non riesce (D10 = (a)).
   * Va detto a chi ha scelto (`avvisoFalliti`), non passato come riuscito.
   */
  falliti: Array<{ device_id: number; nome: string; voce: string; protocollo: CredProtocol }>;
}

const esitoVuoto = (): EsitoScelte => ({ aggiunti: 0, spostati: 0, tolti: 0, vociNuove: [], saltati: [], falliti: [] });

/**
 * L'avviso per le voci scelte che restano fallite; null se non ce ne sono.
 *
 * Perché (revisione della 2e, 16/10): scegliere una voce già legata con un
 * binding fallito la portava in testa ma fallita, e il motore la salta (D10 =
 * (a)): la risposta diceva «aggiornato» e la scelta non aveva effetto. Rimetterla
 * fra le non provate da sola vorrebbe dire riprovarla a ogni acquisizione (con
 * WinRM, accessi falliti sull'account di dominio): resta fallita e lo si dice.
 */
export function avvisoFalliti(falliti: EsitoScelte["falliti"]): string | null {
  if (falliti.length === 0) return null;
  const perVoce = new Map<string, string[]>();
  for (const f of falliti) perVoce.set(f.voce, [...(perVoce.get(f.voce) ?? []), f.nome]);
  const frasi = [...perVoce].map(([voce, nomi]) => {
    const elenco = nomi.slice(0, 5).map((n) => `«${n}»`).join(", ") + (nomi.length > 5 ? "…" : "");
    return `la credenziale «${voce}» è fallita su ${plurale(nomi.length, "apparato", "apparati")} (${elenco})`;
  });
  return `${frasi.join("; ")}: resta esclusa finché una prova non riesce, provala dalla tabella delle credenziali dell'apparato`;
}

export interface OpzioniScelte {
  /** L'utente ha confermato la rimozione dei binding («Nessuna»). */
  conferma: boolean;
  /** Singolo apparato: una voce che non vale è un 400, non un apparato saltato. */
  rigido?: boolean;
  /**
   * Router delle reti: la voce principale che non vale per il protocollo
   * dell'apparato va sul protocollo del suo tipo (una SSH su un router SNMP
   * è il login SSH, come la colonna di prima).
   */
  protocolloDelTipo?: boolean;
}

/**
 * Applica le voci scelte a più apparati, in una transazione. Prima conta i
 * binding che «Nessuna» toglierebbe: se ce ne sono e manca la conferma, 409
 * con la domanda e niente scritto. Il protocollo è quello che l'apparato ha
 * nel DB al momento della chiamata: chi cambia anche il protocollo lo scrive
 * prima, nella stessa transazione.
 */
export function applicaVociApparatiDb(dbh: Database.Database, deviceIds: readonly number[], scelte: SceltaVoci, opzioni: OpzioniScelte): EsitoScelte {
  return dbh.transaction((): EsitoScelte => {
    const esito = esitoVuoto();
    const apparati = [...new Set(deviceIds)].map((id) => leggiApparato(dbh, id)).filter((a): a is Apparato => a != null);
    // SNMP prima: se tutte e due vanno su SNMP (apparato SNMP), la principale finisce in testa.
    const campi = (["snmp_credential_id", "credential_id"] as const).filter((c) => scelte[c] !== undefined);

    const rimozioni: Rimozione[] = [];
    for (const app of apparati) {
      for (const campo of campi) if (scelte[campo] === null) rimozioni.push(daTogliere(dbh, app.id, protocolloDelCampo(campo, app)));
    }
    const conferma = domandaRimozione(rimozioni);
    if (conferma && !opzioni.conferma) throw new RifiutoCredenziali(conferma.domanda, 409, conferma);

    const colonne = colonneApparato(dbh);
    for (const app of apparati) {
      for (const campo of campi) {
        const valore = scelte[campo];
        let p = protocolloDelCampo(campo, app);
        if (valore === null) {
          esito.tolti += togli(dbh, app, campo, p, colonne);
          continue;
        }
        if (valore === undefined) continue;
        if (opzioni.protocolloDelTipo && campo === "credential_id") {
          const voce = leggiVoce(dbh, valore);
          if (voce && !tipiPerProtocollo(p).includes(voce.credential_type.trim().toLowerCase())) p = protocolloDelTipo(voce.credential_type) ?? p;
        }
        try {
          const r = legaVoceDb(dbh, app, p, valore, { inTesta: true });
          if (r.nuovo) esito.aggiunti++;
          if (r.spostato) esito.spostati++;
          if (!r.nuovo) {
            const b = leggiBinding(dbh, r.binding_id);
            if (b?.test_status === "failed") esito.falliti.push({ device_id: app.id, nome: app.name, voce: b.credential_name ?? `#${valore}`, protocollo: p });
          }
        } catch (e) {
          if (!(e instanceof RifiutoCredenziali) || opzioni.rigido) throw e;
          esito.saltati.push({ device_id: app.id, nome: app.name, motivo: e.message });
        }
      }
    }
    return esito;
  })();
}

/**
 * Utente e password, community e token scritti a mano: una voce
 * `«<nome> · <protocollo>»` ciascuno, più il binding (in testa per la modifica,
 * in coda per la creazione). Utente e password vanno sul protocollo di login
 * (per un apparato SNMP, SSH: come le colonne di prima); servono tutti e due.
 */
export function segretiInVociApparatoDb(
  dbh: Database.Database,
  deviceId: number,
  s: { username?: string | null; password?: string | null; community?: string | null; token?: string | null },
  opzioni: { inTesta: boolean },
): EsitoScelte["vociNuove"] {
  return dbh.transaction((): EsitoScelte["vociNuove"] => {
    const app = apparatoOppure404(dbh, deviceId);
    const nuove: EsitoScelte["vociNuove"] = [];
    const lega = (p: CredProtocol, segreto: SegretoInChiaro) => {
      const porta = portaBinding(app, p, null);
      const voce = creaVoceApparatoDb(dbh, app, p, segreto, null);
      legaVoceDb(dbh, app, p, voce.id, { inTesta: opzioni.inTesta, porta });
      nuove.push({ ...voce, device_id: app.id, protocollo: p });
    };
    if (s.username || s.password) {
      if (!s.username || !s.password) {
        throw new RifiutoCredenziali("Per una credenziale nuova servono utente e password: scrivili tutti e due, o scegli una credenziale dell'archivio", 400);
      }
      lega(protocolloLogin(app.protocol), { username: s.username, password: s.password });
    }
    if (s.community) lega("snmp", { password: s.community });
    if (s.token) lega("api", { token: s.token });
    return nuove;
  })();
}

/** Il campo di un corpo: assente, `null`, o un id positivo; altro è un 400. */
function campoVoce(corpo: Record<string, unknown>, campo: CampoVoce): number | null | undefined {
  const v = corpo[campo];
  if (v === undefined) return undefined;
  if (v === null || v === "" || v === 0) return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new RifiutoCredenziali(`Credenziale non valida: «${String(v)}» non è l'id di una voce dell'archivio`, 400);
  return n;
}

const testo = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

/**
 * PUT /api/devices/[id], parte credenziali: `credential_id` e
 * `snmp_credential_id` con la semantica della modifica in blocco (una voce
 * si aggiunge in testa, `null` toglie dopo la conferma); `username` +
 * `password`, `community_string`, `api_token` diventano voci dell'apparato.
 * Nessuna colonna scritta. Un corpo senza credenziali non tocca niente.
 */
export function applicaCorpoApparatoDb(dbh: Database.Database, deviceId: number, corpo: Record<string, unknown>, opzioni: { conferma: boolean }): EsitoScelte {
  return dbh.transaction((): EsitoScelte => {
    apparatoOppure404(dbh, deviceId);
    const scelte: SceltaVoci = {};
    const voce = campoVoce(corpo, "credential_id");
    const snmp = campoVoce(corpo, "snmp_credential_id");
    if (voce !== undefined) scelte.credential_id = voce;
    if (snmp !== undefined) scelte.snmp_credential_id = snmp;
    const esito = Object.keys(scelte).length > 0 ? applicaVociApparatiDb(dbh, [deviceId], scelte, { conferma: opzioni.conferma, rigido: true }) : esitoVuoto();
    esito.vociNuove.push(
      ...segretiInVociApparatoDb(
        dbh,
        deviceId,
        // Con una voce scelta utente e password scritti a mano non valgono (come prima).
        {
          username: voce ? null : testo(corpo.username),
          password: voce ? null : testo(corpo.password),
          community: testo(corpo.community_string),
          token: testo(corpo.api_token),
        },
        { inTesta: true },
      ),
    );
    esito.aggiunti += esito.vociNuove.length;
    return esito;
  })();
}

/**
 * POST /api/networks/bulk-assign-credential: le voci sul router di ogni rete
 * (un router con più reti conta una volta), con la semantica della modifica
 * in blocco. La voce principale che non vale per il protocollo del router va
 * sul protocollo del suo tipo.
 */
export function assegnaVociAiRouterDb(
  dbh: Database.Database,
  networkIds: readonly number[],
  scelte: SceltaVoci,
  opzioni: { conferma: boolean },
): EsitoScelte & { router: number } {
  const router = new Set<number>();
  for (const id of networkIds) {
    const r = dbh.prepare("SELECT router_id FROM network_router WHERE network_id = ?").get(id) as { router_id: number } | undefined;
    if (r) router.add(r.router_id);
  }
  const esito = applicaVociApparatiDb(dbh, [...router], scelte, { conferma: opzioni.conferma, protocolloDelTipo: true });
  return { ...esito, router: router.size };
}

// ── Tabella delle credenziali dell'apparato ─────────────────────────────────

/** POST /api/devices/[id]/credentials con utente e segreto («Nuova»): la voce nell'archivio, il binding in coda. */
export function nuovaVoceEBindingDb(
  dbh: Database.Database,
  deviceId: number,
  p: CredProtocol,
  porta: number,
  s: SegretoInChiaro,
): { binding: RigaBinding; voce: { id: number; nome: string } } {
  return dbh.transaction(() => {
    const app = apparatoOppure404(dbh, deviceId);
    const voce = creaVoceApparatoDb(dbh, app, p, p === "snmp" ? { password: s.password } : s, porta);
    const { binding_id } = legaVoceDb(dbh, app, p, voce.id, { inTesta: false, porta });
    return { binding: leggiBinding(dbh, binding_id) as RigaBinding, voce };
  })();
}

/** Il binding, se è dell'apparato; altrimenti 404 (prima l'id non si confrontava con l'apparato dell'URL). */
function bindingDellApparato(dbh: Database.Database, deviceId: number, bindingId: number): RigaBinding {
  const b = leggiBinding(dbh, bindingId);
  if (!b || b.device_id !== deviceId) throw new RifiutoCredenziali("Binding non trovato", 404);
  return b;
}

/** La voce è solo di quel binding: nessun altro uso (apparati, colonne, reti, host, AD, Proxmox) e nessun altro binding. */
function voceSoloDelBinding(dbh: Database.Database, credentialId: number, b: RigaBinding): boolean {
  const usi = usiCredenzialeDb(dbh, credentialId);
  if (totaleUsi(usi) !== 1 || usi.apparati.length !== 1) return false;
  const [uso] = usi.apparati;
  if (uso.id !== b.device_id || uso.come !== "binding") return false;
  const n = (dbh.prepare("SELECT COUNT(*) AS n FROM device_credential_bindings WHERE credential_id = ?").get(credentialId) as { n: number }).n;
  return n === 1;
}

/**
 * «update» con utente e segreto nuovi. Prima protocollo e porta, se cambiano
 * (`modifica`), poi la voce, sul protocollo che il binding ha dopo:
 * - la voce del binding è solo sua e vale per il protocollo → si aggiorna
 *   (password vuota = non cambiare);
 * - altrimenti (voce condivisa, binding inline rimasto) → voce nuova
 *   `«<nome> · <protocollo>»` e il binding la punta, senza campi inline. Una
 *   voce condivisa non cambia per gli altri apparati; un inline senza segreto
 *   nuovo porta il suo.
 */
export function aggiornaSegretoBindingDb(
  dbh: Database.Database,
  deviceId: number,
  bindingId: number,
  s: { username?: string | null; password?: string | null },
  modifica: { protocol_type?: CredProtocol; port?: number } = {},
): { credential_id: number; nome: string; nuova: boolean } {
  return dbh.transaction(() => {
    bindingDellApparato(dbh, deviceId, bindingId);
    if (modifica.protocol_type !== undefined || modifica.port !== undefined) {
      dbh
        .prepare("UPDATE device_credential_bindings SET protocol_type = COALESCE(?, protocol_type), port = COALESCE(?, port) WHERE id = ?")
        .run(modifica.protocol_type ?? null, modifica.port ?? null, bindingId);
    }
    const b = bindingDellApparato(dbh, deviceId, bindingId);
    const app = apparatoOppure404(dbh, deviceId);
    const p = b.protocol_type;
    const snmp = p === "snmp";
    if (b.credential_id != null) {
      const voce = leggiVoce(dbh, b.credential_id);
      if (voce && tipiPerProtocollo(p).includes(voce.credential_type.trim().toLowerCase()) && voceSoloDelBinding(dbh, b.credential_id, b)) {
        const dati: Partial<DatiCredenziale> = snmp ? {} : { username: s.username ?? undefined };
        if (s.password) dati.password = s.password;
        const esito = modificaVoceDb(dbh, b.credential_id, dati, {});
        if (!esito.ok) throw new RifiutoCredenziali(esito.errore, esito.stato);
        return { credential_id: b.credential_id, nome: voce.name, nuova: false };
      }
    }
    const inline = b.credential_id == null;
    const username = snmp ? null : (s.username ?? (inline ? b.inline_username : null));
    const password = s.password || (inline && b.inline_encrypted_password ? safeDecrypt(b.inline_encrypted_password) : null);
    if (!password) {
      const di = b.credential_name ? `la credenziale «${b.credential_name}» è usata anche altrove` : "il binding non ha una credenziale sua";
      throw new RifiutoCredenziali(
        `Scrivi anche ${snmp ? "la community" : "la password"}: ${di}, quindi se ne crea una nuova per questo apparato`,
        400,
      );
    }
    const voce = creaVoceApparatoDb(dbh, app, p, { username, password }, b.port);
    dbh
      .prepare("UPDATE device_credential_bindings SET credential_id = ?, inline_username = NULL, inline_encrypted_password = NULL WHERE id = ?")
      .run(voce.id, b.id);
    return { credential_id: voce.id, nome: voce.nome, nuova: true };
  })();
}

/** «delete»: solo un binding dell'apparato dell'URL. False = non è suo (o non c'è): la rotta risponde 404. */
export function eliminaBindingApparatoDb(dbh: Database.Database, deviceId: number, bindingId: number): boolean {
  return dbh.prepare("DELETE FROM device_credential_bindings WHERE id = ? AND device_id = ?").run(bindingId, deviceId).changes > 0;
}

// ── «Usata adesso» ──────────────────────────────────────────────────────────

const FONTI_USATE: ReadonlySet<ResolvedCredentialSource> = new Set<ResolvedCredentialSource>(["device_binding", "snmp_ripiego"]);

function riga(
  dbh: Database.Database,
  ruolo: UsataAdesso["ruolo"],
  protocollo: CredProtocol,
  scelta: { ok: true; credential_id: number | null; fonte: ResolvedCredentialSource; porta: number } | { ok: false; motivo: string },
): UsataAdesso {
  if (!scelta.ok) return { ruolo, protocollo, credential_id: null, nome: null, fonte: null, porta: null, motivo: scelta.motivo };
  const fonte = FONTI_USATE.has(scelta.fonte) ? (scelta.fonte as FonteUsata) : null;
  const voce = scelta.credential_id != null ? leggiVoce(dbh, scelta.credential_id) : undefined;
  // Senza voce, dalla 2g (T26) l'acquisizione sceglie solo il «public» dichiarato (D5).
  const nome = voce ? voce.name : scelta.fonte === "snmp_ripiego" ? "«public»" : null;
  return { ruolo, protocollo, credential_id: scelta.credential_id, nome, fonte, porta: scelta.porta, motivo: null };
}

/**
 * Quale credenziale l'acquisizione usa adesso per l'apparato (interfaccia,
 * punto 5): il protocollo principale e, per router e switch o con una fonte
 * SNMP propria, SNMP. Col motore e le fonti dell'acquisizione (D1b = (a)),
 * senza registrare ripieghi: è una vista.
 */
export function usataAdessoDb(dbh: Database.Database, deviceId: number): UsataAdesso[] {
  const r = dbh.prepare("SELECT * FROM network_devices WHERE id = ?").get(deviceId) as (ApparatoInAcquisizione & { device_type: string | null }) | undefined;
  if (!r) return [];
  const righe: UsataAdesso[] = [];
  const principale = tipoBindingPerProtocollo(r.protocol ?? "ssh");
  const snmpDa = (ruolo: UsataAdesso["ruolo"]) => {
    const s = credenzialeSnmpApparatoDb(dbh, r, { registra: false });
    righe.push(riga(dbh, ruolo, "snmp", s.ok ? { ok: true, credential_id: s.credential_id, fonte: s.fonte, porta: s.port } : s));
  };
  if (principale === "snmp") {
    snmpDa("principale");
    return righe;
  }
  const login = sceltaLoginApparatoDb(dbh, r, { registra: false });
  righe.push(
    riga(
      dbh,
      "principale",
      protocolloLogin(r.protocol),
      login.ok ? { ok: true, credential_id: login.candidato.credential_id, fonte: login.candidato.source, porta: login.candidato.port } : login,
    ),
  );
  if (r.device_type === "router" || r.device_type === "switch" || haSnmpApparatoDb(dbh, r)) snmpDa("snmp");
  return righe;
}
