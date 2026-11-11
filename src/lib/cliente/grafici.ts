/**
 * I dati dei grafici della casa della vista cliente (Riccardo, 11/11/2026: «qualcosa di più estetico
 * e che fa colpo, preso dalla dashboard iniziale, senza dover aprire i singoli moduli»).
 *
 * Sono le stesse fonti della Dashboard dell'amministratore, lette dal server: il grafico degli host
 * della Dashboard chiede i dati a `/api/status/chart-detailed`, che al Cliente è vietata dal recinto.
 * Ogni grafico c'è solo se la sua scheda è attiva; una lettura che fallisce toglie quel grafico e basta.
 */
import type Database from "better-sqlite3";
import { getStatusOverTime } from "@/lib/db";
import { withTenant } from "@/lib/db-tenant";
import { condizioneAssente } from "@/lib/hosts/assenti";
import { kpiSicurezza } from "@/lib/security/kpi-dashboard";
import type { StatusPoint } from "@/lib/status-over-time";
import { moduloAttivo, nelCliente, type ContestoCliente } from "./contesto";
import { daSistemare } from "./schede/da-sistemare";
import { statoDominio } from "./schede/dominio";

export const ORE_GRAFICO_ACCESI = 48;
const GIORNI_ACCESSI = 7;
const MASSIMO_RETI = 8;

export interface PuntoAccesi { t: string; accesi: number }
export interface ReteGrafico { id: number; nome: string; accesi: number; spenti: number; totale: number }

export interface GraficiCasa {
  accesi: { punti: PuntoAccesi[]; adesso: number; minimo: number; massimo: number } | null;
  reti: ReteGrafico[];
  rischio: { punteggio: number; gravi: number } | null;
  accessi: { giorni: Array<{ giorno: string; falliti: number }>; ultime24: number } | null;
  perRete: Array<{ nome: string; gravi: number; alte: number }>;
}

/** Pura: dai punti dello stato host alla serie degli accesi. Meno di due punti → niente grafico. */
export function serieAccesi(punti: readonly Pick<StatusPoint, "time" | "online">[]): GraficiCasa["accesi"] {
  if (punti.length < 2) return null;
  const serie = punti.map((p) => ({ t: p.time, accesi: p.online }));
  const valori = serie.map((p) => p.accesi);
  return {
    punti: serie,
    adesso: valori[valori.length - 1] ?? 0,
    minimo: Math.min(...valori),
    massimo: Math.max(...valori),
  };
}

/** Accesi e spenti da poco per rete; gli assenti (oltre 7 giorni) non contano. Le reti vuote si saltano. */
export function retiPerGrafico(db: Database.Database): ReteGrafico[] {
  const righe = db.prepare(`
    SELECT n.id, n.name AS nome,
      (SELECT COUNT(*) FROM hosts h WHERE h.network_id = n.id AND h.status = 'online') AS accesi,
      (SELECT COUNT(*) FROM hosts h WHERE h.network_id = n.id AND h.status <> 'online' AND NOT ${condizioneAssente("h")}) AS spenti
    FROM networks n
  `).all() as Array<{ id: number; nome: string; accesi: number; spenti: number }>;
  return righe
    .map((r) => ({ ...r, totale: r.accesi + r.spenti }))
    .filter((r) => r.totale > 0)
    .sort((a, b) => b.totale - a.totale || a.nome.localeCompare(b.nome, "it"))
    .slice(0, MASSIMO_RETI);
}

function prova<T>(cosa: string, fn: () => T, ripiego: T): T {
  try {
    return fn();
  } catch (e) {
    console.error(`[cliente] grafico ${cosa}:`, e instanceof Error ? e.message : String(e));
    return ripiego;
  }
}

/** Tutti i grafici della casa. `attive` sono gli id delle schede attive. */
export function graficiCasa(c: ContestoCliente, attive: ReadonlySet<string>): GraficiCasa {
  const accesi = prova("accesi", () => serieAccesi(withTenant(c.tenantCode, () => getStatusOverTime(ORE_GRAFICO_ACCESI))), null);
  const reti = prova("reti", () => nelCliente(c, (db) => retiPerGrafico(db)), []);
  const rischio = attive.has("dominio")
    ? prova("rischio", () => {
        const stato = nelCliente(c, (db) => statoDominio(db));
        return stato?.punteggio == null ? null : { punteggio: stato.punteggio, gravi: stato.graviTotali };
      }, null)
    : null;
  const accessi = moduloAttivo(c, "siem")
    ? prova("accessi", () => {
        const a = nelCliente(c, (db) => kpiSicurezza(db)).accessi;
        if (!a) return null;
        return { giorni: a.serie.slice(-GIORNI_ACCESSI).map((g) => ({ giorno: g.giorno, falliti: g.falliti })), ultime24: a.falliti24h };
      }, null)
    : null;
  const perRete = attive.has("da-sistemare") ? prova("per rete", () => daSistemare(c).perRete.slice(0, MASSIMO_RETI), []) : [];
  return { accesi, reti, rischio, accessi, perRete };
}
