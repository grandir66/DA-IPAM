/**
 * Stato del vault nel processo (piano da-vault 2026-10-23): la chiave dei dati aperta dagli slot, chi l'ha aperta,
 * lo store OpenBao dell'hub e le conferme della «mostra password».
 *
 * Sta su `globalThis` (`Symbol.for`), come lo stato dello scheduler: `server.ts` (sotto tsx) e le rotte di Next girano
 * in bundle diversi dello stesso processo, e devono vedere la STESSA chiave. Modulo senza dipendenze, perché lo importa
 * `crypto.ts`.
 *
 * Gli interruttori stanno nel file dell'appliance (`.env.local`), si cambiano solo sul server con un riavvio, e sono
 * spenti di serie (piano: «interruttore spento di serie, attivazione per appliance»):
 * - `DA_VAULT_LOCALE=1`: chiave dei dati dagli slot (appliance dei clienti, passo 10);
 * - `DA_VAULT_OPENBAO=1`: credenziali dei device da OpenBao con `credential_ref` (hub, passo 6);
 * - `DA_VAULT_DALINK=1`: le stesse credenziali da DA-Link (vault semplice, passo 6). Lo store sta nello stesso posto
 *   (`openbao`) e i chiamanti non cambiano: `vaultOpenBaoAcceso()` vale «backend remoto acceso». I due interruttori
 *   insieme sono una configurazione rifiutata (`avvio.ts`): nessuno store, e i lettori rifiutano.
 */
import type { StatoStore, ValoreSegreto } from "./tipi";

export type ModoSblocco = "tpm" | "passphrase" | "domarc";

/**
 * Quello che serve del backend remoto da qui (per non importare `openbao.ts` in `crypto.ts`): `OpenBaoStore` o, con
 * `DA_VAULT_DALINK=1`, `DaLinkStore`.
 */
export interface StoreOpenBaoProcesso {
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
  openbao: StoreOpenBaoProcesso | null;
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
      openbao: null,
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

/**
 * Un backend remoto del vault è acceso: OpenBao (`DA_VAULT_OPENBAO=1`) o DA-Link (`DA_VAULT_DALINK=1`). Il nome resta
 * quello di prima perché i chiamanti (lettore dei segreti, «mostra password», cancellazione) non cambiano. Con i due
 * accesi insieme vale true: l'avvio rifiuta e non mette lo store, e i lettori rifiutano (fail-closed).
 */
export function vaultOpenBaoAcceso(): boolean {
  return process.env.DA_VAULT_OPENBAO === "1" || vaultDalinkAcceso();
}

/** Il backend remoto è DA-Link (`DA_VAULT_DALINK=1`). */
export function vaultDalinkAcceso(): boolean {
  return process.env.DA_VAULT_DALINK === "1";
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
