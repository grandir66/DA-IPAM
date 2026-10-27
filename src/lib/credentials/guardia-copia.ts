/**
 * Guardia degli script che lavorano sulle COPIE dei dati (tappa 2 credenziali,
 * vincolo «Script sulle copie» del piano 2026-10-15-tappa2-archivio-credenziali).
 *
 * Gli script della tappa 2 girano sul server con l'ambiente del servizio
 * caricato (serve ENCRYPTION_KEY), e quell'ambiente contiene DA_INVENT_DATA_DIR
 * verso i dati veri (appliance-systemd-install.sh:69-70). db-tenant e db-hub
 * fissano i percorsi quando si caricano: se lo script li carica prima di aver
 * spostato l'ambiente su --dati, apre — e migra — i DB veri dei clienti.
 *
 * Modulo puro (solo node:fs e node:path): lo script lo importa staticamente
 * PRIMA di toccare l'ambiente e di caricare i moduli del database, e lo
 * richiama dopo averli caricati, coi percorsi che quei moduli useranno davvero.
 *
 * Fallisce chiusa (revisione della 2a, 15/10):
 * - senza DA_INVENT_DATA_DIR nell'ambiente serve `--dati-servizio`. Sull'hub
 *   l'unità non ha la variabile (dati in /opt/da-invent/data, WorkingDirectory
 *   dell'unità) e lo script gira da `$L/codice-*`: `process.cwd()/data` non è
 *   la cartella del servizio, e la guardia lasciava passare i dati veri;
 * - nella copia non ci sono collegamenti: un `tenants/<codice>.db` collegato
 *   (simbolico o fisico) al DB vero passava, perché si guardava solo dove
 *   stanno hub.db e la cartella, non i file dentro.
 */
import fs from "node:fs";
import path from "node:path";
import { unisci, risolvi } from "../percorsi";

export interface PercorsiCopia {
  /** `--dati`: la cartella con la copia (hub.db e tenants/). */
  dati: string;
  /** Il percorso di hub.db che i moduli useranno (`getHubDbPath()`). */
  hubDb: string;
  /** La cartella dei DB tenant che i moduli useranno (`cartellaTenant()`). */
  cartellaTenant: string;
  /**
   * Le cartelle dati del servizio (`cartelleServizio`), lette PRIMA di
   * sovrascrivere l'ambiente. Vuoto = non si parte.
   */
  datiServizio: readonly string[];
}

export type EsitoCartelleServizio = { ok: true; cartelle: string[] } | { ok: false; motivo: string };

/**
 * Le cartelle dati del servizio contro cui controllare `--dati`:
 * - DA_INVENT_DATA_DIR dell'ambiente (appliance: sta in `.env.local`);
 * - `--dati-servizio`, che deve esistere ed essere una cartella;
 * - `<cwd>/data`, dove l'app cercherebbe i dati senza la variabile (conta
 *   solo in più: lo script gira da un'altra cartella).
 * Senza nessuna delle prime due non si parte.
 */
export function cartelleServizio(env: Readonly<Record<string, string | undefined>>, argomento: string | undefined, cwd: string): EsitoCartelleServizio {
  const cartelle: string[] = [];
  const daAmbiente = env.DA_INVENT_DATA_DIR?.trim();
  if (daAmbiente) cartelle.push(daAmbiente);
  if (argomento !== undefined) {
    const arg = argomento.trim();
    let cartella = false;
    try {
      cartella = arg !== "" && !arg.startsWith("--") && fs.statSync(arg).isDirectory();
    } catch {
      cartella = false;
    }
    if (!cartella) return { ok: false, motivo: `--dati-servizio non è una cartella che esiste: ${argomento || "(vuoto)"}` };
    cartelle.push(arg);
  }
  if (cartelle.length === 0) {
    return {
      ok: false,
      motivo:
        "DA_INVENT_DATA_DIR non è nell'ambiente: indica la cartella dati del servizio con --dati-servizio <cartella> " +
        "(sull'hub /opt/da-invent/data), così la guardia sa quali dati non toccare.",
    };
  }
  cartelle.push(unisci(cwd, "data"));
  return { ok: true, cartelle };
}

/** Percorso reale anche se il file non esiste ancora (risolve la cartella più vicina che esiste). */
export function percorsoReale(p: string): string {
  const assoluto = risolvi(p);
  const coda: string[] = [];
  let corrente = assoluto;
  for (;;) {
    try {
      const reale = fs.realpathSync(corrente);
      return coda.length ? unisci(reale, ...coda.reverse()) : reale;
    } catch {
      const su = path.dirname(corrente);
      if (su === corrente) return assoluto;
      coda.push(path.basename(corrente));
      corrente = su;
    }
  }
}

/** Vero se `figlio` sta dentro `padre` (non uguale). Percorsi già reali. */
export function dentro(figlio: string, padre: string): boolean {
  const rel = path.relative(padre, figlio);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * Restituisce i motivi per cui lo script NON deve partire (vuoto = si parte).
 * Mai un'eccezione: ogni caso diventa una riga in italiano.
 */
export function controllaCopia(p: PercorsiCopia): string[] {
  const errori: string[] = [];
  let dati: string;
  try {
    dati = fs.realpathSync(risolvi(p.dati));
  } catch {
    return [`La cartella --dati non esiste: ${p.dati}`];
  }
  if (!fs.statSync(dati).isDirectory()) return [`--dati non è una cartella: ${p.dati}`];

  if (p.datiServizio.length === 0) {
    errori.push("Nessuna cartella dati del servizio da escludere: serve DA_INVENT_DATA_DIR o --dati-servizio");
  }
  for (const s of p.datiServizio) {
    const servizio = percorsoReale(s);
    if (dati === servizio) {
      errori.push(`--dati è la cartella dati del servizio (${servizio}): serve una copia`);
    } else if (dentro(servizio, dati)) {
      errori.push(`--dati contiene la cartella dati del servizio (${servizio})`);
    }
  }

  const hub = percorsoReale(p.hubDb);
  if (!dentro(hub, dati)) {
    errori.push(`hub.db (${hub}) è fuori da --dati (${dati})`);
  } else if (!fs.existsSync(hub) || !fs.statSync(hub).isFile()) {
    errori.push(`--dati non sembra una copia dei dati: manca hub.db (${hub})`);
  }

  const tenant = percorsoReale(p.cartellaTenant);
  if (!dentro(tenant, dati)) {
    errori.push(`La cartella dei tenant (${tenant}) è fuori da --dati (${dati})`);
  } else if (!fs.existsSync(tenant) || !fs.statSync(tenant).isDirectory()) {
    errori.push(`--dati non sembra una copia dei dati: manca la cartella dei tenant (${tenant})`);
  } else {
    let file: string[] = [];
    try {
      file = fs.readdirSync(tenant);
    } catch (e) {
      errori.push(`La cartella dei tenant (${tenant}) non si legge: ${e instanceof Error ? e.message : String(e)}`);
    }
    for (const f of file) errori.push(...fileCollegato(unisci(tenant, f)));
  }
  if (dentro(hub, dati)) {
    for (const f of [p.hubDb, `${p.hubDb}-wal`, `${p.hubDb}-shm`]) errori.push(...fileCollegato(risolvi(f)));
  }
  return errori;
}

/**
 * Un file della copia deve essere un file vero, solo suo: un collegamento
 * simbolico o fisico al DB del servizio farebbe aprire e migrare quello.
 * Un file che non c'è non è un errore (i `-wal`/`-shm` possono mancare).
 */
function fileCollegato(f: string): string[] {
  let st: fs.Stats;
  try {
    st = fs.lstatSync(f);
  } catch {
    return [];
  }
  if (st.isSymbolicLink()) {
    return [`${path.basename(f)} nella copia è un collegamento simbolico (verso ${percorsoReale(f)}): la copia deve avere solo file veri, fatti con copia-dati.ts`];
  }
  if (st.isFile() && st.nlink > 1) {
    return [`${path.basename(f)} nella copia ha altri collegamenti fisici (${st.nlink}): potrebbe essere lo stesso file dei dati del servizio`];
  }
  return [];
}
