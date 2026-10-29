/**
 * Redirect al login senza `callbackUrl` (29/10/2026): quello di NextAuth portava
 * l'indirizzo interno del server (https://0.0.0.0:3001/) nella barra del browser.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { authConfig } from "@/lib/auth.config";

type Autorizza = (p: { auth: { user?: unknown } | null; request: { nextUrl: URL } }) => unknown;
const autorizza = authConfig.callbacks?.authorized as unknown as Autorizza;

test("senza sessione si va a /login senza indirizzo interno", async () => {
  const r = await autorizza({ auth: null, request: { nextUrl: new URL("https://0.0.0.0:3001/hosts?x=1") } });
  assert.ok(r instanceof Response);
  const dove = new URL((r as Response).headers.get("location") ?? "");
  assert.equal(dove.pathname, "/login");
  assert.equal(dove.search, "");
});

test("con sessione si passa", async () => {
  const r = await autorizza({ auth: { user: { id: "1" } }, request: { nextUrl: new URL("https://0.0.0.0:3001/hosts") } });
  assert.equal(r, true);
});

test("le rotte libere restano libere", async () => {
  const r = await autorizza({ auth: null, request: { nextUrl: new URL("https://0.0.0.0:3001/api/health") } });
  assert.equal(r, true);
});
