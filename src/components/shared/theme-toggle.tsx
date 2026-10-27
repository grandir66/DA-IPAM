"use client";

import { useEffect, useState } from "react";

/**
 * Tema chiaro/scuro. Dal 23/10 (Riccardo: in basso restava un blocco enorme) è una voce del
 * menu utente in cima alla barra a sinistra; l'etichetta dice dove si va, non dove si è:
 * «Tema scuro» quando si è sul chiaro. Il menu utente monta l'hook su ogni pagina anche a
 * menu chiuso: è il punto che applica il tema salvato all'apertura.
 */
export function useTema() {
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

  return { dark, mounted, toggle, etichetta: dark ? "Tema chiaro" : "Tema scuro" };
}
