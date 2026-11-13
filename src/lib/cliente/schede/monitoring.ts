/**
 * La scheda «DATIA MONITORING» della vista cliente: lo stato degli apparati dai dati di
 * Zabbix, letti dal centro con la chiave di sola lettura (13/11/2026).
 *
 * Attiva solo con il pannello Zabbix acquistato, configurato e acceso: senza, la scheda
 * non c'è e non parte nessuna richiesta. La logica sta in `../monitoring.ts`, la lettura
 * in `zabbix-lettura/servizio.ts` (stessa attesa crescente e stesse cache del pannello).
 *
 * `db-tenant` si importa solo staticamente (regola 14, ADR 0002).
 */
import { withTenant } from "@/lib/db-tenant";
import { dipendenzeReali } from "@/lib/zabbix-lettura/reale";
import { leggiMonitoringCentro, pannelloNelMenu } from "@/lib/zabbix-lettura/servizio";
import type { ContestoCliente } from "../contesto";
import { componiMonitoring, type Monitoring } from "../monitoring";
import { leggiImpostazioniMonitoring } from "../monitoring-impostazioni";
import type { RiquadroCliente, SchedaCliente, VoceAttenzione } from "../registro";

export const TITOLO_MONITORING = "DATIA MONITORING";
const HREF = "/cliente/monitoring";
const MASSIMO_VOCI = 3;

export type EsitoMonitoring =
  | { ok: true; dati: Monitoring }
  /** Il centro non si legge: il testo è già quello da mostrare. */
  | { ok: false; messaggio: string; ultimaLetturaOk: string | null };

/** La lettura per la pagina e per la casa. Mai un'eccezione verso chi disegna. */
export async function leggiMonitoring(c: ContestoCliente): Promise<EsitoMonitoring> {
  return withTenant(c.tenantCode, async () => {
    const dip = dipendenzeReali();
    const l = await leggiMonitoringCentro(dip);
    if (l.stato === "fermo") {
      return {
        ok: false as const,
        messaggio: l.pannello.stato === "guasto" ? "Il centro di controllo non risponde: gli stati non sono disponibili." : l.pannello.messaggio,
        ultimaLetturaOk: l.pannello.stato === "guasto" ? l.pannello.ultimaLetturaOk : null,
      };
    }
    return {
      ok: true as const,
      dati: componiMonitoring({
        famiglie: l.famiglie,
        impostazioni: leggiImpostazioniMonitoring(dip.db),
        problemi: l.centro.problemi.problemi,
        problemiTroncati: l.centro.problemi.troncati,
        storico: l.storico,
        etaS: l.centro.etaS,
        vecchio: l.centro.vecchio,
        lettoAlle: l.centro.cliente.letto_alle ?? null,
      }),
    };
  });
}

function attiva(c: ContestoCliente): boolean {
  return withTenant(c.tenantCode, () => pannelloNelMenu(dipendenzeReali()));
}

async function riquadro(c: ContestoCliente): Promise<RiquadroCliente> {
  const m = await leggiMonitoring(c);
  if (!m.ok) return { numero: "–", contesto: "stato non disponibile", stato: "attenzione", aperti: 0 };
  const t = m.dati.totali;
  const tutti = t.funziona + t.attenzione + t.fermo + t.non_so;
  return {
    numero: String(t.funziona),
    unita: `di ${tutti}`,
    contesto: t.fermo > 0 ? `${t.fermo} fermi` : t.attenzione > 0 ? `${t.attenzione} da tenere d'occhio` : t.non_so > 0 ? `di ${t.non_so} non so` : "apparati che funzionano",
    stato: t.fermo > 0 ? "grave" : t.attenzione > 0 || t.non_so > 0 ? "attenzione" : "a_posto",
    aperti: t.fermo + t.attenzione,
  };
}

async function attenzione(c: ContestoCliente): Promise<VoceAttenzione[]> {
  const m = await leggiMonitoring(c);
  if (!m.ok) return [];
  const voci: VoceAttenzione[] = [];
  for (const f of m.dati.famiglie) {
    for (const o of f.oggetti) {
      if (o.stato !== "fermo") continue;
      voci.push({ gravita: "grave", testo: `${f.etichetta} · ${o.nome} non risponde`, href: HREF, scheda: TITOLO_MONITORING });
    }
  }
  return voci.slice(0, MASSIMO_VOCI);
}

export const schedaMonitoring: SchedaCliente = {
  id: "monitoring",
  titolo: TITOLO_MONITORING,
  ordine: 15,
  icona: "Activity",
  attiva,
  riquadro,
  attenzione,
};
