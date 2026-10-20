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
import { GraficoAccessi } from "@/components/dashboard/grafico-accessi";
import { getIntegrationsOverview, type IntegrationHealth } from "@/lib/integrations/dashboard-health";
import { getModulesHealth } from "@/lib/modules/health";
import { MODULE_DESCRIPTORS, resolveModules, type ModuleState } from "@/lib/modules/registry";
import { moduleRowTarget, type DestinazioneRigaModulo } from "@/lib/modules/dashboard-rows";
import { completaRiquadri, statoRiquadro, tempoFa, type RigaRiquadro, type StatoPannelloZabbix, type StatoRiquadro } from "@/lib/modules/riquadri-dashboard";
import { STILE_STATO, type ToniStato } from "@/components/shared/stile-stato-modulo";
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

  // KPI hero: Health%, totali, subnet, monitorati offline come allerta
  const denom = stats.online_hosts + stats.offline_hosts + stats.unknown_hosts;
  const healthPct = denom > 0 ? Math.round((stats.online_hosts / denom) * 100) : 0;
  const healthColor =
    healthPct >= 90 ? "text-success" :
    healthPct >= 70 ? "text-amber-500" :
    "text-destructive";

  // Dashboard in una schermata (Riccardo, 20/10): tre righe a tutta altezza su schermo
  // largo; le liste lunghe scorrono dentro il loro riquadro, la pagina no.
  return (
    <div className="flex flex-col gap-2 lg:h-[calc(100dvh-5.5rem)]">
      {/* ── Riga 1: titolo e indicatori ───────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 shrink-0">
        <h1 className="text-xl font-bold tracking-tight mr-2">Dashboard</h1>
        <Indicatore titolo="Health" valore={`${healthPct}%`} colore={healthColor} nota={`${stats.online_hosts}/${denom} host online`} />
        <Indicatore titolo="Subnet" valore={stats.total_networks} href="/networks" />
        <Indicatore titolo="Host" valore={stats.total_hosts} href="/discovery" />
        <Indicatore titolo="Offline" valore={stats.offline_hosts} colore="text-destructive" href="/discovery?status=offline" />
        {monitorStats.total > 0 && (
          <Indicatore titolo="Monitorati" valore={`${monitorStats.online}/${monitorStats.total}`} nota={monitorStats.avg_latency !== null ? `latenza media ${Math.round(monitorStats.avg_latency)} ms` : undefined} href="/monitoring/known-hosts" />
        )}
      </div>

      {/* ── Riga 1b: sicurezza (Riccardo, 20/10) ─────────────────────── */}
      <RigaSicurezza k={sicurezza} />

      {/* ── Riga 2: stato moduli a riquadri ───────────────────────────── */}
      <div className="shrink-0">
        <div className="flex items-center gap-2 mb-1">
          <PlugZap className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Stato moduli</span>
          {integrationErrors > 0 && (
            <Badge variant="outline" className={`text-xs ${STILE_STATO.guasto.classi}`}>{integrationErrors} in errore</Badge>
          )}
          {integrationErrors === 0 && integrationWarnings > 0 && (
            <Badge variant="outline" className={`text-xs ${STILE_STATO.attenzione.classi}`}>{integrationWarnings} da verificare</Badge>
          )}
        </div>
        <div className="grid gap-1.5 grid-cols-[repeat(auto-fill,minmax(150px,1fr))]">
          {riquadri.map((r) => (
            <RiquadroModulo key={r.key} item={r} />
          ))}
        </div>
      </div>

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
              <StatusOverTimeChart altezza={170} />
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

        <Card size="sm" className="lg:min-h-0 data-[size=sm]:gap-1">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Shield className="h-4 w-4 text-primary" />
              Host conosciuti offline
              {monitorStats.offline > 0 && (
                <Badge variant="outline" className={`text-xs ${STILE_STATO.guasto.classi}`}>{monitorStats.offline}</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="lg:flex-1 lg:min-h-0 lg:overflow-auto space-y-0.5">
            {monitorStats.total === 0 ? (
              <p className="text-sm text-muted-foreground py-2">
                Nessun host monitorato. <Link href="/monitoring/known-hosts" className="text-primary hover:underline">Segna gli host da tenere d&apos;occhio →</Link>
              </p>
            ) : offlineKnown.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">
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
                  className="flex items-center justify-between gap-2 text-sm hover:bg-destructive/10 rounded px-2 py-1 transition-colors"
                >
                  <span className="min-w-0 truncate">
                    <span className="font-mono">{h.ip}</span>
                    {(h.custom_name || h.hostname) && (
                      <span className="text-muted-foreground ml-2">{h.custom_name || h.hostname}</span>
                    )}
                  </span>
                  {h.last_seen && (
                    <span className="text-xs text-muted-foreground whitespace-nowrap" title={parseDbDate(h.last_seen).toLocaleString("it-IT", { timeZone: FUSO_UTENTI })}>
                      {tempoFa(h.last_seen)}
                    </span>
                  )}
                </Link>
              ))}
              {/* La lista si ferma a 20: il conteggio vero sta nel badge, il resto nella pagina. */}
              {monitorStats.offline > offlineKnown.length && (
                <Link href="/monitoring/known-hosts" className="text-xs text-primary hover:underline px-2 pt-1 inline-block">
                  Vedi tutti ({monitorStats.offline}) →
                </Link>
              )}
              </>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-2 lg:min-h-0">
          <Card size="sm" className="lg:flex-[3] lg:min-h-0 data-[size=sm]:gap-1">
            <CardHeader>
              <CardTitle className="text-sm flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <Network className="h-4 w-4 text-primary" />
                  Subnet
                </span>
                <Link href="/networks" className="text-xs font-normal text-primary hover:underline">Vedi tutte →</Link>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0 lg:flex-1 lg:min-h-0 lg:overflow-auto">
              {networks.length === 0 ? (
                <p className="text-sm text-muted-foreground px-4 py-2">
                  Nessuna rete configurata. <Link href="/networks" className="text-primary hover:underline">Aggiungi la prima rete →</Link>
                </p>
              ) : (
                <div className="divide-y divide-border">
                  {networks.map((net) => {
                    const pctOnline = net.total_hosts > 0 ? (net.online_count / net.total_hosts) * 100 : 0;
                    const pctOffline = net.total_hosts > 0 ? (net.offline_count / net.total_hosts) * 100 : 0;
                    const pctUnknown = net.total_hosts > 0 ? (net.unknown_count / net.total_hosts) * 100 : 0;
                    return (
                      <Link
                        key={net.id}
                        href={`/networks/${net.id}`}
                        className="flex items-center gap-2 px-3 py-1 text-sm hover:bg-muted/50 transition-colors group"
                        title={`${net.cidr} · ${net.online_count} online / ${net.offline_count} offline / ${net.unknown_count} sconosciuti${net.last_scan ? ` · ultima scansione ${parseDbDate(net.last_scan).toLocaleString("it-IT", { timeZone: FUSO_UTENTI })}` : ""}`}
                      >
                        <span className="font-medium truncate w-32 shrink-0 group-hover:text-primary">{net.name}</span>
                        <div className="flex h-1.5 rounded-full overflow-hidden bg-muted flex-1 min-w-[60px]">
                          {pctOnline > 0 && <div className="bg-success" style={{ width: `${pctOnline}%` }} />}
                          {pctOffline > 0 && <div className="bg-destructive" style={{ width: `${pctOffline}%` }} />}
                          {pctUnknown > 0 && <div className="bg-muted-foreground/40" style={{ width: `${pctUnknown}%` }} />}
                        </div>
                        <span className="font-mono text-[11px] tabular-nums text-right shrink-0">
                          <span className="text-success">{net.online_count}</span>
                          <span className="text-muted-foreground/40 mx-0.5">/</span>
                          <span className="text-destructive">{net.offline_count}</span>
                          <span className="text-muted-foreground ml-1">({net.total_hosts})</span>
                        </span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
          <Card size="sm" className="lg:flex-[2] lg:min-h-0 data-[size=sm]:gap-1">
            <CardHeader>
              <CardTitle className="text-sm flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <Shield className="h-4 w-4 text-primary" />
                  Accessi falliti
                </span>
                <Link href="/security-alerts" className="text-xs font-normal text-primary hover:underline">Alert →</Link>
              </CardTitle>
            </CardHeader>
            <CardContent className="lg:flex-1 lg:min-h-0 flex flex-col">
              <GraficoAccessi ore={sicurezza.accessi?.serie24h ?? null} giorni={sicurezza.accessi?.serie ?? null} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

const numero = (n: number) => n.toLocaleString("it-IT");

/** Un indicatore di sicurezza: tono dal valore, con simbolo (Riccardo è daltonico). */
function ChipSicurezza({ tono, etichetta, valore, href, title }: { tono: ToniStato; etichetta: string; valore: string; href: string; title?: string }) {
  const st = STILE_STATO[tono];
  return (
    <Link href={href} title={title} className={`inline-flex items-baseline gap-1.5 rounded-md border px-2 py-1 text-[13px] leading-tight hover:opacity-90 ${st.classi}`}>
      <span aria-hidden className="font-bold">{st.segno}</span>
      <span>{etichetta}</span>
      <span className="font-bold">{valore}</span>
    </Link>
  );
}

/**
 * Riga «Sicurezza» (Riccardo, 20/10): CVE dello Scanner-Edge, accessi falliti e account
 * bloccati dagli alert di Wazuh, alert da gestire, Health di Active Directory. Una fonte
 * non configurata è grigia, non «zero».
 */
function RigaSicurezza({ k }: { k: KpiSicurezza }) {
  const a = k.accessi;
  const freccia = a ? (a.falliti24h > a.falliti24hPrima ? " ↑" : a.falliti24h < a.falliti24hPrima ? " ↓" : "") : "";
  return (
    <div className="flex flex-wrap items-center gap-1.5 shrink-0">
      <span className="text-sm font-semibold mr-1 flex items-center gap-1.5">
        <Shield className="h-4 w-4 text-primary" />
        Sicurezza
      </span>
      {k.cve ? (
        <>
          <ChipSicurezza tono={k.cve.critiche.cve > 0 ? "guasto" : "ok"} etichetta="Vulnerabilità critiche" valore={`${k.cve.critiche.cve} · ${k.cve.critiche.host} host`} href="/vulnerabilities"
            title={`Scanner-Edge: vulnerabilità distinte di gravità Critical (CVE, o NVT quando manca la CVE) e host colpiti${k.cve.ultimaScansione ? ` · ultima scansione ${parseDbDate(k.cve.ultimaScansione).toLocaleString("it-IT", { timeZone: FUSO_UTENTI })}` : ""}`} />
          <ChipSicurezza tono={k.cve.alte.cve > 0 ? "attenzione" : "ok"} etichetta="Vulnerabilità alte" valore={`${k.cve.alte.cve} · ${k.cve.alte.host} host`} href="/vulnerabilities" title="Scanner-Edge: vulnerabilità distinte di gravità High e host colpiti" />
        </>
      ) : (
        <ChipSicurezza tono="grigio" etichetta="Vulnerabilità" valore="Scanner-Edge non configurato" href="/settings/moduli/edge" />
      )}
      {a ? (
        <>
          <ChipSicurezza
            tono={a.falliti24h === 0 ? "ok" : a.falliti24h > 100 && a.falliti24h > a.falliti24hPrima * 2 ? "guasto" : "attenzione"}
            etichetta="Accessi falliti 24h" valore={`${numero(a.falliti24h)}${freccia}`} href="/security-alerts"
            title={`Eventi 4625 da Wazuh nelle ultime 24 ore (le 24 prima: ${numero(a.falliti24hPrima)}). Approssimato: ogni gruppo d'allarme è ripartito sul periodo in cui è rimasto aperto.`} />
          <ChipSicurezza tono={a.bloccati30g > 0 ? "attenzione" : "ok"} etichetta="Account bloccati 30g" valore={numero(a.bloccati30g)} href="/security-alerts" title="Eventi 4740 da Wazuh negli ultimi 30 giorni" />
          <ChipSicurezza tono={a.daGestire > 0 ? "attenzione" : "ok"} etichetta="Alert da gestire" valore={numero(a.daGestire)} href="/security-alerts" title="Alert di Wazuh non ancora presi in carico" />
        </>
      ) : (
        <ChipSicurezza tono="grigio" etichetta="Accessi e alert" valore="Wazuh non configurato" href="/settings/moduli/wazuh" />
      )}
      {k.healthAd ? (
        <ChipSicurezza
          tono={k.healthAd.critici > 0 ? "guasto" : k.healthAd.alti > 0 || k.healthAd.giorni > 7 || k.healthAd.ultimoFallito ? "attenzione" : "ok"}
          etichetta="Health AD" valore={`${k.healthAd.critici} critici · ${k.healthAd.alti} alti · ${k.healthAd.giorni === 0 ? "oggi" : `${k.healthAd.giorni} g fa`}${k.healthAd.ultimoFallito ? " · ultimo tentativo fallito" : ""}`}
          href="/active-directory?tab=health" title={`Ultima Health riuscita, punteggio globale ${k.healthAd.punteggio ?? "—"}. Oltre 7 giorni è da rifare.${k.healthAd.ultimoFallito ? " L'ultimo tentativo è fallito." : ""}`} />
      ) : (
        <ChipSicurezza tono="grigio" etichetta="Health AD" valore="mai eseguita" href="/active-directory?tab=health" />
      )}
    </div>
  );
}

/** Indicatore compatto della prima riga (al posto dei riquadri KPI alti). */
function Indicatore({ titolo, valore, colore = "text-foreground", nota, href }: {
  titolo: string;
  valore: number | string;
  colore?: string;
  nota?: string;
  href?: string;
}) {
  const corpo = (
    <span className="inline-flex items-baseline gap-1.5 rounded-md border bg-card px-2.5 py-1 hover:border-primary/40 transition-colors" title={nota}>
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">{titolo}</span>
      <span className={`text-lg font-bold leading-none ${colore}`}>{valore}</span>
    </span>
  );
  return href ? <Link href={href}>{corpo}</Link> : corpo;
}

const TONO: Record<StatoRiquadro, ToniStato> = {
  ok: "ok", attenzione: "attenzione", guasto: "guasto", da_verificare: "da_verificare", non_configurato: "grigio",
};

/** Un riquadro piccolo per applicativo: nome, ultimo aggiornamento, stato dal colore (con simbolo). */
function RiquadroModulo({ item }: { item: RigaRiquadro & { apre?: DestinazioneRigaModulo["apre"] } }) {
  const stato = statoRiquadro(item);
  const st = STILE_STATO[TONO[stato]];
  const quando =
    stato === "non_configurato" ? "non configurato"
      : item.notaStato ?? tempoFa(item.lastSync) ?? "mai verificato";
  // Di un modulo non installato non si mostra l'esito della sonda (UI-20).
  const dettaglio = [item.label, item.contaNegliErrori !== false ? item.message : null, item.lastSync ? `Ultimo aggiornamento: ${parseDbDate(item.lastSync).toLocaleString("it-IT", { timeZone: FUSO_UTENTI })}` : null, item.apre ? TITOLO_APRE[item.apre] : null]
    .filter(Boolean).join("\n");
  return (
    <Link href={item.href} title={dettaglio} className={`rounded-md border px-2 py-1 leading-tight hover:opacity-90 transition-opacity ${st.classi}`}>
      <span className="flex items-center gap-1 text-[13px] font-semibold truncate">
        <span aria-hidden className="font-bold">{st.segno}</span>
        <span className="truncate">{item.label}</span>
      </span>
      <span className="block text-[12px] opacity-90 truncate">{quando}</span>
    </Link>
  );
}

const TITOLO_APRE: Record<DestinazioneRigaModulo["apre"], string> = {
  modulo: "Apri il modulo",
  pagina_modulo: "Apri la pagina del modulo",
  configurazione: "Apri la configurazione del modulo",
};
