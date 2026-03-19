"use client";

import { SessionProvider } from "next-auth/react";

/** Richiesto per signIn / useSession su pagine fuori dal dashboard (es. /login). */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
