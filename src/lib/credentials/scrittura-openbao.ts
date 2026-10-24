/**
 * La scrittura dei segreti delle voci in OpenBao (piano da-vault 2026-10-23, passo «svuotare le colonne cifrate»,
 * ADR 0035). Vale solo sull'hub, con `DA_VAULT_OPENBAO=1`; a interruttore spento questo modulo non fa niente e la voce si
 * scrive nelle colonne come sempre.
 *
 * Regole:
 * - un segreto creato o cambiato dalla pagina o dall'API va SUBITO in OpenBao (`clienti/<codcli>/da-ipam/<nome>-<id>`,
 *   come la migrazione) e la riga prende il `credential_ref`; le sei colonne cifrate restano vuote;
 * - OpenBao spento, non configurato, che rifiuta o che rilegge un valore diverso = errore dichiarato col motivo (stato
 *   503) e niente scritto: **mai un ripiego sulla colonna**;
 * - la scrittura è sincrona (`OpenBaoStore.putSync`, ADR 0035) perché i chiamanti sono sincroni e spesso dentro una
 *   transazione del database;
 * - un guardiano in `creaCredenzialeDb` / `aggiornaCredenzialeDb` rifiuta un valore in chiaro che stesse per finire in
 *   una colonna segreta con l'interruttore acceso.
 *
 * Non importa né `db.ts` né `db-tenant.ts` (li importa `archivio.ts`, che importa questo): riceve l'handle.
 * Nessun messaggio contiene un valore.
 */
import type Database from "better-sqlite3";
import { safeDecrypt } from "@/lib/crypto";
import { percorsoCredenziale } from "@/lib/vault/percorsi";
import { statoVaultProcesso, vaultOpenBaoAcceso, type StoreOpenBaoProcesso } from "@/lib/vault/stato";
import type { ValoreSegreto } from "@/lib/vault/tipi";
import { COLONNA_DEL_CAMPO, COLONNE_SEGRETE, type CampoSegreto } from "./segreti";

/** I segreti di una voce per colonna, in chiaro (`null` = la colonna è vuota). */
export type SegretiPerColonna = Record<string, string | null>;

/** Si scrive in OpenBao (hub con l'interruttore acceso)? */
export function scriviInOpenBao(): boolean {
  return vaultOpenBaoAcceso();
}

/** Il cliente di un database tenant, dal nome del file (`…/tenants/C70007.db`): è il `codice_cliente` del percorso. */
export function nomeClienteDb(dbh: Database.Database): string {
  return dbh.name.replace(/^.*[\\/]/, "").replace(/\.db$/, "");
}

/** Un valore nel formato di `encrypt()` (`iv:tag:testo`, tutto esadecimale): quello che può stare in una colonna. */
const FORMATO_CIFRATO = /^[0-9a-f]{32}:[0-9a-f]{32}:[0-9a-f]*$/i;

/**
 * Il guardiano: con OpenBao acceso nessun valore in chiaro può finire in una colonna segreta. Lancia (è un errore di
 * programma, non dell'utente) e non scrive il valore nel messaggio.
 */
export function vietaChiaroNelleColonne(valori: object): void {
  if (!vaultOpenBaoAcceso()) return;
  for (const colonna of COLONNE_SEGRETE) {
    const v = (valori as Record<string, unknown>)[colonna];
    if (typeof v === "string" && v !== "" && !FORMATO_CIFRATO.test(v)) {
      throw new Error(`Un valore in chiaro stava per essere scritto nella colonna ${colonna} con OpenBao acceso: è un errore di programma, nessun segreto è stato salvato`);
    }
  }
}

function storeOppureMotivo(): { ok: true; store: StoreOpenBaoProcesso } | { ok: false; motivo: string } {
  const store = statoVaultProcesso().openbao;
  if (!store) return { ok: false, motivo: "OpenBao è acceso (DA_VAULT_OPENBAO) ma non è configurato: il segreto non è stato salvato" };
  return { ok: true, store };
}

function messaggioDi(e: unknown): string {
  return e instanceof Error ? e.message : "errore";
}

/** I campi di OpenBao di una voce → le colonne. */
function perColonna(v: Readonly<Record<string, string>>): SegretiPerColonna {
  const out: SegretiPerColonna = Object.fromEntries(COLONNE_SEGRETE.map((c) => [c, null]));
  for (const [campo, colonna] of Object.entries(COLONNA_DEL_CAMPO) as Array<[CampoSegreto, string]>) {
    const valore = v[campo];
    if (valore !== undefined && valore !== "") out[colonna] = valore;
  }
  return out;
}

/** Le colonne → i campi di OpenBao (solo quelle che hanno un valore). */
function perCampo(segreti: SegretiPerColonna): ValoreSegreto {
  const out: Record<string, string> = {};
  for (const [campo, colonna] of Object.entries(COLONNA_DEL_CAMPO) as Array<[CampoSegreto, string]>) {
    const valore = segreti[colonna];
    if (typeof valore === "string" && valore !== "") out[campo] = valore;
  }
  return out;
}

/** Il riferimento di una riga (null se non ce l'ha o la colonna non c'è ancora). */
export function riferimentoDellaRiga(riga: Record<string, unknown>): string | null {
  const r = riga.credential_ref;
  return typeof r === "string" && r.trim() ? r.trim() : null;
}

/** Lo schema ha `credential_ref`? (un vecchio `ipam.db` del facade può non averlo). */
export function haColonnaRiferimento(dbh: Database.Database): boolean {
  return (dbh.prepare("PRAGMA table_info(credentials)").all() as Array<{ name: string }>).some((c) => c.name === "credential_ref");
}

/**
 * I segreti attuali di una voce esistente, in chiaro per colonna, per unirli alle modifiche. Con il riferimento: letti
 * ORA da OpenBao (non dalla cache, che può avere fino a 5 minuti: una scrittura intera su un valore vecchio
 * cancellerebbe un campo cambiato altrove). Senza: le colonne decifrate; una colonna che non si decifra è un rifiuto
 * (non si porta in OpenBao un segreto che non si legge).
 */
export function segretiAttuali(dbh: Database.Database, riga: Record<string, unknown>): { ok: true; segreti: SegretiPerColonna } | { ok: false; motivo: string } {
  const nome = typeof riga.name === "string" ? riga.name : `#${String(riga.id)}`;
  const ref = riferimentoDellaRiga(riga);
  if (ref) {
    const s = storeOppureMotivo();
    if (!s.ok) return s;
    try {
      return { ok: true, segreti: perColonna(s.store.getSync(ref)) };
    } catch (e) {
      return { ok: false, motivo: `La credenziale «${nome}»: i segreti attuali non si leggono da OpenBao (${messaggioDi(e)}): modifica non salvata` };
    }
  }
  const segreti: SegretiPerColonna = {};
  for (const colonna of COLONNE_SEGRETE) {
    const cifrato = riga[colonna];
    if (typeof cifrato !== "string" || cifrato === "") {
      segreti[colonna] = null;
      continue;
    }
    const chiaro = safeDecrypt(cifrato);
    if (chiaro == null) {
      return { ok: false, motivo: `La credenziale «${nome}»: un segreto salvato non si decifra (ENCRYPTION_KEY diversa da quella che l'ha cifrato?): non si può portare in OpenBao, scrivilo di nuovo` };
    }
    segreti[colonna] = chiaro;
  }
  return { ok: true, segreti };
}

/** Due insiemi di segreti sono uguali? (stesse colonne piene, stessi valori) */
export function segretiUguali(a: SegretiPerColonna, b: SegretiPerColonna): boolean {
  return COLONNE_SEGRETE.every((c) => (a[c] || null) === (b[c] || null));
}

/**
 * Scrive i segreti della voce in OpenBao e rilegge. `riferimento` = il percorso che la voce ha già (si riscrive lì);
 * senza, `clienti/<codcli>/da-ipam/<nome>-<id>`. Ritorna il percorso, o null se non c'è niente da conservare (nessun
 * segreto e nessun riferimento). Non tocca il database: il chiamante mette `credential_ref` e svuota le colonne.
 */
export function salvaSegretiInOpenBao(
  dbh: Database.Database,
  voce: { id: number; name: string },
  riferimento: string | null,
  segreti: SegretiPerColonna,
): { ok: true; percorso: string | null } | { ok: false; motivo: string } {
  const valore = perCampo(segreti);
  if (Object.keys(valore).length === 0 && !riferimento) return { ok: true, percorso: null };
  const s = storeOppureMotivo();
  if (!s.ok) return s;
  const percorso = riferimento ?? percorsoCredenziale(nomeClienteDb(dbh), voce.id, voce.name);
  try {
    s.store.putSync(percorso, valore);
  } catch (e) {
    return { ok: false, motivo: `La credenziale «${voce.name}» non è stata salvata: i segreti non sono andati in OpenBao (${messaggioDi(e)})` };
  }
  return { ok: true, percorso };
}

/** Le colonne segrete di `valori` messe a null: la riga che finisce nel database con OpenBao. */
export function senzaSegreti<T extends object>(valori: T): T {
  const out = { ...valori } as Record<string, unknown>;
  for (const c of COLONNE_SEGRETE) if (c in out) out[c] = null;
  return out as T;
}

/** La presenza dei segreti per la maschera: dal valore in mano, senza rileggere. */
export function presenzaDa(segreti: SegretiPerColonna): { ok: true; presenti: Record<string, boolean> } {
  return { ok: true, presenti: Object.fromEntries(COLONNE_SEGRETE.map((c) => [c, Boolean(segreti[c])])) };
}
