"use client";

import { useCallback, useEffect, useState } from "react";

export type InventoryViewMode = "nis2" | "full";

const STORAGE_KEY = "da-invent-inventory-view-mode";

export function getStoredInventoryViewMode(): InventoryViewMode {
  if (typeof window === "undefined") return "nis2";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === "full" ? "full" : "nis2";
}

export function setStoredInventoryViewMode(mode: InventoryViewMode): void {
  window.localStorage.setItem(STORAGE_KEY, mode);
}

/** Vista inventario: NIS2 (default) o completa ITAM. */
export function useInventoryViewMode() {
  const [viewMode, setViewModeState] = useState<InventoryViewMode>("nis2");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setViewModeState(getStoredInventoryViewMode());
    setHydrated(true);
  }, []);

  const setViewMode = useCallback((mode: InventoryViewMode) => {
    setViewModeState(mode);
    setStoredInventoryViewMode(mode);
  }, []);

  const isNis2View = viewMode === "nis2";

  return { viewMode, setViewMode, isNis2View, hydrated };
}
