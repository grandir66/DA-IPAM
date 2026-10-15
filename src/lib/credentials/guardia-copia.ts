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
 */
import fs from "node:fs";
import path from "node:path";

export interface PercorsiCopia {
  /** `--dati`: la cartella con la copia (hub.db e tenants/). */
  dati: string;
  /** Il percorso di hub.db che i moduli useranno (`getHubDbPath()`). */
  hubDb: string;
  /** La cartella dei DB tenant che i moduli useranno (`cartellaTenant()`). */
  cartellaTenant: string;
  /** La cartella dati del servizio, letta dall'ambiente PRIMA di sovrascriverlo. */
  datiServizio: string;
}

/** Percorso reale anche se il file non esiste ancora (risolve la cartella più vicina che esiste). */
export function percorsoReale(p: string): string {
  const assoluto = path.resolve(p);
  const coda: string[] = [];
  let corrente = assoluto;
  for (;;) {
    try {
      const reale = fs.realpathSync(corrente);
      return coda.length ? path.join(reale, ...coda.reverse()) : reale;
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
    dati = fs.realpathSync(path.resolve(p.dati));
  } catch {
    return [`La cartella --dati non esiste: ${p.dati}`];
  }
  if (!fs.statSync(dati).isDirectory()) return [`--dati non è una cartella: ${p.dati}`];

  const servizio = percorsoReale(p.datiServizio);
  if (dati === servizio) {
    errori.push(`--dati è la cartella dati del servizio (${servizio}): serve una copia`);
  } else if (dentro(servizio, dati)) {
    errori.push(`--dati contiene la cartella dati del servizio (${servizio})`);
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
  }
  return errori;
}
