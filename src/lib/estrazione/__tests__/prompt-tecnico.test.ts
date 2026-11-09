import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { estrazioneVisibile, leggiPromptTecnico } from "@/lib/estrazione/prompt-tecnico";

// Riccardo, 09/11/2026: «il prompt dovrebbe essere visibile nella UI dell'installazione del tecnico». Solo lì.
test("la pagina esiste solo con DA_PROFILO=tecnico", () => {
  assert.equal(estrazioneVisibile({ DA_PROFILO: "tecnico" }), true);
  assert.equal(estrazioneVisibile({}), false);
  assert.equal(estrazioneVisibile({ DA_PROFILO: "installazione" }), false);
  assert.equal(estrazioneVisibile({ DA_PROFILO: "pippo" }), false);
});

test("la voce di menu è dentro il ramo «tecnico»", () => {
  const s = readFileSync("src/components/shared/sidebar.tsx", "utf8");
  assert.match(s, /\{tecnico && \(\s*<NavItem href="\/estrazione-apparati"/);
});

test("il prompt si legge dal file unico e ha le parti obbligatorie", () => {
  const p = leggiPromptTecnico();
  assert.ok(p, "manca src/lib/estrazione/prompt-tecnico.md");
  for (const parte of ["da-ipam-estrazione", "Vietati sempre", "imposta_credenziali.py", "controlla_estrazione.py", "Pacchetto di consegna", "controlla_campione.py"]) assert.ok(p.includes(parte), parte);
  assert.equal(leggiPromptTecnico("/percorso/che/non/esiste"), null);
});
