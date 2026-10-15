"use client";

/**
 * L'elenco degli oggetti a sinistra (300 px): ricerca per nome, IP o alias,
 * gruppi apribili, «✓ nella mappa». Un oggetto si aggiunge alla mappa passo
 * passo trascinandolo sulla mappa (spec §11.2: «Inserisci» non c'è più); in
 * «Tutto automatico» il trascinamento non c'è e il suggerimento lo dice. Oltre
 * 200 voci per gruppo si mostra «+ altri N» (altre 200 a ogni clic). Gli apparati disabilitati
 * non si elencano (listedNodes): restano sulla mappa.
 */
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { nodeClass } from "@/lib/topology/identity";
import { listedNodes } from "@/lib/topology/object-list";
import type { MapNode, TopologyModel } from "@/lib/topology/model-types";
import { TopoIcon, typeLabel } from "./topology-icons";

const MAX = 200;
const CLIENT = "Client";
/** Il tipo del dato trascinato: l'id del nodo. Lo legge il contenitore della mappa. */
export const DRAG_MIME = "application/x-da-ipam-node";

/** «on» = si trascina (admin, passo passo); «auto» = Tutto automatico, non serve; «off» = non admin. */
export type ListDrag = "on" | "auto" | "off";
const DRAG_HINT: Record<ListDrag, string | null> = {
  on: "trascinalo sulla mappa per aggiungerlo",
  auto: "in «Tutto automatico» la mappa mostra già tutto: per trascinarlo passa a «Passo passo»",
  off: null,
};

interface Props {
  model: TopologyModel;
  visible: ReadonlySet<string>;
  selected: string | null;
  drag: ListDrag;
  onSelect: (id: string) => void;
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

export function ObjectList({ model, visible, selected, drag, onSelect }: Props) {
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
      ["Server e attaccati", (n) => nodeClass(n) === "att" || nodeClass(n) === "hyper"],
      [CLIENT, (n) => nodeClass(n) === "client"],
    ];
    const sorted = listedNodes(model.nodes).sort((a, b) => a.name.localeCompare(b.name, "it") || (a.id < b.id ? -1 : 1));
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
                  const inMap = visible.has(n.id);
                  const canDrag = drag === "on" && !inMap;
                  return (
                    <div
                      key={n.id}
                      role="button"
                      tabIndex={0}
                      draggable={canDrag}
                      onDragStart={canDrag ? (e) => {
                        e.dataTransfer.setData(DRAG_MIME, n.id);
                        e.dataTransfer.effectAllowed = "copy";
                      } : undefined}
                      onClick={() => onSelect(n.id)}
                      onKeyDown={(e) => { if (e.key === "Enter") onSelect(n.id); }}
                      title={[n.name, n.mgmtIp, typeLabel(n.type), why, inMap ? null : DRAG_HINT[drag]].filter(Boolean).join(" · ")}
                      className={cn(
                        "flex items-center gap-1.5 px-2.5 py-1 text-[13px] hover:bg-muted",
                        canDrag ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
                        selected === n.id && "bg-muted font-semibold",
                      )}
                    >
                      <TopoIcon type={n.type} size={18} className="shrink-0" />
                      <span className="min-w-0 flex-1 truncate">
                        {n.name}
                        {why && <span className="text-muted-foreground"> · {why}</span>}
                      </span>
                      {inMap && <span className="shrink-0 font-semibold whitespace-nowrap">✓ nella mappa</span>}
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
