/**
 * Lo svuotamento delle colonne cifrate delle credenziali dell'hub (piano da-vault 2026-10-23, passo «svuotare le
 * colonne cifrate», ADR 0035). Si lancia DOPO `da-vault-migra-openbao --applica` e `--verifica`, con l'app che legge già
 * da OpenBao (`DA_VAULT_OPENBAO=1`, tutte le letture sul lettore unico).
 *
 * - **A vuoto di serie**: legge e confronta, non scrive niente. Il rapporto dice quante righe si svuoterebbero, ma mai un
 *   valore (solo numeri, id e nome della riga).
 * - **Svuota solo ciò che è provato**: una riga con `credential_ref` si svuota se il segreto in OpenBao (letto ORA, non
 *   dalla cache) è UGUALE alle colonne decifrate. Una riga senza riferimento che ha ancora colonne piene, un segreto
 *   mancante, una colonna che non si decifra o una sola differenza = il comando esce con errore e **non tocca niente**,
 *   in nessun cliente (tutto o niente).
 * - **`applica`**: per ogni cliente con righe da svuotare, prima la copia del database in `<dati>/backups/` (API di
 *   backup di SQLite, controllata con `quick_check`); poi UNA transazione che ricontrolla ogni riga contro il segreto già
 *   letto e porta a NULL le sei colonne; poi `wal_checkpoint(TRUNCATE)` e `VACUUM`, perché i valori cifrati non restino
 *   nelle pagine libere del file. Se il ricontrollo trova una riga cambiata nel frattempo, ROLLBACK e stop.
 * - **`verificaSvuotamento`**: dopo, dice quanti segreti restano nelle colonne (devono essere 0) e se ogni riga con
 *   riferimento ha il suo segreto in OpenBao.
 *
 * Perimetro: la tabella `credentials` di ogni cliente attivo (la stessa della migrazione). Restano com'erano, apposta, le
 * altre tabelle che cifrano (binding con segreto inline, integrazioni, AD, system_credentials): non hanno un riferimento.
 *
 * Nessun messaggio contiene un valore.
 */
import path from "node:path";
import type Database from "better-sqlite3";
import { schemaVaultPresente } from "@/lib/db-tenant";
import { backupAccanto } from "@/lib/credentials/backup-accanto";
import { campiVoceDb, COLONNE_SEGRETE } from "@/lib/credentials/segreti";
import { ErroreVault, type SecretStore, type ValoreSegreto } from "./tipi";
import type { TenantDaMigrare } from "./migra-openbao";

function uguali(a: ValoreSegreto, b: ValoreSegreto): boolean {
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a[k] === b[k]);
}

function messaggio(e: unknown): string {
  return e instanceof ErroreVault || e instanceof Error ? e.message : "errore";
}

const QUALCUNA_PIENA = COLONNE_SEGRETE.map((c) => `(${c} IS NOT NULL AND ${c} != '')`).join(" OR ");

/** Quante righe hanno ancora almeno una colonna segreta piena, e quali (id e nome, mai valori). */
function righeConColonnePiene(dbh: Database.Database): Array<{ id: number; nome: string; riferimento: string | null }> {
  return (dbh.prepare(`SELECT id, name, credential_ref FROM credentials WHERE ${QUALCUNA_PIENA} ORDER BY id`).all() as Array<{
    id: number;
    name: string;
    credential_ref: string | null;
  }>).map((r) => ({ id: r.id, nome: r.name, riferimento: r.credential_ref?.trim() || null }));
}

export interface EsitoSvuotaTenant {
  codice: string;
  /** Righe totali di `credentials`. */
  righe: number;
  /** Righe che hanno ancora colonne piene. */
  conColonnePiene: number;
  /** Righe già a posto (colonne vuote). */
  giaVuote: number;
  /** Righe con colonne piene e OpenBao uguale: si svuotano (o si sono svuotate con `applica`). */
  daSvuotare: number;
  /** Righe con colonne piene ma senza `credential_ref`: la migrazione non le ha portate in OpenBao. Bloccano tutto. */
  senzaRiferimento: Array<{ id: number; nome: string }>;
  /** Righe con colonne piene e OpenBao assente, irraggiungibile o diverso. Bloccano tutto. */
  diverse: Array<{ id: number; nome: string; percorso: string; motivo: string }>;
  /** Righe svuotate davvero (solo con `applica`). */
  svuotate: number;
  /** Il backup fatto prima di scrivere (solo con `applica`). */
  backup: string | null;
  vacuum: boolean;
  errore: string | null;
}

export interface EsitoSvuota {
  applicata: boolean;
  /** Nessun ostacolo: a vuoto = "si può"; con `applica` = "fatto". */
  ok: boolean;
  perTenant: EsitoSvuotaTenant[];
}

export async function svuotaColonne(op: {
  store: SecretStore;
  tenants: TenantDaMigrare[];
  applica?: boolean;
  /** `<dati>/backups`. */
  cartellaBackup: string;
  /** Per le prove: si ferma dopo il commit del cliente indicato (simula un crash fra due clienti). */
  dopoCliente?: (codice: string) => void;
}): Promise<EsitoSvuota> {
  const applica = op.applica === true;
  const perTenant: EsitoSvuotaTenant[] = [];
  /** I segreti letti da OpenBao nella fase di confronto, per riga: servono al ricontrollo dentro la transazione. */
  const letti = new Map<string, Map<number, ValoreSegreto>>();

  // ── Fase 1: confronto su TUTTI i clienti, niente si scrive ──────────────────────────────────────────────────────
  for (const t of op.tenants) {
    const e: EsitoSvuotaTenant = {
      codice: t.codice, righe: 0, conColonnePiene: 0, giaVuote: 0, daSvuotare: 0, senzaRiferimento: [], diverse: [], svuotate: 0, backup: null, vacuum: false, errore: null,
    };
    perTenant.push(e);
    if (!schemaVaultPresente(t.dbh)) {
      e.errore = "Lo schema del vault di questo cliente non è aggiornato (credential_ref manca)";
      continue;
    }
    e.righe = (t.dbh.prepare("SELECT COUNT(*) AS n FROM credentials").get() as { n: number }).n;
    const piene = righeConColonnePiene(t.dbh);
    e.conColonnePiene = piene.length;
    e.giaVuote = e.righe - piene.length;
    const dellaRiga = new Map<number, ValoreSegreto>();
    letti.set(t.codice, dellaRiga);
    for (const r of piene) {
      if (!r.riferimento) {
        e.senzaRiferimento.push({ id: r.id, nome: r.nome });
        continue;
      }
      const colonne = campiVoceDb(t.dbh, r.id, { ignoraRiferimento: true });
      if (!colonne.ok) {
        e.diverse.push({ id: r.id, nome: r.nome, percorso: r.riferimento, motivo: "la colonna non si legge" });
        continue;
      }
      let inOpenBao: ValoreSegreto;
      try {
        inOpenBao = await op.store.get(r.riferimento);
      } catch (err) {
        e.diverse.push({ id: r.id, nome: r.nome, percorso: r.riferimento, motivo: messaggio(err) });
        continue;
      }
      if (!uguali(inOpenBao, { ...colonne.campi })) {
        e.diverse.push({ id: r.id, nome: r.nome, percorso: r.riferimento, motivo: "valori diversi fra OpenBao e la colonna" });
        continue;
      }
      e.daSvuotare += 1;
      dellaRiga.set(r.id, inOpenBao);
    }
  }

  const bloccato = perTenant.some((e) => e.errore !== null || e.diverse.length > 0 || e.senzaRiferimento.length > 0);
  if (!applica || bloccato) return { applicata: false, ok: !bloccato, perTenant };

  // ── Fase 2: un cliente alla volta, backup → transazione col ricontrollo → checkpoint e VACUUM ───────────────────
  for (const t of op.tenants) {
    const e = perTenant.find((x) => x.codice === t.codice) as EsitoSvuotaTenant;
    const dellaRiga = letti.get(t.codice) as Map<number, ValoreSegreto>;
    if (dellaRiga.size === 0) continue;
    try {
      const copia = await backupAccanto(t.dbh, t.dbh.name, { cartella: op.cartellaBackup });
      e.backup = copia.percorso;
      const azzera = t.dbh.prepare(`UPDATE credentials SET ${COLONNE_SEGRETE.map((c) => `${c} = NULL`).join(", ")} WHERE id = ?`);
      t.dbh
        .transaction(() => {
          for (const [id, inOpenBao] of dellaRiga) {
            // Il ricontrollo: la riga deve avere ancora lo stesso riferimento e le stesse colonne di quando si è confrontato.
            const ancora = campiVoceDb(t.dbh, id, { ignoraRiferimento: true });
            if (!ancora.ok || !uguali(inOpenBao, { ...ancora.campi })) {
              throw new Error(`La riga #${id} è cambiata durante lo svuotamento: annullato per questo cliente (niente toccato)`);
            }
            azzera.run(id);
          }
        })
        .immediate();
      e.svuotate = dellaRiga.size;
      // I valori cifrati non devono restare nelle pagine libere del file.
      t.dbh.pragma("wal_checkpoint(TRUNCATE)");
      t.dbh.exec("VACUUM");
      t.dbh.pragma("wal_checkpoint(TRUNCATE)");
      e.vacuum = true;
      const controllo = t.dbh.pragma("quick_check", { simple: true });
      if (controllo !== "ok") throw new Error(`Dopo il VACUUM il controllo del database dice «${String(controllo)}»: ripristina dal backup ${e.backup}`);
      op.dopoCliente?.(t.codice);
    } catch (err) {
      e.errore = messaggio(err);
      return { applicata: true, ok: false, perTenant };
    }
  }
  return { applicata: true, ok: true, perTenant };
}

export interface EsitoVerificaSvuotamento {
  codice: string;
  righe: number;
  /** Segreti rimasti nelle colonne (righe con almeno una colonna piena): devono essere 0. */
  rimaste: Array<{ id: number; nome: string }>;
  /** Righe con riferimento il cui segreto in OpenBao manca, è vuoto o non si legge. */
  senzaSegreto: Array<{ id: number; nome: string; percorso: string; motivo: string }>;
  /** Righe con riferimento e segreto in OpenBao: quelle che l'app legge da lì. */
  inOpenBao: number;
  /** Righe senza colonne e senza riferimento (voci senza segreti): non è un errore, si dice. */
  senzaSegreti: number;
}

/**
 * La verifica dopo lo svuotamento: 0 segreti nelle colonne e, per ogni riga con riferimento, il segreto in OpenBao
 * (letto ORA, non vuoto). Nessun valore nel rapporto.
 */
export async function verificaSvuotamento(op: { store: SecretStore; tenants: TenantDaMigrare[] }): Promise<{ ok: boolean; perTenant: EsitoVerificaSvuotamento[] }> {
  const perTenant: EsitoVerificaSvuotamento[] = [];
  for (const t of op.tenants) {
    const v: EsitoVerificaSvuotamento = { codice: t.codice, righe: 0, rimaste: [], senzaSegreto: [], inOpenBao: 0, senzaSegreti: 0 };
    perTenant.push(v);
    if (!schemaVaultPresente(t.dbh)) {
      v.senzaSegreto.push({ id: 0, nome: "(schema)", percorso: "", motivo: "lo schema del vault non è aggiornato (credential_ref manca)" });
      continue;
    }
    v.righe = (t.dbh.prepare("SELECT COUNT(*) AS n FROM credentials").get() as { n: number }).n;
    v.rimaste = righeConColonnePiene(t.dbh).map((r) => ({ id: r.id, nome: r.nome }));
    const righe = t.dbh.prepare("SELECT id, name, credential_ref FROM credentials ORDER BY id").all() as Array<{ id: number; name: string; credential_ref: string | null }>;
    for (const r of righe) {
      const ref = r.credential_ref?.trim();
      if (!ref) {
        if (!v.rimaste.some((x) => x.id === r.id)) v.senzaSegreti += 1;
        continue;
      }
      try {
        const s = await op.store.get(ref);
        if (Object.keys(s).length === 0) v.senzaSegreto.push({ id: r.id, nome: r.name, percorso: ref, motivo: "il segreto in OpenBao è vuoto" });
        else v.inOpenBao += 1;
      } catch (e) {
        v.senzaSegreto.push({ id: r.id, nome: r.name, percorso: ref, motivo: messaggio(e) });
      }
    }
  }
  return { ok: perTenant.every((v) => v.rimaste.length === 0 && v.senzaSegreto.length === 0), perTenant };
}

/** La cartella dei backup dello svuotamento: `<dati>/backups`. */
export function cartellaBackupSvuotamento(dataDir: string): string {
  return path.join(dataDir, "backups");
}
