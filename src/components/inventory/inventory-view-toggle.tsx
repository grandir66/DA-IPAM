"use client";

import { Shield, Package } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import type { InventoryViewMode } from "@/lib/inventory/inventory-view-mode";

interface InventoryViewToggleProps {
  viewMode: InventoryViewMode;
  onViewModeChange: (mode: InventoryViewMode) => void;
  compact?: boolean;
}

/** Commutatore vista NIS2 (default) ↔ inventario ITAM completo. */
export function InventoryViewToggle({ viewMode, onViewModeChange, compact }: InventoryViewToggleProps) {
  const isNis2 = viewMode === "nis2";

  return (
    <div
      className={`flex items-center gap-2 rounded-lg border border-border px-3 py-2 bg-muted/30 ${
        compact ? "text-xs" : "text-sm"
      }`}
    >
      <Shield className={`h-4 w-4 shrink-0 ${isNis2 ? "text-primary" : "text-muted-foreground"}`} />
      <Label htmlFor="inventory-view-toggle" className="cursor-pointer font-medium whitespace-nowrap">
        Vista NIS2
      </Label>
      <Switch
        id="inventory-view-toggle"
        checked={isNis2}
        onCheckedChange={(checked) => onViewModeChange(checked ? "nis2" : "full")}
      />
      {!compact && (
        <span className="text-muted-foreground hidden sm:inline">
          {isNis2 ? "Solo campi rilevanti NIS2" : "Tutti i campi ITAM"}
        </span>
      )}
      {!isNis2 && <Package className="h-4 w-4 text-muted-foreground shrink-0" />}
    </div>
  );
}
