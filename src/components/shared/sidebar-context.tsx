"use client";

import { createContext, useContext, useEffect, useState } from "react";

type SidebarCtx = {
  collapsed: boolean;
  toggle: () => void;
  setCollapsed: (v: boolean) => void;
};

const SidebarContext = createContext<SidebarCtx | null>(null);
const STORAGE_KEY = "da-ipam:sidebar-collapsed";

/**
 * Stato globale del collapse della sidebar (solo desktop md+).
 * Persistito in localStorage così resta tra le sessioni.
 * Condiviso tra Sidebar (larghezza) e AppShell (margine del contenuto).
 */
export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsedState] = useState(false);

  // Idratazione post-mount per evitare mismatch SSR.
  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) === "1") setCollapsedState(true);
    } catch {
      /* localStorage non disponibile: default espanso */
    }
  }, []);

  const setCollapsed = (v: boolean) => {
    setCollapsedState(v);
    try {
      localStorage.setItem(STORAGE_KEY, v ? "1" : "0");
    } catch {
      /* no-op */
    }
  };

  const toggle = () => setCollapsed(!collapsed);

  return (
    <SidebarContext.Provider value={{ collapsed, toggle, setCollapsed }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar(): SidebarCtx {
  const ctx = useContext(SidebarContext);
  // Fallback no-op se usato fuori dal provider (es. test isolati).
  return ctx ?? { collapsed: false, toggle: () => {}, setCollapsed: () => {} };
}
