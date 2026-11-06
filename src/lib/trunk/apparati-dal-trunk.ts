/**
 * Dagli annunci CDP/LLDP sentiti sul trunk agli host (06/11/2026).
 *
 * Al 72729 due Cisco SG200-26 con SNMP spento stavano `unknown` e senza modello mentre si annunciavano
 * ogni 60 secondi: il sensore buttava piattaforma e versione e `trunk_vicini` non lo leggeva nessuno
 * tranne le regole dei rilievi. Qui modello e firmware si riempiono, **mai sovrascrivono** (come i profili,
 * `scanner/profili/salva.ts`); la categoria la decide l'attribuzione, che rispetta `classification_manual`.
 */
import type Database from "better-sqlite3";
import { getCurrentTenantCode, getTenantDb } from "@/lib/db-tenant";
import { SISTEMA_OPERATIVO, type Annuncio } from "@/lib/attribution/annunci";
import { categoriaDaAnnuncio, CONFIDENZA_ANNUNCIO } from "@/lib/attribution/emitters";
import { recomputeAttributionForDb } from "@/lib/attribution/recompute";
import { propagaAllApparato, segnaDaRivedere } from "@/lib/scanner/profili/propaga-apparato";
import type { FattiProfilo } from "@/lib/scanner/profili/tipi";

const TETTO_TESTO = 120;

export interface EsitoApparati {
  hostToccati: number;
  campiRiempiti: number;
}

type RigaAnnuncio = Annuncio & { host_id: number; versione: string | null };

/** La descrizione di un Linux con `lldpd` non è un modello, la prima riga della versione IOS è una versione. */
function fattiDaAnnuncio(r: RigaAnnuncio): Pick<FattiProfilo, "modello" | "firmware"> {
  const fatti: Pick<FattiProfilo, "modello" | "firmware"> = {};
  const piattaforma = r.piattaforma?.trim();
  if (piattaforma && !SISTEMA_OPERATIVO.test(piattaforma)) fatti.modello = piattaforma.slice(0, TETTO_TESTO);
  const versione = r.versione?.split("\n").map((x) => x.trim()).find(Boolean);
  if (versione) fatti.firmware = versione.slice(0, TETTO_TESTO);
  return fatti;
}

/** Solo le evidenze degli annunci: quelle dal nome del vicino (0.7) hanno la stessa fonte, e `expires_at` è ISO con T e Z. */
function haEvidenzaDiAnnuncio(d: Database.Database, hostId: number): boolean {
  return !!d.prepare(
    `SELECT 1 FROM attribution_evidence WHERE host_id = ? AND source IN ('cdp', 'lldp')
     AND dimension = 'category' AND confidence >= ?
     AND (expires_at IS NULL OR expires_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) LIMIT 1`,
  ).get(hostId, CONFIDENZA_ANNUNCIO);
}

/** Va dopo `salvaVicini`. Gira ogni 2 minuti: il ricalcolo parte solo quando c'è qualcosa di nuovo. */
export function portaApparatiDalTrunk(): EsitoApparati {
  const d = getTenantDb(getCurrentTenantCode() ?? "DEFAULT");
  const righe = d.prepare(
    `SELECT host_id, protocollo, piattaforma, versione, capacita FROM trunk_vicini
     WHERE host_id IS NOT NULL AND (piattaforma IS NOT NULL OR capacita IS NOT NULL)
     ORDER BY ultima_vista DESC`,
  ).all() as RigaAnnuncio[];

  const riempi = (colonna: "model" | "firmware") => d.prepare(
    `UPDATE hosts SET ${colonna} = ?, updated_at = datetime('now')
     WHERE id = ? AND (${colonna} IS NULL OR TRIM(${colonna}) = '')`,
  );
  const riempiModello = riempi("model");
  const riempiFirmware = riempi("firmware");

  const esito: EsitoApparati = { hostToccati: 0, campiRiempiti: 0 };
  const visti = new Set<number>();
  for (const r of righe) {
    if (visti.has(r.host_id)) continue;   // uno switch si annuncia su ogni porta: basta una riga
    visti.add(r.host_id);
    esito.hostToccati++;

    const fatti = fattiDaAnnuncio(r);
    const riempite: string[] = [];
    if (fatti.modello && riempiModello.run(fatti.modello, r.host_id).changes > 0) riempite.push("model");
    if (fatti.firmware && riempiFirmware.run(fatti.firmware, r.host_id).changes > 0) riempite.push("firmware");
    esito.campiRiempiti += riempite.length;

    if (riempite.length > 0) {
      try {
        segnaDaRivedere(d, "hosts", r.host_id, riempite);
        propagaAllApparato(d, r.host_id, fatti);
      } catch (e) {
        console.error(`[trunk] host ${r.host_id}: segno «da rivedere» o apparato non aggiornati:`, e);
      }
    }
    if (riempite.length > 0 || (categoriaDaAnnuncio(r) && !haEvidenzaDiAnnuncio(d, r.host_id))) {
      recomputeAttributionForDb(d, r.host_id, "scan");
    }
  }
  return esito;
}
