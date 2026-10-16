/**
 * Controller di rete (ADR 0007): tipi condivisi fra DB, rotte e pagina.
 * Niente import di runtime qui: lo usano sia il server sia il browser.
 */

/** Famiglia del controller. Omada esiste nel vocabolario ma non si legge ancora. */
export type ControllerVendor = "unifi" | "omada";

/**
 * Come si parla col controller:
 * - `self_hosted`: UniFi Network Application classica (VM, es. cliente A), utente e password;
 * - `udm`: console UniFi OS (UDM, UDM Pro/Beast, Cloud Key Gen2+), chiave API
 *   oppure utente LOCALE e password (ADR 0019);
 * - `omada`: controller Omada (OpenAPI, client id e secret) — non ancora disponibile.
 */
export type ControllerKind = "self_hosted" | "udm" | "omada";

export const CONTROLLER_KINDS: readonly ControllerKind[] = ["udm", "self_hosted", "omada"];

/** Come si entra in una console UniFi OS (ADR 0019). */
export type UnifiOsAuth = "api_key" | "password";

/**
 * Il metodo di una console UniFi OS: quello scelto nel modulo (`udmAuth`) se
 * c'è; altrimenti si deduce dai campi: la chiave se c'è, poi utente (e
 * password) se c'è l'utente; senza nessuno dei due vale la chiave già salvata
 * (il controllo del modulo dice se c'è davvero).
 */
export function unifiOsAuthOf(f: { apiKey: string; username: string; udmAuth?: UnifiOsAuth }): UnifiOsAuth {
  if (f.udmAuth) return f.udmAuth;
  if (f.apiKey.trim() !== "") return "api_key";
  return f.username.trim() !== "" ? "password" : "api_key";
}

/**
 * Metodo d'accesso di una voce dell'archivio usata da un controller (tappa 2f
 * credenziali, T23): `chiave` (chiave API), `utente` (utente e password),
 * `client` (Omada, client id e secret).
 */
export type MetodoVoceController = "chiave" | "utente" | "client";

/**
 * Regola tipo ↔ metodo della voce (ADR 0019): una console UniFi OS entra con
 * la chiave API o con un utente locale; il self-hosted solo con utente e
 * password; Omada coi suoi metodi. La voce è sempre del tipo «Controller
 * UniFi» (`unifi`), o «Controller Omada» (`omada`) per Omada.
 */
export function metodiVocePerController(kind: ControllerKind): readonly MetodoVoceController[] {
  if (kind === "udm") return ["chiave", "utente"];
  if (kind === "self_hosted") return ["utente"];
  return ["client", "utente"];
}

/** L'accesso scelto nel modulo di una console UniFi OS → il metodo che la voce deve avere. */
export function metodoVoceDiAccesso(a: UnifiOsAuth): "chiave" | "utente" {
  return a === "api_key" ? "chiave" : "utente";
}

/**
 * Con che cosa entra un controller salvato (tappa 2f), col criterio del server
 * (`credenzialeControllerDb`): la sua voce, oppure niente. Dalla 2g (T26) le
 * colonne della riga non si leggono più.
 */
export type StatoCredenzialeController = "voce" | "mancante";

/** Il metodo di una voce → l'accesso di una console UniFi OS. */
export function accessoDiMetodoVoce(m: MetodoVoceController): UnifiOsAuth {
  return m === "chiave" ? "api_key" : "password";
}

/** Tipi che si possono già salvare e leggere. Omada si accende dopo la misura su un controller vero. */
export const CONTROLLER_KINDS_AVAILABLE: readonly ControllerKind[] = ["udm", "self_hosted"];

export function vendorOfKind(kind: ControllerKind): ControllerVendor {
  return kind === "omada" ? "omada" : "unifi";
}

export function isControllerKind(v: unknown): v is ControllerKind {
  return typeof v === "string" && (CONTROLLER_KINDS as readonly string[]).includes(v);
}

/** Pianificazioni ammesse, in minuti (lo scheduler sa fare ore fisse e «ogni giorno alle 03:00»). */
export const CONTROLLER_SCHEDULE_MINUTES: readonly number[] = [60, 120, 240, 360, 720, 1440];

/** Da dove nasce una riga: a mano dalla pagina, o portata dalla configurazione vecchia dell'hub. */
export type ControllerOrigin = "manual" | "legacy_hub";

/** Riga di `network_controllers` così com'è nel DB (segreti cifrati). Solo server. */
export interface NetworkControllerRow {
  id: number;
  name: string;
  vendor: ControllerVendor;
  kind: ControllerKind;
  url: string;
  site: string;
  username: string;
  password_enc: string;
  api_key_enc: string;
  cert_pin: string | null;
  enabled: number;
  last_run_at: string | null;
  last_ok: number | null;
  last_message: string | null;
  last_devices: number | null;
  last_ports: number | null;
  last_neighbors: number | null;
  origin: ControllerOrigin;
  /**
   * Voce dell'archivio con cui si entra (tappa 2f credenziali). NULL: riga
   * mai convertita (si leggono le colonne qui sopra, se il segno della 2f non
   * è `done:`) oppure voce scollegata (indirizzo cambiato, voce eliminata):
   * «Credenziale mancante».
   */
  credential_id: number | null;
  created_at: string;
  updated_at: string;
}

/** Quello che la pagina vede di un controller: mai i segreti, solo se ci sono. */
export interface NetworkControllerView {
  id: number;
  name: string;
  vendor: ControllerVendor;
  kind: ControllerKind;
  url: string;
  site: string;
  /** L'utente rimasto nelle colonne di una riga di prima della 2f; per una voce è dentro la voce. */
  username: string;
  /**
   * Con che cosa entra, col criterio del server: la finestra legge da qui se
   * la credenziale salvata vale ancora (revisione della 2f: con le colonne
   * piene e il segno `done:` diceva «forma vecchia» e il server «mancante»).
   */
  credentialState: StatoCredenzialeController;
  /** C'è una password con cui entrare: la voce a utente, o la colonna di una riga mai convertita. */
  passwordSet: boolean;
  /** C'è una chiave API con cui entrare: la voce a chiave, o la colonna di una riga mai convertita. */
  apiKeySet: boolean;
  /** Voce dell'archivio con cui il controller entra (tappa 2f, T23); null = nessuna. */
  credentialId: number | null;
  credentialName: string | null;
  credentialMethod: MetodoVoceController | null;
  certPin: string | null;
  enabled: boolean;
  lastRunAt: string | null;
  lastOk: boolean | null;
  lastMessage: string | null;
  lastDevices: number | null;
  lastPorts: number | null;
  lastNeighbors: number | null;
  origin: ControllerOrigin;
  /** Pianificazione in minuti, null = spenta. */
  scheduleMinutes: number | null;
  /** Lettura dei client collegati ogni ora dalle 7 alle 20 (topologia fase 2): spenta di default. */
  clientSchedule: boolean;
  /** Ultima lettura dei client (riga a sé: non è la lettura degli apparati). */
  lastClientRun: { at: string; ok: boolean; message: string | null } | null;
}

export type ControllerRunTrigger = "manual" | "schedule";

/** Che cosa ha letto un giro: gli apparati (stat/device) o i client collegati (stat/sta). */
export type ControllerRunKind = "apparati" | "client";

/**
 * Il valore della colonna `trigger` dello storico: i giri dei client portano il
 * prefisso «client:» (lo schema non ha un campo per il tipo, e la potatura e le
 * letture lo distinguono da qui).
 */
export type ControllerRunStoredTrigger = ControllerRunTrigger | `client:${ControllerRunTrigger}`;

/** Una lettura del controller, come la mostra il dettaglio della riga. */
export interface ControllerRunView {
  id: number;
  kind: ControllerRunKind;
  startedAt: string;
  finishedAt: string;
  trigger: ControllerRunTrigger;
  triggeredBy: string | null;
  ok: boolean;
  total: number;
  added: number;
  updated: number;
  skipped: number;
  ports: number;
  neighbors: number;
  message: string | null;
  errors: string[];
  skippedReasons: string[];
  offline: string[];
}

/**
 * Corpo di POST /api/controllers e PUT /api/controllers/[id] (tappa 2f, T23):
 * - `credentialId`: una voce dell'archivio scelta nella tendina (niente segreti);
 * - altrimenti segreti nuovi (chiave, o utente e password): al salvataggio
 *   diventano una voce «UniFi · <nome>»;
 * - niente dei due: vale la credenziale salvata, solo allo stesso indirizzo.
 */
export interface ControllerInput {
  name: string;
  kind: ControllerKind;
  url: string;
  site: string;
  username: string;
  password: string;
  apiKey: string;
  /**
   * Solo per `udm`: il metodo scelto nel modulo. Il server rifiuta i campi che
   * non gli corrispondono invece di ripiegare in silenzio sull'altro metodo;
   * se manca (es. accendi/spegni) si deduce dai campi.
   */
  udmAuth?: UnifiOsAuth;
  /** Voce dell'archivio scelta (tappa 2f, T23). */
  credentialId?: number | null;
  enabled: boolean;
  scheduleMinutes: number | null;
  /**
   * Impronta del certificato vista dalla «Prova» fatta nel modulo prima di
   * salvare: l'amministratore l'ha vista, quindi vale come primo uso. Si scrive
   * solo se l'indirizzo è nuovo o non c'è ancora un'impronta.
   */
  certPin?: string | null;
}
