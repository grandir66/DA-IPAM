/**
 * da-vault (piano `docs/superpowers/plans/2026-10-23-da-vault.md`, passo 5): l'interfaccia comune dei due backend.
 *
 * - `openbao` (hub e app interne): KV v2 di OpenBao, AppRole, cache in memoria a tempo (`openbao.ts`);
 * - `locale` (appliance dei clienti): i segreti propri dell'app, cifrati con la chiave dei dati dell'archivio a slot
 *   (`locale.ts`, `archivio.ts`);
 * - `dalink` (hub, vault semplice passo 6): le quattro rotte del vault di DA-Link col gettone dell'app (`dalink.ts`).
 *
 * Un percorso è come nel piano: `app/<app>/<nome>`, `clienti/<codcli>/<sistema>/<servizio>`, minuscolo con trattini.
 * Un valore è un KV piatto (campo → testo), come un segreto KV v2.
 *
 * Nessun messaggio d'errore contiene un valore: solo percorso, campo, cosa manca.
 */

export type ValoreSegreto = Readonly<Record<string, string>>;

export interface OpzioniGet {
  /**
   * Lettura fatta dall'app per conto di una persona (la «mostra password»): il nome va in `X-Domarc-Utente`, che
   * OpenBao scrive nel registro. Una lettura per conto non passa dalla cache.
   */
  perConto?: string;
  /** L'id dell'utente (hub.users.id): va in `X-Domarc-Utente` accanto al nome, che da solo può cambiare o ripetersi. */
  perContoId?: string;
}

export type StatoStore =
  | {
      pronto: true;
      aggiornatoAlle: number | null;
      degradato?: string;
      /** Riferimenti di credenziali malformati saltati nell'ultimo giro della cache (solo il numero; i nomi stanno nel log). */
      riferimentiSaltati?: number;
    }
  | { pronto: false; motivo: string };

export interface SecretStore {
  readonly backend: "openbao" | "locale" | "dalink";
  /** Il segreto del percorso; `ErroreVault` se non c'è o se il backend non risponde oltre la cache. */
  get(percorso: string, opzioni?: OpzioniGet): Promise<ValoreSegreto>;
  /** Scrive (sostituisce) il segreto del percorso. */
  put(percorso: string, valore: ValoreSegreto): Promise<void>;
  /** I percorsi sotto un prefisso, completi, in ordine. */
  list(prefisso: string): Promise<string[]>;
  delete(percorso: string): Promise<void>;
  stato(): StatoStore;
}

export type CodiceErroreVault =
  | "bloccato"
  | "non_raggiungibile"
  | "non_pronto"
  | "non_trovato"
  | "rifiutato"
  | "percorso_non_valido"
  | "slot_assente"
  | "slot_errato"
  | "slot_estraneo"
  | "archivio_assente"
  | "archivio_esistente"
  | "archivio_rotto"
  | "configurazione";

/** Un errore dichiarato del vault: un codice e un messaggio in italiano, mai un valore segreto. */
export class ErroreVault extends Error {
  readonly codice: CodiceErroreVault;
  constructor(codice: CodiceErroreVault, messaggio: string) {
    super(messaggio);
    this.name = "ErroreVault";
    this.codice = codice;
  }
}

const PERCORSO = /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)*$/;

/** Un percorso valido: segmenti in minuscolo con cifre, trattini, punti e trattini bassi; niente `..`, niente `/` in testa. */
export function percorsoValido(p: string): boolean {
  return PERCORSO.test(p) && !p.split("/").some((s) => s === "." || s === "..");
}

export function controllaPercorso(p: string): string {
  if (!percorsoValido(p)) throw new ErroreVault("percorso_non_valido", `Percorso del vault non valido: «${p}»`);
  return p;
}
