/**
 * Cricchetto della facciata `db.ts` (NUC-2).
 *
 * `db.ts` e `db-tenant.ts` hanno due copie di centinaia di funzioni dati, e le
 * copie si separano: una correzione fatta in una non arriva all'altra
 * (analisi del sistema, 2026-10). La fusione si fa a gruppi; questo test
 * impedisce di tornare indietro fra un gruppo e l'altro:
 * - il numero di funzioni DEFINITE in `db.ts` (dichiarazioni esportate con
 *   corpo e `export const f = (…) => …` / `function (…)`, contate col parser di
 *   TypeScript) è esattamente SOGLIA: se sale, una funzione nuova è finita
 *   nella facciata; se scende, si abbassa SOGLIA nello stesso commit, così il
 *   margine non resta libero per funzioni nuove;
 * - una funzione spostata in `db-tenant.ts` non può riapparire in `db.ts` con
 *   nessuna dichiarazione, esportata o no (una copia locale usata da un'altra
 *   funzione della facciata è di nuovo una seconda copia).
 * Quando un gruppo si sposta, si abbassa SOGLIA e si aggiungono i nomi a SPOSTATE
 * (`support/facciata-spostate.ts`, condiviso con la prova d'identità). Lo stesso
 * vale per i tipi: un tipo spostato (TIPI_SPOSTATI) non si ridichiara in `db.ts`.
 * Buchi chiusi nella revisione del 2026-10-12.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { DELEGHE_HUB, SPOSTATE, TIPI_HUB, TIPI_SPOSTATI } from "./support/facciata-spostate";

/**
 * Funzioni esportate definite in db.ts: 275 all'inizio, 271 dopo il gruppo 0
 * (T3-04), 168 dopo il gruppo 1a (T3-05, 103 letture); nel gruppo 1b (T3-06):
 * 144 dopo le credenziali, 133 dopo AD, 125 dopo DHCP,
 * 104 dopo inventario e licenze, 97 dopo ARP, vicini, rotte e porte,
 * 83 dopo apparati, job e Proxmox, 64 dopo reti e host; nel gruppo 2 (T3-07),
 * una per commit: 63 dopo upsertArpEntries, 62 dopo getHostByMac, 61 dopo getHostById, 60 dopo getHostsByNetworkWithDevices, 59 dopo recomputeMultihomedLinks, 58 dopo resetConfiguration, 57 dopo getAdComputersPaginated, 56 dopo getAdUsersPaginated, 55 dopo upsertHost;
 * nel gruppo 3 (T3-08): 54 dopo il ramo del vecchio ipam.db (`closeDb` passa a db-legacy.ts),
 * 9 dopo le deleghe all'hub (45 riesportate, 4 involucri restano).
 */
const SOGLIA = 9;

interface Dichiarazione {
  nome: string;
  esportata: boolean;
  funzione: boolean;
}

function dichiarazioni(file: string): Dichiarazione[] {
  const testo = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(path.basename(file), testo, ts.ScriptTarget.Latest, true);
  const out: Dichiarazione[] = [];
  const esportata = (s: ts.Statement) =>
    ts.canHaveModifiers(s) && (ts.getModifiers(s) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  for (const s of sf.statements) {
    if (ts.isFunctionDeclaration(s) && s.name) {
      out.push({ nome: s.name.text, esportata: esportata(s), funzione: !!s.body });
    } else if (ts.isVariableStatement(s)) {
      for (const d of s.declarationList.declarations) {
        if (!ts.isIdentifier(d.name)) continue;
        const init = d.initializer;
        const funzione = !!init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init));
        out.push({ nome: d.name.text, esportata: esportata(s), funzione });
      }
    } else if (ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s)) {
      out.push({ nome: s.name.text, esportata: esportata(s), funzione: false });
    }
  }
  return out;
}

function funzioniDefinite(file: string): string[] {
  return dichiarazioni(file).filter((d) => d.esportata && d.funzione).map((d) => d.nome);
}

const DB_TS = path.join(process.cwd(), "src", "lib", "db.ts");
const DB_TENANT_TS = path.join(process.cwd(), "src", "lib", "db-tenant.ts");
const DB_HUB_TS = path.join(process.cwd(), "src", "lib", "db-hub.ts");

/**
 * File che il cricchetto NON guarda, ciascuno col suo motivo (T3-08). Per ognuno
 * la prova sotto vincola chi può importarlo, così l'eccezione non si allarga.
 */
const ESCLUSI: Readonly<Record<string, { motivo: string; importatori: readonly string[] }>> = {
  "src/lib/db-legacy.ts": {
    motivo:
      "il vecchio database single-tenant `ipam.db` con le sue migrazioni inline: lo apre solo " +
      "`getDb()` senza contesto e senza tenant DEFAULT (ripiego contato nel registro, da chiudere " +
      "in T3-09) e lo script che rigenera il modello vuoto, con un percorso esplicito",
    importatori: ["src/lib/db.ts", "scripts/generate-empty-db.ts"],
  },
};

/** File sotto `dir` (ricorsivo) con estensione .ts/.tsx/.mjs/.cjs/.js, percorsi relativi alla radice. */
function sorgenti(dir: string): string[] {
  const radice = process.cwd();
  const out: string[] = [];
  const giro = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === ".next") continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) giro(p);
      else if (/\.(ts|tsx|mjs|cjs|js)$/.test(e.name)) out.push(path.relative(radice, p));
    }
  };
  giro(path.join(radice, dir));
  return out;
}

test("db.ts: le funzioni definite sono esattamente SOGLIA", () => {
  const n = funzioniDefinite(DB_TS).length;
  assert.ok(n <= SOGLIA, `db.ts definisce ${n} funzioni, la soglia è ${SOGLIA}: una funzione nuova va in db-tenant.ts`);
  assert.equal(n, SOGLIA, `db.ts definisce ${n} funzioni, meno della soglia ${SOGLIA}: sono scese, abbassa SOGLIA a ${n}`);
});

test("db.ts: le deleghe all'hub sono riesportazioni, non ridichiarazioni; db-hub.ts le definisce", () => {
  const nomi = new Set(dichiarazioni(DB_TS).map((d) => d.nome));
  assert.deepEqual(DELEGHE_HUB.filter((n) => nomi.has(n)), [], "deleghe all'hub ridichiarate in db.ts");
  assert.deepEqual(TIPI_HUB.filter((n) => nomi.has(n)), [], "tipi dell'hub ridichiarati in db.ts");
  const hub = dichiarazioni(DB_HUB_TS).filter((d) => d.esportata);
  const funzioniHub = new Set(hub.filter((d) => d.funzione).map((d) => d.nome));
  assert.deepEqual(DELEGHE_HUB.filter((n) => !funzioniHub.has(n)), [], "deleghe che db-hub.ts non definisce");
  const tipiHub = new Set(hub.map((d) => d.nome));
  assert.deepEqual(TIPI_HUB.filter((n) => !tipiHub.has(n)), [], "tipi che db-hub.ts non esporta");
});

test("file esclusi dal cricchetto: esistono, hanno un motivo e li importa solo chi è ammesso", () => {
  for (const [file, { motivo, importatori }] of Object.entries(ESCLUSI)) {
    const modulo = path.basename(file).replace(/\.ts$/, "");
    const importa = new RegExp(`(?:from\\s+|import\\(\\s*|require\\(\\s*)["'][^"']*/${modulo}["']`);
    assert.ok(fs.existsSync(path.join(process.cwd(), file)), `${file} escluso ma assente`);
    assert.ok(motivo.length > 40, `${file}: manca il motivo dell'esclusione`);
    const chi = [...sorgenti("src"), ...sorgenti("scripts"), "server.ts"]
      .filter((f) => f !== file && fs.existsSync(path.join(process.cwd(), f)))
      .filter((f) => importa.test(fs.readFileSync(path.join(process.cwd(), f), "utf8")));
    assert.deepEqual(chi.sort(), [...importatori].sort(), `${file}: importato da file non ammessi`);
  }
});

test("db.ts: le funzioni spostate non vi sono ridichiarate, nemmeno in locale", () => {
  const nomi = new Set(dichiarazioni(DB_TS).map((d) => d.nome));
  const tornate = SPOSTATE.filter((n) => nomi.has(n));
  assert.deepEqual(tornate, [], "funzioni spostate in db-tenant.ts dichiarate di nuovo in db.ts");
});

test("db-tenant.ts: definisce tutte le funzioni spostate", () => {
  const definite = new Set(funzioniDefinite(DB_TENANT_TS));
  const mancanti = SPOSTATE.filter((n) => !definite.has(n));
  assert.deepEqual(mancanti, [], "funzioni spostate che db-tenant.ts non definisce");
});

test("db.ts: i tipi spostati non vi sono ridichiarati; db-tenant.ts li esporta", () => {
  const inFacciata = new Set(dichiarazioni(DB_TS).map((d) => d.nome));
  assert.deepEqual(TIPI_SPOSTATI.filter((n) => inFacciata.has(n)), [], "tipi spostati dichiarati di nuovo in db.ts");
  const esportatiTenant = new Set(dichiarazioni(DB_TENANT_TS).filter((d) => d.esportata).map((d) => d.nome));
  assert.deepEqual(TIPI_SPOSTATI.filter((n) => !esportatiTenant.has(n)), [], "tipi spostati che db-tenant.ts non esporta");
});
