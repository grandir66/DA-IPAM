/**
 * Una sola pianificazione per rete (Riccardo, 08/11/2026, tavola oggetto 29): «Per device» e «Un profilo solo»
 * si escludono. Qui si descrive quella «Un profilo solo» della rete e la si toglie dalla sonda; la sonda è la
 * fonte vera (cron o finestra), la riga di `edge_scan_schedules` ne è il ricordo.
 */
import { getEdgeSchedule, deleteEdgeSchedule, dimenticaEdgeFinestra, type EdgeScheduleConfig } from "@/lib/vuln/edge-schedule-store";
import { removeEdgeSubnetFinestra, removeEdgeSubnetSchedule } from "@/lib/vuln/edge-subnet-bridge";
import { describeCron } from "@/lib/vuln/cron-builder";
import { profiloRegistro } from "@/lib/vuln/scansioni-va-regole";

const GIORNI = ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"];

/** In una frase, per l'avviso. `null` = la rete non ha una pianificazione «Un profilo solo» accesa. Pura. */
export function descriviUnProfilo(s: EdgeScheduleConfig | null): string | null {
  if (!s) return null;
  if (s.modo === "finestra") {
    if (!s.fascia_attiva) return null;
    const giorni = (s.fascia_giorni ?? "").split(",").filter(Boolean).map((g) => GIORNI[Number(g)]?.slice(0, 3)).filter(Boolean).join(", ");
    return `a finestra, dalle ${s.fascia_dalle ?? "?"} alle ${s.fascia_alle ?? "?"}${giorni ? ` (${giorni})` : ""}`;
  }
  if (!s.enabled || !s.frequency || !s.at_time) return s?.enabled ? `${s.profile ? profiloRegistro(s.profile) : "profilo della rete"}, pianificata` : null;
  const frequenza = (["daily", "weekly", "monthly"] as const).find((f) => f === s.frequency);
  if (!frequenza) return `${s.profile ? profiloRegistro(s.profile) : "profilo della rete"}, pianificata`;
  const quando = describeCron({
    frequency: frequenza,
    at: s.at_time,
    daysOfWeek: (s.days_of_week ?? "").split(",").filter(Boolean).map(Number),
    dayOfMonth: s.day_of_month ?? undefined,
  });
  return `${s.profile ? profiloRegistro(s.profile) : "profilo della rete"}, ${quando.charAt(0).toLowerCase()}${quando.slice(1)}`;
}

export function pianificazioneUnProfilo(networkId: number): string | null {
  return descriviUnProfilo(getEdgeSchedule(networkId));
}

/** Toglie dalla sonda la pianificazione «Un profilo solo» della rete. Se la sonda non risponde non si finge. */
export async function togliUnProfilo(networkId: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const s = getEdgeSchedule(networkId);
  if (!descriviUnProfilo(s)) return { ok: true };
  if (s!.modo === "finestra") {
    const r = await removeEdgeSubnetFinestra(networkId);
    if (!r.ok) return { ok: false, error: r.error ?? "finestra non tolta dalla sonda" };
    dimenticaEdgeFinestra(networkId);
    return { ok: true };
  }
  const r = await removeEdgeSubnetSchedule(networkId);
  if (!r.ok) return { ok: false, error: r.error ?? "pianificazione non tolta dalla sonda" };
  deleteEdgeSchedule(networkId);
  return { ok: true };
}
