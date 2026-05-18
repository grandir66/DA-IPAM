---
scope: API routes (Next.js App Router)
applies_to: src/app/api/**/route.ts
---

# API routes — regole

## Auth check OBBLIGATORIO

```ts
import { requireAuth, requireAdmin } from "@/lib/api-auth";

export async function GET(req: Request) {
  const session = await requireAuth();      // GET con dati sensibili
  // ...
}

export async function POST(req: Request) {
  const session = await requireAdmin();     // POST/PUT/DELETE → sempre admin
  // ...
}
```

Eccezioni senza auth: `/api/auth/*`, `/api/setup`, `/api/health`, `/api/version`. Per endpoint di test (`/api/test-snmp`, `/api/test-arp`) → `requireAdmin()` anche in dev.

## Contesto tenant

Tutte le route tenant-scoped devono passare per:

```ts
import { withTenantFromSession } from "@/lib/api-tenant";

export async function GET(req: Request) {
  return withTenantFromSession(async () => {
    // qui dentro db() risolve sul tenant del JWT
  });
}
```

NON chiamare `getDb()` da `db.ts` direttamente in route nuove: usa `db()` da `db-tenant.ts` dentro `withTenantFromSession`.

## Validazione input

Body JSON → SEMPRE Zod v4 schema + try-catch su `JSON.parse`:

```ts
const body = await req.json().catch(() => null);
const parsed = Schema.safeParse(body);
if (!parsed.success) {
  return Response.json({ error: parsed.error.issues }, { status: 400 });
}
```

Nota Zod v4: `.issues` non `.errors`. `z.record()` richiede 2 arg: `z.record(z.string(), z.unknown())`. `.nullable()` produce `T | null | undefined`.

## Error shape

```ts
return Response.json({ error: "messaggio in italiano" }, { status: 4xx | 5xx });
```

Niente stack trace nel body in produzione. Logging server-side con `console.error` (mai `console.log`).

## Rate limiting

Per endpoint sensibili (login, reset password, test credenziali in massa) usare `checkRateLimit()` da `src/lib/rate-limit.ts`.

## Anti-pattern

- `fetch('http://127.0.0.1:...')` da una route → mai. Importa la funzione interna.
- Tornare dati di tenant diverso senza `withTenantFromSession` → leak cross-tenant.
- `decrypt()` nudo su credenziali in path non-critico → usare `safeDecrypt()`.
