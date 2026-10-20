/**
 * Rotte dell'agente Python remoto: tolte del tutto (v0.9.811, 20/10/2026).
 *
 * L'agente è stato tolto con la v0.9.810 (decisione 26 della spec NetBird); le sue rotte
 * erano rimaste ferme (410) per un giro, insieme a `/agent-install.sh` e alla pagina
 * `/tenants/[id]/agent`: chi aggiornava con un `update.sh` più vecchio della v0.9.805
 * leggeva i tipi della build attiva che le citavano, e senza i file la build nuova
 * falliva (incidente della v0.9.804 con `/api/search`, 20/10). Verificato il 20/10 che
 * tutte le installazioni hanno lo script nuovo (da-invent 0.9.808, DTS 0.9.810, PX-NAS
 * 0.9.810): le rotte si tolgono, e questa prova impedisce che tornino per sbaglio.
 *
 * Run: node --import tsx --test src/lib/executor/__tests__/rotte-agente-tolte.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const RADICE = process.cwd();

const TOLTI = [
  "src/app/api/agents",
  "src/app/api/tenant-agents",
  "src/app/api/tenants/[id]/agent",
  "src/app/agent-install.sh",
  "src/app/(dashboard)/tenants/[id]/agent",
  "src/lib/agente-remoto-tolto.ts",
];

test("le rotte e la pagina dell'agente remoto non esistono più nell'albero", () => {
  const presenti = TOLTI.filter((p) => existsSync(join(RADICE, p)));
  assert.deepEqual(presenti, []);
});

test("`/agent-install.sh` non è più fra i percorsi pubblici della guardia", () => {
  const sorgente = readFileSync(join(RADICE, "src/lib/auth.config.ts"), "utf8");
  assert.equal(sorgente.includes("/agent-install.sh"), false);
});

test("`/agents` resta: è la pagina «URL dell'hub» a cui rimanda il Launchpad", () => {
  assert.equal(existsSync(join(RADICE, "src/app/(dashboard)/agents/page.tsx")), true);
});
