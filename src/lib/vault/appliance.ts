/**
 * Il vault dentro DA-IPAM (piano da-vault 2026-10-23): avvio, sblocco, stato, pausa delle scansioni.
 *
 * - `avviaVaultLocale()` (da `server.ts`, solo con `DA_VAULT_LOCALE=1`): apre l'archivio dallo slot TPM se c'è;
 *   altrimenti il vault resta **bloccato** col motivo (archivio assente, niente TPM, slot estraneo…).
 * - `sbloccaConPassphrase()`: lo sblocco a mano (Impostazioni › Vault) con la passphrase del cliente.
 * - `motivoPausaVault()`: con un interruttore acceso e il vault bloccato (o OpenBao oltre la cache) le scansioni sono
 *   in pausa: `runJob` salta col motivo, il layout mostra il banner. Interruttori spenti: sempre null.
 *
 * La cartella dell'archivio è `<dati>/vault` (`DA_VAULT_DIR` la sposta, per le prove e per i volumi dedicati).
 */
import { resolveDataDir } from "@/lib/data-dir";
import { apriConPassphrase, apriConTpm, archivioPresente, leggiArchivio, type NomeSlot } from "./archivio";
import { conGuardiaPassphrase, type EsitoGuardia } from "./guardia-passphrase";
import { backendRemotoAttivo, chiudiVault, impostaChiaveDati, motivoRemotoNonAvviato, statoVaultProcesso, vaultLocaleAcceso, vaultOpenBaoAcceso, type ModoSblocco } from "./stato";
import { ErroreVault } from "./tipi";
import { unisci } from "../percorsi";

export function cartellaVault(): string {
  return process.env.DA_VAULT_DIR?.trim() || unisci(resolveDataDir(), "vault");
}

/** All'avvio: con l'interruttore acceso prova lo slot TPM; se non va, bloccato col motivo (e lo scrive nel log). */
export function avviaVaultLocale(op: { credenziali?: string } = { credenziali: process.env.CREDENTIALS_DIRECTORY }): void {
  if (!vaultLocaleAcceso()) return;
  const dir = cartellaVault();
  if (!archivioPresente(dir)) {
    chiudiVault("l'archivio non è ancora stato creato (scripts/da-vault.ts crea)");
    console.error("[vault] DA_VAULT_LOCALE=1 ma l'archivio del vault non c'è: credenziali illeggibili e scansioni in pausa");
    return;
  }
  try {
    impostaChiaveDati(apriConTpm(dir, op.credenziali), "tpm");
    console.info("[vault] sbloccato dallo slot TPM");
  } catch (e) {
    const motivo = e instanceof ErroreVault ? e.message : "slot TPM non leggibile";
    chiudiVault(`${motivo}: serve la passphrase del cliente`);
    console.error(`[vault] bloccato all'avvio (${e instanceof ErroreVault ? e.codice : "errore"}): scansioni in pausa finché non si sblocca`);
  }
}

/** Sblocco a mano con la passphrase del cliente. Lancia `ErroreVault` (passphrase errata, slot assente…). */
export async function sbloccaConPassphrase(passphrase: string): Promise<void> {
  if (!vaultLocaleAcceso()) throw new ErroreVault("configurazione", "Il vault locale è spento su questa appliance (DA_VAULT_LOCALE)");
  const chiave = await apriConPassphrase(cartellaVault(), passphrase);
  impostaChiaveDati(chiave, "passphrase");
  console.info("[vault] sbloccato con la passphrase del cliente");
}

/**
 * Lo sblocco a mano dietro la guardia della passphrase (limite per utente condiviso con l'esportazione KeePass, tetto
 * alle derivazioni in corso). `{ ok: false, stato: 429 }` se bloccato; `ErroreVault` come `sbloccaConPassphrase` altrimenti.
 */
export async function sbloccaGuardato(utenteId: string, passphrase: string): Promise<EsitoGuardia<void>> {
  return conGuardiaPassphrase(utenteId, () => sbloccaConPassphrase(passphrase));
}

/** Perché le scansioni sono in pausa; null = nessuna pausa (sempre null con gli interruttori spenti). */
export function motivoPausaVault(): string | null {
  const s = statoVaultProcesso();
  if (vaultLocaleAcceso() && !s.chiaveDati) {
    return `Vault bloccato: ${s.motivoBloccato ?? "la chiave degli slot non è aperta"}`;
  }
  if (vaultOpenBaoAcceso()) {
    if (!s.openbao) return `${motivoRemotoNonAvviato()}: credenziali non leggibili`;
    const st = s.openbao.stato();
    if (!st.pronto) return st.motivo;
  }
  return null;
}

/** Il testo del banner in testa alle pagine; null = niente banner. */
export function testoBannerVault(): string | null {
  const m = motivoPausaVault();
  return m ? `${m}. Le scansioni sono in pausa finché il vault non torna disponibile.` : null;
}

export interface StatoVaultPubblico {
  locale: {
    acceso: boolean;
    sbloccato: boolean;
    sbloccatoDa: ModoSblocco | null;
    sbloccatoAlle: string | null;
    motivo: string | null;
    archivio: { presente: boolean; slot: Record<NomeSlot, boolean> | null };
  };
  /** Il vault remoto (OpenBao o DA-Link: la chiave resta `openbao` per l'API di prima); `nome` è quello vero. */
  openbao: { nome: string; acceso: boolean; pronto: boolean | null; motivo: string | null; aggiornatoAlle: string | null };
  pausa: string | null;
}

/** Lo stato per la pagina e per l'API: mai la chiave, mai un valore. */
export function statoVault(): StatoVaultPubblico {
  const s = statoVaultProcesso();
  const dir = cartellaVault();
  let archivio: StatoVaultPubblico["locale"]["archivio"] = { presente: false, slot: null };
  if (vaultLocaleAcceso() && archivioPresente(dir)) {
    try {
      archivio = { presente: true, slot: leggiArchivio(dir).slot };
    } catch {
      archivio = { presente: true, slot: null };
    }
  }
  const ob = vaultOpenBaoAcceso() ? (s.openbao?.stato() ?? null) : null;
  const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());
  return {
    locale: {
      acceso: vaultLocaleAcceso(),
      sbloccato: vaultLocaleAcceso() && s.chiaveDati !== null,
      sbloccatoDa: s.sbloccatoDa,
      sbloccatoAlle: iso(s.sbloccatoAlle),
      motivo: vaultLocaleAcceso() && !s.chiaveDati ? s.motivoBloccato : null,
      archivio,
    },
    openbao: {
      nome: backendRemotoAttivo() ?? "Vault remoto",
      acceso: vaultOpenBaoAcceso(),
      pronto: ob ? ob.pronto : null,
      motivo: ob && !ob.pronto ? ob.motivo : ob && ob.pronto ? (ob.degradato ?? null) : vaultOpenBaoAcceso() ? motivoRemotoNonAvviato() : null,
      aggiornatoAlle: ob && ob.pronto ? iso(ob.aggiornatoAlle) : null,
    },
    pausa: motivoPausaVault(),
  };
}
