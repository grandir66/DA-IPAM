/**
 * Migrazione delle credenziali dei device verso OpenBao (piano da-vault 2026-10-23, passo 6, l'hub).
 *
 * - **Prova a vuoto di default**: si contano le voci e si calcolano i percorsi; niente si scrive, né in OpenBao né nel
 *   database. Il rapporto non contiene mai valori.
 * - **`applica`**: per ogni cliente, ogni voce senza `credential_ref` va in OpenBao
 *   (`clienti/<codcli>/da-ipam/<nome>-<id>`, campi `username`, `password`, `private_key`, `key_passphrase`,
 *   `auth_key`, `priv_key`), si rilegge e si confronta; solo se tutte tornano uguali si scrivono i riferimenti, in una
 *   transazione per cliente. Un errore di OpenBao a metà lascia il cliente senza riferimenti nuovi (i segreti già
 *   scritti in OpenBao restano lì e si riscrivono uguali al giro dopo). Una voce che non si legge si salta e si dice.
 * - **Le colonne cifrate restano**: per una versione la lettura è doppia (con l'interruttore acceso, una voce senza
 *   riferimento si legge dalla colonna con un avviso). Svuotarle, con `VACUUM`, è il passo della versione dopo.
 * - `verificaMigrazione`: prima di accendere `DA_VAULT_OPENBAO`, confronta OpenBao e colonne voce per voce (una
 *   modifica fatta dalla pagina a interruttore spento non toglie il riferimento) ed elenca i percorsi ORFANI di OpenBao
 *   (sotto la cartella del cliente, senza voce che li usi: revisione del 23/10, rilievo 7).
 * - **Il backend è quello acceso** (`storeDellaMigrazione`, condizioni del passo 7 del vault semplice, revisione del
 *   29/10): `DA_VAULT_OPENBAO=1` → OpenBao, `DA_VAULT_DALINK=1` → DA-Link. Con DA-Link acceso una credenziale cambiata
 *   dalla pagina perde il riferimento e torna sulla colonna (`togliRiferimentoSeCambianoSegreti`): questa migrazione la
 *   riporta in DA-Link, sopra la voce vecchia, come con OpenBao. Spenti: OpenBao, come prima del passo 6 (si migra, poi
 *   si accende); tutti e due accesi = rifiuto col motivo. I testi nominano il backend vero.
 */
import type Database from "better-sqlite3";
import { schemaVaultPresente } from "@/lib/db-tenant";
import { campiVoceDb } from "@/lib/credentials/segreti";
import { configurazioneDalink, configurazioneOpenBao, sceltaBackendRemoto } from "./avvio";
import { DaLinkStore } from "./dalink";
import { OpenBaoStore } from "./openbao";
import { ErroreVault, type OpzioniGet, type SecretStore, type StatoStore, type ValoreSegreto } from "./tipi";

/** Il nome del backend nei testi della migrazione. */
export function nomeBackend(store: SecretStore): string {
  if (store.backend === "dalink") return "DA-Link";
  if (store.backend === "openbao") return "OpenBao";
  return "il vault";
}

/**
 * DA-Link per la migrazione: un giro dell'ambito (`aggiorna()`) prima di ogni `list` e di ogni `put`, così l'elenco è
 * quello di adesso e il `put` manda la versione che DA-Link ha (una voce già presente col valore vecchio si sostituisce,
 * non dà 409: senza giro la cache è vuota e la versione attesa sarebbe 0). Dopo un `put` la `get` successiva rifà il
 * giro: la rilettura che la migrazione confronta viene da DA-Link, non dalla cache appena scritta.
 */
class DaLinkPerMigrazione implements SecretStore {
  readonly backend = "dalink" as const;
  private daRileggere = true;
  constructor(private readonly s: DaLinkStore) {}

  async get(percorso: string, opzioni?: OpzioniGet): Promise<ValoreSegreto> {
    if (this.daRileggere) {
      await this.s.aggiorna();
      this.daRileggere = false;
    }
    return this.s.get(percorso, opzioni);
  }

  async put(percorso: string, valore: ValoreSegreto): Promise<void> {
    await this.s.aggiorna();
    this.daRileggere = true;
    await this.s.put(percorso, valore);
  }

  async list(prefisso: string): Promise<string[]> {
    await this.s.aggiorna();
    this.daRileggere = false;
    return this.s.list(prefisso);
  }

  async delete(percorso: string): Promise<void> {
    await this.s.aggiorna();
    this.daRileggere = true;
    await this.s.delete(percorso);
  }

  stato(): StatoStore {
    return this.s.stato();
  }
}

/**
 * Lo store della migrazione dall'interruttore acceso, con la configurazione dell'app (`sceltaBackendRemoto`,
 * `configurazioneOpenBao`, `configurazioneDalink`). Nel motivo solo nomi di variabili, mai valori.
 */
export function storeDellaMigrazione(
  env: Record<string, string | undefined>,
): { ok: true; store: SecretStore; nome: string } | { ok: false; motivo: string } {
  const scelta = sceltaBackendRemoto(env);
  if (scelta.backend === "rifiutato") return { ok: false, motivo: scelta.motivo };
  // Interruttori spenti: OpenBao, come prima del passo 6 — è il percorso previsto «si migra, poi si accende»
  // (revisione dell'orchestratore, 29/10: il rifiuto rompeva quel flusso). DA-Link solo se acceso.
  if (scelta.backend === "dalink") {
    const c = configurazioneDalink(env);
    if (!c.ok) return { ok: false, motivo: `DA-Link non configurato: ${c.motivo}` };
    const store = new DaLinkPerMigrazione(new DaLinkStore(c.config));
    return { ok: true, store, nome: nomeBackend(store) };
  }
  const c = configurazioneOpenBao(env);
  if (!c.ok) return { ok: false, motivo: `OpenBao non configurato: ${c.motivo}` };
  const store = new OpenBaoStore({ ...c.config, cartelle: [] });
  return { ok: true, store, nome: nomeBackend(store) };
}

export interface TenantDaMigrare {
  codice: string;
  dbh: Database.Database;
}

function slug(t: string): string {
  return t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

/** La cartella di un cliente nel vault (OpenBao o DA-Link): `clienti/<codcli>/da-ipam`. */
export function prefissoCliente(codiceCliente: string): string {
  return `clienti/${slug(codiceCliente) || "cliente"}/da-ipam`;
}

/** Il percorso di una voce nel vault (OpenBao o DA-Link): `clienti/<codcli>/da-ipam/<nome>-<id>`, minuscolo con trattini. */
export function percorsoCredenziale(codiceCliente: string, credentialId: number, nome: string): string {
  return `clienti/${slug(codiceCliente) || "cliente"}/da-ipam/${slug(nome) || "credenziale"}-${credentialId}`;
}

function uguali(a: ValoreSegreto, b: ValoreSegreto): boolean {
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a[k] === b[k]);
}

function messaggio(e: unknown): string {
  return e instanceof ErroreVault || e instanceof Error ? e.message : "errore";
}

export interface EsitoTenant {
  codice: string;
  daMigrare: number;
  giaMigrate: number;
  migrate: number;
  percorsi: string[];
  illeggibili: Array<{ id: number; nome: string; motivo: string }>;
  errore: string | null;
}

export async function migraVersoOpenBao(op: {
  store: SecretStore;
  tenants: TenantDaMigrare[];
  applica?: boolean;
}): Promise<{ applicata: boolean; perTenant: EsitoTenant[] }> {
  const applica = op.applica === true;
  const perTenant: EsitoTenant[] = [];
  for (const t of op.tenants) {
    const esito: EsitoTenant = { codice: t.codice, daMigrare: 0, giaMigrate: 0, migrate: 0, percorsi: [], illeggibili: [], errore: null };
    perTenant.push(esito);
    if (!schemaVaultPresente(t.dbh)) {
      esito.errore = "Lo schema del vault di questo cliente non è aggiornato (credential_ref manca)";
      continue;
    }
    const righe = t.dbh.prepare("SELECT id, name, credential_ref FROM credentials ORDER BY id").all() as Array<{ id: number; name: string; credential_ref: string | null }>;
    const daFare = righe.filter((r) => !r.credential_ref?.trim());
    esito.giaMigrate = righe.length - daFare.length;
    esito.daMigrare = daFare.length;
    esito.percorsi = daFare.map((r) => percorsoCredenziale(t.codice, r.id, r.name));
    if (!applica || daFare.length === 0) continue;

    const scritte: Array<{ id: number; percorso: string }> = [];
    try {
      for (const r of daFare) {
        const c = campiVoceDb(t.dbh, r.id, { ignoraRiferimento: true });
        if (!c.ok) {
          esito.illeggibili.push({ id: r.id, nome: r.name, motivo: c.motivo });
          continue;
        }
        const percorso = percorsoCredenziale(t.codice, r.id, r.name);
        const valore: ValoreSegreto = { ...c.campi };
        await op.store.put(percorso, valore);
        const riletto = await op.store.get(percorso);
        if (!uguali(riletto, valore)) {
          throw new Error(`La voce #${r.id} «${r.name}» non torna uguale da ${nomeBackend(op.store)}: riferimenti di questo cliente non scritti`);
        }
        scritte.push({ id: r.id, percorso });
      }
      const scrivi = t.dbh.prepare("UPDATE credentials SET credential_ref = ? WHERE id = ? AND credential_ref IS NULL");
      t.dbh.transaction(() => {
        for (const s of scritte) scrivi.run(s.percorso, s.id);
      })();
      esito.migrate = scritte.length;
    } catch (e) {
      esito.errore = messaggio(e);
    }
  }
  return { applicata: applica, perTenant };
}

export interface EsitoVerificaTenant {
  codice: string;
  controllate: number;
  diverse: Array<{ id: number; nome: string; percorso: string; motivo: string }>;
  /**
   * Percorsi in OpenBao sotto la cartella del cliente che nessuna voce usa più (voce cancellata con OpenBao che non
   * rispondeva, segreto cambiato dalla pagina, cancellazione in massa). Mai i valori.
   */
  orfani: string[];
  /** Se l'elenco di OpenBao non si è potuto leggere: gli orfani NON sono stati verificati. */
  orfaniErrore: string | null;
}

export async function verificaMigrazione(op: {
  store: SecretStore;
  tenants: TenantDaMigrare[];
}): Promise<{ perTenant: EsitoVerificaTenant[] }> {
  const perTenant: EsitoVerificaTenant[] = [];
  // I riferimenti in uso, di tutti i clienti: un percorso è orfano solo se nessuna voce di nessun cliente lo usa.
  const inUso = new Set<string>();
  for (const t of op.tenants) {
    if (!schemaVaultPresente(t.dbh)) continue;
    for (const r of t.dbh.prepare("SELECT credential_ref FROM credentials WHERE credential_ref IS NOT NULL AND trim(credential_ref) != ''").all() as Array<{ credential_ref: string }>) {
      inUso.add(r.credential_ref.trim());
    }
  }
  for (const t of op.tenants) {
    const diverse: Array<{ id: number; nome: string; percorso: string; motivo: string }> = [];
    let controllate = 0;
    if (schemaVaultPresente(t.dbh)) {
      const righe = t.dbh
        .prepare("SELECT id, name, credential_ref FROM credentials WHERE credential_ref IS NOT NULL AND trim(credential_ref) != '' ORDER BY id")
        .all() as Array<{ id: number; name: string; credential_ref: string }>;
      for (const r of righe) {
        controllate += 1;
        const c = campiVoceDb(t.dbh, r.id, { ignoraRiferimento: true });
        if (!c.ok) {
          diverse.push({ id: r.id, nome: r.name, percorso: r.credential_ref, motivo: "la colonna non si legge" });
          continue;
        }
        try {
          const v = await op.store.get(r.credential_ref);
          if (!uguali(v, { ...c.campi })) diverse.push({ id: r.id, nome: r.name, percorso: r.credential_ref, motivo: `valori diversi fra ${nomeBackend(op.store)} e la colonna` });
        } catch (e) {
          diverse.push({ id: r.id, nome: r.name, percorso: r.credential_ref, motivo: messaggio(e) });
        }
      }
    }
    let orfani: string[] = [];
    let orfaniErrore: string | null = null;
    try {
      orfani = (await op.store.list(prefissoCliente(t.codice))).filter((p) => !inUso.has(p));
    } catch (e) {
      orfaniErrore = messaggio(e);
    }
    perTenant.push({ codice: t.codice, controllate, diverse, orfani, orfaniErrore });
  }
  return { perTenant };
}
