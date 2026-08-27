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

        // Login: backoff INCREMENTALE e VISIBILE. I primi tentativi non bloccano;
        // dal superamento della soglia scatta un cooldown che raddoppia a ogni
        // ulteriore fallimento (30s → 1m → 2m → … cap 15m). Solo i FALLIMENTI
        // contano; un successo azzera (clearRateLimit). Se bloccato si torna qui
        // SENZA toccare la password e SENZA registrare un nuovo fallimento (i
        // tentativi durante il cooldown non aggravano il blocco). La UI mostra il
        // countdown via GET /api/auth/lock-state, così l'utente sa di dover
        // aspettare e non crede di aver perso la password. Radice degli incidenti
        // 99.50 (17/07) e appliance DTS (blocco "muto" = "credenziali errate").
        const { loginLockState, recordFailedAttempt, clearRateLimit } = await import("./rate-limit");
        const rateLimitKey = `login:${username}`;
        const lock = loginLockState(rateLimitKey);
        if (lock.locked) {
          console.warn(
            `[Auth] ${username}: login bloccato ancora ${lock.retryAfterSec}s dopo ${lock.fails} tentativi falliti`,
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
          // Single-tenant (es. appliance): TUTTI, superadmin incluso, defaultano
          // all'unico tenant — altrimenti il superadmin resta su __ALL__ (vista
          // aggregata) e ogni pagina tenant-scoped fa 409 (niente tenant risolto).
          // Multi-tenant: superadmin → __ALL__ (+ switcher), altri → selezione.
          tenantCode:
            tenantList.length === 1
              ? tenantList[0].code
              : user.role === "superadmin"
                ? "__ALL__"
                : null,
        };
      },
    }),
  ],
});
