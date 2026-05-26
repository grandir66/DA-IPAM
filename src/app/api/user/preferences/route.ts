/**
 * Preferenze utente persistenti server-side (chiave-valore JSON).
 * Risolve la limitazione del localStorage che è browser-specifico: con questo
 * endpoint le impostazioni (es. colonne visibili in /discovery) seguono l'utente
 * tra browser/device.
 *
 * Storage: tabella `settings` di hub.db con key `user:<email>:<scope>`.
 * Auth: requireAuth (qualsiasi utente loggato può leggere/scrivere le proprie).
 *
 * GET  /api/user/preferences?key=discovery-columns   → { value: string|null }
 * PUT  /api/user/preferences  { key, value: string } → { ok: true }
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { getSetting, setSetting } from "@/lib/db-hub";

export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store, private" };

// Lista bianca di chiavi gestite — limita superficie e previene name collisions.
const ALLOWED_KEYS = new Set([
  "discovery-columns",
  "discovery-filters",
  "objects-tab-prefs",
]);

function userScope(email: string | null | undefined, key: string): string {
  return `user:${email ?? "_"}:${key}`;
}

export async function GET(req: Request) {
  const authCheck = await requireAuth();
  if (isAuthError(authCheck)) return authCheck;

  const key = new URL(req.url).searchParams.get("key") ?? "";
  if (!ALLOWED_KEYS.has(key)) {
    return NextResponse.json({ error: "key non ammessa" }, { status: 400 });
  }

  const email = authCheck.user.email;
  const value = getSetting(userScope(email, key));
  return NextResponse.json({ value }, { headers: NO_CACHE });
}

const BodySchema = z.object({
  key: z.string().min(1).max(80),
  value: z.string().max(20_000), // JSON serializzato, molto generoso
});

export async function PUT(req: Request) {
  const authCheck = await requireAuth();
  if (isAuthError(authCheck)) return authCheck;

  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON non valido" }, { status: 400 }); }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  if (!ALLOWED_KEYS.has(parsed.data.key)) {
    return NextResponse.json({ error: "key non ammessa" }, { status: 400 });
  }

  const email = authCheck.user.email;
  setSetting(userScope(email, parsed.data.key), parsed.data.value);
  return NextResponse.json({ ok: true }, { headers: NO_CACHE });
}
