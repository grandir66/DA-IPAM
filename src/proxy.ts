/**
 * Usa lo stesso `auth` di auth.ts così JWT/session e segreto coincidono con le API route.
 * Una seconda istanza NextAuth(authConfig) può far risultare la sessione assente dopo il login.
 */
import { auth } from "@/lib/auth";

export const proxy = auth;

export const config = {
  // ws/ssh escluso: è un upgrade WebSocket gestito dal custom server (server.ts),
  // NON deve passare dal middleware auth (redirect /login → corrompe l'handshake).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/auth|ws/ssh|logo-white\\.png|logo-color\\.png).*)"],
};
