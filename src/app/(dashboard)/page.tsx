import { getDashboardStats, getNetworks, getRecentActivity, getUserCount, getKnownHostStats, getOfflineKnownHosts } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Network, Monitor, Wifi, WifiOff, HelpCircle, Shield, AlertTriangle, Activity, TrendingUp, PlugZap, CheckCircle2, XCircle, Clock } from "lucide-react";
import { StatusOverTimeChart } from "@/components/shared/status-over-time-chart";
import { StatusChangeFeed } from "@/components/shared/status-change-feed";
import { getServerTenantCode } from "@/lib/api-tenant";
import { withTenant } from "@/lib/db-tenant";
import { getIntegrationsOverview, type IntegrationHealth } from "@/lib/integrations/dashboard-health";
import { getModulesHealth } from "@/lib/modules/health";
import { MODULE_DESCRIPTORS } from "@/lib/modules/registry";

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
  const recentActivity = withTenant(tenantCode, () => getRecentActivity(8));
  const monitorStats = withTenant(tenantCode, () => getKnownHostStats());
  const offlineKnown = withTenant(tenantCode, () => getOfflineKnownHosts());
  // Stato moduli (registry + health cachato 60s) + riga Active Directory separata
  // (AD non è uno dei 6 moduli base ma resta visibile per non regredire).
  const moduleHealth = await getModulesHealth(tenantCode);
  const moduleRows: IntegrationHealth[] = moduleHealth.map((h) => {
    const d = MODULE_DESCRIPTORS.find((m) => m.key === h.key);
    return {
      key: h.key,
      label: d?.label ?? h.key,
      status: h.status === "unknown" ? "stale" : h.status,
      // La colonna timestamp = "ultima verifica" del modulo. Solo il probe `edge`
      // espone un last_sync_at reale; gli altri probe sono live ma senza timestamp
      // di data-sync → senza fallback un modulo CONNESSO mostrava "Mai eseguita"
      // (l'utente lo leggeva come "non sincronizzato"). Fallback al `probedAt`
      // (istante dell'health-check) per i moduli configurati; i moduli non
      // configurati (status "never") restano senza timestamp → "Mai eseguita".
      lastSync: h.lastSync ?? (h.status === "never" ? null : h.probedAt),
      message: h.message,
      href: d?.configHref ?? "/settings?tab=moduli",
    };
  });
  const adRows = withTenant(tenantCode, () => getIntegrationsOverview()).filter((i) =>
    i.key.startsWith("ad_"),
  );
  const integrations: IntegrationHealth[] = [...moduleRows, ...adRows];
  const integrationErrors = integrations.filter((i) => i.status === "error").length;
  const integrationWarnings = integrations.filter(
    (i) => i.status === "warning" || i.status === "stale",
  ).length;

  // KPI hero: Health%, totali, subnet, monitorati offline come allerta
  const denom = stats.online_hosts + stats.offline_hosts + stats.unknown_hosts;
  const healthPct = denom > 0 ? Math.round((stats.online_hosts / denom) * 100) : 0;
  const healthColor =
    healthPct >= 90 ? "text-success" :
    healthPct >= 70 ? "text-amber-500" :
    "text-destructive";

  return (
    <div className="space-y-4">
      {/* ── Header ────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Panoramica del sistema IPAM</p>
        </div>
      </div>

      {/* ── Hero KPI: Health grande + 4 contatori ────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-2">
        <Card className="lg:col-span-2 bg-gradient-to-br from-primary/5 via-card to-card border-primary/20">
          <CardContent className="py-5 px-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Health</p>
                <p className={`text-5xl font-bold ${healthColor} leading-tight`}>{healthPct}<span className="text-2xl">%</span></p>
                <p className="text-xs text-muted-foreground mt-1">
                  {stats.online_hosts}/{denom} host online ora
                </p>
              </div>
              <div className={`${healthColor} opacity-30`}>
                <TrendingUp className="h-12 w-12" />
              </div>
            </div>
          </CardContent>
        </Card>

        <KpiCard title="Subnet" value={stats.total_networks} icon={<Network className="h-4 w-4" />} color="text-primary" href="/networks" />
        <KpiCard title="Host Totali" value={stats.total_hosts} icon={<Monitor className="h-4 w-4" />} color="text-foreground" href="/discovery" />
        <KpiCard title="Offline" value={stats.offline_hosts} icon={<WifiOff className="h-4 w-4" />} color="text-destructive" href="/discovery?status=offline" />
      </div>

      {/* ── Chart stato nel tempo + Change feed (2 colonne) ─────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-2">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              Stato host nel tempo
            </CardTitle>
          </CardHeader>
          <CardContent>
            <StatusOverTimeChart />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              Transizioni recenti
            </CardTitle>
          </CardHeader>
          <CardContent>
            <StatusChangeFeed />
          </CardContent>
        </Card>
      </div>

      {/* ── Monitoring + alert host offline ───────────────────────────── */}
      {monitorStats.total > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Shield className="h-4 w-4 text-primary" />
              Monitoraggio attivo
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
              <span className="inline-flex items-center gap-1.5">
                <Monitor className="h-4 w-4 text-muted-foreground" />
                <span className="font-bold">{monitorStats.total}</span>
                <span className="text-muted-foreground">monitorati</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Wifi className="h-4 w-4 text-success" />
                <span className="text-success font-medium">{monitorStats.online} online</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <WifiOff className="h-4 w-4 text-destructive" />
                <span className="text-destructive font-medium">{monitorStats.offline} offline</span>
              </span>
              {monitorStats.avg_latency !== null && (
                <span className="inline-flex items-center gap-1.5">
                  <Activity className="h-4 w-4 text-primary" />
                  <span>Latenza media: <span className="font-mono font-medium">{Math.round(monitorStats.avg_latency)}ms</span></span>
                </span>
              )}
            </div>

            {offlineKnown.length > 0 && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                  <span className="text-sm font-medium text-destructive">
                    {offlineKnown.length} host conosciut{offlineKnown.length === 1 ? "o" : "i"} offline
                  </span>
                </div>
                <div className="space-y-0.5">
                  {offlineKnown.slice(0, 8).map((h) => (
                    <Link
                      key={h.id}
                      href={`/hosts/${h.id}`}
                      className="flex items-center justify-between text-sm hover:bg-destructive/10 rounded px-2 py-1 transition-colors"
                    >
                      <span>
                        <span className="font-mono">{h.ip}</span>
                        {(h.custom_name || h.hostname) && (
                          <span className="text-muted-foreground ml-2">
                            ({h.custom_name || h.hostname})
                          </span>
                        )}
                      </span>
                      {h.last_seen && (
                        <span className="text-xs text-muted-foreground">
                          Ultimo contatto: {new Date(h.last_seen).toLocaleString("it-IT")}
                        </span>
                      )}
                    </Link>
                  ))}
                  {offlineKnown.length > 8 && (
                    <Link href="/monitoring/known-hosts" className="text-xs text-primary hover:underline px-2 pt-1 inline-block">
                      Vedi tutti ({offlineKnown.length}) →
                    </Link>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Stato moduli ─────────────────────────────────────────────── */}
      {integrations.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <PlugZap className="h-4 w-4 text-primary" />
              Stato Moduli
              {integrationErrors > 0 && (
                <Badge variant="destructive" className="ml-1 text-xs">
                  {integrationErrors} in errore
                </Badge>
              )}
              {integrationErrors === 0 && integrationWarnings > 0 && (
                <Badge variant="outline" className="ml-1 text-xs border-amber-500/60 text-amber-700 dark:text-amber-400">
                  {integrationWarnings} da verificare
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {integrations.map((it) => (
              <IntegrationRow key={it.key} item={it} />
            ))}
          </CardContent>
        </Card>
      )}

      {/* ── Subnet grid compatta ──────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Network className="h-4 w-4 text-primary" />
            Subnet
          </h2>
          <Link href="/networks" className="text-sm text-primary hover:underline">
            Vedi tutte →
          </Link>
        </div>
        {networks.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center">
              <Network className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
              <p className="text-muted-foreground text-sm">Nessuna rete configurata</p>
              <Link href="/networks" className="text-primary hover:underline text-sm mt-2 inline-block">
                Aggiungi la prima rete →
              </Link>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              <div className="divide-y divide-border">
                {networks.map((net) => {
                  const pctOnline = net.total_hosts > 0 ? (net.online_count / net.total_hosts) * 100 : 0;
                  const pctOffline = net.total_hosts > 0 ? (net.offline_count / net.total_hosts) * 100 : 0;
                  const pctUnknown = net.total_hosts > 0 ? (net.unknown_count / net.total_hosts) * 100 : 0;
                  return (
                    <Link
                      key={net.id}
                      href={`/networks/${net.id}`}
                      className="flex items-center gap-3 px-3 py-1.5 text-sm hover:bg-muted/50 transition-colors group"
                    >
                      <span className="font-medium truncate w-32 sm:w-44 shrink-0 group-hover:text-primary" title={net.name}>
                        {net.name}
                      </span>
                      <span className="font-mono text-[11px] text-muted-foreground w-28 shrink-0 truncate" title={net.cidr}>
                        {net.cidr}
                      </span>
                      <div className="flex h-1.5 rounded-full overflow-hidden bg-muted flex-1 min-w-[80px] max-w-xs">
                        {pctOnline > 0 && <div className="bg-success" style={{ width: `${pctOnline}%` }} />}
                        {pctOffline > 0 && <div className="bg-destructive" style={{ width: `${pctOffline}%` }} />}
                        {pctUnknown > 0 && <div className="bg-muted-foreground/40" style={{ width: `${pctUnknown}%` }} />}
                      </div>
                      <span className="font-mono text-[11px] tabular-nums w-32 sm:w-40 text-right shrink-0">
                        <span className="text-success">{net.online_count}</span>
                        <span className="text-muted-foreground/40 mx-0.5">/</span>
                        <span className="text-destructive">{net.offline_count}</span>
                        <span className="text-muted-foreground/40 mx-0.5">/</span>
                        <span className="text-muted-foreground">{net.unknown_count}</span>
                        <span className="text-muted-foreground ml-2">({net.total_hosts})</span>
                      </span>
                      {net.last_scan && (
                        <span className="hidden md:inline text-[11px] text-muted-foreground whitespace-nowrap w-24 text-right shrink-0">
                          {new Date(net.last_scan).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* ── Recent scan activity ──────────────────────────────────────── */}
      {recentActivity.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <HelpCircle className="h-4 w-4 text-muted-foreground" />
              Attività scan recente
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {recentActivity.map((activity) => (
                <div key={activity.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                  <Badge variant="outline" className="text-xs shrink-0">
                    {activity.scan_type}
                  </Badge>
                  <span className="text-muted-foreground text-xs">
                    {activity.status}
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {new Date(activity.timestamp).toLocaleString("it-IT")}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function KpiCard({ title, value, icon, color, href }: {
  title: string;
  value: number;
  icon: React.ReactNode;
  color: string;
  href?: string;
}) {
  const card = (
    <Card size="sm" className="hover:border-primary/40 transition-colors h-full">
      <CardContent className="py-4 px-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">{title}</p>
            <p className={`text-3xl font-bold ${color} leading-tight mt-0.5`}>{value}</p>
          </div>
          <div className={`${color} opacity-50`}>{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
  return href ? <Link href={href}>{card}</Link> : card;
}

function IntegrationRow({ item }: { item: IntegrationHealth }) {
  const icon =
    item.status === "ok" ? <CheckCircle2 className="h-4 w-4 text-success" /> :
    item.status === "error" ? <XCircle className="h-4 w-4 text-destructive" /> :
    item.status === "warning" ? <AlertTriangle className="h-4 w-4 text-amber-500" /> :
    item.status === "stale" ? <Clock className="h-4 w-4 text-amber-500" /> :
    <HelpCircle className="h-4 w-4 text-muted-foreground" />;
  const lastSyncLabel = item.lastSync
    ? new Date(item.lastSync).toLocaleString("it-IT")
    : "Mai eseguita";
  return (
    <Link
      href={item.href}
      className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 hover:bg-muted/50 transition-colors"
    >
      <span className="flex items-center gap-2 min-w-0">
        {icon}
        <span className="text-sm font-medium truncate">{item.label}</span>
        {item.message && (
          <span className="text-xs text-muted-foreground truncate hidden sm:inline">
            — {item.message}
          </span>
        )}
      </span>
      <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
        {lastSyncLabel}
      </span>
    </Link>
  );
}
