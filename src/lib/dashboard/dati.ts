/**
 * I dati dei widget della Dashboard, fuori dalla pagina (Riccardo, 12/11/2026: «i widget completi, semplicemente
 * filtrati»): la Dashboard e la casa di /cliente leggono da qui, così un numero ha un conto solo. Il codice è quello
 * che stava in `src/app/(dashboard)/page.tsx`, spostato senza cambiarlo.
 */
import { getDashboardStats, getNetworks, getKnownHostStats, getOfflineKnownHosts } from "@/lib/db";
import { getTenantDb, withTenant } from "@/lib/db-tenant";
import { barreReteDiSerie } from "@/lib/rilievi/barre-di-serie";
import type { BarraRete } from "@/lib/rilievi/gruppi";
import { kpiSicurezza, type KpiSicurezza } from "@/lib/security/kpi-dashboard";
import { leggiAccessiIndexer, type SerieAccessi } from "@/lib/security/accessi-indexer";
import { condizioneAssente } from "@/lib/hosts/assenti";
import { contaArchiviatiOTrattino } from "@/lib/hosts/pulizia-archivio";
import { getIntegrationsOverview, type IntegrationHealth } from "@/lib/integrations/dashboard-health";
import { getModulesHealth } from "@/lib/modules/health";
import { MODULE_DESCRIPTORS, resolveModules, type ModuleState } from "@/lib/modules/registry";
import { moduleRowTarget, type DestinazioneRigaModulo } from "@/lib/modules/dashboard-rows";
import { completaRiquadri, type StatoPannelloZabbix } from "@/lib/modules/riquadri-dashboard";
import { dipendenzeReali } from "@/lib/zabbix-lettura/reale";
import { leggiConfigLettura } from "@/lib/zabbix-lettura/config";

export type StatoModuloRiga = IntegrationHealth & {
  apre?: DestinazioneRigaModulo["apre"];
  notaStato?: string | null;
  /** false = modulo non installato: fuori dal conteggio errori, icona neutra. */
  contaNegliErrori?: boolean;
};

/** I riquadri dei moduli e il conto di quelli in errore. `ruolo` decide il link di LibreNMS (T3-26). */
export async function moduliDashboard(tenantCode: string, ruolo: string | undefined) {
  // Stato moduli (registry + health cachato 60s) + riga Active Directory separata
  // (AD non è uno dei 6 moduli base ma resta visibile per non regredire).
  const moduleHealth = await getModulesHealth(tenantCode);
  // Stato dal registry (solo letture locali, niente sonde): decide se la riga
  // apre il modulo o la configurazione (UI-20). Se non si legge, le righe
  // tornano ad aprire la configurazione, come prima, e l'errore va nel log.
  let moduleStates: ModuleState[] = [];
  // Il ruolo decide il link di LibreNMS (accesso automatico solo admin, T3-26)
  // e il collegamento «Vista cliente» accanto al titolo.
  try {
    moduleStates = await withTenant(tenantCode, () => resolveModules(tenantCode, ruolo));
  } catch (e) {
    console.error("[dashboard] stato dei moduli non leggibile:", e);
  }
  const moduleRows: StatoModuloRiga[] = moduleHealth.map((h) => {
    const d = MODULE_DESCRIPTORS.find((m) => m.key === h.key);
    const target = moduleRowTarget(
      d,
      moduleStates.find((m) => m.key === h.key),
      h,
    );
    return {
      key: h.key,
      label: d?.label ?? h.key,
      status: h.status === "unknown" ? "stale" : h.status,
      // La colonna timestamp = "ultima verifica" del modulo. Solo il probe `edge`
      // espone un last_sync_at reale; gli altri probe sono live ma senza timestamp
      // di data-sync → senza fallback un modulo CONNESSO mostrava "Mai eseguita"
      // (l'utente lo leggeva come "non sincronizzato"). Fallback al `probedAt`
      // (istante dell'health-check) per i moduli configurati. I moduli non
      // attivi mostrano al posto dell'ora la nota di moduleRowTarget
      // («Modulo non attivo», UI-20), non più «Mai eseguita».
      lastSync: h.lastSync ?? (h.status === "never" ? null : h.probedAt),
      message: h.message,
      href: target.href,
      apre: target.apre,
      notaStato: target.notaStato,
      contaNegliErrori: target.contaNegliErrori,
      abilitato: moduleStates.find((m) => m.key === h.key)?.enabled,
    };
  });
  const adRows = withTenant(tenantCode, () => getIntegrationsOverview()).filter((i) =>
    i.key.startsWith("ad_"),
  );
  const integrations: StatoModuloRiga[] = [...moduleRows, ...adRows];
  // Riquadri (Riccardo, 20/10): tutti i moduli possibili, i non configurati in grigio.
  let zabbix: StatoPannelloZabbix | null = null;
  try {
    zabbix = withTenant(tenantCode, () => {
      const d = dipendenzeReali();
      return d.acquistato() ? leggiConfigLettura(d.db) : null;
    });
  } catch (e) {
    console.error("[dashboard] pannello Zabbix non leggibile:", e);
  }
  const riquadri = completaRiquadri(
    integrations,
    MODULE_DESCRIPTORS.map((d) => ({ ...d, enabled: moduleStates.find((m) => m.key === d.key)?.enabled === true })),
    { zabbix },
  );
  // Un modulo non installato non conta: la sua sonda può fallire (MeshCentral
  // disinstallato tiene i parametri di collegamento) senza che sia un guasto.
  const contate = integrations.filter((i) => i.contaNegliErrori !== false);
  const integrationErrors = contate.filter((i) => i.status === "error").length;
  const integrationWarnings = contate.filter(
    (i) => i.status === "warning" || i.status === "stale",
  ).length;


  return { riquadri, integrationErrors, integrationWarnings, moduleStates };
}

/** Indicatori, sicurezza, accessi, reti e cose da sistemare. `moduleStates` dice quali fonti sono configurate. */
export async function datiDashboard(tenantCode: string, moduleStates: ModuleState[]) {
  const stats = withTenant(tenantCode, () => getDashboardStats());
  const networks = withTenant(tenantCode, () => getNetworks());
  const monitorStats = withTenant(tenantCode, () => getKnownHostStats());
  const offlineKnown = withTenant(tenantCode, () => getOfflineKnownHosts());
  // KPI di sicurezza (Riccardo, 20/10): solo letture del DB del cliente.
  let sicurezza: KpiSicurezza = { cve: null, accessi: null, healthAd: null };
  try {
    sicurezza = withTenant(tenantCode, () => kpiSicurezza(getTenantDb(tenantCode)));
  } catch (e) {
    console.error("[dashboard] KPI di sicurezza non leggibili:", e);
  }
  // Le tabelle esistono sempre (schema e job di pulizia): «non configurato» lo dice il
  // catalogo dei moduli, non la presenza della tabella (revisione del 20/10).
  const configurato = (k: string) => moduleStates.find((m) => m.key === k)?.configured === true;
  if (!configurato("edge")) sicurezza = { ...sicurezza, cve: null };
  if (!configurato("wazuh")) sicurezza = { ...sicurezza, accessi: null };
  // Accessi falliti (Riccardo, 20/10): i conteggi veri dell'indexer; senza indexer la stima.
  const lettura = sicurezza.accessi ? await leggiAccessiIndexer(tenantCode) : null;
  const stimati = sicurezza.accessi;
  const accessi: SerieAccessi | null = lettura?.serie ?? (stimati
    ? {
        fonte: "stima",
        motivo: lettura?.motivo ?? undefined,
        ore: stimati.serie24h.map((o) => ({ ora: o.ora, falliti: o.falliti })),
        giorni: stimati.serie.map((g) => ({ giorno: g.giorno, falliti: g.falliti })),
        // Lo stesso totale del grafico (le 24 ore ora per ora), non un secondo calcolo.
        totale24h: stimati.serie24h.reduce((n, o) => n + o.falliti, 0),
        totale24hPrima: stimati.falliti24hPrima,
        tendenza: stimati.falliti24h > stimati.falliti24hPrima ? "su" : stimati.falliti24h < stimati.falliti24hPrima ? "giu" : "pari",
      }
    : null);

  // Indicatori: Health%, totali, subnet, monitorati.
  // Offline = visti negli ultimi 7 giorni; gli «assenti» a parte, fuori dalla salute, come
  // nel grafico (Riccardo, 20/10: in alto 51%, nel grafico 98%).
  const offlineSplit = withTenant(tenantCode, () =>
    getTenantDb(tenantCode)
      .prepare(`SELECT COALESCE(SUM(status = 'offline' AND NOT ${condizioneAssente()}), 0) AS recenti, COALESCE(SUM(${condizioneAssente()}), 0) AS assenti FROM hosts`)
      .get() as { recenti: number; assenti: number },
  );
  // «—» se l'archivio non si legge: l'indicatore non fa cadere la dashboard (m11, revisione finale).
  const archiviati = withTenant(tenantCode, () => contaArchiviatiOTrattino());
  // Stesso conto della pagina Findings (11/11/2026): barre e tessere «critiche/alte» vengono da qui.
  let barreRete: BarraRete[] | null = null;
  try {
    barreRete = withTenant(tenantCode, () => barreReteDiSerie());
  } catch {
    barreRete = null;
  }
  const rilieviRete = (barreRete ?? []).slice(0, 6);
  const daSistemare = barreRete
    ? { critiche: barreRete.reduce((n, b) => n + b.critical, 0), alte: barreRete.reduce((n, b) => n + b.high, 0), reti: barreRete.length }
    : null;
  const denom = stats.online_hosts + offlineSplit.recenti + stats.unknown_hosts;
  const healthPct = denom > 0 ? Math.round((stats.online_hosts / denom) * 100) : 0;
  const healthColor =
    healthPct >= 90 ? "text-success" :
    healthPct >= 70 ? "text-amber-600" :
    "text-destructive";

  return { stats, networks, monitorStats, offlineKnown, sicurezza, accessi, offlineSplit, archiviati, rilieviRete, daSistemare, denom, healthPct, healthColor };
}

export type DatiDashboard = Awaited<ReturnType<typeof datiDashboard>>;
