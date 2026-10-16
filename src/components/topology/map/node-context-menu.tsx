"use client";

/**
 * Il menu del tasto destro su un oggetto della mappa (spec §11.2). Le voci le
 * sceglie nodeMenuItems (logica pura); qui si disegnano. «Aggiungi collegati ▸»
 * è un sottomenu con una casella per ogni collegato non ancora nella mappa e
 * «Aggiungi i selezionati» in fondo. In fondo al file il menu di una VM
 * dell'hypervisor espanso (spec §11.5).
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
import { ruoloVoci, type AddableLinked, type MenuItem, type NodeMenuKey, type RuoloMappa, type VmMenuKey } from "@/lib/topology/map-menus";
import { typeLabel } from "./topology-icons";

interface Props {
  title: string;
  items: Array<MenuItem<NodeMenuKey>>;
  addable: AddableLinked[];
  onAction: (key: Exclude<NodeMenuKey, "addLinked" | "role">) => void;
  onAddLinked: (ids: string[]) => void;
  /** Il ruolo nella mappa di un apparato; null per un host o una VM (T1b). */
  ruolo: RuoloMappa | null;
  onRole: (r: RuoloMappa) => void;
  /** Mappa nuova (T3, §13.9): il menu del ruolo ha anche «Core» e «Accesso». */
  conCavi?: boolean;
}

export function NodeMenuContent({ title, items, addable, onAction, onAddLinked, ruolo, onRole, conCavi = false }: Props) {
  return (
    <>
      <ContextMenuLabel className="max-w-72 truncate" title={title}>{title}</ContextMenuLabel>
      <ContextMenuSeparator />
      {items.map((it) =>
        it.key === "addLinked" ? (
          <AddLinkedSub key={it.key} label={it.label} addable={addable} onAdd={onAddLinked} />
        ) : it.key === "role" && !it.disabled ? (
          <RoleSub key={it.key} label={it.label} attuale={ruolo ?? ""} onRole={onRole} conCavi={conCavi} />
        ) : (
          <ContextMenuItem
            key={it.key}
            disabled={it.disabled}
            variant={it.key === "hide" || it.key === "remove" ? "destructive" : "default"}
            onClick={() => onAction(it.key as Exclude<NodeMenuKey, "addLinked" | "role">)}
          >
            {it.label}
          </ContextMenuItem>
        ),
      )}
    </>
  );
}

/** «Ruolo nella mappa ▸»: tre voci (cinque con la mappa nuova); quella di adesso è segnata e spenta (sceglierla non cambierebbe niente). */
function RoleSub({ label, attuale, onRole, conCavi }: { label: string; attuale: RuoloMappa; onRole: (r: RuoloMappa) => void; conCavi: boolean }) {
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>{label}</ContextMenuSubTrigger>
      <ContextMenuSubContent>
        {ruoloVoci(attuale, conCavi).map((v) => (
          <ContextMenuItem key={v.value || "sistema"} disabled={v.value === attuale} onClick={() => onRole(v.value)}>{v.label}</ContextMenuItem>
        ))}
      </ContextMenuSubContent>
    </ContextMenuSub>
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

export function VmMenuContent({ title, detail, items, onAction }: {
  title: string;
  /** «▶ accesa · 192.0.2.10 · su PVE-1». */
  detail: string;
  items: Array<MenuItem<VmMenuKey>>;
  onAction: (key: VmMenuKey) => void;
}) {
  return (
    <>
      <ContextMenuLabel className="max-w-72 truncate text-foreground" title={title}>{title}</ContextMenuLabel>
      <ContextMenuLabel className="max-w-72 pt-0 [overflow-wrap:anywhere]">{detail}</ContextMenuLabel>
      <ContextMenuSeparator />
      {items.map((it) => (
        <ContextMenuItem key={it.key} disabled={it.disabled} onClick={() => onAction(it.key)}>{it.label}</ContextMenuItem>
      ))}
    </>
  );
}
