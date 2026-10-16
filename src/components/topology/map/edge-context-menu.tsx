"use client";

/**
 * Il menu del tasto destro su una linea (spec §11.2): Modifica porte (solo a
 * mano) · ★ Rendi principale o «Togli la scelta» · Rimuovi (a mano) / Ignora
 * (automatico, con conferma). In testa la linea in parole: chi, porte, fonte.
 * Chi non è admin vede solo la descrizione.
 */
import { ContextMenuItem, ContextMenuLabel, ContextMenuSeparator } from "@/components/ui/context-menu";
import type { EdgeMenuKey, MenuItem } from "@/lib/topology/map-menus";

interface Props {
  /** «SW-A ↔ SRV-1». */
  title: string;
  /** «Port 5 → eno1 · LLDP · ✓ visto oggi». */
  detail: string;
  items: Array<MenuItem<EdgeMenuKey>>;
  onAction: (key: EdgeMenuKey) => void;
  /** Il testo al posto di «Solo un amministratore…» quando un admin non ha voci (una contrazione). */
  vuoto?: string;
}

export function EdgeMenuContent({ title, detail, items, onAction, vuoto }: Props) {
  return (
    <>
      <ContextMenuLabel className="max-w-80 text-foreground">{title}</ContextMenuLabel>
      <ContextMenuLabel className="max-w-80 pt-0 [overflow-wrap:anywhere]">{detail}</ContextMenuLabel>
      <ContextMenuSeparator />
      {items.length === 0 ? (
        <ContextMenuLabel className="max-w-80 whitespace-normal">{vuoto ?? "Solo un amministratore modifica i collegamenti."}</ContextMenuLabel>
      ) : (
        items.map((it) => (
          <ContextMenuItem
            key={it.key}
            disabled={it.disabled}
            variant={it.key === "remove" || it.key === "ignore" ? "destructive" : "default"}
            onClick={() => onAction(it.key)}
          >
            {it.label}
          </ContextMenuItem>
        ))
      )}
    </>
  );
}
