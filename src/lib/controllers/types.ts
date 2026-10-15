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
 * Il metodo di una console UniFi OS si deduce dai campi: la chiave se c'è,
 * altrimenti utente (e password) se c'è l'utente; senza nessuno dei due vale la
 * chiave già salvata (il controllo del modulo dice se c'è davvero).
 */
export function unifiOsAuthOf(f: { apiKey: string; username: string }): UnifiOsAuth {
  if (f.apiKey.trim() !== "") return "api_key";
  return f.username.trim() !== "" ? "password" : "api_key";
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
  username: string;
  passwordSet: boolean;
  apiKeySet: boolean;
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

/** Corpo di POST /api/controllers e PUT /api/controllers/[id]. Segreti vuoti = «non cambiare». */
export interface ControllerInput {
  name: string;
  kind: ControllerKind;
  url: string;
  site: string;
  username: string;
  password: string;
  apiKey: string;
  enabled: boolean;
  scheduleMinutes: number | null;
  /**
   * Impronta del certificato vista dalla «Prova» fatta nel modulo prima di
   * salvare: l'amministratore l'ha vista, quindi vale come primo uso. Si scrive
   * solo se l'indirizzo è nuovo o non c'è ancora un'impronta.
   */
  certPin?: string | null;
}
