import { parseDbDate, FUSO_UTENTI } from "@/lib/db-date";
import { getDashboardStats, getNetworks, getUserCount, getKnownHostStats, getOfflineKnownHosts } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { Network, Shield, Activity, PlugZap } from "lucide-react";
import { StatusOverTimeChart } from "@/components/shared/status-over-time-chart";
import { StatusChangeFeed } from "@/components/shared/status-change-feed";
import { getServerTenantCode } from "@/lib/api-tenant";
import { getTenantDb, withTenant } from "@/lib/db-tenant";
import { kpiSicurezza, type KpiSicurezza } from "@/lib/security/kpi-dashboard";
import { IstogrammaAccessi } from "@/components/dashboard/istogramma-accessi";
import { CardSicurezza } from "@/components/dashboard/card-sicurezza";
import { BarreSubnet, LegendaSubnet } from "@/components/dashboard/barre-subnet";
import { ModuliCompatti } from "@/components/dashboard/moduli-compatti";
import { leggiAccessiIndexer, type SerieAccessi } from "@/lib/security/accessi-indexer";
import { ASSENTE_DOPO_GIORNI, condizioneAssente } from "@/lib/hosts/assenti";
import { contaArchiviatiOTrattino } from "@/lib/hosts/pulizia-archivio";
import { getIntegrationsOverview, type IntegrationHealth } from "@/lib/integrations/dashboard-health";
import { getModulesHealth } from "@/lib/modules/health";
import { MODULE_DESCRIPTORS, resolveModules, type ModuleState } from "@/lib/modules/registry";
import { moduleRowTarget, type DestinazioneRigaModulo } from "@/lib/modules/dashboard-rows";
import { completaRiquadri, tempoFa, type StatoPannelloZabbix } from "@/lib/modules/riquadri-dashboard";
import { STILE_STATO } from "@/components/shared/stile-stato-modulo";
import { dipendenzeReali } from "@/lib/zabbix-lettura/reale";
import { leggiConfigLettura } from "@/lib/zabbix-lettura/config";

/** Riga «Stato moduli»: le righe dei moduli portano anche dove aprono (UI-20). */
type StatoModuloRiga = IntegrationHealth & {
  apre?: DestinazioneRigaModulo["apre"];
  notaStato?: string | null;
  /** false = modulo non installato: fuori dal conteggio errori, icona neutra. */
  contaNegliErrori?: boolean;
};

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  // Redirect to setup if no users exist (hub DB, no tenant context needed)
  const userCount = getUserCount();
  if (userCount === 0) {
    redirect("/setup");
  }

  const tenantCode = await getServerTenantCode();
  const stats = withTenant(tenantCode, () => getDashboardStats());
  const networks = withTenant(tenantCode, () => getNetworks());
  const monitorStats = withTenant(tenantCode, () => getKnownHostStats());
  const offlineKnown = withTenant(tenantCode, () => getOfflineKnownHosts());
  // Stato moduli (registry + health cachato 60s) + riga Active Directory separata
  // (AD non è uno dei 6 moduli base ma resta visibile per non regredire).
  const moduleHealth = await getModulesHealth(tenantCode);
  // Stato dal registry (solo letture locali, niente sonde): decide se la riga
  // apre il modulo o la configurazione (UI-20). Se non si legge, le righe
  // tornano ad aprire la configurazione, come prima, e l'errore va nel log.
  let moduleStates: ModuleState[] = [];
  try {
    // Il ruolo decide il link di LibreNMS (accesso automatico solo admin, T3-26).
    const ruolo = ((await auth())?.user as { role?: string } | undefined)?.role;
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
  const denom = stats.online_hosts + offlineSplit.recenti + stats.unknown_hosts;
  const healthPct = denom > 0 ? Math.round((stats.online_hosts / denom) * 100) : 0;
  const healthColor =
    healthPct >= 90 ? "text-success" :
    healthPct >= 70 ? "text-amber-600" :
    "text-destructive";

  // Dashboard in una schermata, disposizione a tre colonne (Riccardo, 20/10): andamenti a
  // sinistra, operatività al centro, infrastruttura a destra. Le liste scorrono nel riquadro.
  return (
    <div className="flex flex-col gap-2 lg:h-[calc(100dvh-5.5rem)]">
      {/* ── Riga 1: titolo e indicatori ───────────────────────────────── */}
      <div className="flex flex-wrap items-stretch gap-2 shrink-0">
        <h1 className="text-xl font-bold tracking-tight mr-2 self-center">Dashboard</h1>
        <Indicatore titolo="Health" valore={`${healthPct}%`} colore={healthColor} nota={`${stats.online_hosts}/${denom} host online (offline visti negli ultimi ${ASSENTE_DOPO_GIORNI} giorni)`} anello={healthPct} />
        <Indicatore titolo="Subnet" valore={stats.total_networks} href="/networks" />
        <Indicatore titolo="Host" valore={stats.total_hosts} href="/discovery" />
        <Indicatore titolo="Offline" valore={offlineSplit.recenti} colore="text-destructive" href="/discovery?status=offline" nota={`Offline visti negli ultimi ${ASSENTE_DOPO_GIORNI} giorni`} />
        <Indicatore titolo={`Assenti > ${ASSENTE_DOPO_GIORNI} g`} valore={offlineSplit.assenti} colore="text-muted-foreground" href="/discovery?status=offline" nota={`Offline e non visti da oltre ${ASSENTE_DOPO_GIORNI} giorni: fuori dalla salute`} />
        <Indicatore titolo="Archiviati" valore={archiviati} colore="text-muted-foreground" href="/settings?tab=sistema#pulizia-host" nota="Archiviati dalla pulizia: si recuperano per 90 giorni" />
        {monitorStats.total > 0 && (
          <Indicatore titolo="Monitorati" valore={`${monitorStats.online}/${monitorStats.total}`} nota={monitorStats.avg_latency !== null ? `latenza media ${Math.round(monitorStats.avg_latency)} ms` : undefined} href="/monitoring/known-hosts" />
        )}
      </div>

      {/* ── Riga 2: sicurezza, card bianche con striscia (Riccardo, 20/10) ── */}
      <RigaSicurezza k={sicurezza} accessi={accessi} />

      {/* ── Riga 3: tre colonne che riempiono l'altezza che resta ─────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-2 lg:flex-1 lg:min-h-0">
        <div className="flex flex-col gap-2 lg:min-h-0">
          <Card size="sm" className="shrink-0 data-[size=sm]:gap-1">
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Activity className="h-4 w-4 text-primary" />
                Stato host nel tempo
              </CardTitle>
            </CardHeader>
            <CardContent>
              <StatusOverTimeChart altezza={250} />
            </CardContent>
          </Card>
          <Card size="sm" className="lg:flex-1 lg:min-h-0 data-[size=sm]:gap-1">
            <CardHeader>
              <CardTitle className="text-sm flex items-center justify-between gap-2">
                <span className="flex items-center gap-2" title="Fallimenti di autenticazione di Windows e Linux raccolti da Wazuh, esclusi i nostri account e le nostre reti. Microsoft 365 e apparati di rete stanno nella pagina Alert.">
                  <Shield className="h-4 w-4 text-primary" />
                  Accessi falliti
                </span>
                <Link href="/security-alerts" className="text-[13px] font-normal text-primary hover:underline">Alert →</Link>
              </CardTitle>
            </CardHeader>
            <CardContent className="lg:flex-1 lg:min-h-0 flex flex-col">
              <IstogrammaAccessi ore={accessi?.ore ?? null} giorni={accessi?.giorni ?? null} fonte={accessi?.fonte ?? "stima"} motivo={accessi?.motivo} />
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-2 lg:min-h-0">
          <Card size="sm" className="shrink-0 lg:max-h-[45%] lg:min-h-0 data-[size=sm]:gap-1">
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Shield className="h-4 w-4 text-primary" />
                Host conosciuti offline
                {monitorStats.offline > 0 && (
                  <Badge variant="outline" className={`text-[13px] ${STILE_STATO.guasto.classi}`}>{monitorStats.offline}</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="lg:min-h-0 lg:overflow-auto space-y-0.5">
              {monitorStats.total === 0 ? (
                <p className="text-sm text-muted-foreground py-1">
                  Nessun host monitorato. <Link href="/monitoring/known-hosts" className="text-primary hover:underline">Segna gli host da tenere d&apos;occhio →</Link>
                </p>
              ) : offlineKnown.length === 0 ? (
                <p className="text-sm text-muted-foreground py-1">
                  {monitorStats.online === monitorStats.total
                    ? `Tutti i ${monitorStats.total} host monitorati sono online.`
                    : `Nessun host offline; ${monitorStats.total - monitorStats.online} di ${monitorStats.total} in stato sconosciuto.`}
                </p>
              ) : (
                <>
                {offlineKnown.map((h) => (
                  <Link
                    key={h.id}
                    href={`/hosts/${h.id}`}
                    className="grid grid-cols-[9rem_minmax(0,1fr)_auto] items-center gap-2 text-sm hover:bg-destructive/10 rounded px-2 py-1 transition-colors"
                    title="Apri la scheda dell'host"
                  >
                    <span className="font-mono">{h.ip}</span>
                    <span className="text-muted-foreground truncate">{h.custom_name || h.hostname || ""}</span>
                    <span className="text-[13px] text-muted-foreground whitespace-nowrap" title={h.last_seen ? `Visto l'ultima volta: ${parseDbDate(h.last_seen).toLocaleString("it-IT", { timeZone: FUSO_UTENTI })}` : undefined}>
                      {h.last_seen ? `visto ${tempoFa(h.last_seen)}` : "mai visto"}
                    </span>
                  </Link>
                ))}
                {/* La lista si ferma a 20: il conteggio vero sta nel badge, il resto nella pagina. */}
                {monitorStats.offline > offlineKnown.length && (
                  <Link href="/monitoring/known-hosts" className="text-[13px] text-primary hover:underline px-2 pt-1 inline-block">
                    Vedi tutti ({monitorStats.offline}) →
                  </Link>
                )}
                </>
              )}
            </CardContent>
          </Card>
          <Card size="sm" className="lg:flex-1 lg:min-h-0 data-[size=sm]:gap-1">
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Activity className="h-4 w-4 text-primary" />
                Transizioni recenti
              </CardTitle>
            </CardHeader>
            <CardContent className="lg:flex-1 lg:min-h-0 lg:overflow-auto">
              <StatusChangeFeed />
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-2 lg:min-h-0">
          <Card size="sm" className="lg:flex-1 lg:min-h-0 data-[size=sm]:gap-1">
            <CardHeader>
              <CardTitle className="text-sm flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <Network className="h-4 w-4 text-primary" />
                  Subnet
                </span>
                <Link href="/networks" className="text-[13px] font-normal text-primary hover:underline">Vedi tutte →</Link>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0 lg:flex-1 lg:min-h-0 lg:overflow-auto">
              {networks.length === 0 ? (
                <p className="text-sm text-muted-foreground px-4 py-2">
                  Nessuna rete configurata. <Link href="/networks" className="text-primary hover:underline">Aggiungi la prima rete →</Link>
                </p>
              ) : (
                <>
                  <BarreSubnet reti={networks} />
                  <LegendaSubnet />
                </>
              )}
            </CardContent>
          </Card>
          <Card size="sm" className="shrink-0 data-[size=sm]:gap-1">
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <PlugZap className="h-4 w-4 text-primary" />
                Moduli
                {integrationErrors > 0 && (
                  <Badge variant="outline" className={`text-[13px] ${STILE_STATO.guasto.classi}`}>{STILE_STATO.guasto.segno} {integrationErrors} in errore</Badge>
                )}
                {integrationErrors === 0 && integrationWarnings > 0 && (
                  <Badge variant="outline" className={`text-[13px] ${STILE_STATO.attenzione.classi}`}>{STILE_STATO.attenzione.segno} {integrationWarnings} da verificare</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ModuliCompatti riquadri={riquadri} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

const numero = (n: number) => Math.round(n).toLocaleString("it-IT");

/**
 * Riga «Sicurezza» (Riccardo, 20/10): CVE dello Scanner-Edge, accessi falliti e account
 * bloccati da Wazuh, alert da gestire, Health di Active Directory. Una fonte non
 * configurata è grigia, non «zero». Card bianche con la striscia del token e il simbolo.
 */
function RigaSicurezza({ k, accessi }: { k: KpiSicurezza; accessi: SerieAccessi | null }) {
  const a = k.accessi;
  const falliti = accessi?.totale24h ?? 0;
  const prima = accessi?.totale24hPrima ?? 0;
  const freccia = accessi?.tendenza === "su" ? " ↑" : accessi?.tendenza === "giu" ? " ↓" : "";
  return (
    <div className="grid gap-2 grid-cols-2 md:grid-cols-3 xl:grid-cols-6 shrink-0">
      {k.cve ? (
        <>
          <CardSicurezza tono={k.cve.critiche.cve > 0 ? "guasto" : "ok"} titolo="Vulnerabilità critiche" valore={numero(k.cve.critiche.cve)} nota={`su ${k.cve.critiche.host} host`} href="/vulnerabilities"
            title={`Scanner-Edge: vulnerabilità distinte di gravità Critical (CVE, o NVT quando manca la CVE) e host colpiti${k.cve.ultimaScansione ? ` · ultima scansione ${parseDbDate(k.cve.ultimaScansione).toLocaleString("it-IT", { timeZone: FUSO_UTENTI })}` : ""}`} />
          <CardSicurezza tono={k.cve.alte.cve > 0 ? "attenzione" : "ok"} titolo="Vulnerabilità alte" valore={numero(k.cve.alte.cve)} nota={`su ${k.cve.alte.host} host`} href="/vulnerabilities" title="Scanner-Edge: vulnerabilità distinte di gravità High e host colpiti" />
        </>
      ) : (
        <CardSicurezza tono="grigio" titolo="Vulnerabilità" valore="Scanner-Edge non configurato" href="/settings/moduli/edge" />
      )}
      {a && accessi ? (
        <>
          <CardSicurezza
            tono={falliti === 0 ? "ok" : falliti > 100 && falliti > prima * 2 ? "guasto" : "attenzione"}
            titolo="Accessi falliti 24h" valore={`${numero(falliti)}${freccia}`} nota={`le 24 ore prima: ${numero(prima)}${accessi.fonte === "stima" ? " · stima" : ""}`} href="/security-alerts"
            title={accessi.fonte === "indexer"
              ? "Fallimenti di autenticazione di Windows e Linux dall'indexer di Wazuh nelle ultime 24 ore, esclusi i nostri account e le nostre reti. La freccia confronta le 24 ore piene con le 24 prima."
              : `${accessi.motivo ? `${accessi.motivo[0].toUpperCase()}${accessi.motivo.slice(1)}: ` : ""}eventi 4625 stimati, ogni gruppo d'allarme è ripartito sul periodo in cui è rimasto aperto.`} />
          <CardSicurezza tono={a.bloccati30g > 0 ? "attenzione" : "ok"} titolo="Account bloccati 30g" valore={numero(a.bloccati30g)} href="/security-alerts" title="Eventi 4740 da Wazuh negli ultimi 30 giorni" />
          <CardSicurezza tono={a.daGestire > 0 ? "attenzione" : "ok"} titolo="Alert da gestire" valore={numero(a.daGestire)} href="/security-alerts" title="Alert di Wazuh non ancora presi in carico" />
        </>
      ) : (
        <CardSicurezza tono="grigio" titolo="Accessi e alert" valore="Wazuh non configurato" href="/settings/moduli/wazuh" />
      )}
      {k.healthAd ? (
        <CardSicurezza
          tono={k.healthAd.critici > 0 ? "guasto" : k.healthAd.alti > 0 || k.healthAd.giorni > 7 || k.healthAd.ultimoFallito ? "attenzione" : "ok"}
          titolo="Health AD" valore={`${k.healthAd.critici} critici · ${k.healthAd.alti} alti`}
          nota={`${k.healthAd.giorni === 0 ? "oggi" : `${k.healthAd.giorni} g fa`}${k.healthAd.ultimoFallito ? " · ultimo tentativo fallito" : ""}`}
          href="/active-directory?tab=health" title={`Ultima Health riuscita, punteggio globale ${k.healthAd.punteggio ?? "—"}. Oltre 7 giorni è da rifare.${k.healthAd.ultimoFallito ? " L'ultimo tentativo è fallito." : ""}`} />
      ) : (
        <CardSicurezza tono="grigio" titolo="Health AD" valore="mai eseguita" href="/active-directory?tab=health" />
      )}
    </div>
  );
}

/** Indicatore della prima riga: card bassa, etichetta sopra e valore grande; Health con l'anello. */
function Indicatore({ titolo, valore, colore = "text-foreground", nota, href, anello }: {
  titolo: string;
  valore: number | string;
  colore?: string;
  nota?: string;
  href?: string;
  anello?: number;
}) {
  const corpo = (
    <span className="flex h-full items-center gap-2 rounded-md border bg-card px-3 py-1 hover:border-primary/40 transition-colors" title={nota}>
      {anello !== undefined && <Anello pct={anello} colore={colore} />}
      <span className="flex flex-col leading-tight">
        <span className="text-[13px] text-muted-foreground">{titolo}</span>
        <span className={`text-xl font-bold leading-none ${colore}`}>{valore}</span>
      </span>
    </span>
  );
  return href ? <Link href={href}>{corpo}</Link> : corpo;
}

/** Anello della Health: la parte piena nel colore della soglia, il resto grigio. */
function Anello({ pct, colore }: { pct: number; colore: string }) {
  const r = 14;
  const c = 2 * Math.PI * r;
  return (
    <svg width="36" height="36" viewBox="0 0 36 36" aria-hidden className={colore}>
      <circle cx="18" cy="18" r={r} fill="none" stroke="currentColor" strokeOpacity="0.18" strokeWidth="5" />
      <circle cx="18" cy="18" r={r} fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round"
        strokeDasharray={`${(Math.max(0, Math.min(100, pct)) / 100) * c} ${c}`} transform="rotate(-90 18 18)" />
    </svg>
  );
}
