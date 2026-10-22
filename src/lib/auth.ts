import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { authConfig } from "./auth.config";
import { accessoDomarcAttivo, identitaDaAuth, traduzionePer } from "./daauth";

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  // LAN / IP variabile / container DHCP: con trustHost le richieste usano l'Host della richiesta.
  // Non serve AUTH_URL fisso salvo deployment con URL pubblico unico (allora opz. AUTH_URL + AUTH_TRUST_HOST=false).
  // AUTH_TRUST_HOST=false solo se serve vincolare a un solo host (es. dietro proxy con nome DNS fisso).
  trustHost: process.env.AUTH_TRUST_HOST !== "false",
  providers: [
    // ── Accesso con l'account Domarc (DA-Auth) ────────────────────────────
    //
    // La via normale dal 2026-09-08. Non chiede credenziali: legge il cookie
    // di sessione di entra.domarc.it che il browser manda già (è emesso su
    // `.domarc.it`) e chiede a DA-Auth chi è quella persona.
    //
    // Il login locale qui sotto NON si spegne: è la riserva. Se DA-Auth non
    // risponde, `identitaDaAuth` restituisce null e si entra come prima.
    Credentials({
      id: "domarc",
      name: "Account Domarc",
      credentials: {},
      async authorize(_credentials, request) {
        // Difesa in profondità: la pagina non mostra il bottone quando
        // l'opzione è spenta, ma una richiesta costruita a mano arriverebbe
        // comunque qui. Su un'appliance di cliente questa strada non esiste.
        if (!accessoDomarcAttivo()) return null;

        const identita = await identitaDaAuth(request?.headers?.get("cookie"));
        if (!identita) return null;

        const { getUserByUsername, getUserTenantAccess, getActiveTenants, createUser, setUserTenantAccess } =
          await import("./db-hub");
        const { updateUserLastLogin } = await import("./db");

        let user = getUserByUsername(identita.username);

        // Autenticare non è autorizzare. Chi non ha un'utenza qui entra solo
        // se **qualcuno l'ha dichiarato** su questa applicazione in DA-Auth:
        // allora l'utenza si crea, col ruolo e i clienti che la tabella di
        // traduzione associa al suo. Non è auto-provisioning — non si inventa
        // niente, si esegue una decisione presa e firmata.
        //
        // Qui il rischio è doppio rispetto alle altre applicazioni: una riga
        // creata al volo senza clienti non servirebbe a niente, e una con i
        // clienti sbagliati sarebbe un danno. Per questo i clienti si
        // dichiarano per codice, e un codice che non esiste NON diventa
        // «tutti»: viene saltato.
        if (!user) {
          if (!identita.dichiarato) {
            console.warn(
              `[Auth] ${identita.username}: riconosciuto da DA-Auth ma non dichiarato su DA-IPAM`,
            );
            return null;
          }
          const traduzione = traduzionePer(identita.role);
          if (!traduzione) {
            console.warn(
              `[Auth] ${identita.username}: dichiarato con ruolo «${identita.role}», che qui ` +
                "non ha una traduzione — vedi RUOLO_DOMARC_A_LOCALE",
            );
            return null;
          }
          const crypto = await import("node:crypto");
          const bcryptCrea = await import("bcrypt");
          // Password casuale e subito dimenticata: a questa utenza si arriva
          // solo da entra.domarc.it. Nessuna seconda credenziale da custodire.
          const segreto = crypto.randomBytes(32).toString("hex");
          const creato = createUser(
            identita.username,
            await bcryptCrea.hash(segreto, 12),
            traduzione.ruolo,
            null,
            `${identita.username}@domarc.it`,
          );
          const perCodice = new Map(getActiveTenants().map(t => [t.codice_cliente, t.id]));
          for (const codice of traduzione.tenant ?? []) {
            const id = perCodice.get(codice);
            if (id === undefined) {
              console.warn(`[Auth] ${identita.username}: cliente «${codice}» non esiste, saltato`);
              continue;
            }
            setUserTenantAccess(creato.id, id, traduzione.ruolo);
          }
          user = creato;
          console.warn(
            `[Auth] ${identita.username}: utenza DA-IPAM creata su dichiarazione di DA-Auth, ` +
              `ruolo ${traduzione.ruolo}, clienti [${(traduzione.tenant ?? []).join(", ") || "nessuno"}]`,
          );
        }
        updateUserLastLogin(user.id);

        // ⚠️ Ruolo e tenant vengono dalla riga LOCALE, non da DA-Auth. I due
        // sistemi parlano vocabolari diversi (DA-IPAM ha `superadmin` e
        // l'accesso per tenant, DA-Auth no): tradurre in silenzio vorrebbe
        // dire inventare una corrispondenza che nessuno ha deciso, e in una
        // direzione darebbe a qualcuno più di quello che ha oggi.
        let tenantList: Array<{ code: string; name: string; role: string }>;
        if (user.role === "superadmin") {
          tenantList = getActiveTenants().map(t => ({
            code: t.codice_cliente, name: t.ragione_sociale, role: "superadmin",
          }));
        } else {
          tenantList = getUserTenantAccess(user.id).map(t => ({
            code: t.codice_cliente, name: t.ragione_sociale, role: t.role,
          }));
        }

        return {
          id: String(user.id),
          name: user.username,
          email: user.email || `${user.username}@da-invent.local`,
          role: user.role,
          tenants: tenantList,
          tenantCode:
            tenantList.length === 1
              ? tenantList[0].code
              : user.role === "superadmin"
                ? "__ALL__"
                : null,
        };
      },
    }),
    Credentials({
      name: "credentials",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
        codice: { label: "Codice", type: "text" },
      },
      async authorize(credentials) {
        // Password, blocco dei tentativi (backoff incrementale e visibile: incidenti 99.50 del
        // 17/07 e appliance cliente A) e verifica in due passaggi per chi l'admin l'ha richiesta
        // stanno in una funzione sola, la stessa del passo 1 della pagina (ADR 0023).
        const { verificaAccessoLocale } = await import("./accesso/accesso-locale");
        const esito = await verificaAccessoLocale(
          {
            username: String(credentials?.username ?? ""),
            password: String(credentials?.password ?? ""),
            codice: credentials?.codice ? String(credentials.codice) : undefined,
          },
          { fase: "accesso" },
        );
        if (esito.esito === "bloccato") {
          console.warn(`[Auth] ${String(credentials?.username ?? "").trim()}: login bloccato ancora ${esito.secondi}s`);
          return null;
        }

        // ── Utente di servizio Domarc (env var, accesso incondizionato, senza codice) ──
        if (esito.esito === "servizio") {
          const { getActiveTenants } = await import("./db-hub");
          const allTenants = getActiveTenants();
          return {
            id: "0",
            name: esito.username,
            email: "support@domarc.it",
            role: "superadmin",
            tenants: allTenants.map(t => ({ code: t.codice_cliente, name: t.ragione_sociale, role: "superadmin" })),
            tenantCode: "__ALL__",
          };
        }
        if (esito.esito !== "entra") return null;

        const user = esito.utente;
        const { getUserTenantAccess } = await import("./db-hub");
        const { updateUserLastLogin } = await import("./db");
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
