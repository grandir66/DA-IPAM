/**
 * Le chiavi di hub.db che la tappa 2 credenziali ha reso inutili (2g, T27):
 * - `host_windows_credential_id`, `host_linux_credential_id` (D3): le legge
 *   solo la conversione delle catene (2d), e solo con UN tenant attivo
 *   (`converti-catene.ts`, `MOTIVO_DUE_TENANT`); sul cliente A sono già nelle
 *   liste delle reti, sull'hub (due tenant) non si sono mai copiate;
 * - `integration_unifi_*`: le legge solo `migrateLegacyUnifiConfig`, una volta
 *   per tenant (segno `controllers_legacy_unifi`), e solo con al più un tenant
 *   attivo; dalla 2f il segreto è una voce dell'archivio.
 * Si tolgono solo quando nessuno le leggerà più: con un tenant attivo, la sua
 * conversione deve essere già fatta. Altrimenti restano, col perché. Mai i
 * valori a terminale: solo i nomi.
 *
 * Modulo con l'handle di hub.db: non importa né `db.ts`, né `db-hub.ts`, né
 * `db-tenant.ts`. I segni dei tenant li legge chi chiama.
 */
import type Database from "better-sqlite3";
import { conversioneChiusa } from "./segni-t2";

export const CHIAVI_D3: readonly string[] = Object.freeze(["host_windows_credential_id", "host_linux_credential_id"]);
export const PREFISSO_UNIFI = "integration_unifi_";
/** Il segno di `migrateLegacyUnifiConfig` nel tenant (`controllers/service.ts`). */
export const SEGNO_UNIFI_PORTATA = "controllers_legacy_unifi";

export interface TenantHub {
  codice: string;
  attivo: boolean;
  /** `credenziali_t2_catene` del tenant; null se manca, undefined se il DB del tenant non c'è. */
  segnoCatene: string | null | undefined;
  /** `controllers_legacy_unifi` del tenant; null se manca, undefined se il DB del tenant non c'è. */
  segnoUnifi: string | null | undefined;
}

export interface PianoChiaviHub {
  daTogliere: string[];
  trattenute: Array<{ chiave: string; motivo: string }>;
}

/** Le chiavi di D3 e le `integration_unifi_*` presenti in hub.db, per nome. */
export function chiaviPresentiDb(hub: Database.Database): string[] {
  const righe = hub
    .prepare(
      `SELECT key FROM settings
       WHERE key IN (${CHIAVI_D3.map(() => "?").join(", ")}) OR key LIKE ? ESCAPE '\\'
       ORDER BY key`
    )
    .all(...CHIAVI_D3, `${PREFISSO_UNIFI.replace(/_/g, "\\_")}%`) as Array<{ key: string }>;
  return righe.map((r) => r.key);
}

function motivoD3(attivi: TenantHub[]): string | null {
  if (attivi.length !== 1) return null;
  const t = attivi[0];
  if (t.segnoCatene === undefined) return `il DB del tenant attivo ${t.codice} non c'è: non si sa se la 2d le ha già copiate`;
  if (!conversioneChiusa(t.segnoCatene)) {
    return `la 2d non è chiusa nel tenant attivo ${t.codice} (segno ${t.segnoCatene ?? "assente"}): quando la farà, le chiavi servono (D3)`;
  }
  return null;
}

function motivoUnifi(attivi: TenantHub[]): string | null {
  if (attivi.length > 1) return null;
  if (attivi.length === 0) return "nessun tenant attivo: la configurazione UniFi dell'hub si porterebbe nel primo tenant che si apre";
  const t = attivi[0];
  if (t.segnoUnifi === undefined) return `il DB del tenant attivo ${t.codice} non c'è: non si sa se la configurazione UniFi è già stata portata`;
  if (!t.segnoUnifi?.trim()) return `la configurazione UniFi dell'hub non è ancora stata portata nel tenant attivo ${t.codice} (${SEGNO_UNIFI_PORTATA} assente)`;
  return null;
}

/** Quali chiavi si possono togliere adesso, e perché le altre restano. */
export function pianoChiaviHub(chiavi: readonly string[], tenant: readonly TenantHub[]): PianoChiaviHub {
  const attivi = tenant.filter((t) => t.attivo);
  const d3 = motivoD3(attivi);
  const unifi = motivoUnifi(attivi);
  const piano: PianoChiaviHub = { daTogliere: [], trattenute: [] };
  for (const k of [...chiavi].sort()) {
    const motivo = CHIAVI_D3.includes(k) ? d3 : k.startsWith(PREFISSO_UNIFI) ? unifi : "non è una chiave della tappa 2";
    if (motivo) piano.trattenute.push({ chiave: k, motivo });
    else piano.daTogliere.push(k);
  }
  return piano;
}

/**
 * Toglie le chiavi del piano, in una transazione: se le chiavi presenti non
 * sono più quelle del piano (il DB è cambiato dopo la conferma) non tocca
 * niente. Restituisce quante ne ha tolte.
 */
export function togliChiaviHubDb(hub: Database.Database, piano: PianoChiaviHub): number {
  return hub.transaction((): number => {
    const presenti = chiaviPresentiDb(hub);
    const attese = [...piano.daTogliere, ...piano.trattenute.map((t) => t.chiave)].sort();
    if (JSON.stringify(presenti) !== JSON.stringify(attese)) {
      throw new Error("Le chiavi di hub.db sono cambiate dopo la conferma: niente tolto, rilancia a vuoto");
    }
    const togli = hub.prepare("DELETE FROM settings WHERE key = ?");
    let n = 0;
    for (const k of piano.daTogliere) n += togli.run(k).changes;
    if (n !== piano.daTogliere.length) throw new Error(`tolte ${n} chiavi invece di ${piano.daTogliere.length}: annullato`);
    return n;
  })();
}
