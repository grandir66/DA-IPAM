/**
 * INVARIANTE (T3-25, SEC-5 parte viewer): la configurazione delle integrazioni
 * letta da chi non è admin arriva con i campi segreti vuoti e i flag
 * «impostato»; l'admin la riceve come prima.
 *
 * Perché (12/10, tappa 3): il GET della configurazione bastava a un utente in
 * sola lettura e restituiva token e password delle integrazioni così come
 * stavano nel database dell'hub. UniFi li nascondeva già; le altre no.
 *
 * Due parti: la maschera, su configurazioni finte con la forma vera di
 * `ComponentConfig`; e il GET della rotta, letto con l'albero sintattico (la
 * sessione di NextAuth esiste solo dentro una richiesta di Next), che deve far
 * passare ogni `config` della risposta dalla maschera. È la prova a cui rimanda
 * l'eccezione «mascherata» di src/lib/permessi/rotte.ts.
 *
 * Run: node --import tsx --test src/lib/permessi/__tests__/politica.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import type { ComponentConfig } from "../../integrations/types";
import {
  CAMPI_SEGRETI_INTEGRAZIONE,
  livelloAlmeno,
  mascheraConfigIntegrazione,
  puoVedereSegreti,
} from "../politica";

const RADICE = process.cwd();

test("livelloAlmeno: ordine viewer < admin < superadmin, ruolo sconosciuto mai", () => {
  assert.equal(livelloAlmeno("viewer", "viewer"), true);
  assert.equal(livelloAlmeno("viewer", "admin"), false);
  assert.equal(livelloAlmeno("admin", "admin"), true);
  assert.equal(livelloAlmeno("admin", "superadmin"), false);
  assert.equal(livelloAlmeno("superadmin", "admin"), true);
  for (const r of [undefined, null, "", "Admin", "operator", 1]) {
    assert.equal(livelloAlmeno(r, "viewer"), false, `ruolo ${String(r)}`);
  }
});

test("puoVedereSegreti: solo admin e superadmin", () => {
  assert.equal(puoVedereSegreti("superadmin"), true);
  assert.equal(puoVedereSegreti("admin"), true);
  assert.equal(puoVedereSegreti("viewer"), false);
  assert.equal(puoVedereSegreti(undefined), false);
});

// Forme vere, da getIntegrationConfig: managed con token e password admin
// salvati dopo l'installazione, external con utente e password (graylog).
const FINTE: Record<string, ComponentConfig> = {
  librenms: {
    mode: "managed",
    url: "http://da-librenms:8000",
    apiToken: "tok-librenms-finto",
    adminPassword: "pw-admin-finta",
    containerName: "da-librenms",
    uiUrl: "https://ipam.esempio.lan:7443",
  },
  graylog: {
    mode: "external",
    url: "http://graylog.esempio.lan:9000",
    apiToken: "tok-graylog-finto",
    username: "lettore",
    password: "pw-graylog-finta",
  },
  loki: { mode: "managed", url: "http://da-loki:3100", apiToken: "", containerName: "da-loki" },
};

for (const [nome, cfg] of Object.entries(FINTE)) {
  test(`maschera ${nome}: chi non vede i segreti li riceve vuoti, con i flag «impostato»`, () => {
    const m = mascheraConfigIntegrazione(cfg, false);
    for (const campo of CAMPI_SEGRETI_INTEGRAZIONE) {
      const valore = m[campo];
      assert.ok(valore === "" || valore === undefined, `${nome}.${campo} restituito`);
      assert.equal(m[`${campo}Set`], !!cfg[campo], `${nome}.${campo}Set`);
    }
    // Nessun valore segreto sopravvive in un campo qualunque.
    const testo = JSON.stringify(m);
    for (const campo of CAMPI_SEGRETI_INTEGRAZIONE) {
      const v = cfg[campo];
      if (v) assert.ok(!testo.includes(v), `${nome}: il valore di ${campo} compare nella risposta`);
    }
    // Il resto resta com'era: la card lo mostra.
    assert.equal(m.mode, cfg.mode);
    assert.equal(m.url, cfg.url);
    assert.equal(m.username, cfg.username);
    assert.equal(m.containerName, cfg.containerName);
    assert.equal(m.uiUrl, cfg.uiUrl);
  });

  test(`maschera ${nome}: l'admin riceve la configurazione invariata`, () => {
    assert.deepEqual(mascheraConfigIntegrazione(cfg, true), cfg);
  });
}

test("maschera: non modifica la configurazione ricevuta", () => {
  const cfg = { ...FINTE.librenms };
  mascheraConfigIntegrazione(cfg, false);
  assert.deepEqual(cfg, FINTE.librenms);
});

// ---------------------------------------------------------------------------
// Il GET della rotta passa dalla maschera prima della risposta
// ---------------------------------------------------------------------------

const ROTTA = "src/app/api/integrations/[component]/route.ts";

/** Gli inizializzatori di ogni proprietà `config` dentro il GET. */
function configDelGet(sorgente: string): ts.Expression[] {
  const sf = ts.createSourceFile("route.ts", sorgente, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const get = sf.statements.find((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === "GET");
  assert.ok(get?.body, "GET non trovato");
  const out: ts.Expression[] = [];
  const visita = (n: ts.Node) => {
    if (ts.isPropertyAssignment(n) && n.name.getText(sf) === "config") out.push(n.initializer);
    if (ts.isShorthandPropertyAssignment(n) && n.name.text === "config") out.push(n.name);
    ts.forEachChild(n, visita);
  };
  visita(get.body);
  return out;
}

/** Vero se l'espressione è una chiamata a mascheraConfigIntegrazione. */
const eMaschera = (e: ts.Expression): boolean =>
  ts.isCallExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === "mascheraConfigIntegrazione";

test("controllo: un GET che restituisce la configurazione senza maschera viene segnalato", () => {
  const finto = `
export async function GET() {
  const cfg = getIntegrationConfig("librenms");
  if (x) return NextResponse.json({ config: mascheraConfigIntegrazione(cfg, false) });
  return NextResponse.json({ component, config: cfg });
}
`;
  const trovati = configDelGet(finto);
  assert.equal(trovati.length, 2);
  assert.deepEqual(trovati.map(eMaschera), [true, false]);
});

test(`GET ${ROTTA}: ogni config della risposta passa dalla maschera`, () => {
  const trovati = configDelGet(readFileSync(join(RADICE, ROTTA), "utf8"));
  assert.ok(trovati.length > 0, "nessuna proprietà config nel GET: la prova non sa più cosa guardare");
  for (const e of trovati) assert.ok(eMaschera(e), `config restituita senza maschera: ${e.getText()}`);
});

test(`GET ${ROTTA}: chi vede i segreti lo decide puoVedereSegreti sul ruolo della sessione`, () => {
  const src = readFileSync(join(RADICE, ROTTA), "utf8");
  assert.match(src, /puoVedereSegreti\(\s*\w+\.user\.role\s*\)/);
});
