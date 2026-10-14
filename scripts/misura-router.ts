// scripts/misura-router.ts
/**
 * misura-router.ts — effetto della regola «un router aggiunge solo ciò che gli è
 * collegato direttamente» (spec topologia §11.1) su una COPIA del DB di un tenant.
 * Copia della copia in una cartella temporanea; stampa solo conteggi.
 * Con --salva <file.json> scrive il «genitore di ogni nodo» (classe del padre
 * nell'albero automatico); con --confronta <file.json> conta quanti apparati
 * passano da sotto un router a sotto uno switch rispetto a quel file.
 *
 * Uso:  npx tsx scripts/misura-router.ts <copia.db> --cartella <scratchpad> [--salva f.json | --confronta f.json]
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { controllaPercorsi } from "../src/lib/scanner/__tests__/support/percorsi-prova";

async function main(): Promise<number> {
  const a = process.argv.slice(2);
  const val = (k: string) => (a.indexOf(k) >= 0 ? a[a.indexOf(k) + 1] : undefined);
  const cartella = val("--cartella");
  const salva = val("--salva");
  const confronta = val("--confronta");
  const liberi = a.filter((x, i) => !x.startsWith("--") && !["--cartella", "--salva", "--confronta"].includes(a[i - 1] ?? ""));
  if (!cartella || liberi.length !== 1) {
    process.stderr.write("Uso: npx tsx scripts/misura-router.ts <copia.db> --cartella <scratchpad> [--salva f.json | --confronta f.json]\n");
    return 2;
  }
  const sorgente = path.resolve(liberi[0]);
  const tenant = path.basename(sorgente).replace(/\.db$/i, "");
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(tenant)) return 2;
  const lavoro = path.join(path.resolve(cartella), `misura-router-${new Date().toISOString().replace(/[:.]/g, "-")}`);
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
  const m = tenantDb.withTenant(tenant, () => buildTopologyModel(tenantDb.getTopologyModelInput(2)));

  const tipo = new Map(m.nodes.map((n) => [n.id, n.type]));
  const isRouter = (id: string) => ["router", "firewall"].includes(tipo.get(id) ?? "");
  const touching = (src: string) => m.links.filter((l) => l.source === (src as typeof l.source) && (isRouter(l.a) || isRouter(l.b))).length;
  const toccano: Record<string, number> = {};
  for (const s of ["lldp", "cdp", "mndp", "mac_table", "unifi_uplink"]) toccano[s] = touching(s);

  const head = proposeHead(m);
  const tree = buildTree(m, autoVisible(m), head ? [head] : []);
  const padre: Record<string, string> = {};
  for (const [padreId, figli] of tree.children) for (const f of figli) padre[f] = isRouter(padreId) ? "router" : "altro";
  const out: Record<string, unknown> = {
    collegamenti_che_toccano_un_router_per_fonte: toccano,
    apparati_isolati: m.counts.isolatedDevices,
    nodi_totali: m.counts.nodes,
    collegamenti_totali: m.counts.links,
    radici_albero_automatico: tree.roots.length,
    da_sistemare: m.isolated.length,
    figli_di_router: Object.values(padre).filter((v) => v === "router").length,
  };
  if (salva) fs.writeFileSync(salva, JSON.stringify(padre));
  if (confronta) {
    const prima = JSON.parse(fs.readFileSync(confronta, "utf8")) as Record<string, string>;
    out.da_router_a_non_router = Object.keys(prima).filter((id) => prima[id] === "router" && padre[id] === "altro").length;
    out.da_non_router_a_router = Object.keys(prima).filter((id) => prima[id] === "altro" && padre[id] === "router").length;
    out.senza_padre_ora = Object.keys(prima).filter((id) => !(id in padre)).length;
  }
  process.stdout.write(`${JSON.stringify(out)}\n`);
  return 0;
}

main().then((c) => process.exit(c), (e) => { process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`); process.exit(2); });
