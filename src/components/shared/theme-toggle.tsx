"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Tema chiaro/scuro come voce in fondo al menu a sinistra (Riccardo, 20/10: via la barra in
 * alto). La scritta dice dove si va, non dove si è: «Tema scuro» quando si è sul chiaro.
 * È anche il punto che applica il tema salvato all'apertura: il menu c'è su ogni pagina.
 */
export function ThemeToggle({ compresso = false }: { compresso?: boolean }) {
  const [mounted, setMounted] = useState(false);
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const isDark = stored === "dark" || (!stored && prefersDark);
    setDark(isDark);
    document.documentElement.classList.toggle("dark", isDark);
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted) {
      document.documentElement.classList.toggle("dark", dark);
    }
  }, [dark, mounted]);

  function toggle() {
    const next = !dark;
    setDark(next);
    localStorage.setItem("theme", next ? "dark" : "light");
  }

  const etichetta = dark ? "Tema chiaro" : "Tema scuro";
  return (
    <button
      type="button"
      onClick={toggle}
      disabled={!mounted}
      title={compresso ? etichetta : undefined}
      className={cn(
        "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors w-full",
        compresso && "md:justify-center md:px-0",
      )}
    >
      {dark ? <Sun className="h-4 w-4 shrink-0" /> : <Moon className="h-4 w-4 shrink-0" />}
      <span className={cn(compresso && "md:hidden")}>{mounted ? etichetta : "Tema"}</span>
    </button>
  );
}
