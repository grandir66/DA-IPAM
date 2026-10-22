"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "./sidebar";
import { SidebarProvider, useSidebar } from "./sidebar-context";
import { PageTransition } from "./page-transition";
import { UpdateChecker } from "./update-checker";

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [onboardingGateReady, setOnboardingGateReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const ac = new AbortController();
    const slow = setTimeout(() => ac.abort(), 12_000);
    const giveUp = setTimeout(() => {
      if (!cancelled) setOnboardingGateReady(true);
    }, 15_000);

    fetch("/api/onboarding/status", { signal: ac.signal, credentials: "same-origin" })
      .then(async (r) => {
        if (r.status === 401 || r.status === 403) {
          router.replace("/login");
          return;
        }
        const data = (await r.json()) as { completed?: boolean };
        if (cancelled) return;
        if (data.completed === false) {
          router.replace("/onboarding");
          return;
        }
        setOnboardingGateReady(true);
      })
      .catch(() => {
        if (!cancelled) setOnboardingGateReady(true);
      })
      .finally(() => {
        clearTimeout(slow);
        clearTimeout(giveUp);
      });

    return () => {
      cancelled = true;
      clearTimeout(slow);
      clearTimeout(giveUp);
      ac.abort();
    };
  }, [router]);

  if (!onboardingGateReady) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground text-sm">Caricamento…</p>
      </div>
    );
  }

  return (
    <SidebarProvider>
      <AppShellInner>{children}</AppShellInner>
    </SidebarProvider>
  );
}

function AppShellInner({ children }: { children: React.ReactNode }) {
  const { collapsed } = useSidebar();
  return (
    <div className="min-h-screen bg-background">
        <UpdateChecker />
        {/* Il menu legge ?tab= (voce «Health Active Directory», 19/10): useSearchParams vuole un Suspense. */}
        <Suspense fallback={null}>
          <Sidebar />
        </Suspense>
        <main className={`${collapsed ? "md:ml-16" : "md:ml-64"} min-h-screen flex flex-col transition-[margin] duration-200`}>
          {/* Niente barra in alto (Riccardo, 20/10): tema e utente stanno in fondo al menu, la
              ricerca nelle tabelle che la chiedono. Sul telefono 3,5rem in alto per il pulsante del menu. */}
          <div className="flex-1 overflow-auto px-2 pt-14 pb-2 md:px-3 md:py-3">
            <PageTransition>{children}</PageTransition>
          </div>
        </main>
      </div>
  );
}
