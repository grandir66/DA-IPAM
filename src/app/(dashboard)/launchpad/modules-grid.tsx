"use client";

/**
 * Griglia dei 6 moduli base in cima alla Launchpad — unico punto di accesso.
 * Stato live da /api/modules/health (refresh 60s). Ogni tile: stato + "Apri"
 * (route nativa o dashboard esterna) + "Configura" (deep-link al tab moduli).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ShieldAlert,
  PackageCheck,
  ServerCog,
  Activity,
  ScrollText,
  Radar,
  ExternalLink,
  Settings2,
  RefreshCw,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import type { ModuleState, ModuleKey } from "@/lib/modules/registry";
import type { ModuleHealth, ModuleHealthStatus, ModuleVerdict } from "@/lib/modules/health";

const ICONS: Record<string, LucideIcon> = {
  ShieldAlert,
  PackageCheck,
  ServerCog,
  Activity,
  ScrollText,
  Radar,
};

const STATUS_DOT: Record<ModuleHealthStatus, string> = {
  ok: "bg-emerald-500",
  warning: "bg-amber-500",
  stale: "bg-amber-500",
  error: "bg-red-500",
  never: "bg-muted-foreground/40",
  unknown: "bg-muted-foreground/40",
};

const STATUS_LABEL: Record<ModuleHealthStatus, string> = {
  ok: "Attivo",
  warning: "Attenzione",
  stale: "Sync vecchia",
  error: "Errore",
  never: "Non configurato",
  unknown: "Sconosciuto",
};

// F2/F5: il semaforo è guidato dal verdict L7 (ok/degraded/fail) quando disponibile.
const VERDICT_DOT: Record<ModuleVerdict, string> = {
  ok: "bg-emerald-500",
  degraded: "bg-amber-500",
  fail: "bg-red-500",
};

const VERDICT_LABEL: Record<ModuleVerdict, string> = {
  ok: "Connesso",
  degraded: "Degradato",
  fail: "Non connesso",
};

function relativeTime(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.now() - Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  const min = Math.round(ms / 60000);
  if (min < 1) return "ora";
  if (min < 60) return `${min}m fa`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h fa`;
  return `${Math.round(h / 24)}g fa`;
}

export function ModulesGrid() {
  const [modules, setModules] = useState<ModuleState[] | null>(null);
  const [health, setHealth] = useState<Map<ModuleKey, ModuleHealth>>(new Map());
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadHealth = useCallback(() => {
    fetch("/api/modules/health")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { health: ModuleHealth[] } | null) => {
        if (d?.health) setHealth(new Map(d.health.map((h) => [h.key, h])));
      })
      .catch(() => {});
  }, []);

  // Aggiorna un singolo tile dopo Verifica/Ripara (merge del risultato live).
  const mergeHealth = useCallback((h: ModuleHealth) => {
    setHealth((prev) => {
      const next = new Map(prev);
      next.set(h.key, h);
      return next;
    });
  }, []);

  useEffect(() => {
    fetch("/api/modules")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { modules: ModuleState[] } | null) => setModules(d?.modules ?? []))
      .catch(() => setModules([]));

    loadHealth();
    pollRef.current = setInterval(loadHealth, 60_000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [loadHealth]);

  return (
    <div>
      <div className="mb-3">
        <h2 className="text-lg font-semibold">Moduli</h2>
        <p className="text-sm text-muted-foreground">
          Apri la gestione di ogni modulo o vai alla configurazione. Lo stato si aggiorna
          ogni 60s.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {modules === null
          ? Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-32 rounded-lg border border-border bg-card animate-pulse" />
            ))
          : modules.map((m) => (
              <ModuleTile
                key={m.key}
                module={m}
                health={health.get(m.key)}
                onHealthUpdate={mergeHealth}
              />
            ))}
      </div>
    </div>
  );
}

function ModuleTile({
  module: m,
  health,
  onHealthUpdate,
}: {
  module: ModuleState;
  health?: ModuleHealth;
  onHealthUpdate: (h: ModuleHealth) => void;
}) {
  const router = useRouter();
  const Icon = ICONS[m.icon] ?? Activity;
  const status: ModuleHealthStatus = health?.status ?? (m.enabled ? "unknown" : "never");
  const canOpen = m.installed && !!m.uiUrl;
  const [verifying, setVerifying] = useState(false);
  const [repairing, setRepairing] = useState(false);

  // Semaforo guidato dal verdict L7 quando disponibile, altrimenti status storico.
  const verdict = health?.verdict;
  const dotClass = verdict ? VERDICT_DOT[verdict] : STATUS_DOT[status];
  const stateLabel = verdict ? VERDICT_LABEL[verdict] : (health?.message ?? STATUS_LABEL[status]);
  const lastSync = relativeTime(health?.lastSyncAt ?? null);
  const showRepair = !!verdict && verdict !== "ok" && !!health?.repairAction;

  async function verify() {
    setVerifying(true);
    try {
      const res = await fetch("/api/modules/health", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: m.key }),
      });
      const data = (await res.json().catch(() => null)) as { health?: ModuleHealth[] } | null;
      const h = data?.health?.find((x) => x.key === m.key);
      if (res.ok && h) {
        onHealthUpdate(h);
        if (h.verdict === "ok") toast.success(`${m.label}: connesso`);
        else if (h.verdict === "degraded") toast.warning(`${m.label}: degradato — ${h.detail ?? ""}`);
        else toast.error(`${m.label}: non connesso — ${h.detail ?? ""}`);
      } else {
        toast.error(`Verifica ${m.label} fallita`);
      }
    } catch {
      toast.error(`Verifica ${m.label}: errore di rete`);
    } finally {
      setVerifying(false);
    }
  }

  async function repair() {
    setRepairing(true);
    try {
      const res = await fetch(`/api/modules/${m.key}/repair`, { method: "POST" });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; verdict?: string; detail?: string; fix?: string | null; configHref?: string | null }
        | null;
      if (data?.ok) {
        toast.success(`${m.label}: riparato (connesso)`);
        verify();
      } else if (data?.configHref) {
        toast.info(data.fix ?? `Configura ${m.label}`);
        router.push(data.configHref);
      } else {
        toast.error(data?.fix ?? `${m.label}: ${data?.detail ?? "ancora non connesso"}`);
        if (data) {
          onHealthUpdate({ ...(health as ModuleHealth), verdict: (data.verdict as ModuleVerdict) ?? "fail", detail: data.detail ?? null });
        }
      }
    } catch {
      toast.error(`Ripara ${m.label}: errore di rete`);
    } finally {
      setRepairing(false);
    }
  }

  return (
    <div
      className={`rounded-lg border border-border bg-card p-4 flex flex-col gap-3 ${
        m.installed ? "" : "opacity-70"
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="rounded-md bg-muted p-2 shrink-0">
          <Icon className="h-5 w-5 text-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-medium truncate">{m.label}</h3>
            <Badge variant="outline" className="text-[10px] uppercase shrink-0">
              {m.category}
            </Badge>
          </div>
          <div className="flex items-center gap-1.5 mt-1">
            <span className={`h-2 w-2 rounded-full shrink-0 ${dotClass}`} />
            <span className="text-xs text-muted-foreground truncate">
              {stateLabel}
              {lastSync ? ` · ultimo sync ${lastSync}` : ""}
            </span>
          </div>
        </div>
      </div>

      <p className="text-xs text-muted-foreground line-clamp-2 flex-1">
        {m.installed ? m.description : m.note ?? m.description}
      </p>

      <div className="flex items-center gap-2">
        {canOpen ? (
          m.uiIsInternal ? (
            <Link
              href={m.uiUrl!}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
            >
              Apri
            </Link>
          ) : (
            <a
              href={m.uiUrl!}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Apri
            </a>
          )
        ) : (
          <span
            className="inline-flex items-center px-2.5 py-1.5 rounded-md bg-muted text-muted-foreground text-xs font-medium cursor-not-allowed"
            title={m.installed ? "URL non disponibile" : "Modulo non installato"}
          >
            Apri
          </span>
        )}
        <Link
          href={m.configHref}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border text-xs font-medium hover:bg-accent transition-colors"
        >
          <Settings2 className="h-3.5 w-3.5" />
          Configura
        </Link>
        {m.installed && (
          <button
            type="button"
            onClick={() => void verify()}
            disabled={verifying || repairing}
            title="Verifica live: raggiungibile + auth + ultimo sync"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border text-xs font-medium hover:bg-accent transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${verifying ? "animate-spin" : ""}`} />
            {verifying ? "Verifico…" : "Verifica"}
          </button>
        )}
        {showRepair && (
          <button
            type="button"
            onClick={() => void repair()}
            disabled={verifying || repairing}
            title="Ri-testa e mostra come riparare il modulo"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-amber-500/40 text-amber-600 dark:text-amber-500 text-xs font-medium hover:bg-amber-500/10 transition-colors disabled:opacity-50"
          >
            <Wrench className={`h-3.5 w-3.5 ${repairing ? "animate-pulse" : ""}`} />
            {repairing ? "Riparo…" : "Ripara"}
          </button>
        )}
      </div>
    </div>
  );
}
