import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * INVARIANTE: nel passo «token» della finestra «Nuovo agente» il rimando al
 * riquadro Hub URL non chiude la finestra.
 *
 * UI-24 (piano di miglioramento, tappa 1, revisione del 2026-10-12). Il passo
 * token mostra il token in chiaro una volta sola. L'avviso «Hub URL non
 * configurato» compare proprio lì e rimandava al riquadro Hub URL chiudendo la
 * finestra (prima con un link a /settings, poi con setWizardOpen(false)): token e
 * comando di install sparivano. Riaprire «Nuovo agente» crea un agente nuovo, e
 * da /agents il token di quello appena creato non si rigenera: restava un agente
 * orfano da cancellare. Il riquadro ora si apre in un'altra scheda
 * (/agents#hub-url-config) e la pagina rilegge l'Hub URL al ritorno.
 *
 * Legge il sorgente perché la pagina non si può rendere senza le API: è una
 * guardia contro il ritorno del difetto, non una prova dell'aspetto a schermo.
 * L'unico punto in cui il passo token può chiudere la finestra è il pulsante
 * «Chiudi e testa connessione» del DialogFooter, dopo la copia del comando.
 */

const PAGE = path.join(process.cwd(), "src/app/(dashboard)/agents/page.tsx");

/** Il JSX del passo token, fino al DialogFooter escluso. */
function tokenStep(): string {
  const src = fs.readFileSync(PAGE, "utf8");
  // Il blocco che rende il passo, non la descrizione della finestra che nomina lo stesso passo.
  const start = src.search(/\{wizardStep === "token" && createdToken\b/);
  assert.ok(start >= 0, "passo token non trovato in agents/page.tsx");
  const end = src.indexOf("<DialogFooter>", start);
  assert.ok(end > start, "DialogFooter del passo token non trovato");
  return src.slice(start, end);
}

test("il passo token non chiude la finestra prima del pulsante finale (UI-24)", () => {
  assert.ok(
    !/setWizardOpen\(\s*false\s*\)/.test(tokenStep()),
    "nel passo token un comando chiude la finestra: il token in chiaro andrebbe perso",
  );
});

test("il rimando al riquadro Hub URL si apre in un'altra scheda (UI-24)", () => {
  const links = [...tokenStep().matchAll(/<(?:a|Link)\b[^>]*href="[^"]*#hub-url-config"[^>]*>/g)].map((m) => m[0]);
  assert.ok(links.length > 0, "l'avviso «Hub URL non configurato» non dice più dove impostarlo");
  for (const link of links) {
    assert.match(link, /target="_blank"/, `il link chiude o lascia la finestra del token: ${link}`);
    assert.match(link, /href="\/agents#hub-url-config"/, `nell'altra scheda deve aprirsi il riquadro: ${link}`);
  }
});
