/**
 * Usa lo stesso `auth` di auth.ts così JWT/session e segreto coincidono con le API route.
 * Una seconda istanza NextAuth(authConfig) può far risultare la sessione assente dopo il login.
 */
import { auth } from "@/lib/auth";

export const proxy = auth;

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/auth|logo-white\\.png|logo-color\\.png).*)"],
};
