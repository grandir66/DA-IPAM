import { getDashboardStats, getNetworks, getRecentActivity, getUserCount, getKnownHostStats, getOfflineKnownHosts } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Network, Monitor, Wifi, WifiOff, HelpCircle, Shield, AlertTriangle, Activity, TrendingUp } from "lucide-react";
import { StatusOverTimeChart } from "@/components/shared/status-over-time-chart";
import { StatusChangeFeed } from "@/components/shared/status-change-feed";
import { getServerTenantCode } from "@/lib/api-tenant";
import { withTenant } from "@/lib/db-tenant";

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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
            {networks.map((net) => (
              <Link key={net.id} href={`/networks/${net.id}`}>
                <Card className="hover:shadow-md hover:border-primary/40 transition-all cursor-pointer h-full">
                  <CardContent className="py-3 px-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold truncate" title={net.name}>{net.name}</span>
                      <Badge variant="outline" className="font-mono text-[10px] px-1.5 py-0">
                        {net.cidr}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="text-success font-medium">{net.online_count}</span>
                      <span className="text-destructive font-medium">{net.offline_count}</span>
                      <span className="text-muted-foreground">{net.unknown_count}</span>
                      <span className="text-muted-foreground ml-auto">
                        {net.total_hosts} tot
                      </span>
                    </div>
                    {net.total_hosts > 0 && (
                      <div className="flex h-1.5 rounded-full overflow-hidden bg-muted">
                        {net.online_count > 0 && (
                          <div className="bg-success" style={{ width: `${(net.online_count / net.total_hosts) * 100}%` }} />
                        )}
                        {net.offline_count > 0 && (
                          <div className="bg-destructive" style={{ width: `${(net.offline_count / net.total_hosts) * 100}%` }} />
                        )}
                        {net.unknown_count > 0 && (
                          <div className="bg-muted-foreground/40" style={{ width: `${(net.unknown_count / net.total_hosts) * 100}%` }} />
                        )}
                      </div>
                    )}
                    {net.last_scan && (
                      <p className="text-[10px] text-muted-foreground">
                        Scan: {new Date(net.last_scan).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      </p>
                    )}
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
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
