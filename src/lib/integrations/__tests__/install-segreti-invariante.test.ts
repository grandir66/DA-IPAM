/**
 * INVARIANTE (T3-27, SEC-13): nel sorgente delle integrazioni non c'è un
 * segreto scritto a mano, e nessuna riga di registro interpola una variabile
 * che porta una password, un segreto o un token.
 *
 * Perché: fino a v0.3.271 l'installazione di LibreNMS usava password del
 * database e chiave applicativa fisse, uguali su ogni macchina, e scriveva la
 * password admin nel registro dell'installazione, che la pagina mostra. Le
 * prove con docker finto stanno in install-segreti.test.ts; questa legge il
 * sorgente, così copre anche le integrazioni che una prova non installa.
 *
 * Run: node --import tsx --test src/lib/integrations/__tests__/install-segreti-invariante.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const RADICE = process.cwd();

function sorgenti(dir: string): string[] {
  const out: string[] = [];
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) {
      if (nome !== "__tests__") out.push(...sorgenti(p));
    } else if (/\.tsx?$/.test(nome) && !/\.test\.tsx?$/.test(nome)) {
      out.push(p);
    }
  }
  return out;
}

const FILE = [
  ...sorgenti(join(RADICE, "src/lib/integrations")),
  ...sorgenti(join(RADICE, "src/app/api/integrations")),
];

/** Riga per riga, col file e il numero: il messaggio d'errore dice dove guardare. */
function cerca(re: RegExp): string[] {
  const out: string[] = [];
  for (const f of FILE) {
    readFileSync(f, "utf8").split("\n").forEach((riga, i) => {
      if (re.test(riga)) out.push(`${relative(RADICE, f)}:${i + 1}`);
    });
  }
  return out;
}

test("sono stati letti i sorgenti delle integrazioni (la prova non passa a vuoto)", () => {
  assert.ok(FILE.some((f) => f.endsWith("librenms.ts")));
  assert.ok(FILE.some((f) => f.endsWith("graylog.ts")));
  assert.ok(FILE.some((f) => f.endsWith(join("[component]", "install", "route.ts"))));
});

test("nessuna costante con nome da segreto assegnata a una stringa scritta a mano", () => {
  // `DB_PASSWORD = "…"`, `passwordSecret = "…"`, `adminPassword = "admin"`
  // (anche come valore predefinito di un parametro), `password: "…"`.
  // Ammesse le stringhe vuote (campo non impostato) e i nomi delle chiavi
  // delle impostazioni (`KEY_PASSWORD = "integration_…"`), che non sono valori.
  const re = /\b\w*(password|secret|app_?key)\w*\s*[:=]\s*["'`](?!\$\{|integration_)[^"'`]+["'`]/i;
  assert.deepEqual(cerca(re), []);
});

test("nessuna variabile d'ambiente da segreto con un valore scritto a mano", () => {
  // `"MYSQL_ROOT_PASSWORD=root_secret"`: il valore va nell'ambiente del
  // processo docker (`-e NOME`), non fra gli argomenti e non nel sorgente.
  const re = /["'`][A-Z0-9_]*(PASSWORD|SECRET|APP_KEY|TOKEN)[A-Z0-9_]*=/;
  assert.deepEqual(cerca(re), []);
});

test("nessuna chiave applicativa Laravel scritta nel sorgente", () => {
  assert.deepEqual(cerca(/base64:[A-Za-z0-9+/]{40,}={0,2}/), []);
});

test("nessuna riga di registro interpola password, segreti o token", () => {
  const trovati: string[] = [];
  for (const f of FILE) {
    const testo = readFileSync(f, "utf8");
    for (const m of testo.matchAll(/\b(?:log|appendLog|registro)\s*\(\s*`([^`]*)`/g)) {
      for (const e of m[1].matchAll(/\$\{([^}]*)\}/g)) {
        if (/password|secret|segret|token|app_?key/i.test(e[1])) {
          const riga = testo.slice(0, m.index).split("\n").length;
          trovati.push(`${relative(RADICE, f)}:${riga} → \${${e[1]}}`);
        }
      }
    }
  }
  assert.deepEqual(trovati, []);
});

test("la rotta d'installazione non ha una password predefinita: usa parametriInstallazione", () => {
  const rotta = readFileSync(join(RADICE, "src/app/api/integrations/[component]/install/route.ts"), "utf8");
  assert.match(rotta, /parametriInstallazione\(/);
  assert.doesNotMatch(rotta, /["']admin["']/);
});
