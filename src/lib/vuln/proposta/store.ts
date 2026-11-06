/**
 * Proposte salvate. Il sistema riscrive solo le righe `proposto`: `confermato` ed `escluso` sono una
 * scelta di una persona e al massimo si segnano «da rivedere». Un host diventato impianto non resta
 * confermato su un profilo: lì vince il freno.
 */
import { getDb, getHostsByNetwork } from "@/lib/db";
import { leggiContesiDiRete } from "@/lib/attribution/contesi";
import type { Host } from "@/types";
import type { IdVoce } from "@/lib/vuln/scansioni-va-regole";
import { proponiProfilo, type Famiglia, type Proposta } from "./regole";

export type StatoProposta = "proposto" | "confermato" | "escluso";

export interface RigaProposta {
  host_id: number;
  ip: string;
  nome: string | null;
  famiglia: Famiglia;
  voce: IdVoce | null;
  con_web: number;
  confidenza: "alta" | "bassa";
  motivo: string;
  stato: StatoProposta;
  da_rivedere: number;
  confermata_da: string | null;
  confermata_il: string | null;
}

interface Salvata {
  host_id: number;
  famiglia: Famiglia;
  stato: StatoProposta;
}

/** Cosa fare di una riga già salvata davanti alla proposta nuova. Esportata per le prove. */
export function esitoRigenerazione(salvata: Salvata | undefined, nuova: Proposta): "scrivi" | "segna" | "lascia" {
  if (!salvata || salvata.stato === "proposto") return "scrivi";
  if (nuova.famiglia === "impianti" && salvata.famiglia !== "impianti") return "scrivi";
  return salvata.famiglia === nuova.famiglia ? "lascia" : "segna";
}

/** Host su cui le fonti non concordano su tipo o sistema (stesso criterio della rigenerazione). */
export function contesiDiRete(networkId: number, adesso = new Date().toISOString()): Set<number> {
  return new Set(
    leggiContesiDiRete(getDb(), networkId, adesso, { limite: Number.MAX_SAFE_INTEGER }).righe
      .filter((r) => r.dimensione === "category" || r.dimensione === "os")
      .map((r) => r.host_id),
  );
}

export function rigeneraProposte(
  networkId: number,
  adesso = new Date().toISOString(),
  soloHost?: ReadonlySet<number>,
): { scritte: number; daRivedere: number } {
  const db = getDb();
  const hosts = getHostsByNetwork(networkId).filter((h) => h.status !== "offline") as Array<Host & Parameters<typeof proponiProfilo>[0]>;
  const contesi = contesiDiRete(networkId, adesso);
  const salvate = new Map(
    (db.prepare(
      `SELECT p.host_id, p.famiglia, p.stato FROM va_proposte p JOIN hosts h ON h.id = p.host_id WHERE h.network_id = ?`,
    ).all(networkId) as Salvata[]).map((s) => [s.host_id, s]),
  );
  const scrivi = db.prepare(
    `INSERT INTO va_proposte (host_id, famiglia, voce, con_web, confidenza, motivo, stato, da_rivedere, aggiornata_il)
     VALUES (@id, @famiglia, @voce, @conWeb, @confidenza, @motivo, 'proposto', 0, datetime('now'))
     ON CONFLICT(host_id) DO UPDATE SET famiglia=excluded.famiglia, voce=excluded.voce, con_web=excluded.con_web,
       confidenza=excluded.confidenza, motivo=excluded.motivo, stato='proposto', da_rivedere=0,
       confermata_da=NULL, confermata_il=NULL, aggiornata_il=datetime('now')`,
  );
  const segna = db.prepare(
    `UPDATE va_proposte SET da_rivedere=1, motivo=?, aggiornata_il=datetime('now') WHERE host_id=?`,
  );
  let scritte = 0;
  let daRivedere = 0;
  db.transaction(() => {
    for (const h of hosts) {
      if (soloHost && !soloHost.has(h.id)) continue;
      const nuova = proponiProfilo(h, { conteso: contesi.has(h.id) });
      const azione = esitoRigenerazione(salvate.get(h.id), nuova);
      if (azione === "scrivi") {
        scrivi.run({ id: h.id, famiglia: nuova.famiglia, voce: nuova.voce, conWeb: nuova.conWeb ? 1 : 0, confidenza: nuova.confidenza, motivo: nuova.motivo });
        scritte++;
      } else if (azione === "segna") {
        segna.run(`Ora risulterebbe: ${nuova.motivo}`, h.id);
        daRivedere++;
      }
    }
  })();
  return { scritte, daRivedere };
}

export function leggiProposte(networkId: number): RigaProposta[] {
  return getDb().prepare(
    `SELECT p.host_id, h.ip, COALESCE(NULLIF(h.custom_name,''), h.hostname) AS nome, p.famiglia, p.voce, p.con_web,
            p.confidenza, p.motivo, p.stato, p.da_rivedere, p.confermata_da, p.confermata_il
     FROM va_proposte p JOIN hosts h ON h.id = p.host_id
     WHERE h.network_id = ? ORDER BY p.famiglia, h.ip`,
  ).all(networkId) as RigaProposta[];
}

/** Quanto è avanti la proposta di ogni rete, per l'elenco delle reti: una query sola, niente N+1. */
export interface ContoProposte {
  totale: number;
  confermate: number;
  daRivedere: number;
}

export function contiPropostePerRete(): Record<number, ContoProposte> {
  const righe = getDb().prepare(
    `SELECT h.network_id AS rete, COUNT(*) AS totale,
            SUM(CASE WHEN p.stato = 'confermato' AND p.da_rivedere = 0 THEN 1 ELSE 0 END) AS confermate,
            SUM(p.da_rivedere) AS daRivedere
     FROM va_proposte p JOIN hosts h ON h.id = p.host_id GROUP BY h.network_id`,
  ).all() as Array<ContoProposte & { rete: number }>;
  return Object.fromEntries(righe.map(({ rete, ...c }) => [rete, c]));
}

/** L'ultima volta che una riga della rete è cambiata; `null` se la rete non ha proposte. */
export function ultimaProposta(networkId: number): string | null {
  const r = getDb().prepare(
    `SELECT MAX(p.aggiornata_il) AS il FROM va_proposte p JOIN hosts h ON h.id = p.host_id WHERE h.network_id = ?`,
  ).get(networkId) as { il: string | null } | undefined;
  return r?.il ?? null;
}

/**
 * Accetta il tipo nuovo di un host «da rivedere». Riconfermarlo non basterebbe: la famiglia salvata
 * resta quella vecchia e il lancio lo toglierebbe di nuovo. La riga torna `proposto` e la rigenerazione
 * la scrive nella famiglia giusta, dove una persona decide da capo. Conferma vecchia persa di proposito.
 * Si rigenera solo chi si riapre: gli altri host restano come sono. Un host offline non si riapre: la
 * rigenerazione lo salta e resterebbe proposto nella famiglia vecchia.
 */
export function riapriProposte(networkId: number, hostIds: number[]): { riaperte: number } {
  const db = getDb();
  const online = new Set(getHostsByNetwork(networkId).filter((h) => h.status !== "offline").map((h) => h.id));
  const ammessi = new Set(leggiProposte(networkId).filter((r) => r.da_rivedere && online.has(r.host_id)).map((r) => r.host_id));
  const scrivi = db.prepare(
    `UPDATE va_proposte SET stato='proposto', da_rivedere=0, confermata_da=NULL, confermata_il=NULL, aggiornata_il=datetime('now') WHERE host_id=?`,
  );
  const riaperti = new Set(hostIds.filter((id) => ammessi.has(id)));
  db.transaction(() => {
    for (const id of riaperti) scrivi.run(id);
  })();
  if (riaperti.size > 0) rigeneraProposte(networkId, undefined, riaperti);
  return { riaperte: riaperti.size };
}

export interface GruppoLanciato {
  scan_id: number;
  famiglia: Famiglia;
  device: number;
  lanciato_il: string;
  /** Come è finito, una volta saputo: poi la sonda non si interroga più per questo gruppo. */
  chiuso: "finito" | "errore" | null;
  chiuso_messaggio: string | null;
}

/** Oltre questi giorni le righe non servono: né al riquadro né a nessun altro. */
const GIORNI_GRUPPI = 30;
const ORE_RIQUADRO = 72;

/** Ricorda quale scansione è quale gruppo: la sonda non conosce le famiglie. */
export function registraGruppiLanciati(networkId: number, gruppi: Array<Pick<GruppoLanciato, "scan_id" | "famiglia" | "device">>, il: string): void {
  const db = getDb();
  const scrivi = db.prepare(
    `INSERT OR REPLACE INTO va_gruppi_lanciati (network_id, scan_id, famiglia, device, lanciato_il) VALUES (?, ?, ?, ?, ?)`,
  );
  const limite = new Date(new Date(il).getTime() - GIORNI_GRUPPI * 86400000).toISOString();
  db.transaction(() => {
    db.prepare(`DELETE FROM va_gruppi_lanciati WHERE lanciato_il < ?`).run(limite);
    for (const g of gruppi) scrivi.run(networkId, g.scan_id, g.famiglia, g.device, il);
  })();
}

/**
 * I gruppi recenti della rete, di tutti i lanci: «Riprova» è un lancio nuovo e il gruppo di prima può
 * essere ancora in corso, e uno andato in errore deve restare visibile anche quando gli altri chiudono.
 */
export function gruppiRecenti(networkId: number, adesso = new Date()): GruppoLanciato[] {
  const da = new Date(adesso.getTime() - ORE_RIQUADRO * 3600000).toISOString();
  return getDb().prepare(
    `SELECT scan_id, famiglia, device, lanciato_il, chiuso, chiuso_messaggio FROM va_gruppi_lanciati
     WHERE network_id = ? AND lanciato_il >= ? ORDER BY scan_id DESC LIMIT 50`,
  ).all(networkId, da) as GruppoLanciato[];
}

export function segnaGruppiChiusi(networkId: number, chiusi: ReadonlyArray<{ scan_id: number; chiuso: "finito" | "errore"; messaggio: string | null }>): void {
  const db = getDb();
  const scrivi = db.prepare(`UPDATE va_gruppi_lanciati SET chiuso = ?, chiuso_messaggio = ? WHERE network_id = ? AND scan_id = ?`);
  db.transaction(() => {
    for (const c of chiusi) scrivi.run(c.chiuso, c.messaggio, networkId, c.scan_id);
  })();
}

export interface Conferma {
  hostIds: number[];
  stato: "confermato" | "escluso";
  voce?: IdVoce;
  chi: string;
}

/** Una persona conferma o esclude. Un impianto o un host da chiarire non si conferma su un profilo. */
export function confermaProposte(networkId: number, c: Conferma): { aggiornate: number; rifiutate: number[] } {
  const db = getDb();
  const righe = new Map(leggiProposte(networkId).map((r) => [r.host_id, r]));
  const scrivi = db.prepare(
    `UPDATE va_proposte SET stato=?, voce=COALESCE(?, voce), da_rivedere=0, confermata_da=?, confermata_il=datetime('now'),
       aggiornata_il=datetime('now') WHERE host_id=?`,
  );
  const rifiutate: number[] = [];
  let aggiornate = 0;
  db.transaction(() => {
    for (const id of c.hostIds) {
      const r = righe.get(id);
      if (!r) {
        rifiutate.push(id);
        continue;
      }
      if (c.stato === "confermato" && (r.famiglia === "impianti" || (r.voce === null && !c.voce))) {
        rifiutate.push(id);
        continue;
      }
      scrivi.run(c.stato, c.voce ?? null, c.chi, id);
      aggiornate++;
    }
  })();
  return { aggiornate, rifiutate };
}
