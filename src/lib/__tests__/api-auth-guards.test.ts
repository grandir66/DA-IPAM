/**
 * Contratto auth su route sensibili (WAVE 1 / W1-5).
 *
 * Verifica statica: per ogni {route, metodo} nella lista, il corpo del metodo
 * deve invocare la guardia attesa (`requireAdmin` o `requireSuperAdmin`).
 * Blocca le regressioni: se qualcuno rimuove la guardia, il test fallisce.
 *
 * Non è un test comportamentale (non fa una request reale) — è un lucchetto sul
 * sorgente, complementare all'audit `scripts/audit-api-auth.ts`. Estendere la
 * lista `CONTRACT` man mano che Wave 1 eleva altre route.
 *
 * Run:  node --import tsx --test src/lib/__tests__/api-auth-guards.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

interface Contract {
  route: string; // path sotto src/app/api
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  guard: "requireAdmin" | "requireSuperAdmin";
}

// Contratto atteso. I primi due sono i fix di Wave 1; gli altri sono controlli
// positivi su route già protette (documentano l'intento e catturano rimozioni).
const CONTRACT: Contract[] = [
  { route: "devices/test-provisional", method: "POST", guard: "requireAdmin" },
  { route: "analytics/anomalies/[id]", method: "PATCH", guard: "requireAdmin" },
  { route: "analytics/anomalies/[id]", method: "DELETE", guard: "requireAdmin" },
  // probe diagnostici verso host/credenziali arbitrari (audit SEC-9)
  { route: "test-snmp", method: "GET", guard: "requireAdmin" },
  { route: "test-arp", method: "GET", guard: "requireAdmin" },
  { route: "credentials/[id]/test-snmp", method: "GET", guard: "requireAdmin" },
  { route: "networks/[id]/test-snmp", method: "GET", guard: "requireAdmin" },
  { route: "networks/[id]/test-dns", method: "GET", guard: "requireAdmin" },
  { route: "credentials/[id]", method: "PUT", guard: "requireAdmin" },
  { route: "credentials/[id]", method: "DELETE", guard: "requireAdmin" },
];

/** Estrae il corpo di un metodo HTTP esportato (slice fino al prossimo export). */
function methodSlice(src: string, method: string): string | null {
  const re = new RegExp(
    `export\\s+(?:async\\s+)?(?:function\\s+${method}\\b|const\\s+${method}\\s*=)`
  );
  const start = src.search(re);
  if (start < 0) return null;
  const rest = src.slice(start + 1);
  const nextRel = rest.search(
    /export\s+(?:async\s+)?(?:function\s+(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b|const\s+(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*=)/
  );
  const end = nextRel < 0 ? src.length : start + 1 + nextRel;
  return src.slice(start, end);
}

for (const c of CONTRACT) {
  test(`${c.method} /api/${c.route} → ${c.guard}`, () => {
    const file = join(ROOT, "src/app/api", c.route, "route.ts");
    const src = readFileSync(file, "utf8");
    const slice = methodSlice(src, c.method);
    assert.ok(slice, `metodo ${c.method} non trovato in ${c.route}/route.ts`);
    const re = new RegExp(`\\b${c.guard}\\s*\\(`);
    assert.match(
      slice,
      re,
      `${c.method} /api/${c.route} deve invocare ${c.guard}() — guardia mancante o indebolita`
    );
  });
}
