"use client";

/**
 * Il menu del tasto destro su un oggetto della mappa (spec §11.2). Le voci le
 * sceglie nodeMenuItems (logica pura); qui si disegnano. «Aggiungi collegati ▸»
 * è un sottomenu con una casella per ogni collegato non ancora nella mappa e
 * «Aggiungi i selezionati» in fondo.
 */
import { useState } from "react";
import {
  ContextMenuCheckboxItem,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import type { AddableLinked, MenuItem, NodeMenuKey } from "@/lib/topology/map-menus";
import { typeLabel } from "./topology-icons";

interface Props {
  title: string;
  items: Array<MenuItem<NodeMenuKey>>;
  addable: AddableLinked[];
  onAction: (key: Exclude<NodeMenuKey, "addLinked">) => void;
  onAddLinked: (ids: string[]) => void;
}

export function NodeMenuContent({ title, items, addable, onAction, onAddLinked }: Props) {
  return (
    <>
      <ContextMenuLabel className="max-w-72 truncate" title={title}>{title}</ContextMenuLabel>
      <ContextMenuSeparator />
      {items.map((it) =>
        it.key === "addLinked" ? (
          <AddLinkedSub key={it.key} label={it.label} addable={addable} onAdd={onAddLinked} />
        ) : (
          <ContextMenuItem
            key={it.key}
            disabled={it.disabled}
            variant={it.key === "hide" || it.key === "remove" ? "destructive" : "default"}
            onClick={() => onAction(it.key as Exclude<NodeMenuKey, "addLinked">)}
          >
            {it.label}
          </ContextMenuItem>
        ),
      )}
    </>
  );
}

function AddLinkedSub({ label, addable, onAdd }: { label: string; addable: AddableLinked[]; onAdd: (ids: string[]) => void }) {
  const [checked, setChecked] = useState<ReadonlySet<string>>(() => new Set(addable.filter((a) => a.checked).map((a) => a.id)));
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>{label}</ContextMenuSubTrigger>
      <ContextMenuSubContent className="max-w-96">
        {addable.map((a) => (
          <ContextMenuCheckboxItem
            key={a.id}
            checked={checked.has(a.id)}
            closeOnClick={false}
            onCheckedChange={(v) => setChecked((s) => {
              const n = new Set(s);
              if (v) n.add(a.id);
              else n.delete(a.id);
              return n;
            })}
          >
            <span className="min-w-0 flex-1 truncate">{a.name}</span>
            <span className="shrink-0 text-[13px] text-muted-foreground">{typeLabel(a.type)}</span>
          </ContextMenuCheckboxItem>
        ))}
        <ContextMenuSeparator />
        <ContextMenuItem disabled={checked.size === 0} onClick={() => onAdd(addable.filter((a) => checked.has(a.id)).map((a) => a.id))}>
          Aggiungi i selezionati ({checked.size})
        </ContextMenuItem>
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}
