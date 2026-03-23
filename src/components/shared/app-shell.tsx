"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "./sidebar";
import { PageTransition } from "./page-transition";
import { GlobalSearch } from "./global-search";
import { ThemeToggle } from "./theme-toggle";
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
    <div className="min-h-screen bg-background">
        <UpdateChecker />
        <Sidebar />
        <main className="md:ml-64 min-h-screen flex flex-col">
          {/* Top bar */}
          <div className="sticky top-0 z-20 shrink-0 bg-background/80 backdrop-blur-sm border-b border-border">
            <div className="flex items-center gap-3 px-3 py-2">
              <div className="flex-1 md:pl-0 pl-10 min-w-0">
                <GlobalSearch />
              </div>
              <ThemeToggle />
            </div>
          </div>
          <div className="flex-1 overflow-auto px-2 py-2 md:px-3 md:py-3">
            <PageTransition>{children}</PageTransition>
          </div>
        </main>
      </div>
  );
}
