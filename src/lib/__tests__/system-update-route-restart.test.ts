/**
 * INVARIANTE: sotto systemd la rotta /api/system/update non esce MAI con 0 e non
 * si rilancia da sé; il riavvio lo chiede alle funzioni di src/lib/app-service.ts.
 *
 * Perché (revisione del 2026-10-12, dopo INS-1): se `systemctl is-active`
 * scadeva (3 s, macchina sotto carico) o l'unità aveva un nome diverso, la rotta
 * concludeva «nessun servizio» e ripiegava sul rilancio di sé con
 * `process.exit(0)`. Sotto systemd un'uscita con 0 non viene riavviata
 * (Restart=on-failure) e il figlio staccato muore col gruppo dell'unità: il
 * servizio restava spento. Lo stesso sulle appliance come DTS, che ricevono dev
 * ogni 15 minuti. La rotta importa next/server e l'autenticazione, quindi la si
 * prova leggendone il sorgente, come le altre prove-invariante del repo.
 *
 * Dice anche che «Aggiorna» programma da sé il riavvio (prima lo chiedeva il
 * browser, se riceveva la risposta) e che l'azione si legge da indirizzo o corpo.
 *
 * Run: node --import tsx --test src/lib/__tests__/system-update-route-restart.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROTTA = path.join(process.cwd(), "src", "app", "api", "system", "update", "route.ts");

/** Il sorgente senza commenti: la prosa può nominare process.exit(0). */
function senzaCommenti(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const SRC = senzaCommenti(fs.readFileSync(ROTTA, "utf8"));

/**
 * Il corpo `{ … }` di `function <nome>(`. Basta per le funzioni di questa rotta:
 * nessuna ha graffe nei parametri o nel tipo di ritorno.
 */
function corpo(nome: string): string {
  const inizio = SRC.indexOf(`function ${nome}(`);
  assert.notEqual(inizio, -1, `manca function ${nome} in route.ts`);
  const apertura = SRC.indexOf("{", inizio);
  let profondita = 0;
  for (let i = apertura; i < SRC.length; i++) {
    if (SRC[i] === "{") profondita++;
    else if (SRC[i] === "}" && --profondita === 0) return SRC.slice(apertura, i + 1);
  }
  throw new Error(`corpo di ${nome} non chiuso`);
}

test("il riavvio decide con app-service: unità del proprio cgroup o uscita con 1", () => {
  const riavvia = corpo("riavviaApp");
  assert.match(riavvia, /planRestart\(\s*readRestartContext\(\)\s*\)/);
  assert.match(riavvia, /restartWithSystemd\(/);
  assert.match(riavvia, /exitForSystemd\(/);
  assert.doesNotMatch(riavvia, /process\.exit/, "sotto systemd si esce solo con exitForSystemd (1)");
  // il rilancio di sé solo nel ramo «fuori da systemd»
  assert.match(
    riavvia,
    /if\s*\(\s*piano\.mode\s*===\s*"not-systemd"\s*\)\s*\{\s*riavviaFuoriDaSystemd\(\);\s*return;\s*\}/,
  );
  assert.equal(riavvia.match(/riavviaFuoriDaSystemd\(/g)?.length, 1);
});

test("process.exit compare solo nel ramo fuori da systemd (PM2, sviluppo)", () => {
  const fuori = corpo("riavviaFuoriDaSystemd");
  const resto = SRC.replace(fuori, "");
  assert.doesNotMatch(resto, /process\.exit\s*\(/, "process.exit fuori da riavviaFuoriDaSystemd");
  assert.equal(
    SRC.match(/(?<!function )riavviaFuoriDaSystemd\(\)/g)?.length,
    1,
    "chiamato solo da riavviaApp",
  );
  // niente più scelta fra i servizi attivi: si riavvia il proprio
  assert.doesNotMatch(SRC, /pickServiceToRestart|readServiceStates|is-active/);
});

test("«Riavvia» e «Aggiorna» riuscito passano dallo stesso riavvio programmato", () => {
  const post = corpo("POST");
  assert.ok((post.match(/programmaRiavvio\(\)/g)?.length ?? 0) >= 2, "restart e apply");
  assert.match(post, /restartScheduled/);
  assert.match(corpo("programmaRiavvio"), /setTimeout\(\s*riavviaApp\s*,/);
});

test("POST legge l'azione da indirizzo o corpo (readUpdateAction)", () => {
  const post = corpo("POST");
  assert.match(post, /readUpdateAction\(/);
  // non più `const action = url.searchParams.get("action")`: il corpo restava ignorato
  assert.doesNotMatch(post, /=\s*url\.searchParams\.get\(\s*"action"\s*\)/);
});
