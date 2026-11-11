/**
 * I giri lanciati a mano da `/scans` si scrivono qui finché girano, così un riavvio del servizio
 * non li perde: al riavvio ripartono da capo, una volta sola (Riccardo, 10/11/2026: «prima
 * dell'aggiornamento le attività dovrebbero essere messe in pausa e riprese al riavvio»; quella
 * sera quattro Discovery erano morte col riavvio di un aggiornamento).
 *
 * Freni, perché un riavvio non deve diventare un motivo per bussare di nuovo agli host (lo stesso
 * giorno una ventina di riavvii aveva fatto rifare le prove sui DC): un giro si rilancia una sola
 * volta, solo se ha meno di due ore, e senza le prove invasive, che restano una scelta fatta a mano.
 * Solo Discovery e Solo controlli: Segmentazione e Sonda L2 non si rilanciano.
 */
import { getTenantSetting, setTenantSetting, withTenant } from "@/lib/db-tenant";
import { getScanProgress } from "@/lib/scanner/discovery";

export const CHIAVE_GIRI_DA_RILANCIARE = "scans.giri_da_rilanciare";
export const ETA_MASSIMA_MS = 2 * 60 * 60_000;
const CONTROLLO_MS = 5_000;

export interface GiroSalvato {
  id: string;
  corpo: Record<string, unknown>;
  lanciato_il: string;
  /** Quante volte è già ripartito dopo un riavvio. */
  rilanci: number;
}

export function leggiSalvati(grezzo: string | null | undefined): GiroSalvato[] {
  if (!grezzo) return [];
  try {
    const v: unknown = JSON.parse(grezzo);
    if (!Array.isArray(v)) return [];
    return v.filter(
      (x): x is GiroSalvato =>
        !!x && typeof x === "object" && typeof (x as GiroSalvato).id === "string" && typeof (x as GiroSalvato).lanciato_il === "string"
        && !!(x as GiroSalvato).corpo && typeof (x as GiroSalvato).corpo === "object" && Number.isInteger((x as GiroSalvato).rilanci),
    );
  } catch {
    return [];
  }
}

/** Quali giri rimasti a metà ripartono: mai rilanciati prima, e abbastanza recenti. */
export function daRilanciare(voci: readonly GiroSalvato[], adesso: number = Date.now()): GiroSalvato[] {
  return voci.filter((v) => {
    const t = Date.parse(v.lanciato_il);
    return v.rilanci === 0 && !Number.isNaN(t) && adesso - t >= 0 && adesso - t < ETA_MASSIMA_MS;
  });
}

/** Il corpo con cui un giro riparte: uguale, ma senza prove invasive. */
export function corpoPerRilancio(corpo: Record<string, unknown>): Record<string, unknown> {
  const { prove_fabbrica: _tolta, ...resto } = corpo;
  void _tolta;
  return resto;
}

export function eRilanciabile(tipo: unknown): boolean {
  return tipo === "discovery" || tipo === "controlli";
}

function scrivi(voci: GiroSalvato[]): void {
  setTenantSetting(CHIAVE_GIRI_DA_RILANCIARE, JSON.stringify(voci.slice(-20)));
}

/**
 * Scrive il giro e lo toglie quando tutti i suoi job hanno smesso di girare. Va chiamata dentro
 * il contesto del tenant; il controllo periodico lo riapre da sé.
 */
export function salvaGiroInCorso(tenant: string, corpo: Record<string, unknown>, jobIds: readonly string[], rilanci: number): void {
  if (jobIds.length === 0) return;
  const voce: GiroSalvato = { id: `${Date.now()}-${jobIds[0]}`, corpo, lanciato_il: new Date().toISOString(), rilanci };
  scrivi([...leggiSalvati(getTenantSetting(CHIAVE_GIRI_DA_RILANCIARE)), voce]);
  const timer = setInterval(() => {
    if (jobIds.some((id) => getScanProgress(id)?.status === "running")) return;
    clearInterval(timer);
    try {
      withTenant(tenant, () => scrivi(leggiSalvati(getTenantSetting(CHIAVE_GIRI_DA_RILANCIARE)).filter((v) => v.id !== voce.id)));
    } catch (e) {
      console.error(`[scans] giro salvato non tolto per ${tenant}:`, e instanceof Error ? e.message : "errore");
    }
  }, CONTROLLO_MS);
  if (typeof (timer as { unref?: () => void }).unref === "function") (timer as { unref: () => void }).unref();
}
