import type Database from "better-sqlite3";
import { recordEvidence } from "./evidence";
import { mapLegacyClassification } from "./taxonomy";

/**
 * La scelta a mano della classe arriva al motore (11/11/2026, hub 533).
 *
 * Chi sceglie una classe a mano scrive `hosts.classification` e `classification_manual = 1`,
 * da più punti (scheda host, modifica in blocco, «rendi apparato»). Il motore non lo sapeva:
 * 106 scelte a mano sul cliente 70791 e nessuna evidenza `manual`. Così `attr_category` diceva
 * una cosa e la classe un'altra (un telefono scelto «smartphone» restava «macchina virtuale»
 * per chi legge `attr_category`, come la vista cliente).
 *
 * Qui, a ogni ricalcolo, la scelta a mano diventa un'evidenza `manual` di categoria, e torna
 * indietro quando la scelta viene tolta. Un punto solo, invece di inseguire chi scrive la classe.
 */

/** Segna le evidenze nate dalla scelta a mano della classe: solo queste si ritirano da qui. */
export const SEGNO_SCELTA_A_MANO = "classificazione a mano";

interface RigaHost { classification: string | null; classification_manual: number | null }
interface RigaEvidenza { id: number; claim: string }

/** Le evidenze `manual` di categoria nate da qui e ancora vive. */
function nostreVive(dbh: Database.Database, hostId: number, nowIso: string): RigaEvidenza[] {
  return dbh.prepare(
    `SELECT id, claim FROM attribution_evidence
     WHERE host_id = ? AND source = 'manual' AND dimension = 'category' AND raw_value = ?
       AND superseded_by IS NULL AND (expires_at IS NULL OR expires_at > ?)`
  ).all(hostId, SEGNO_SCELTA_A_MANO, nowIso) as RigaEvidenza[];
}

/**
 * Allinea l'evidenza `manual` di categoria alla scelta a mano della classe.
 * Rende cosa ha fatto: «scritta», «ritirata» o «niente».
 */
export function allineaSceltaAMano(
  dbh: Database.Database,
  hostId: number,
  nowIso: string = new Date().toISOString()
): "scritta" | "ritirata" | "niente" {
  const host = dbh.prepare("SELECT classification, classification_manual FROM hosts WHERE id = ?")
    .get(hostId) as RigaHost | undefined;
  if (!host) return "niente";
  const vive = nostreVive(dbh, hostId, nowIso);
  const categoria = (host.classification_manual ?? 0) === 1 && host.classification
    ? mapLegacyClassification(host.classification).category
    : null;

  if (!categoria) {
    if (vive.length === 0) return "niente";
    const ritira = dbh.prepare("UPDATE attribution_evidence SET expires_at = ? WHERE id = ?");
    for (const e of vive) ritira.run(nowIso, e.id);
    return "ritirata";
  }
  if (vive.length === 1 && vive[0].claim === categoria) return "niente";
  recordEvidence(dbh, hostId, [{
    source: "manual", phase: "manual", dimension: "category", claim: categoria,
    confidence: 1, raw_value: SEGNO_SCELTA_A_MANO,
  }]);
  return "scritta";
}
