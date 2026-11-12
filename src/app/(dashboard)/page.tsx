import { parseDbDate, FUSO_UTENTI } from "@/lib/db-date";
import { getUserCount } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { Network, Shield, Activity, PlugZap } from "lucide-react";
import { StatusOverTimeChart } from "@/components/shared/status-over-time-chart";
import { StatusChangeFeed } from "@/components/shared/status-change-feed";
import { getServerTenantCode } from "@/lib/api-tenant";
import { IstogrammaAccessi } from "@/components/dashboard/istogramma-accessi";
import { BarreSubnet, LegendaSubnet } from "@/components/dashboard/barre-subnet";
import { ModuliCompatti } from "@/components/dashboard/moduli-compatti";
import { FilaIndicatori, RigaRilieviPerRete, RigaSicurezza } from "@/components/dashboard/widget";
import { datiDashboard, moduliDashboard } from "@/lib/dashboard/dati";
import { tempoFa } from "@/lib/modules/riquadri-dashboard";
import { STILE_STATO } from "@/components/shared/stile-stato-modulo";

/** Riga «Stato moduli»: le righe dei moduli portano anche dove aprono (UI-20). */

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  // Redirect to setup if no users exist (hub DB, no tenant context needed)
  const userCount = getUserCount();
  if (userCount === 0) {
    redirect("/setup");
  }

  const tenantCode = await getServerTenantCode();
  let ruolo: string | undefined;
  try {
    ruolo = ((await auth())?.user as { role?: string } | undefined)?.role;
  } catch (e) {
    console.error("[dashboard] ruolo non leggibile:", e);
  }
  // I dati stanno in src/lib/dashboard/dati.ts: li legge anche la casa di /cliente (12/11/2026).
  const { riquadri, integrationErrors, integrationWarnings, moduleStates } = await moduliDashboard(tenantCode, ruolo);
  const dati = await datiDashboard(tenantCode, moduleStates);
  const { networks, monitorStats, offlineKnown, sicurezza, accessi, rilieviRete, daSistemare } = dati;

  // Dashboard in una schermata, disposizione a tre colonne (Riccardo, 20/10): andamenti a
  // sinistra, operatività al centro, infrastruttura a destra. Le liste scorrono nel riquadro.
  return (
    <div className="flex flex-col gap-2 lg:h-[calc(100dvh-1.5rem)]">
      {/* ── Riga 1: titolo e indicatori ───────────────────────────────── */}
      <div className="flex flex-wrap items-stretch gap-2 shrink-0">
        <h1 className="text-xl font-bold tracking-tight mr-2 self-center">Dashboard</h1>
        {(ruolo === "admin" || ruolo === "superadmin") && (
          <Link href="/cliente" className="self-center text-sm font-medium text-cian-testo hover:underline">
            Vista cliente
          </Link>
        )}
        <FilaIndicatori dati={dati} />
      </div>

      {/* ── Riga 2: sicurezza, card bianche con striscia (Riccardo, 20/10) ── */}
      <RigaSicurezza k={sicurezza} accessi={accessi} daSistemare={daSistemare} />

      {/* Rilievi per rete (Riccardo, 09/11): le barre della pagina Vulnerabilità, anche qui. */}
      {rilieviRete.length > 0 && <RigaRilieviPerRete reti={rilieviRete} />}

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
              <IstogrammaAccessi ore={accessi?.ore ?? null} giorni={accessi?.giorni ?? null} fonte={accessi?.fonte ?? "stima"} motivo={accessi?.motivo} bersagliati={accessi?.bersagliati} />
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
