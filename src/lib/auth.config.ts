import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";

/**
 * Auth config that does NOT import db.ts or bcrypt.
 * Used by middleware (Edge runtime) for session validation only.
 * The actual authorize() logic with db/bcrypt runs in Node.js runtime
 * via the full auth.ts module.
 */
export const authConfig: NextAuthConfig = {
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      // This authorize is a placeholder for the Edge runtime.
      // The real authorize logic is in auth.ts which overrides this.
      authorize: () => null,
    }),
  ],
  session: {
    strategy: "jwt",
    maxAge: 8 * 60 * 60, // 8 ore — poi richiede nuovo login
    updateAge: 4 * 60 * 60, // Rinnova token solo se più vecchio di 4 ore
  },
  pages: {
    signIn: "/login",
  },
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.role = (user as { role?: string }).role || "viewer";
        token.tenants = (user as Record<string, unknown>).tenants || [];
        token.tenantCode = (user as Record<string, unknown>).tenantCode || null;
      }
      // Allow client-side tenant switch via session update
      if (trigger === "update" && session?.tenantCode) {
        token.tenantCode = session.tenantCode;
        // Ricarica lista tenant per superadmin (potrebbe aver creato nuovi clienti)
        if (token.role === "superadmin") {
          try {
            const { getActiveTenants } = await import("./db-hub");
            const allTenants = getActiveTenants();
            token.tenants = allTenants.map((t: { codice_cliente: string; ragione_sociale: string }) => ({
              code: t.codice_cliente,
              name: t.ragione_sociale,
              role: "superadmin",
            }));
          } catch { /* fallback: mantieni lista esistente */ }
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as unknown as Record<string, unknown>).role = token.role as string;
        (session.user as unknown as Record<string, unknown>).tenantCode = token.tenantCode as string | null;
        (session.user as unknown as Record<string, unknown>).tenants = token.tenants || [];
      }
      return session;
    },
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const pathname = nextUrl.pathname;

      // Allow auth API, setup, login, and debug test APIs
      if (
        pathname.startsWith("/api/auth") ||
        pathname === "/setup" ||
        pathname === "/api/setup" ||
        pathname === "/api/health" ||
        pathname === "/api/version" ||
        pathname === "/api/test-snmp" ||
        pathname === "/api/test-arp"
      ) {
        return true;
      }

      if (pathname === "/select-tenant") {
        return isLoggedIn;
      }

      if (pathname === "/login") {
        if (isLoggedIn) {
          return Response.redirect(new URL("/", nextUrl));
        }
        return true;
      }

      return isLoggedIn;
    },
  },
};
