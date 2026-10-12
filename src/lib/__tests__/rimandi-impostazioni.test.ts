import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * INVARIANTE: un rimando a «Impostazioni → …» porta in un posto che esiste.
 *
 * UI-24 (piano di miglioramento, tappa 1, 2026-10-12). Il tab «Integrazioni»
 * di Impostazioni è stato fuso in «Moduli» (alias `integrazioni` → `moduli` in
 * settings/page.tsx), ma una dozzina di messaggi diceva ancora «Impostazioni →
 * Integrazioni» o «Integrazioni → Wazuh»; altri nominavano tab mai esistiti
 * («Profilo Nmap», «SNMP», «Credenziali», «Job schedulati»). E la pagina RMM
 * aveva un pulsante «Vai a Impostazioni → Moduli» che apriva il tab Utenti,
 * perché il link era `/settings` senza `?tab=`. Chi segue l'indicazione non
 * trova niente e pensa che la funzione non ci sia.
 *
 * I nomi dei tab si leggono da settings/page.tsx (l'elenco `tabs` e
 * `TAB_ALIASES`): un tab rinominato là fa fallire qui i rimandi rimasti indietro.
 */

const ROOT = process.cwd();
const SRC = path.join(ROOT, "src");
const SETTINGS_PAGE = path.join(SRC, "app/(dashboard)/settings/page.tsx");

function isComment(line: string): boolean {
  const t = line.trim();
  return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") || t.startsWith("{/*");
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next" || entry.name === "__tests__") continue;
      out.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

const rel = (file: string) => path.relative(ROOT, file);

/** Etichetta del tab → chiave, dall'elenco `tabs` della pagina Impostazioni. */
function tabLabels(): Map<string, string> {
  const src = fs.readFileSync(SETTINGS_PAGE, "utf8");
  const out = new Map<string, string>();
  for (const m of src.matchAll(/\{\s*key:\s*"([^"]+)",\s*label:\s*"([^"]+)",\s*icon:/g)) out.set(m[2], m[1]);
  return out;
}

/** Valore di `?tab=` accettato → chiave del tab, da `TAB_ALIASES`. */
function tabAliases(): Map<string, string> {
  const src = fs.readFileSync(SETTINGS_PAGE, "utf8");
  const block = src.match(/const TAB_ALIASES[^=]*=\s*\{([\s\S]*?)\};/)?.[1] ?? "";
  const out = new Map<string, string>();
  for (const m of block.matchAll(/["']?([\w-]+)["']?\s*:\s*"([\w-]+)"/g)) out.set(m[1], m[2]);
  return out;
}

/**
 * `/settings/<pagina>` che è solo un rinvio a un tab (es. `features` →
 * `?tab=moduli`, `updates` → `?tab=aggiornamenti`): si segue il rinvio.
 */
function followRedirect(href: string): string {
  const sub = new URL(href, "http://x").pathname.match(/^\/settings\/([\w-]+)$/)?.[1];
  if (!sub) return href;
  const page = path.join(SRC, "app/(dashboard)/settings", sub, "page.tsx");
  if (!fs.existsSync(page)) return href;
  return fs.readFileSync(page, "utf8").match(/redirect\("(\/settings\?[^"]+)"\)/)?.[1] ?? href;
}

/** Il testo dopo «Impostazioni →» comincia con il nome di un tab che esiste? */
function tabNamed(rest: string, labels: Map<string, string>): string | null {
  const text = rest.replace(/^(<[^>]+>\s*)+/, "");
  for (const label of [...labels.keys()].sort((a, b) => b.length - a.length)) {
    if (text.startsWith(label) && !/^[\p{L}]/u.test(text.slice(label.length))) return label;
  }
  return null;
}

test("i nomi dei tab si leggono dalla pagina Impostazioni", () => {
  // Se la lettura si rompe, le prove sotto passerebbero senza controllare niente.
  const labels = tabLabels();
  assert.ok(labels.size >= 8, `letti solo ${labels.size} tab da settings/page.tsx`);
  assert.equal(labels.get("Moduli"), "moduli");
  assert.equal(tabAliases().get("integrazioni"), "moduli");
});

test("nessun testo rimanda a «Integrazioni», che è diventato il tab Moduli (UI-24)", () => {
  const RIMANDO = /Integrazioni\s*→|→\s*Integrazioni|\b(?:in|da|a)\s+Integrazioni\b/;
  const offenders: string[] = [];
  for (const file of sourceFiles(SRC)) {
    fs.readFileSync(file, "utf8").split("\n").forEach((line, i) => {
      if (!isComment(line) && RIMANDO.test(line)) offenders.push(`${rel(file)}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(offenders, [], `Rimandi a «Integrazioni» (usare «Impostazioni → Moduli»):\n${offenders.join("\n")}`);
});

test("ogni «Impostazioni → X» nomina un tab che esiste (UI-24)", () => {
  const labels = tabLabels();
  // «Impostazioni» di altri prodotti (l'interfaccia dell'edge, LibreNMS): non sono le nostre.
  const ALTRUI = /(?:edge|LibreNMS)\s*→\s*$/i;
  const offenders: string[] = [];
  for (const file of sourceFiles(SRC)) {
    fs.readFileSync(file, "utf8").split("\n").forEach((line, i) => {
      if (isComment(line)) return;
      for (const m of line.matchAll(/Impostazioni\s*→\s*/g)) {
        if (ALTRUI.test(line.slice(Math.max(0, m.index - 30), m.index))) continue;
        if (!tabNamed(line.slice(m.index + m[0].length), labels)) {
          offenders.push(`${rel(file)}:${i + 1}: ${line.trim()}`);
        }
      }
    });
  }
  assert.deepEqual(
    offenders,
    [],
    `Rimandi a un tab che non esiste (tab veri: ${[...labels.keys()].join(", ")}):\n${offenders.join("\n")}`,
  );
});

test("un link a /settings che nomina un tab apre quel tab (UI-24)", () => {
  const labels = tabLabels();
  const aliases = tabAliases();
  const LINK = /<(Link|a)\b[^>]*?\bhref="(\/settings[^"]*)"[^>]*>([\s\S]*?)<\/\1>/g;
  const offenders: string[] = [];
  for (const file of sourceFiles(SRC).filter((f) => f.endsWith(".tsx"))) {
    const src = fs.readFileSync(file, "utf8");
    for (const m of src.matchAll(LINK)) {
      const [, , href, inner] = m;
      const arrow = inner.match(/Impostazioni\s*→\s*/);
      if (!arrow || arrow.index === undefined) continue;
      const label = tabNamed(inner.slice(arrow.index + arrow[0].length), labels);
      if (!label) continue; // un tab inesistente lo segnala già la prova sopra
      const url = new URL(followRedirect(href), "http://x");
      const tab = url.pathname === "/settings" ? (url.searchParams.get("tab") ?? "").toLowerCase() : "";
      if (aliases.get(tab) !== labels.get(label)) {
        const line = src.slice(0, m.index).split("\n").length;
        offenders.push(`${rel(file)}:${line}: href="${href}" ma il testo dice «Impostazioni → ${label}»`);
      }
    }
  }
  assert.deepEqual(offenders, [], `Link che non aprono il tab che nominano:\n${offenders.join("\n")}`);
});
