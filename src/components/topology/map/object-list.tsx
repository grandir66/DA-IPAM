"use client";

/**
 * L'elenco degli oggetti a sinistra (300 px): ricerca per nome, IP o alias,
 * gruppi apribili, «✓ nella mappa» o «Inserisci» (passo passo, admin). Oltre
 * 200 voci per gruppo si mostra «+ altri N» (altre 200 a ogni clic).
 */
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { nodeClass } from "@/lib/topology/identity";
import type { MapNode, TopologyModel } from "@/lib/topology/model-types";
import { TopoIcon, typeLabel } from "./topology-icons";

const MAX = 200;
const CLIENT = "Client";

interface Props {
  model: TopologyModel;
  visible: ReadonlySet<string>;
  selected: string | null;
  /** Passo passo, admin, con una mappa scelta. */
  canInsert: boolean;
  onSelect: (id: string) => void;
  onInsert: (id: string) => void;
}

function matches(n: MapNode, q: string): boolean {
  if (!q) return true;
  return (
    n.name.toLowerCase().includes(q) ||
    (n.mgmtIp ?? "").includes(q) ||
    n.addresses.some((a) => a.ip.includes(q)) ||
    n.aliases.some((a) => a.toLowerCase().includes(q))
  );
}

export function ObjectList({ model, visible, selected, canInsert, onSelect, onInsert }: Props) {
  const [q, setQ] = useState("");
  const [closed, setClosed] = useState<ReadonlySet<string>>(() => new Set([CLIENT]));
  const [limit, setLimit] = useState<Readonly<Record<string, number>>>({});

  const groups = useMemo(() => {
    const isolated = new Set(model.isolated);
    const suspicious = new Set(model.suspicious);
    const promote = new Set(model.promote.map((p) => `host:${p.hostId}`));
    const why = (n: MapNode): string | null =>
      promote.has(n.id) ? "host da promuovere" : suspicious.has(n.id) ? "tipo sospetto" : isolated.has(n.id) ? "nessun collegamento" : null;
    const defs: Array<[string, (n: MapNode) => boolean]> = [
      ["Router e firewall", (n) => nodeClass(n) === "infra" && n.type !== "switch"],
      ["Switch", (n) => n.type === "switch"],
      ["Access point", (n) => nodeClass(n) === "ap"],
      ["Server e attaccati", (n) => nodeClass(n) === "att"],
      [CLIENT, (n) => nodeClass(n) === "client"],
    ];
    const sorted = [...model.nodes].sort((a, b) => a.name.localeCompare(b.name, "it") || (a.id < b.id ? -1 : 1));
    const out = defs.map(([name, f]) => ({ name, items: sorted.filter((n) => !why(n) && f(n)) }));
    out.push({ name: "Da sistemare", items: sorted.filter((n) => why(n) !== null) });
    return { list: out, why };
  }, [model]);

  const query = q.trim().toLowerCase();
  const toggle = (set: ReadonlySet<string>, k: string) => {
    const s = new Set(set);
    if (s.has(k)) s.delete(k);
    else s.add(k);
    return s;
  };

  return (
    <aside className="flex w-[300px] shrink-0 flex-col border-r border-border bg-card">
      <div className="border-b border-border p-2.5">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca nome, IP o alias…" aria-label="Cerca negli oggetti" />
      </div>
      <div className="min-h-0 flex-1 overflow-auto pb-2">
        {groups.list.map((g) => {
          const items = g.items.filter((n) => matches(n, query));
          if (!items.length) return null;
          const isClosed = closed.has(g.name) && !query;
          const shown = items.slice(0, limit[g.name] ?? MAX);
          return (
            <div key={g.name}>
              <button
                type="button"
                onClick={() => setClosed((c) => toggle(c, g.name))}
                aria-expanded={!isClosed}
                className="w-full px-2.5 pt-2 pb-1 text-left text-[13px] font-semibold tracking-wide text-muted-foreground uppercase hover:text-foreground"
              >
                {isClosed ? "▸" : "▾"} {g.name} ({items.length})
              </button>
              {!isClosed &&
                shown.map((n) => {
                  const why = groups.why(n);
                  return (
                    <div
                      key={n.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => onSelect(n.id)}
                      onKeyDown={(e) => { if (e.key === "Enter") onSelect(n.id); }}
                      title={[n.name, n.mgmtIp, typeLabel(n.type), why].filter(Boolean).join(" · ")}
                      className={cn(
                        "flex cursor-pointer items-center gap-1.5 px-2.5 py-1 text-[13px] hover:bg-muted",
                        selected === n.id && "bg-muted font-semibold",
                      )}
                    >
                      <TopoIcon type={n.type} size={18} className="shrink-0" />
                      <span className="min-w-0 flex-1 truncate">
                        {n.name}
                        {why && <span className="text-muted-foreground"> · {why}</span>}
                      </span>
                      {visible.has(n.id) ? (
                        <span className="shrink-0 font-semibold whitespace-nowrap">✓ nella mappa</span>
                      ) : canInsert ? (
                        <Button
                          size="xs"
                          variant="outline"
                          className="text-[13px]"
                          onClick={(e) => { e.stopPropagation(); onInsert(n.id); }}
                        >
                          Inserisci
                        </Button>
                      ) : null}
                    </div>
                  );
                })}
              {!isClosed && items.length > shown.length && (
                <button
                  type="button"
                  onClick={() => setLimit((l) => ({ ...l, [g.name]: (l[g.name] ?? MAX) + MAX }))}
                  className="px-2.5 py-1 text-[13px] text-muted-foreground underline"
                >
                  + altri {items.length - shown.length}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
