import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { recinto } from "./cliente/recinto";

/**
 * Auth config that does NOT import db.ts or bcrypt.
 * Used by middleware (Edge runtime) for session validation only.
 * The actual authorize() logic with db/bcrypt runs in Node.js runtime
 * via the full auth.ts module.
 */
/** Mac del tecnico (ADR 0037): profilo della sonda trunk all'accesso e al cambio. Altrove niente. */
async function segnaProfiloTrunkSeTecnico(codice: string): Promise<void> {
  try {
    const { isTecnico } = await import("./profilo");
    if (!isTecnico()) return;
    const { segnaCambioProfiloTrunk } = await import("./trunk/tecnico-profilo");
    segnaCambioProfiloTrunk(codice);
  } catch (e) {
    console.warn(`[Auth] profilo della sonda trunk non segnato: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export const authConfig: NextAuthConfig = {
  providers: [
    // Segnaposto per l'Edge runtime, come quello sotto: la `authorize` vera
    // vive in auth.ts, che qui non può essere importato (usa il database).
    // Deve però ESISTERE anche qui, o il middleware non riconoscerebbe il
    // provider e la sessione emessa da «domarc» risulterebbe di nessuno.
    Credentials({
      id: "domarc",
      name: "Account Domarc",
      credentials: {},
      authorize: () => null,
    }),
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
  events: {
    // «Esci»: segna l'ora sull'utente, così le richieste in ritardo non riaprono la sessione.
    async signOut(message) {
      const token = "token" in message ? message.token : null;
      const userId = token?.userId && token.userId !== "0" ? Number(token.userId) : null;
      if (!userId) return;
      const { segnaUscita } = await import("./accesso/sessione");
      segnaUscita(userId);
    },
  },
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.role = (user as { role?: string }).role || "viewer";
        token.vistaCliente = (user as { vistaCliente?: boolean }).vistaCliente === true;
        token.tenants = (user as Record<string, unknown>).tenants || [];
        token.tenantCode = (user as Record<string, unknown>).tenantCode || null;
        // Persist user id in token: NextAuth lo mette in token.sub di default,
        // ma lo replichiamo esplicitamente per robustezza tra refresh/update.
        const rawId = (user as { id?: string }).id;
        if (rawId) token.userId = rawId;
        // Ora dell'accesso: non cambia ai rinnovi, a differenza di `iat` (lib/accesso/sessione.ts).
        token.accessoAt = Date.now();
        if (typeof token.tenantCode === "string") await segnaProfiloTrunkSeTecnico(token.tenantCode);
      } else if (token.userId && token.userId !== "0") {
        // Dopo «Esci» un token di un accesso precedente non vale più, anche se una richiesta
        // partita prima dell'uscita lo rinnova: null fa cancellare il cookie ad Auth.js.
        const { sessioneRevocata } = await import("./accesso/sessione");
        if (sessioneRevocata(Number(token.userId), token.accessoAt as number | undefined)) return null;
      }
      // Cambio d'istanza dal browser: solo verso le istanze dell'utente, «tutte» solo al
      // superadmin (prima passava qualsiasi codice, 23/10). Rifiutato = resta dov'era.
      // Installazione «tecnico» (ADR 0037): un aggiornamento senza profilo chiesto rinfresca
      // l'elenco dei profili del superadmin. Serve a chi è entrato prima di averne: altrimenti il
      // selettore resta vuoto finché non esce e rientra. Altrove non succede niente di nuovo.
      if (trigger === "update" && !session?.tenantCode && token.role === "superadmin") {
        const { isTecnico } = await import("./profilo");
        if (isTecnico()) {
          try {
            const { getActiveTenants } = await import("./db-hub");
            token.tenants = getActiveTenants().map((t: { codice_cliente: string; ragione_sociale: string }) => ({
              code: t.codice_cliente,
              name: t.ragione_sociale,
              role: "superadmin",
            }));
          } catch { /* fallback: mantieni lista esistente */ }
        }
      }
      if (trigger === "update" && session?.tenantCode) {
        const { istanzaAmmessa, segnaUltimaIstanza } = await import("./accesso/sessione");
        const richiesta = String(session.tenantCode);
        const userId = token.userId && token.userId !== "0" ? Number(token.userId) : null;
        if (!istanzaAmmessa(userId, token.role as string | undefined, richiesta)) {
          console.warn(`[Auth] utente ${token.userId ?? "?"}: cambio d'istanza verso «${richiesta}» rifiutato`);
          return token;
        }
        token.tenantCode = richiesta;
        if (userId) segnaUltimaIstanza(userId, richiesta);
        // Mac del tecnico: la sonda trunk si azzera e riparte sul cliente nuovo (Riccardo, 08/11).
        await segnaProfiloTrunkSeTecnico(richiesta);
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
        const u = session.user as unknown as Record<string, unknown>;
        // id: prima token.userId (esplicito), fallback token.sub (standard JWT).
        u.id = (token.userId as string | undefined) ?? token.sub ?? null;
        u.role = token.role as string;
        u.vistaCliente = token.vistaCliente === true;
        u.tenantCode = token.tenantCode as string | null;
        u.tenants = token.tenants || [];
      }
      return session;
    },
    authorized({ auth, request: { nextUrl, method } }) {
      const isLoggedIn = !!auth?.user;
      const pathname = nextUrl.pathname;

      // Allow auth API, setup, login, e installer dell'agente d'inventario.
      // (L'installatore dell'agente Python remoto non c'è più dalla v0.9.811.)
      // NB: `/api/test-snmp` e `/api/test-arp` RIMOSSI dall'allowlist (erano
      // debug leftover): ora richiedono admin nell'handler (audit SEC-9).
      if (
        pathname.startsWith("/api/auth") ||
        pathname === "/setup" ||
        pathname === "/api/setup" ||
        pathname === "/api/health" ||
        pathname === "/api/version" ||
        pathname === "/api/inventory/ingest" ||
        pathname.startsWith("/api/integrations/inventory-agent/install/")
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

      // Redirect fatto qui e non da NextAuth: il suo aggiunge `callbackUrl` con l'indirizzo
      // interno del server (https://0.0.0.0:3001/), che compariva nella barra del browser
      // dietro nginx (prova del 29/10, 79994-ipam-4). La pagina di login non lo usa.
      if (!isLoggedIn) return Response.redirect(new URL("/login", nextUrl));
      const esito = recinto((auth?.user as { vistaCliente?: boolean } | undefined)?.vistaCliente === true, pathname, method);
      if (esito === "vai_a_cliente") return Response.redirect(new URL("/cliente", nextUrl));
      if (esito === "vietato") return Response.json({ error: "Non consentito" }, { status: 403 });
      return true;
    },
  },
};
