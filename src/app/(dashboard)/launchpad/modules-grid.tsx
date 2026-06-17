"use client";

/**
 * Griglia dei 6 moduli base in cima alla Launchpad — unico punto di accesso.
 * Stato live da /api/modules/health (refresh 60s). Ogni tile: stato + "Apri"
 * (route nativa o dashboard esterna) + "Configura" (deep-link al tab moduli).
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ShieldAlert,
  PackageCheck,
  ServerCog,
  Activity,
  ScrollText,
  Radar,
  ExternalLink,
  Settings2,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { ModuleState, ModuleKey } from "@/lib/modules/registry";
import type { ModuleHealth, ModuleHealthStatus } from "@/lib/modules/health";

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

export function ModulesGrid() {
  const [modules, setModules] = useState<ModuleState[] | null>(null);
  const [health, setHealth] = useState<Map<ModuleKey, ModuleHealth>>(new Map());
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetch("/api/modules")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { modules: ModuleState[] } | null) => setModules(d?.modules ?? []))
      .catch(() => setModules([]));

    const loadHealth = () => {
      fetch("/api/modules/health")
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { health: ModuleHealth[] } | null) => {
          if (d?.health) setHealth(new Map(d.health.map((h) => [h.key, h])));
        })
        .catch(() => {});
    };
    loadHealth();
    pollRef.current = setInterval(loadHealth, 60_000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

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
              <ModuleTile key={m.key} module={m} health={health.get(m.key)} />
            ))}
      </div>
    </div>
  );
}

function ModuleTile({ module: m, health }: { module: ModuleState; health?: ModuleHealth }) {
  const Icon = ICONS[m.icon] ?? Activity;
  const status: ModuleHealthStatus = health?.status ?? (m.enabled ? "unknown" : "never");
  const canOpen = m.installed && !!m.uiUrl;

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
            <span className={`h-2 w-2 rounded-full shrink-0 ${STATUS_DOT[status]}`} />
            <span className="text-xs text-muted-foreground truncate">
              {health?.message ?? STATUS_LABEL[status]}
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
      </div>
    </div>
  );
}
