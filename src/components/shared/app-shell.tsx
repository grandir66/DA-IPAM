"use client";

import { Sidebar } from "./sidebar";
import { PageTransition } from "./page-transition";
import { GlobalSearch } from "./global-search";
import { ThemeToggle } from "./theme-toggle";
import { SessionProvider } from "next-auth/react";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <div className="min-h-screen bg-background">
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
    </SessionProvider>
  );
}
