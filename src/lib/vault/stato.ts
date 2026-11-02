/**
 * Stato del vault nel processo (piano da-vault 2026-10-23): la chiave dei dati aperta dagli slot, chi l'ha aperta,
 * lo store remoto dell'hub (DA-Link) e le conferme della «mostra password».
 *
 * Sta su `globalThis` (`Symbol.for`), come lo stato dello scheduler: `server.ts` (sotto tsx) e le rotte di Next girano
 * in bundle diversi dello stesso processo, e devono vedere la STESSA chiave. Modulo senza dipendenze, perché lo importa
 * `crypto.ts`.
 *
 * Gli interruttori stanno nel file dell'appliance (`.env.local`), si cambiano solo sul server con un riavvio, e sono
 * spenti di serie (piano: «interruttore spento di serie, attivazione per appliance»):
 * - `DA_VAULT_LOCALE=1`: chiave dei dati dagli slot (appliance dei clienti, passo 10);
 * - `DA_VAULT_DALINK=1`: le credenziali dei device con `credential_ref` lette da DA-Link (hub, vault semplice passo 6).
 *
 * OpenBao è stato tolto il 02/11/2026: `DA_VAULT_OPENBAO=1` rimasto in un file è una configurazione rifiutata
 * (`avvio.ts`): nessuno store, il motivo nel log e a schermo, e i lettori rifiutano (fail-closed, mai la colonna per una
 * voce col riferimento).
 */
import type { StatoStore, ValoreSegreto } from "./tipi";

export type ModoSblocco = "tpm" | "passphrase" | "domarc";

/** Quello che serve del backend remoto da qui (per non importare `dalink.ts` in `crypto.ts`): `DaLinkStore`. */
export interface StoreRemotoProcesso {
  /** Quale backend è (`DaLinkStore` lo dichiara); le prove con un finto possono ometterlo. */
  readonly backend?: "locale" | "dalink";
  leggiSync(percorso: string): ValoreSegreto;
  get(percorso: string, opzioni?: { perConto?: string; perContoId?: string }): Promise<ValoreSegreto>;
  /** Cancella il segreto con tutte le sue versioni (metadata). */
  delete(percorso: string): Promise<void>;
  stato(): StatoStore;
}

export interface StatoVaultProcesso {
  chiaveDati: Buffer | null;
  sbloccatoDa: ModoSblocco | null;
  sbloccatoAlle: number | null;
  /** Perché è bloccato (archivio assente, niente TPM, …); null = mai provato o sbloccato. */
  motivoBloccato: string | null;
  /** Lo store del vault remoto (DA-Link), messo da `avviaVault`; null = spento o non avviato. */
  remoto: StoreRemotoProcesso | null;
  /**
   * Perché il backend remoto acceso non è partito (configurazione rifiutata all'avvio): solo nomi di variabili, mai
   * valori. null = niente da dire. Lo scrive `avviaVault`; lo leggono il banner e i lettori dei segreti.
   */
  remotoNonAvviato: string | null;
  /** «Mostra password»: id utente → scadenza (ms) della conferma con la 2FA. */
  conferme: Map<string, number>;
  /** Credenziali già segnalate come lette dalla colonna (doppia lettura), per scriverlo una volta sola. */
  doppiaLetturaSegnalata: Set<string>;
}

const CHIAVE = Symbol.for("da-ipam.vault.stato");

export function statoVaultProcesso(): StatoVaultProcesso {
  const g = globalThis as Record<symbol, StatoVaultProcesso | undefined>;
  let s = g[CHIAVE];
  if (!s) {
    s = {
      chiaveDati: null,
      sbloccatoDa: null,
      sbloccatoAlle: null,
      motivoBloccato: null,
      remoto: null,
      remotoNonAvviato: null,
      conferme: new Map(),
      doppiaLetturaSegnalata: new Set(),
    };
    g[CHIAVE] = s;
  }
  return s;
}

export function vaultLocaleAcceso(): boolean {
  return process.env.DA_VAULT_LOCALE === "1";
}

/** Il motivo del rifiuto di `DA_VAULT_OPENBAO=1`, rimasto in un file dopo che OpenBao è stato tolto. */
export const MOTIVO_OPENBAO_TOLTO = "OpenBao è stato tolto il 02/11, usa DA_VAULT_DALINK=1";

/** `DA_VAULT_OPENBAO=1` è ancora nel file: configurazione rifiutata (OpenBao non c'è più). */
export function openBaoRimastoNelFile(): boolean {
  return process.env.DA_VAULT_OPENBAO === "1";
}

/**
 * Un backend remoto del vault è acceso: DA-Link (`DA_VAULT_DALINK=1`). Vale true anche con `DA_VAULT_OPENBAO=1` rimasto
 * nel file: l'avvio lo rifiuta e non mette lo store, e i lettori rifiutano le voci col riferimento (fail-closed).
 */
export function vaultRemotoAcceso(): boolean {
  return vaultDalinkAcceso() || openBaoRimastoNelFile();
}

/** Il backend remoto è DA-Link (`DA_VAULT_DALINK=1`). */
export function vaultDalinkAcceso(): boolean {
  return process.env.DA_VAULT_DALINK === "1";
}

/**
 * Il nome del backend remoto per i testi a schermo: «DA-Link» con lo store avviato o con il suo interruttore acceso da
 * solo; null se non si sa (spento, o configurazione rifiutata per `DA_VAULT_OPENBAO=1`).
 */
export function backendRemotoAttivo(): "DA-Link" | null {
  if (statoVaultProcesso().remoto?.backend === "dalink") return "DA-Link";
  if (vaultDalinkAcceso() && !openBaoRimastoNelFile()) return "DA-Link";
  return null;
}

/** Il nome per aprire una frase («DA-Link non ha risposto»): il backend vero o, se non si sa, «Il vault remoto». */
export function nomeBackendRemoto(): string {
  return backendRemotoAttivo() ?? "Il vault remoto";
}

/** Perché il vault remoto acceso non ha uno store: il motivo dell'avvio, o quello che si deduce dagli interruttori. */
export function motivoRemotoNonAvviato(): string {
  const dichiarato = statoVaultProcesso().remotoNonAvviato;
  if (dichiarato) return dichiarato;
  if (openBaoRimastoNelFile()) return MOTIVO_OPENBAO_TOLTO;
  return "DA-Link acceso ma non avviato (DALINK_VAULT_URL, DALINK_VAULT_GETTONE e DALINK_VAULT_IMPRONTA)";
}

export function chiaveDatiAttiva(): Buffer | null {
  return statoVaultProcesso().chiaveDati;
}

export function impostaChiaveDati(chiave: Buffer, da: ModoSblocco): void {
  if (chiave.length !== 32) throw new Error("La chiave dei dati deve essere di 32 byte");
  const s = statoVaultProcesso();
  s.chiaveDati = Buffer.from(chiave);
  s.sbloccatoDa = da;
  s.sbloccatoAlle = Date.now();
  s.motivoBloccato = null;
}

/** Toglie la chiave dalla memoria (la azzera) e annota il perché. */
export function chiudiVault(motivo: string | null): void {
  const s = statoVaultProcesso();
  s.chiaveDati?.fill(0);
  s.chiaveDati = null;
  s.sbloccatoDa = null;
  s.sbloccatoAlle = null;
  s.motivoBloccato = motivo;
}
