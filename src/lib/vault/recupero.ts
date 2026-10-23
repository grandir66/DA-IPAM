/**
 * Recupero con la chiave Domarc (piano da-vault 2026-10-23, «Recupero», D3): `scripts/da-vault-recover.ts`.
 *
 * La chiave privata Domarc (AGE-SECRET-KEY-1…) sta nella cartella personale di Riccardo in Keeper e si passa sullo
 * **stdin**, mai come argomento (resterebbe nella storia della shell e in `ps`) né da un file nel repository. Le
 * operazioni non cambiano la chiave dei dati (niente ricifra):
 * - `reset-password`: riscrive lo slot del cliente con una passphrase nuova (il cliente l'ha persa);
 * - `export-keyfile`: dà il key file delle esportazioni KeePass (il cliente l'ha perso);
 * - `rotate`: riscrive lo slot Domarc verso una chiave pubblica nuova (cambio di generazione, es. `domarc-2027`).
 *
 * Ogni uso chiede un ticket e lascia in `recuperi.jsonl`, nella cartella dell'archivio, una riga PRIMA (intento) e una
 * DOPO (ok o fallito), senza segreti: la comunicazione al cliente (D5: «Domarc lo informa di ogni uso») parte da lì.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { apriConDomarc, scriviSlotCliente, scriviSlotDomarc, SCRYPT_LOGN } from "./archivio";
import { LocaleStore, PERCORSO_KEYFILE } from "./locale";
import { ErroreVault } from "./tipi";

const IDENTITA = /^AGE-SECRET-KEY-1[0-9A-Z]{58}$/;

/**
 * Prima riga dello stdin: l'identità (ripulita ai bordi: è una chiave, non una frase); le righe dopo (es. la passphrase
 * nuova) in `resto`, COM'ERANO: la passphrase non si taglia (la stessa regola di `crea`, che la rifiuta se ha spazi ai
 * bordi: `controllaPassphrase` in archivio.ts). Righe vuote saltate.
 */
export function leggiIdentitaDaStdin(testo: string): { identita: string; resto: string[] } {
  const righe = testo.split(/\r?\n/).filter((r) => r.trim() !== "");
  const identita = (righe[0] ?? "").trim();
  if (!IDENTITA.test(identita)) {
    throw new ErroreVault("configurazione", "Sullo stdin, alla prima riga, serve la chiave privata Domarc (AGE-SECRET-KEY-1…)");
  }
  return { identita, resto: righe.slice(1) };
}

/** Rifiuta la chiave negli argomenti e ogni opzione per leggerla da un file: si passa solo sullo stdin. */
export function controllaArgomenti(argomenti: string[]): void {
  for (const a of argomenti) {
    if (/AGE-SECRET-KEY-/i.test(a) || /^--(chiave|key|identita|identity|identity-file|key-file|file-chiave)(=|$)/i.test(a)) {
      throw new ErroreVault("configurazione", "La chiave Domarc si passa solo sullo stdin, mai come argomento né da un file");
    }
  }
}

export async function resetPassword(dir: string, identita: string, nuova: string, scryptLogN: number = SCRYPT_LOGN): Promise<void> {
  const chiave = await apriConDomarc(dir, identita);
  await scriviSlotCliente(dir, chiave, nuova, scryptLogN);
}

export async function esportaKeyfileDomarc(dir: string, identita: string): Promise<Uint8Array> {
  const chiave = await apriConDomarc(dir, identita);
  let v: Readonly<Record<string, string>>;
  try {
    v = await new LocaleStore({ dir, chiave: () => chiave }).get(PERCORSO_KEYFILE);
  } catch (e) {
    if (e instanceof ErroreVault && e.codice === "non_trovato") {
      throw new ErroreVault("non_trovato", "Questo archivio non ha un key file: il cliente non ha mai esportato in KeePass");
    }
    throw e;
  }
  if (!v.keyfile) throw new ErroreVault("non_trovato", "Questo archivio non ha un key file");
  return new Uint8Array(Buffer.from(v.keyfile, "base64"));
}

export async function ruotaSlotDomarc(dir: string, identita: string, nuovoDestinatario: string): Promise<void> {
  const chiave = await apriConDomarc(dir, identita);
  await scriviSlotDomarc(dir, chiave, nuovoDestinatario);
}

export type StatoRecupero = "intento" | "ok" | "fallito";

/**
 * Una riga in `recuperi.jsonl`: ticket, comando, ora, chi (utente del sistema), stato. Mai segreti. Si scrive PRIMA
 * dell'operazione (`intento`) e DOPO con l'esito (`ok` o `fallito`, con il solo codice dell'errore): un tentativo
 * fallito o interrotto lascia comunque la traccia, e il cliente (D5: «Domarc lo informa di ogni uso») la vede.
 */
export function registraRecupero(dir: string, riga: { ticket: string; comando: string; chi: string; stato?: StatoRecupero; errore?: string }): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  appendFileSync(join(dir, "recuperi.jsonl"), `${JSON.stringify({ ...riga, il: new Date().toISOString() })}\n`, { mode: 0o600 });
}
