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
    maxAge: 24 * 60 * 60,
  },
  pages: {
    signIn: "/login",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = (user as { role?: string }).role || "viewer";
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as { role?: string }).role = token.role as string;
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
        pathname === "/api/test-snmp" ||
        pathname === "/api/test-arp"
      ) {
        return true;
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
