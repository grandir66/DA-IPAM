/**
 * I widget della Dashboard, fuori dalla pagina (Riccardo, 12/11/2026: nella vista semplificata «i widget completi,
 * semplicemente filtrati»). Li usano la Dashboard e la casa di /cliente. `dove` dice dove portano i collegamenti:
 * nella Dashboard alle pagine di gestione, in /cliente alle pagine della vista cliente; dove la vista cliente non ha
 * una pagina corrispondente (le impostazioni) il widget resta senza collegamento.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { parseDbDate, FUSO_UTENTI } from "@/lib/db-date";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CardSicurezza } from "@/components/dashboard/card-sicurezza";
import { BarraGravita, LegendaGravita } from "@/components/shared/console";
import type { BarraRete } from "@/lib/rilievi/gruppi";
import type { KpiSicurezza } from "@/lib/security/kpi-dashboard";
import type { SerieAccessi } from "@/lib/security/accessi-indexer";
import { ASSENTE_DOPO_GIORNI } from "@/lib/hosts/assenti";
import type { DatiDashboard } from "@/lib/dashboard/dati";

export type Dove = "dashboard" | "cliente";

/** Dove porta, in /cliente, un collegamento della Dashboard. Quello che manca qui in /cliente non ha collegamento. */
const NEL_CLIENTE: Record<string, string> = {
  "/vulnerabilities#vulnerabilita": "/cliente/da-sistemare",
  "/security-alerts": "/cliente/log-sicurezza",
  "/sicurezza-dominio?tab=health": "/cliente/dominio",
  "/networks": "/cliente/reti",
  "/discovery": "/cliente/apparati",
  "/discovery?status=offline": "/cliente/apparati",
  "/monitoring/known-hosts": "/cliente/apparati",
};

export function vai(dove: Dove, href: string): string | undefined {
  return dove === "dashboard" ? href : NEL_CLIENTE[href];
}

function Vai({ href, className, title, children }: { href: string | undefined; className?: string; title?: string; children: ReactNode }) {
  return href ? <Link href={href} className={className} title={title}>{children}</Link> : <span className={className} title={title}>{children}</span>;
}

const numero = (n: number) => Math.round(n).toLocaleString("it-IT");

/**
 * Riga «Sicurezza» (Riccardo, 20/10): CVE dello Scanner-Edge, accessi falliti e account
 * bloccati da Wazuh, alert da gestire, Health di Active Directory. Una fonte non
 * configurata è grigia, non «zero». Card bianche con la striscia del token e il simbolo.
 */
export function RigaRilieviPerRete({ reti, dove = "dashboard" }: { reti: BarraRete[]; dove?: Dove }) {
  return (
    <Card size="sm" className="shrink-0 data-[size=sm]:gap-1">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Cose da sistemare per rete <span className="text-[13px] font-normal text-muted-foreground">· un software o un rilievo per host, come in Findings</span></CardTitle>
        <LegendaGravita />
      </CardHeader>
      <CardContent className="space-y-2">
        <BarreRilieviPerRete reti={reti} dove={dove} />
      </CardContent>
    </Card>
  );
}

export function RigaSicurezza({ k, accessi, daSistemare, dove = "dashboard" }: { dove?: Dove; k: KpiSicurezza; accessi: SerieAccessi | null; daSistemare: { critiche: number; alte: number; reti: number } | null }) {
  const a = k.accessi;
  const falliti = accessi?.totale24h ?? 0;
  const prima = accessi?.totale24hPrima ?? 0;
  const freccia = accessi?.tendenza === "su" ? " ↑" : accessi?.tendenza === "giu" ? " ↓" : "";
  return (
    <div className="grid gap-2 grid-cols-2 md:grid-cols-3 xl:grid-cols-6 shrink-0">
      {daSistemare ? (
        <>
          <CardSicurezza tono={daSistemare.critiche > 0 ? "guasto" : "ok"} titolo="Critiche da sistemare" valore={numero(daSistemare.critiche)} nota={`in ${daSistemare.reti} reti`} href={vai(dove, "/vulnerabilities#vulnerabilita")}
            title={`Cose da sistemare di gravità critica: un software o un rilievo per host, lo stesso conto delle barre e della pagina Findings${k.cve?.ultimaScansione ? ` · ultima scansione Edge ${parseDbDate(k.cve.ultimaScansione).toLocaleString("it-IT", { timeZone: FUSO_UTENTI })}` : ""}`} />
          <CardSicurezza tono={daSistemare.alte > 0 ? "attenzione" : "ok"} titolo="Alte da sistemare" valore={numero(daSistemare.alte)} nota={`in ${daSistemare.reti} reti`} href={vai(dove, "/vulnerabilities#vulnerabilita")} title="Cose da sistemare di gravità alta: stesso conto delle barre e della pagina Findings" />
        </>
      ) : (
        <CardSicurezza tono="grigio" titolo="Vulnerabilità" valore="Scanner-Edge non configurato" href={vai(dove, "/settings/moduli/edge")} />
      )}
      {a && accessi ? (
        <>
          <CardSicurezza
            tono={falliti === 0 ? "ok" : falliti > 100 && falliti > prima * 2 ? "guasto" : "attenzione"}
            titolo="Accessi falliti 24h" valore={`${numero(falliti)}${freccia}`} nota={`le 24 ore prima: ${numero(prima)}${accessi.fonte === "stima" ? " · stima" : ""}`} href={vai(dove, "/security-alerts")}
            title={accessi.fonte === "indexer"
              ? "Fallimenti di autenticazione di Windows e Linux dall'indexer di Wazuh nelle ultime 24 ore, esclusi i nostri account e le nostre reti. La freccia confronta le 24 ore piene con le 24 prima."
              : `${accessi.motivo ? `${accessi.motivo[0].toUpperCase()}${accessi.motivo.slice(1)}: ` : ""}eventi 4625 stimati, ogni gruppo d'allarme è ripartito sul periodo in cui è rimasto aperto.`} />
          <CardSicurezza tono={a.bloccati30g > 0 ? "attenzione" : "ok"} titolo="Account bloccati 30g" valore={numero(a.bloccati30g)} href={vai(dove, "/security-alerts")} title="Eventi 4740 da Wazuh negli ultimi 30 giorni" />
          <CardSicurezza tono={a.daGestire > 0 ? "attenzione" : "ok"} titolo="Alert da gestire" valore={numero(a.daGestire)} href={vai(dove, "/security-alerts")} title="Alert di Wazuh non ancora presi in carico" />
        </>
      ) : (
        <CardSicurezza tono="grigio" titolo="Accessi e alert" valore="Wazuh non configurato" href={vai(dove, "/settings/moduli/wazuh")} />
      )}
      {k.healthAd ? (
        <CardSicurezza
          tono={k.healthAd.critici > 0 ? "guasto" : k.healthAd.alti > 0 || k.healthAd.giorni > 7 || k.healthAd.ultimoFallito ? "attenzione" : "ok"}
          titolo="Health AD" valore={`${k.healthAd.critici} critici · ${k.healthAd.alti} alti`}
          nota={`${k.healthAd.giorni === 0 ? "oggi" : `${k.healthAd.giorni} g fa`}${k.healthAd.ultimoFallito ? " · ultimo tentativo fallito" : ""}`}
          href={vai(dove, "/sicurezza-dominio?tab=health")} title={`Ultima Health riuscita, punteggio globale ${k.healthAd.punteggio ?? "—"}. Oltre 7 giorni è da rifare.${k.healthAd.ultimoFallito ? " L'ultimo tentativo è fallito." : ""}`} />
      ) : (
        <CardSicurezza tono="grigio" titolo="Health AD" valore="mai eseguita" href={vai(dove, "/sicurezza-dominio?tab=health")} />
      )}
    </div>
  );
}

/** Indicatore della prima riga: card bassa, etichetta sopra e valore grande; Health con l'anello. */
export function Indicatore({ titolo, valore, colore = "text-foreground", nota, href, anello }: {
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

/** Le sole righe di «Cose da sistemare per rete», senza la cornice: le usa anche la casa di /cliente. */
export function BarreRilieviPerRete({ reti, dove = "dashboard" }: { reti: BarraRete[]; dove?: Dove }) {
  return (
    <>
        {reti.map((r) => (
          <div key={r.network_id} className="flex items-center gap-3">
            <Vai href={vai(dove, "/vulnerabilities#vulnerabilita")} className="w-44 shrink-0 truncate text-[13px] font-medium hover:underline" title={r.network_name}>{r.network_name}</Vai>
            <BarraGravita className="flex-1" conteggi={{ Critical: r.critical, High: r.high, Medium: r.medium, Low: r.low }} />
            <span className="w-12 shrink-0 text-right font-mono text-[13px] tabular-nums">{r.total}</span>
          </div>
        ))}
    </>
  );
}

/** La fila di numeri in testa alla Dashboard: Health, Subnet, Host, Offline, Assenti, Archiviati, Monitorati. */
export function FilaIndicatori({ dati, dove = "dashboard" }: { dati: DatiDashboard; dove?: Dove }) {
  const { stats, offlineSplit, archiviati, monitorStats, healthPct, healthColor, denom } = dati;
  return (
    <>
        <Indicatore titolo="Health" valore={`${healthPct}%`} colore={healthColor} nota={`${stats.online_hosts}/${denom} host online (offline visti negli ultimi ${ASSENTE_DOPO_GIORNI} giorni)`} anello={healthPct} />
        <Indicatore titolo="Subnet" valore={stats.total_networks} href={vai(dove, "/networks")} />
        <Indicatore titolo="Host" valore={stats.total_hosts} href={vai(dove, "/discovery")} />
        <Indicatore titolo="Offline" valore={offlineSplit.recenti} colore="text-destructive" href={vai(dove, "/discovery?status=offline")} nota={`Offline visti negli ultimi ${ASSENTE_DOPO_GIORNI} giorni`} />
        <Indicatore titolo={`Assenti > ${ASSENTE_DOPO_GIORNI} g`} valore={offlineSplit.assenti} colore="text-muted-foreground" href={vai(dove, "/discovery?status=offline")} nota={`Offline e non visti da oltre ${ASSENTE_DOPO_GIORNI} giorni: fuori dalla salute`} />
        <Indicatore titolo="Archiviati" valore={archiviati} colore="text-muted-foreground" href={vai(dove, "/settings?tab=sistema#pulizia-host")} nota="Archiviati dalla pulizia: si recuperano per 90 giorni" />
        {monitorStats.total > 0 && (
          <Indicatore titolo="Monitorati" valore={`${monitorStats.online}/${monitorStats.total}`} nota={monitorStats.avg_latency !== null ? `latenza media ${Math.round(monitorStats.avg_latency)} ms` : undefined} href={vai(dove, "/monitoring/known-hosts")} />
        )}
    </>
  );
}
