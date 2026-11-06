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

export function rigeneraProposte(networkId: number, adesso = new Date().toISOString()): { scritte: number; daRivedere: number } {
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
