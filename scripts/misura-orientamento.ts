// scripts/misura-orientamento.ts
/**
 * misura-orientamento.ts — quanto è larga e alta la mappa automatica della topologia
 * oggi (albero dall'alto, fratelli affiancati) e quanto lo sarebbe da sinistra a destra
 * (livelli in colonna, fratelli impilati), e quante pagine A4/A3 servono a stamparla.
 * Serve a decidere l'orientamento sul dato vero (spec topologia §12).
 *
 * La disposizione di oggi è quella vera di `layoutTree`. Quella verticale è una STIMA
 * fatta con le stesse misure dei riquadri e con le stesse regole dell'albero:
 *   - colonna di un livello = il riquadro più largo di quel livello (con la fascia degli
 *     attaccati sotto il riquadro e gli AP in un blocco di 2 colonne);
 *   - altezza di un sottoalbero = max(il proprio blocco, la somma dei figli + spazi).
 * Lavora su una copia della copia dentro `--cartella`. Stampa solo numeri.
 *
 * Uso:  npx tsx scripts/misura-orientamento.ts <copia.db> --cartella <scratchpad>
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { controllaPercorsi } from "../src/lib/scanner/__tests__/support/percorsi-prova";

/** Area stampabile a 96 dpi (1 px = 0,2646 mm), margini di 10 mm. */
const FOGLI = { A4: { w: 718, h: 1047 }, A3: { w: 1047, h: 1512 } } as const;
const SCALE = [1, 0.7] as const;
/** Spazio orizzontale fra due livelli nella disposizione verticale (linee + etichette di porta). */
const LEVEL_GAP_H = 90;
const AP_COLS_V = 2;

function pagine(w: number, h: number) {
  const out: Record<string, number> = {};
  for (const s of SCALE) {
    for (const [nome, f] of Object.entries(FOGLI)) {
      const vert = Math.ceil((w * s) / f.w) * Math.ceil((h * s) / f.h);
      const oriz = Math.ceil((w * s) / f.h) * Math.ceil((h * s) / f.w);
      out[`${nome}_${Math.round(s * 100)}%`] = Math.min(vert, oriz);
      out[`${nome}_${Math.round(s * 100)}%_foglio`] = vert <= oriz ? 1 : 0; // 1 = verticale
    }
  }
  return out;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const i = argv.indexOf("--cartella");
  const cartella = i >= 0 ? argv[i + 1] : "";
  const liberi = argv.filter((a, j) => !a.startsWith("--") && argv[j - 1] !== "--cartella");
  if (!cartella || liberi.length !== 1) {
    process.stderr.write("Uso: npx tsx scripts/misura-orientamento.ts <copia.db> --cartella <scratchpad>\n");
    return 2;
  }
  const sorgente = path.resolve(liberi[0]);
  const tenant = path.basename(sorgente).replace(/\.db$/i, "");
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(tenant)) return 2;
  const lavoro = path.join(path.resolve(cartella), `misura-orientamento-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  const dataDir = path.join(lavoro, "data");
  const hubDb = path.join(lavoro, "hub.db");
  const errori = controllaPercorsi({ scratchpad: cartella, sorgente, dataDir, hubDb, repo: process.cwd() });
  if (errori.length > 0) {
    process.stderr.write(`Non parto:\n${errori.map((e) => `  - ${e}`).join("\n")}\n`);
    return 2;
  }
  const dest = path.join(dataDir, "tenants", `${tenant}.db`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(sorgente, dest);
  process.env.DA_INVENT_DATA_DIR = dataDir;
  process.env.DA_IPAM_HUB_DB_PATH = hubDb;
  process.env.ENCRYPTION_KEY ||= crypto.randomBytes(16).toString("hex");
  const registro = path.join(lavoro, "misura.log");
  for (const k of ["log", "info", "warn", "error", "debug"] as const) {
    console[k] = (...p: unknown[]) => fs.appendFileSync(registro, `[${k}] ${p.map(String).join(" ")}\n`);
  }

  // Import dinamico voluto: l'ambiente va impostato prima di caricare db-tenant (processo solo, fuori dall'app; ADR 0002 non si applica).
  const tenantDb = await import("../src/lib/db-tenant");
  tenantDb.getTenantDb(tenant);
  const { buildTopologyModel } = await import("../src/lib/topology/model");
  const { buildTree, autoVisible, proposeHead } = await import("../src/lib/topology/tree");
  const L = await import("../src/lib/topology/tree-layout");

  const input = tenantDb.withTenant(tenant, () => tenantDb.getTopologyModelInput(2));
  const model = buildTopologyModel(input);
  const head = proposeHead(model);
  const tree = buildTree(model, autoVisible(model), head ? [head] : []);
  const oggi = L.layoutTree(model, tree, []);

  // Stima da sinistra a destra, con i riquadri e i figli calcolati da layoutTree.
  const figliDi = new Map<string, { box: string[]; ap: number; att: number }>();
  for (const n of oggi.nodes.values()) {
    if (!n.parent) continue;
    const f = figliDi.get(n.parent) ?? { box: [], ap: 0, att: 0 };
    if (n.role === "box") f.box.push(n.id);
    else if (n.role === "ap") f.ap++;
    else f.att++;
    figliDi.set(n.parent, f);
  }
  for (const [p, extra] of oggi.moreAttached) {
    const f = figliDi.get(p) ?? { box: [], ap: 0, att: 0 };
    f.att += extra;
    figliDi.set(p, f);
  }
  const apBlocco = AP_COLS_V * (L.AP_W + 8);
  const colonne: number[] = [];
  const blocco = (id: string, livello: number): number => {
    const n = oggi.nodes.get(id);
    const f = figliDi.get(id) ?? { box: [], ap: 0, att: 0 };
    const att = Math.min(f.att, L.ATT_MAX);
    const altAtt = att > 0 ? att * L.ATT_ROW + (f.att > L.ATT_MAX ? L.ATT_ROW : 0) + 6 : 0;
    const altAp = f.ap > 0 ? L.AP_HEAD + Math.ceil(f.ap / AP_COLS_V) * (L.AP_H + 8) : 0;
    const proprio = (n?.h ?? L.BOX_H) + altAtt + altAp;
    const larg = Math.max(n?.w ?? 150, att > 0 ? L.ATT_W : 0, f.ap > 0 ? apBlocco : 0);
    colonne[livello] = Math.max(colonne[livello] ?? 0, larg);
    const figli = f.box.map((c) => blocco(c, livello + 1));
    const sommaFigli = figli.reduce((a, b) => a + b, 0) + Math.max(0, figli.length - 1) * L.GAP;
    return Math.max(proprio, sommaFigli);
  };
  const altezze = tree.roots.map((r) => blocco(r, 0));
  const vertW = colonne.reduce((a, b) => a + b, 0) + Math.max(0, colonne.length - 1) * LEVEL_GAP_H + 2 * L.MARGIN;
  const vertH = altezze.reduce((a, b) => a + b, 0) + Math.max(0, altezze.length - 1) * L.ROOT_GAP + 2 * L.MARGIN;

  const maxFratelli = Math.max(0, ...[...figliDi.values()].map((f) => f.box.length));
  const out = {
    nodi_nell_albero: [...oggi.nodes.values()].filter((n) => n.role === "box").length,
    ap: [...oggi.nodes.values()].filter((n) => n.role === "ap").length,
    attaccati: [...oggi.nodes.values()].filter((n) => n.role === "attached").length,
    radici: tree.roots.length,
    livelli: colonne.length,
    fratelli_max_sotto_un_nodo: maxFratelli,
    oggi_px: { larghezza: Math.round(oggi.width), altezza: Math.round(oggi.height) },
    oggi_pagine: pagine(oggi.width, oggi.height),
    verticale_stima_px: { larghezza: Math.round(vertW), altezza: Math.round(vertH) },
    verticale_pagine: pagine(vertW, vertH),
  };
  process.stdout.write(`${JSON.stringify(out, null, 1)}\n`);
  return 0;
}

main().then((c) => process.exit(c), (e) => { process.stderr.write(`errore: ${e instanceof Error ? e.message : String(e)}\n`); process.exit(2); });
