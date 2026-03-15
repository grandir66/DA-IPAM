import { getDashboardStats, getNetworks, getRecentActivity, getUserCount } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Network, Monitor, Wifi, WifiOff, HelpCircle } from "lucide-react";
import { DashboardClient } from "./dashboard-client";

export const dynamic = "force-dynamic";

export default function DashboardPage() {
  // Redirect to setup if no users exist
  const userCount = getUserCount();
  if (userCount === 0) {
    redirect("/setup");
  }

  const stats = getDashboardStats();
  const networks = getNetworks();
  const recentActivity = getRecentActivity(10);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-0.5">Panoramica del sistema IPAM</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
        <StatCard
          title="Reti"
          value={stats.total_networks}
          icon={<Network className="h-4 w-4" />}
          color="text-primary"
        />
        <StatCard
          title="Host Totali"
          value={stats.total_hosts}
          icon={<Monitor className="h-4 w-4" />}
          color="text-foreground"
        />
        <StatCard
          title="Online"
          value={stats.online_hosts}
          icon={<Wifi className="h-4 w-4" />}
          color="text-success"
        />
        <StatCard
          title="Offline"
          value={stats.offline_hosts}
          icon={<WifiOff className="h-4 w-4" />}
          color="text-destructive"
        />
        <StatCard
          title="Sconosciuti"
          value={stats.unknown_hosts}
          icon={<HelpCircle className="h-4 w-4" />}
          color="text-muted-foreground"
        />
      </div>

      {/* Online Chart */}
      <DashboardClient />

      {/* Networks Grid */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xl font-semibold">Reti</h2>
          <Link
            href="/networks"
            className="text-sm text-primary hover:underline"
          >
            Vedi tutte →
          </Link>
        </div>
        {networks.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Network className="h-12 w-12 mx-auto text-muted-foreground/40 mb-4" />
              <p className="text-muted-foreground">Nessuna rete configurata</p>
              <Link
                href="/networks"
                className="text-primary hover:underline text-sm mt-2 inline-block"
              >
                Aggiungi la prima rete →
              </Link>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {networks.map((net) => (
              <Link key={net.id} href={`/networks/${net.id}`}>
                <Card className="hover:shadow-md transition-shadow cursor-pointer">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center justify-between">
                      {net.name}
                      <Badge variant="secondary" className="font-mono text-xs">
                        {net.cidr}
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-4 text-sm">
                      <span className="text-success font-medium">{net.online_count} online</span>
                      <span className="text-destructive font-medium">{net.offline_count} offline</span>
                      <span className="text-muted-foreground">{net.unknown_count} sconosciuti</span>
                    </div>
                    {/* Mini status bar */}
                    {net.total_hosts > 0 && (
                      <div className="flex h-2 rounded-full overflow-hidden mt-3 bg-muted">
                        {net.online_count > 0 && (
                          <div
                            className="bg-success"
                            style={{ width: `${(net.online_count / net.total_hosts) * 100}%` }}
                          />
                        )}
                        {net.offline_count > 0 && (
                          <div
                            className="bg-destructive"
                            style={{ width: `${(net.offline_count / net.total_hosts) * 100}%` }}
                          />
                        )}
                        {net.unknown_count > 0 && (
                          <div
                            className="bg-muted-foreground/40"
                            style={{ width: `${(net.unknown_count / net.total_hosts) * 100}%` }}
                          />
                        )}
                      </div>
                    )}
                    {net.last_scan && (
                      <p className="text-xs text-muted-foreground mt-2">
                        Ultima scansione: {new Date(net.last_scan).toLocaleString("it-IT")}
                      </p>
                    )}
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Recent Activity */}
      {recentActivity.length > 0 && (
        <div>
          <h2 className="text-xl font-semibold mb-2">Attività Recente</h2>
          <Card>
            <CardContent className="p-0">
              <div className="divide-y divide-border">
                {recentActivity.map((activity) => (
                  <div key={activity.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                    <Badge variant="outline" className="text-xs shrink-0">
                      {activity.scan_type}
                    </Badge>
                    <span className="text-muted-foreground">
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
        </div>
      )}
    </div>
  );
}

function StatCard({
  title,
  value,
  icon,
  color,
}: {
  title: string;
  value: number;
  icon: React.ReactNode;
  color: string;
}) {
  return (
    <Card size="sm">
      <CardContent className="pt-4 pb-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
          </div>
          <div className={`${color} opacity-60`}>{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
}
