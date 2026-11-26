/**
 * Il manuale per pagina segue il programma (Riccardo, 26/11/2026: il manuale unico «è diventato gigantesco e
 * probabilmente neppure più aggiornato rispetto al programma reale»). Fallisce quando una pagina nuova non ha la sua
 * guida in docs/manuale/pagine/, quando una guida cita un'immagine che non c'è o un'altra guida che non esiste.
 *
 * Run: node --import tsx --test src/lib/manuale/__tests__/copertura.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { guidaDelPercorso, leggiGuida, titoloConAncora, type GuidaLetta } from "../formato";
import { leggiIcona } from "../icone";

const RADICE = process.cwd();
const APP = join(RADICE, "src", "app");
const GUIDE = join(RADICE, "docs", "manuale", "pagine");

/** Pagine senza guida per scelta: accesso, prima installazione, il manuale stesso, la stampa della mappa. */
const SENZA_GUIDA = new Set(["/login", "/setup", "/onboarding", "/select-tenant", "/manual", "/topology/stampa"]);

function pagine(dir: string, base = ""): string[] {
  const out: string[] = [];
  for (const voce of readdirSync(dir)) {
    const pieno = join(dir, voce);
    if (statSync(pieno).isDirectory()) {
      if (voce === "api" || voce.startsWith("_")) continue;
      out.push(...pagine(pieno, /^\(.+\)$/.test(voce) ? base : `${base}/${voce}`));
    } else if (voce === "page.tsx") out.push(base || "/");
  }
  return out;
}

function guide(): GuidaLetta[] {
  return readdirSync(GUIDE).filter((f) => f.endsWith(".md")).map((f) => {
    const g = leggiGuida(f.replace(/\.md$/, ""), readFileSync(join(GUIDE, f), "utf-8"));
    assert.ok(g, `${f}: manca l'intestazione (percorso, titolo) fra le righe ---`);
    return g;
  });
}

test("ogni pagina dell'app ha la sua guida", () => {
  const tutte = guide();
  const mancanti = pagine(APP).filter((p) => !SENZA_GUIDA.has(p) && !guidaDelPercorso(tutte, p));
  assert.deepEqual(mancanti, [], `Pagine senza guida in docs/manuale/pagine/:\n${mancanti.join("\n")}`);
});

test("ogni guida porta a una pagina che esiste", () => {
  const vere = pagine(APP);
  for (const g of guide()) {
    for (const p of g.percorsi) assert.ok(vere.includes(p), `${g.nome}.md: la pagina ${p} non esiste in src/app`);
  }
});

test("immagini e rimandi delle guide esistono, il prodotto si chiama DA-IPAM", () => {
  const nomi = new Set(readdirSync(GUIDE).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, "")));
  for (const g of guide()) {
    for (const [, src] of g.testo.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)) {
      assert.ok(src.startsWith("/manuale/"), `${g.nome}.md: immagine fuori da /manuale/ (${src})`);
      assert.ok(existsSync(join(RADICE, "public", src)), `${g.nome}.md: manca l'immagine public${src}`);
    }
    for (const [, nome] of g.testo.matchAll(/\]\((?:\.\.\/)?pagine\/([a-z0-9-]+)\.md(?:#[^)]*)?\)/g)) {
      assert.ok(nomi.has(nome), `${g.nome}.md: rimanda a pagine/${nome}.md, che non c'è`);
    }
    assert.ok(!g.testo.includes("DA-INVENT"), `${g.nome}.md: il prodotto si chiama DA-IPAM`);
  }
});

test("le parti comuni dell'interfaccia hanno le loro immagini e rimandano a guide vere", () => {
  const testo = readFileSync(join(RADICE, "docs", "manuale", "INTERFACCIA.md"), "utf-8");
  const nomi = new Set(readdirSync(GUIDE).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, "")));
  for (const [, src] of testo.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)) {
    assert.ok(existsSync(join(RADICE, "public", src)), `INTERFACCIA.md: manca l'immagine public${src}`);
  }
  for (const [, nome] of testo.matchAll(/\]\(pagine\/([a-z0-9-]+)\.md/g)) assert.ok(nomi.has(nome), `INTERFACCIA.md: manca pagine/${nome}.md`);
});

test("le icone citate nelle guide esistono (`icona:nome`, `tasto:nome`)", () => {
  const testi = [...guide().map((g) => [g.nome, g.testo] as const), ["INTERFACCIA", readFileSync(join(RADICE, "docs", "manuale", "INTERFACCIA.md"), "utf-8")] as const];
  for (const [nome, testo] of testi) {
    for (const [, segno] of testo.matchAll(/`((?:icona|tasto):[^`]*)`/g)) {
      assert.ok(leggiIcona(segno), `${nome}.md: l'icona «${segno}» non c'è in src/lib/manuale/icone.ts`);
    }
  }
  assert.deepEqual(leggiIcona("tasto:filter"), { nome: "filter", tasto: true });
  assert.equal(leggiIcona("icona:inesistente"), null);
  assert.equal(leggiIcona("npm run dev"), null);
});

test("il percorso con tratti variabili riconosce gli indirizzi veri, il fisso vince", () => {
  const g = (nome: string, percorso: string) => ({ nome, percorsi: [percorso], titolo: nome, versione: "", aggiornata: "", testo: "" });
  const elenco = [g("scheda", "/devices/[id]"), g("elenco", "/devices"), g("home", "/"), g("cve", "/patch-management/cve/[cveId]")];
  assert.equal(guidaDelPercorso(elenco, "/devices/42")?.nome, "scheda");
  assert.equal(guidaDelPercorso(elenco, "/devices/")?.nome, "elenco");
  assert.equal(guidaDelPercorso(elenco, "/devices?x=1")?.nome, "elenco");
  assert.equal(guidaDelPercorso(elenco, "/")?.nome, "home");
  assert.equal(guidaDelPercorso(elenco, "/patch-management/cve/CVE-2024-1")?.nome, "cve");
  assert.equal(guidaDelPercorso(elenco, "/devices/42/altro"), null);
  assert.equal(guidaDelPercorso([...elenco, g("nuovo", "/devices/nuovo")], "/devices/nuovo")?.nome, "nuovo");
  assert.deepEqual(titoloConAncora("Rete × rete {#matrice}"), { testo: "Rete × rete", id: "matrice" });
  assert.deepEqual(titoloConAncora("Senza àncora"), { testo: "Senza àncora", id: null });
  assert.equal(leggiGuida("x", "# nessuna intestazione"), null);
});
