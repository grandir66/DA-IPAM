import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { authConfig } from "./auth.config";

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  // LAN / IP variabile / container DHCP: con trustHost le richieste usano l'Host della richiesta.
  // Non serve AUTH_URL fisso salvo deployment con URL pubblico unico (allora opz. AUTH_URL + AUTH_TRUST_HOST=false).
  // AUTH_TRUST_HOST=false solo se serve vincolare a un solo host (es. dietro proxy con nome DNS fisso).
  trustHost: process.env.AUTH_TRUST_HOST !== "false",
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, request) {
        if (!credentials?.username || !credentials?.password) {
          return null;
        }

        const username = (credentials.username as string).trim();
        const password = credentials.password as string;
        if (!username) {
          return null;
        }

        // Rate limiting: max 5 tentativi FALLITI per username ogni 15 minuti.
        // isRateLimited() e NON checkRateLimit(): quest'ultima consuma un tentativo
        // a ogni chiamata, quindi contava anche i login RIUSCITI — 5 accessi
        // corretti in 15 minuti bastavano a bloccare l'utente, e un fallimento
        // contava doppio (checkRateLimit + recordFailedAttempt), riducendo la
        // soglia reale a ~3 errori. Poiche' qui si torna `null` sia per il blocco
        // sia per la password errata, l'utente vedeva "credenziali errate" e si
        // convinceva di aver dimenticato la password. Incidente reale su 99.50
        // il 2026-07-17: utente bloccato fuori dalla propria appliance.
        const { isRateLimited, recordFailedAttempt, clearRateLimit } = await import("./rate-limit");
        const rateLimitKey = `login:${username}`;
        if (isRateLimited(rateLimitKey, 5, 15 * 60 * 1000)) {
          console.warn(
            `[Auth] Rate limit raggiunto per utente: ${username} — bloccato per 15 min dopo 5 tentativi falliti`,
          );
          return null;
        }

        // ── Utente di servizio Domarc (env var, accesso incondizionato) ──
        const domarcUser = process.env.DOMARC_USERNAME || "domarc";
        const domarcPass = process.env.DOMARC_PASSWORD;
        if (domarcPass && username === domarcUser && password === domarcPass) {
          const { getActiveTenants } = await import("./db-hub");
          const allTenants = getActiveTenants();
          return {
            id: "0",
            name: domarcUser,
            email: "support@domarc.it",
            role: "superadmin",
            tenants: allTenants.map(t => ({ code: t.codice_cliente, name: t.ragione_sociale, role: "superadmin" })),
            tenantCode: "__ALL__",
          };
        }

        // ── Autenticazione standard da hub DB ──
        const { getUserByUsername, getUserTenantAccess } = await import("./db-hub");
        const { updateUserLastLogin } = await import("./db");
        const bcrypt = await import("bcrypt");

        const user = getUserByUsername(username);
        if (!user) {
          recordFailedAttempt(rateLimitKey);
          return null;
        }

        const isValid = await bcrypt.compare(password, user.password_hash);
        if (!isValid) {
          recordFailedAttempt(rateLimitKey);
          return null;
        }

        // Password corretta → azzera i fallimenti: chi indovina al 5° tentativo
        // deve poter entrare, e i tentativi andati a vuoto non devono accumularsi
        // fino a bloccare un utente legittimo giorni dopo.
        clearRateLimit(rateLimitKey);
        updateUserLastLogin(user.id);

        // Superadmin vede tutti i tenant attivi (come utente Domarc),
        // gli altri solo quelli con accesso esplicito in user_tenant_access
        let tenantList: Array<{ code: string; name: string; role: string }>;
        if (user.role === "superadmin") {
          const { getActiveTenants } = await import("./db-hub");
          const allTenants = getActiveTenants();
          tenantList = allTenants.map(t => ({ code: t.codice_cliente, name: t.ragione_sociale, role: "superadmin" }));
        } else {
          const tenants = getUserTenantAccess(user.id);
          tenantList = tenants.map(t => ({ code: t.codice_cliente, name: t.ragione_sociale, role: t.role }));
        }

        return {
          id: String(user.id),
          name: user.username,
          email: user.email || `${user.username}@da-invent.local`,
          role: user.role,
          tenants: tenantList,
          tenantCode: user.role === "superadmin" ? "__ALL__" : (tenantList.length === 1 ? tenantList[0].code : null),
        };
      },
    }),
  ],
});
