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
 *   modifica fatta dalla pagina a interruttore spento non toglie il riferimento).
 */
import type Database from "better-sqlite3";
import { schemaVaultPresente } from "@/lib/db-tenant";
import { campiVoceDb } from "@/lib/credentials/segreti";
import { ErroreVault, type SecretStore, type ValoreSegreto } from "./tipi";

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

/** Il percorso di una voce in OpenBao: `clienti/<codcli>/da-ipam/<nome>-<id>`, minuscolo con trattini. */
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
          throw new Error(`La voce #${r.id} «${r.name}» non torna uguale da OpenBao: riferimenti di questo cliente non scritti`);
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

export async function verificaMigrazione(op: {
  store: SecretStore;
  tenants: TenantDaMigrare[];
}): Promise<{ perTenant: Array<{ codice: string; controllate: number; diverse: Array<{ id: number; nome: string; percorso: string; motivo: string }> }> }> {
  const perTenant = [];
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
          if (!uguali(v, { ...c.campi })) diverse.push({ id: r.id, nome: r.name, percorso: r.credential_ref, motivo: "valori diversi fra OpenBao e la colonna" });
        } catch (e) {
          diverse.push({ id: r.id, nome: r.name, percorso: r.credential_ref, motivo: messaggio(e) });
        }
      }
    }
    perTenant.push({ codice: t.codice, controllate, diverse });
  }
  return { perTenant };
}
