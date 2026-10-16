// scripts/misura-orientamento.ts
/**
 * misura-orientamento.ts — quanto è larga e alta la mappa automatica della topologia
 * oggi (albero dall'alto, fratelli affiancati) e quanto lo sarebbe da sinistra a destra
 * (livelli in colonna, fratelli impilati), e quanti fogli A4/A3 servono a stamparla (`planSheets` della pagina di stampa).
 * Serve a decidere l'orientamento sul dato vero (spec topologia §12).
 *
 * Entrambe le disposizioni sono quelle vere di `layoutTree` (`"tb"` = orizzontale di oggi, `"lr"` =
 * verticale, da sinistra a destra): niente stime.
 * Lavora su una copia della copia dentro `--cartella`. Stampa solo numeri.
 *
 * Uso:  npx tsx scripts/misura-orientamento.ts <copia.db> --cartella <scratchpad>
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { controllaPercorsi } from "../src/lib/scanner/__tests__/support/percorsi-prova";
import { drawingBoxes } from "../src/lib/topology/print-draw";
import { OVERLAP_MM, planSheets } from "../src/lib/topology/print-tiles";
import type { LayoutResult } from "../src/lib/topology/tree-layout";

/**
 * Fogli veri della stampa (spec §12.3): `planSheets` della pagina di stampa, coi riquadri della
 * disposizione (un riquadro non si spezza fra due fogli), A4 e A3, scala 100 % e 80 %, foglio girato
 * se servono meno fogli. Il conto è dei tasselli stampati (i vuoti no): la pagina ne aggiunge uno per
 * la panoramica, più uno per ogni seguito dell'elenco dei cavi di ridondanza.
 */
function pagine(layout: LayoutResult) {
  const out: Record<string, string> = {};
  for (const scale of [1, 0.8] as const) {
    for (const paper of ["A3", "A4"] as const) {
      const p = planSheets({ width: layout.width, height: layout.height, boxes: drawingBoxes(layout) }, { paper, scale, overlapMm: OVERLAP_MM });
      out[`${paper}_${Math.round(scale * 100)}%`] = `${p.printed} fogli (griglia ${p.rows} righe × ${p.cols} colonne, ${p.tiles.length - p.printed} vuoti), foglio ${p.landscape ? "orizzontale" : "verticale"}`;
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
  const oggi = L.layoutTree(model, tree, [], new Set(), "tb");
  const verticale = L.layoutTree(model, tree, [], new Set(), "lr");

  const figliDi = new Map<string, number>();
  for (const n of verticale.nodes.values()) if (n.parent && n.role === "box") figliDi.set(n.parent, (figliDi.get(n.parent) ?? 0) + 1);
  const colonne = new Set([...verticale.nodes.values()].filter((n) => n.role === "box").map((n) => n.x));

  const maxFratelli = Math.max(0, ...figliDi.values());
  const out = {
    nodi_nell_albero: [...oggi.nodes.values()].filter((n) => n.role === "box").length,
    ap: [...oggi.nodes.values()].filter((n) => n.role === "ap").length,
    attaccati: [...oggi.nodes.values()].filter((n) => n.role === "attached").length,
    attaccati_nascosti_oltre_il_limite: [...oggi.moreAttached.values()].reduce((a, b) => a + b, 0),
    radici: tree.roots.length,
    livelli: colonne.size,
    fratelli_max_sotto_un_nodo: maxFratelli,
    orizzontale_px: { larghezza: Math.round(oggi.width), altezza: Math.round(oggi.height) },
    orizzontale_fogli: pagine(oggi),
    verticale_px: { larghezza: Math.round(verticale.width), altezza: Math.round(verticale.height) },
    verticale_fogli: pagine(verticale),
  };
  process.stdout.write(`${JSON.stringify(out, null, 1)}\n`);
  return 0;
}

main().then((c) => process.exit(c), (e) => { process.stderr.write(`errore: ${e instanceof Error ? e.message : String(e)}\n`); process.exit(2); });
