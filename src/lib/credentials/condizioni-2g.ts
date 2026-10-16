/**
 * Le condizioni per togliere il vecchio (tappa 2g credenziali, T26 e T27 del
 * piano `plans/2026-10-15-tappa2-archivio-credenziali.md`).
 *
 * Decisioni di Riccardo del 16/10, che qui diventano regola:
 * - D9 rivista: niente attesa di 14 giorni dopo la 2f («non voglio
 *   attendere»). Restano i segni chiusi e il registro dei ripieghi a zero DAL
 *   RILASCIO DELLA 2f, cioè dalla data scritta nel segno
 *   `credenziali_t2_integrazioni` del tenant, per i casi di D9: tutti i
 *   `cred_*` tranne `cred_public`, che con D5 = (a) resta per sempre;
 * - lasciati accettati: sull'hub due apparati sono rimasti fuori dalla 2e
 *   (binding fallito verso la stessa voce della colonna). Un segno
 *   `credenziali_t2_apparati` a `parziale:` non blocca più quando gli
 *   apparati lasciati, RICALCOLATI ADESSO con la conversione a vuoto,
 *   coincidono esattamente con l'elenco di id passato a mano per quel tenant.
 *   L'elenco non si deduce e non ha un valore di default: senza, un
 *   `parziale:` blocca. Dopo la 2g quegli apparati restano senza credenziale
 *   valida finché una Prova non riesce (il motore non legge più le colonne).
 *   Le righe di controller e AD lasciate dalla 2f (Omada) restano un blocco.
 *
 * Un tenant senza nessun segno (mai aperto dopo la 2c, come il DEFAULT
 * dell'hub) si esclude e si dice per nome: quando si aprirà farà tutte le
 * conversioni in fila, e la pulizia lì non parte da sola (è uno script).
 *
 * Ripieghi da confermare (T27, 16/10): il registro scrive caso, tenant e
 * firma del chiamante, non l'apparato. In un tenant con lasciati accettati un
 * `cred_colonna_apparato` può venire proprio da loro (fino al codice della 2g
 * il motore ripiegava sulla colonna dopo il binding fallito), e non c'è modo
 * di dirlo dal registro. Allora non blocca da solo: si elenca per firma col
 * conteggio (`daConfermare`) e lo conferma Riccardo nella conferma scritta
 * della pulizia, con quel numero. Gli altri casi, le righe illeggibili e il
 * tetto orario bloccano come sempre; senza lasciati accettati anche
 * `cred_colonna_apparato` blocca.
 *
 * Modulo puro (solo `node:fs` per leggere il registro): non importa né `db.ts`
 * né `db-tenant.ts`, e non apre nessun DB. I dati li raccoglie chi chiama.
 */
import fs from "node:fs";
import path from "node:path";

/** I casi del registro che bloccano la 2g (D9): tutti i `cred_*` tranne `cred_public`. */
export const CASI_CHE_BLOCCANO_2G: readonly string[] = Object.freeze([
  "cred_colonna_apparato",
  "cred_binding_inline",
  "cred_catena_vecchia",
  "cred_chiave_hub",
  "cred_riga_integrazione",
  "cred_v3_vecchia",
]);

export interface SegniT2 {
  tipi: string | null;
  catene: string | null;
  apparati: string | null;
  integrazioni: string | null;
}

const NOME_SEGNO: Readonly<Record<keyof SegniT2, string>> = {
  tipi: "credenziali_t2_tipi",
  catene: "credenziali_t2_catene",
  apparati: "credenziali_t2_apparati",
  integrazioni: "credenziali_t2_integrazioni",
};

export interface StatoTenant2g {
  tenant: string;
  segni: SegniT2;
  /** Gli apparati che la conversione della 2e, rifatta a vuoto adesso, lascerebbe. */
  lasciatiApparati: ReadonlyArray<{ device_id: number; motivo: string }>;
  /** Le righe di controller e AD che la conversione della 2f, rifatta a vuoto adesso, lascerebbe. */
  lasciatiIntegrazioni: ReadonlyArray<{ tabella: string; id: number; motivo: string }>;
}

/** Una riga del registro dei ripieghi (`db-maintenance/ripieghi.ts`). */
export interface RigaRegistro {
  ts: string;
  caso: string;
  tenant: string | null;
  firma: string;
  tipo: string;
  ora?: string;
  n?: number;
}

export interface Registro {
  righe: RigaRegistro[];
  /** Righe che non si leggono: il registro non dice tutto, quindi bloccano. */
  illeggibili: number;
}

export interface DaConfermare {
  /** Una riga per caso e firma, col conteggio: va a terminale e nella domanda della conferma. */
  righe: string[];
  /** La somma dei conteggi (per ora, il massimo scritto): è il numero che si conferma per iscritto. */
  conteggio: number;
}

export interface EsitoCondizioni {
  tenant: string;
  /** `da_confermare`: nessun blocco, ma ripieghi che solo una conferma scritta può attribuire ai lasciati accettati. */
  stato: "ok" | "bloccato" | "escluso" | "da_confermare";
  blocchi: string[];
  note: string[];
  /** I ripieghi `cred_colonna_apparato` attribuibili ai lasciati accettati; null se non ce ne sono. */
  daConfermare: DaConfermare | null;
}

/** Il caso che i lasciati accettati possono aver scritto (colonne di `network_devices`). */
export const CASO_DEI_LASCIATI = "cred_colonna_apparato";

/** La data ISO di un segno `done:<data>:…` o `parziale:<data>:…`; null per `errore:` o assente. */
export function dataDelSegno(segno: string | null): string | null {
  const m = /^(?:done|parziale):(\d{4}-\d{2}-\d{2}T[0-9:.]+Z):/.exec(segno ?? "");
  return m ? m[1] : null;
}

function descriviSegno(valore: string | null): string {
  if (valore == null) return "manca";
  return `vale «${valore.length > 80 ? `${valore.slice(0, 80)}…` : valore}»`;
}

const elencoId = (ids: readonly number[]): string => (ids.length ? ids.map((id) => `#${id}`).join(", ") : "nessuno");

function stessiId(a: readonly number[], b: readonly number[]): boolean {
  const x = [...new Set(a)].sort((p, q) => p - q);
  const y = [...new Set(b)].sort((p, q) => p - q);
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

/**
 * I ripieghi dei casi di D9 del tenant (o senza tenant) dal momento `dal`, per
 * caso e firma. Con `attribuibili` (il tenant ha lasciati accettati) quelli di
 * `CASO_DEI_LASCIATI` non bloccano: vanno in `daConfermare`.
 */
function ripieghiDal(registro: Registro, tenant: string, dal: string | null, attribuibili: boolean): { blocchi: string[]; daConfermare: DaConfermare | null } {
  const gruppi = new Map<string, { caso: string; firma: string; perOra: Map<string, number>; ultimo: string }>();
  let limiti = 0;
  for (const r of registro.righe) {
    if (dal != null && r.ts < dal) continue;
    if (r.tipo === "limite") {
      limiti++;
      continue;
    }
    if (!CASI_CHE_BLOCCANO_2G.includes(r.caso)) continue;
    if (r.tenant != null && r.tenant !== tenant) continue;
    const chiave = `${r.caso}|${r.firma}`;
    const g = gruppi.get(chiave) ?? { caso: r.caso, firma: r.firma, perOra: new Map<string, number>(), ultimo: "" };
    const ora = r.ora ?? r.ts.slice(0, 13);
    const n = r.tipo === "conteggio" && typeof r.n === "number" ? r.n : 1;
    g.perOra.set(ora, Math.max(g.perOra.get(ora) ?? 0, n));
    if (r.ts > g.ultimo) g.ultimo = r.ts;
    gruppi.set(chiave, g);
  }
  const blocchi: string[] = [];
  const confermare: DaConfermare = { righe: [], conteggio: 0 };
  for (const g of gruppi.values()) {
    const n = [...g.perOra.values()].reduce((s, v) => s + v, 0);
    const riga = `ripiego ${g.caso} da ${g.firma}: almeno ${n} (l'ultimo ${g.ultimo})`;
    if (attribuibili && g.caso === CASO_DEI_LASCIATI) {
      confermare.righe.push(riga);
      confermare.conteggio += n;
    } else {
      blocchi.push(riga);
    }
  }
  if (limiti > 0) blocchi.push(`il registro ha raggiunto il tetto orario ${limiti} volte: alcune righe non sono state scritte`);
  if (registro.illeggibili > 0) blocchi.push(`${registro.illeggibili} righe del registro non si leggono`);
  return { blocchi, daConfermare: confermare.righe.length > 0 ? confermare : null };
}

/**
 * Si può togliere il vecchio da questo tenant? `accettati`: l'elenco degli
 * apparati lasciati accettati da Riccardo per QUESTO tenant, o null se non
 * passato. I ripieghi contano dalla data del segno della 2f del tenant (senza
 * una data, tutto il registro), e da nessun'altra: una data passata a mano
 * (`--dal`, tolta nella revisione della 2g del 16/10) poteva solo restringere
 * la finestra e nascondere ripieghi veri.
 */
export function valutaCondizioni2g(t: StatoTenant2g, registro: Registro, accettati: readonly number[] | null): EsitoCondizioni {
  const blocchi: string[] = [];
  const note: string[] = [];
  const s = t.segni;
  if (s.tipi == null && s.catene == null && s.apparati == null && s.integrazioni == null) {
    note.push(`tenant ${t.tenant}: nessun segno della tappa 2 (mai aperto dopo la 2c): escluso, la pulizia lì non parte`);
    return { tenant: t.tenant, stato: "escluso", blocchi, note, daConfermare: null };
  }

  for (const k of ["tipi", "catene", "integrazioni"] as const) {
    if (!(s[k] ?? "").startsWith("done:")) blocchi.push(`${NOME_SEGNO[k]} ${descriviSegno(s[k])}: serve done:`);
  }

  // 2e: lasciati ricalcolati adesso contro l'elenco accettato (mai dedotto).
  const lasciati = [...new Set(t.lasciatiApparati.map((l) => l.device_id))].sort((a, b) => a - b);
  const segnoApparati = s.apparati ?? "";
  if (!segnoApparati.startsWith("done:") && !segnoApparati.startsWith("parziale:")) {
    blocchi.push(`${NOME_SEGNO.apparati} ${descriviSegno(s.apparati)}: serve done: (o parziale: coi lasciati accettati)`);
  } else if (segnoApparati.startsWith("parziale:") && accettati == null) {
    blocchi.push(
      `${NOME_SEGNO.apparati} è parziale: e nessun elenco di lasciati accettati per il tenant ${t.tenant} (lasciati ricalcolati adesso: ${elencoId(lasciati)}): ` +
        `serve --lasciati-accettati ${t.tenant}:<id>,<id> deciso da Riccardo`
    );
  } else if (!stessiId(lasciati, accettati ?? [])) {
    blocchi.push(
      `apparati lasciati dalla 2e, ricalcolati adesso: ${elencoId(lasciati)}; accettati: ${elencoId(accettati ?? [])}: non coincidono`
    );
  } else if (lasciati.length > 0) {
    note.push(
      `tenant ${t.tenant}: apparati lasciati accettati ${elencoId(lasciati)}: dopo la 2g restano senza credenziale valida finché una Prova non riesce`
    );
  }
  for (const l of t.lasciatiApparati) {
    if (!accettati?.includes(l.device_id)) note.push(`apparato #${l.device_id}: ${l.motivo}`);
  }

  // 2f: una riga lasciata (Omada) è un blocco esplicito, sempre.
  for (const l of t.lasciatiIntegrazioni) {
    blocchi.push(`${l.tabella === "network_controllers" ? "controller" : "Active Directory"} #${l.id} lasciato dalla 2f: ${l.motivo}`);
  }

  // Registro dei ripieghi dal rilascio della 2f (D9 rivista: nessun periodo d'attesa).
  const da = dataDelSegno(s.integrazioni);
  if (da == null) note.push(`tenant ${t.tenant}: nessuna data della 2f: il registro si legge per intero`);
  const ripieghi = ripieghiDal(registro, t.tenant, da, (accettati?.length ?? 0) > 0);
  blocchi.push(...ripieghi.blocchi);
  if (ripieghi.daConfermare) {
    note.push(
      `tenant ${t.tenant}: ${ripieghi.daConfermare.conteggio} ripieghi ${CASO_DEI_LASCIATI} dal rilascio della 2f: il registro non scrive l'apparato, ` +
        `quindi non si può dire se vengono dai lasciati accettati ${elencoId(accettati ?? [])}; si confermano per iscritto nella pulizia`
    );
  }

  const stato = blocchi.length > 0 ? "bloccato" : ripieghi.daConfermare ? "da_confermare" : "ok";
  return { tenant: t.tenant, stato, blocchi, note, daConfermare: ripieghi.daConfermare };
}

/**
 * `--lasciati-accettati <tenant>:<id>,<id>` (ripetibile, un tenant per volta):
 * gli id degli apparati sono del DB di quel tenant, quindi senza il tenant
 * l'elenco varrebbe per tutti. Un valore malformato è un errore, mai un
 * elenco dedotto.
 */
export function leggiLasciatiAccettati(valori: readonly string[]): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const v of valori) {
    const m = /^([A-Za-z0-9_-]{1,64}):(\d+(?:,\d+)*)$/.exec(v.trim());
    if (!m) throw new Error(`--lasciati-accettati «${v}»: si scrive <tenant>:<id>,<id> (per esempio CODICE:22,25, col codice del tenant)`);
    const ids = m[2].split(",").map((x) => Number(x));
    if (ids.some((id) => !Number.isInteger(id) || id <= 0)) throw new Error(`--lasciati-accettati «${v}»: gli id sono numeri positivi`);
    if (new Set(ids).size !== ids.length) throw new Error(`--lasciati-accettati «${v}»: un id ripetuto`);
    if (out.has(m[1])) throw new Error(`--lasciati-accettati: il tenant ${m[1]} c'è due volte`);
    out.set(m[1], ids);
  }
  return out;
}

const FILE_REGISTRO = /^ripieghi-\d{4}-\d{2}-\d{2}\.jsonl$/;

/**
 * Legge (senza scrivere) i file `ripieghi-<giorno>.jsonl` di una cartella del
 * registro. Una cartella che non c'è è un errore: un registro vuoto per una
 * cartella sbagliata direbbe «nessun ripiego».
 */
export function leggiRegistroRipieghi(cartella: string): Registro {
  let file: string[];
  try {
    file = fs.readdirSync(cartella).filter((f) => FILE_REGISTRO.test(f)).sort();
  } catch (e) {
    throw new Error(`Cartella del registro dei ripieghi non leggibile (${cartella}): ${e instanceof Error ? e.message : String(e)}`);
  }
  const righe: RigaRegistro[] = [];
  let illeggibili = 0;
  for (const f of file) {
    for (const testo of fs.readFileSync(path.join(cartella, f), "utf8").split("\n")) {
      if (testo.trim() === "") continue;
      try {
        const r = JSON.parse(testo) as Partial<RigaRegistro>;
        if (typeof r.ts !== "string" || typeof r.tipo !== "string") {
          illeggibili++;
          continue;
        }
        righe.push({
          ts: r.ts,
          tipo: r.tipo,
          caso: typeof r.caso === "string" ? r.caso : "",
          tenant: typeof r.tenant === "string" ? r.tenant : null,
          firma: typeof r.firma === "string" ? r.firma : "",
          ...(typeof r.ora === "string" ? { ora: r.ora } : {}),
          ...(typeof r.n === "number" ? { n: r.n } : {}),
        });
      } catch {
        illeggibili++;
      }
    }
  }
  return { righe, illeggibili };
}
