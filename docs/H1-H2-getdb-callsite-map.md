# Mappa call-site `getDb()` — analisi tenant-leak H1/H2

- **Data**: 2026-07-19 · **Tipo**: analisi read-only (nessuna modifica al codice)
- **Scopo**: precondizione WAVE 5 (refactor facade `db.ts`) — capire dove `getDb()` gira
  senza contesto tenant prima di cambiarne il comportamento. Audit di riferimento: H1, H2.

## Come `getDb()` risolve il tenant (`src/lib/db.ts:95`)

1. Se c'è un **contesto tenant attivo** (AsyncLocalStorage via `getCurrentTenantCode()`) →
   `getTenantDb(tenantCode)`. ✅ tenant corretto.
2. Altrimenti, se esistono `hub.db` + `tenants/DEFAULT.db` → **fallback silenzioso a `DEFAULT`**. ← H1
3. Altrimenti (legacy single-tenant) → `ipam.db`.

Il rischio H1 è il punto **2**: codice che chiama `getDb()` (direttamente o via una delle ~300
funzioni query di `db.ts`) **fuori** da un `withTenant()` → opera su DEFAULT senza accorgersene.
Su single-tenant è innocuo (DEFAULT è l'unico tenant); su multi-tenant può leggere/scrivere il
tenant sbagliato.

## Classificazione dei call-site (314 chiamate `getDb()`)

La grande maggioranza sono chiamate **interne** alle funzioni query di `db.ts`: il rischio non è
lì, ma in **chi invoca quelle funzioni senza contesto**. Analisi per superficie:

| Superficie | Contesto tenant | Esito |
|---|---|---|
| **API routes** (`src/app/api/**`, 7 file con `getDb()` diretto + tutte via funzioni db) | `withTenantFromSession()` avvolge l'handler | ✅ SICURO |
| **Cron scheduler** (`src/lib/cron/scheduler.ts`) | itera `getActiveTenants()` e avvolge ogni job in `withTenant(tenant.codice_cliente)` (righe 19/77/117) | ✅ SICURO (per-tenant) |
| **Cron jobs** (`src/lib/cron/jobs.ts:879`) | eseguiti DENTRO il wrapper dello scheduler | ✅ SICURO (eredita il contesto) |
| **lib helper** (`ad-client`, `router-client`, `physical-device-db`, `identity-resolver`) | nessun `getDb()` a **module-scope**; le funzioni sono chiamate da route/cron già in contesto | ✅ SICURO (eredita) |
| **`server.ts`** (startup) | 0 chiamate `getDb()` | ✅ n/a |
| **backup/scheduler** | non usa `getDb()` (opera su path/file) | ✅ n/a |

**Nessun `getDb()` a livello di modulo** (top-level) trovato → non ci sono chiamate eseguite al
load fuori da ogni contesto.

## Conclusione: rischio H1 pratico BASSO

Tutte le superfici background principali (scheduler, API) **avvolgono già** l'esecuzione in
`withTenant`. Il fallback DEFAULT di H1 è una **rete di sicurezza** che oggi non viene colpita
dai path noti. Questo significa che il refactor facade (WAVE 5) può procedere usando questa
mappa come garanzia: **non** si sta rimuovendo un comportamento su cui i path legittimi dipendono
in modo nascosto.

## Il residuo VERO: H2 — `__ALL__` → DEFAULT

`withTenantFromSession` (`src/lib/api-tenant.ts:42`) rimappa `tenantCode === "__ALL__"` (vista
aggregata superadmin) a `"DEFAULT"`. Conseguenza:

- **Letture** in modalità `__ALL__`: il superadmin vede i dati di **DEFAULT**, non un aggregato
  reale. Fuorviante ma non distruttivo.
- **Mutazioni** in modalità `__ALL__`: una POST/PUT/DELETE scrive su **DEFAULT.db**, non sul
  tenant inteso. ← bug reale, ma path stretto (solo superadmin in vista "tutti i tenant").

### Fix H2 — FATTO (v0.3.153)

`withTenantFromSession` **non rimappa più** `__ALL__` a DEFAULT: ritorna **409** "seleziona un
tenant specifico". La decisione è estratta in `resolveSessionTenant(tenantCode)` (pura, testata in
`src/lib/__tests__/resolve-session-tenant.test.ts`). Verificato sicuro per le letture: le 4 viste
aggregate (networks/hosts/devices/search) usano `queryAllTenants` e branchano **prima** di
arrivare qui, quindi non ricevono il 409; nessun test codificava il vecchio comportamento; build
di produzione completo verde su tutte le 181 route.

**Nota residua** (non-distruttiva): `getServerTenantCode()` (letture Server Component) rimappa
ancora `__ALL__`→DEFAULT. È solo lettura (nessun rischio di scrittura sul tenant sbagliato);
allinearla al 409 è un follow-up minore di coerenza, non di sicurezza.

## Raccomandazioni per WAVE 5

1. Il refactor `db.ts` → thin facade può procedere: i path sono mappati e sicuri.
2. Chiudere H2 col fix bounded sopra **prima** o **insieme** al refactor.
3. Opzionale (osservabilità): `console.warn("[db] getDb() fallback DEFAULT senza contesto")` nel
   ramo di fallback, per intercettare a runtime eventuali nuovi call-site non wrappati (non cambia
   comportamento). Utile durante il refactor, da rimuovere dopo.
