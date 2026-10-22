/**
 * Riquadri «Stato moduli» della dashboard (Riccardo, 20/10): un riquadro piccolo per
 * applicativo con nome, ultimo aggiornamento e stato. Tutti i moduli possibili: quelli
 * senza riga (senza sonda, non installati) e il pannello Zabbix o Active Directory non
 * configurati compaiono in grigio. Modulo puro.
 */
import { parseDbDate } from "@/lib/db-date";
import type { IntegrationHealth } from "@/lib/integrations/dashboard-health";

export type StatoRiquadro = "ok" | "attenzione" | "guasto" | "da_verificare" | "non_configurato";

export type RigaRiquadro = IntegrationHealth & {
  /** false = modulo non installato o non configurato: grigio, fuori dai conteggi. */
  contaNegliErrori?: boolean;
  notaStato?: string | null;
  /** Interruttore del modulo dal catalogo: installato ma spento = grigio come in Impostazioni (revisione 20/10). */
  abilitato?: boolean;
};

/** Il pannello Zabbix come lo legge la dashboard: esito delle letture, non solo l'interruttore. */
export interface StatoPannelloZabbix {
  enabled: boolean;
  fallimenti: number;
  ultimoErrore: string | null;
  ultimaLetturaOk: string | null;
}

export function statoRiquadro(r: RigaRiquadro): StatoRiquadro {
  if (r.contaNegliErrori === false) return "non_configurato";
  if (r.abilitato === false && r.status === "never") return "non_configurato";
  if (r.status === "error") return "guasto";
  if (r.status === "warning" || r.status === "stale") return "attenzione";
  if (r.status === "ok") return "ok";
  return "da_verificare";
}

/** Le righe dei moduli più quelli del catalogo che non ne hanno una, Zabbix e AD in fondo. */
export function completaRiquadri(
  righe: readonly RigaRiquadro[],
  catalogo: readonly { key: string; label: string; configHref: string; enabled?: boolean }[],
  pannelli: { zabbix: StatoPannelloZabbix | null },
): RigaRiquadro[] {
  const eAd = (k: string) => k === "ad" || k.startsWith("ad_");
  const moduli = righe.filter((r) => !eAd(r.key));
  const ad = righe.filter((r) => eAd(r.key));
  const grigio = (key: string, label: string, href: string): RigaRiquadro => ({
    key, label, status: "never", lastSync: null, message: "Non configurato", href, contaNegliErrori: false,
  });
  // Acceso ma senza sonda di salute (es. Inventario NIS2): «da verificare», non grigio.
  const mancanti = catalogo.filter((d) => !moduli.some((r) => r.key === d.key)).map((d): RigaRiquadro =>
    d.enabled
      ? { key: d.key, label: d.label, status: "never", lastSync: null, message: "Acceso, senza controllo di salute", href: d.configHref }
      : grigio(d.key, d.label, d.configHref));
  const z = pannelli.zabbix;
  const zabbix: RigaRiquadro = z?.enabled
    ? {
        key: "zabbix", label: "Zabbix", href: "/zabbix",
        // Tre letture fallite di fila = guasto; meno = attenzione; mai riuscita = da verificare.
        status: z.fallimenti >= 3 ? "error" : z.fallimenti > 0 ? "warning" : z.ultimaLetturaOk ? "ok" : "never",
        lastSync: z.ultimaLetturaOk,
        message: z.ultimoErrore ?? "Pannello in sola lettura",
      }
    : grigio("zabbix", "Zabbix", "/settings/moduli/zabbix");
  return [
    ...moduli,
    ...mancanti,
    zabbix,
    ...(ad.length > 0 ? ad : [grigio("ad", "Active Directory", "/active-directory")]),
  ];
}

/** «3 min fa», «2 h fa», «4 g fa»; null se non c'è un'ora. */
export function tempoFa(quando: string | null, ora: Date = new Date()): string | null {
  if (!quando) return null;
  const t = parseDbDate(quando).getTime();
  if (Number.isNaN(t)) return null;
  const min = Math.floor((ora.getTime() - t) / 60_000);
  if (min < 1) return "adesso";
  if (min < 60) return `${min} min fa`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h fa`;
  return `${Math.floor(h / 24)} g fa`;
}
