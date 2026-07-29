"use client";

/**
 * Fascia di stato Wazuh — quattro riquadri a semaforo (manager, indexer,
 * ingestione, repliche) in testa alla pagina Alert sicurezza.
 *
 * Nessun `setInterval` proprio: il refresh è guidato dal `refreshKey` passato
 * dal genitore (contatore agganciato al ciclo di aggiornamento già presente
 * nella pagina). `AbortController` con cleanup nell'`useEffect`.
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Settings2 } from "lucide-react";
import type { BlockHealth, HealthVerdict } from "@/lib/integrations/wazuh-health-thresholds";

interface WazuhHealthResponse {
  blocks: BlockHealth[];
  probedAt: string;
}

const BLOCK_LABEL: Record<BlockHealth["key"], string> = {
  manager: "Manager",
  indexer: "Indexer",
  ingestion: "Ingestione",
  replication: "Repliche",
};

// Stesse classi del semaforo usate in launchpad/modules-grid.tsx (VERDICT_DOT
// / STATUS_DOT["never"]): non inventarne di nuove.
const VERDICT_DOT: Record<HealthVerdict, string> = {
  ok: "bg-emerald-500",
  degraded: "bg-amber-500",
  fail: "bg-red-500",
};
const NEUTRAL_DOT = "bg-muted-foreground/40";

const WAZUH_SETTINGS_HREF = "/settings?tab=moduli#module-wazuh";

interface WazuhHealthBandProps {
  refreshKey: number;
}

export function WazuhHealthBand({ refreshKey }: WazuhHealthBandProps) {
  const [blocks, setBlocks] = useState<BlockHealth[] | null>(null);
  const [expanded, setExpanded] = useState<Set<BlockHealth["key"]>>(new Set());
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    fetch("/api/integrations/wazuh/health", { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: WazuhHealthResponse | null) => {
        if (d?.blocks) setBlocks(d.blocks);
      })
      .catch(() => {
        // Fascia informativa, non un'azione utente: in caso di errore si
        // mantiene l'ultimo stato noto, nessun toast.
      });
    return () => ac.abort();
  }, [refreshKey]);

  function toggle(key: BlockHealth["key"]) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {blocks === null
        ? Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-20 animate-pulse rounded-lg border border-border bg-card"
            />
          ))
        : blocks.map((b) => {
            const isExpandable = b.configured && !!b.detail && b.detail.length > 0;
            const isOpen = expanded.has(b.key);
            const dotClass = b.configured ? VERDICT_DOT[b.verdict] : NEUTRAL_DOT;

            return (
              <div key={b.key} className="rounded-lg border border-border bg-card p-3">
                <div
                  role={isExpandable ? "button" : undefined}
                  tabIndex={isExpandable ? 0 : undefined}
                  aria-expanded={isExpandable ? isOpen : undefined}
                  onClick={isExpandable ? () => toggle(b.key) : undefined}
                  onKeyDown={
                    isExpandable
                      ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            toggle(b.key);
                          }
                        }
                      : undefined
                  }
                  className={`flex items-start gap-2 ${isExpandable ? "cursor-pointer" : ""}`}
                >
                  <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${dotClass}`} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium uppercase text-muted-foreground">
                        {BLOCK_LABEL[b.key]}
                      </span>
                      {isExpandable ? (
                        isOpen ? (
                          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        )
                      ) : null}
                    </span>
                    <span className="block text-base font-semibold leading-snug">
                      {b.headline}
                    </span>
                  </span>
                </div>

                {!b.configured ? (
                  <Link
                    href={WAZUH_SETTINGS_HREF}
                    className="mt-2 inline-flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline"
                  >
                    <Settings2 className="h-3 w-3" />
                    Configura nelle impostazioni
                  </Link>
                ) : null}

                {isExpandable && isOpen ? (
                  <ul className="mt-2 space-y-0.5 border-t border-border pt-2 text-xs text-muted-foreground">
                    {(b.detail ?? []).map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            );
          })}
    </div>
  );
}
