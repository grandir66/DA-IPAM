// scripts/misura-topologia.ts
/**
 * misura-topologia.ts — numeri della topologia prima/dopo la fase 1 su una COPIA
 * del DB di un tenant (piano 2026-10-13-topologia-fase1-dati, Task 14).
 * Copia della copia in una cartella temporanea; migrazione applicata lì; con
 * --unifi legge il controller in sola lettura e scrive solo sulla copia.
 * Stampa solo conteggi.
 *
 * Uso:  npx tsx scripts/misura-topologia.ts <copia.db> --cartella <scratchpad> [--unifi <id> --segreto-stdin] [--json]
 *   Il segreto (chiave API o password del controller) arriva come PRIMA RIGA di
 *   stdin, mai in un argomento. Uscita: 0 fatto, 1 integrità rovinata, 2 non partito.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import readline from "node:readline";
import { controllaPercorsi } from "../src/lib/scanner/__tests__/support/percorsi-prova";

function uso(msg?: string): number {
  if (msg) process.stderr.write(`${msg}\n`);
  process.stderr.write("Uso: npx tsx scripts/misura-topologia.ts <copia.db> --cartella <scratchpad> [--unifi <id> --segreto-stdin] [--json]\n");
  return 2;
}

async function primaRiga(): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin });
  for await (const line of rl) {
    rl.close();
    return line.trim();
  }
  return "";
}

async function main(): Promise<number> {
  const a = process.argv.slice(2);
  const val = (k: string) => (a.indexOf(k) >= 0 ? a[a.indexOf(k) + 1] : undefined);
  const cartella = val("--cartella");
  const unifi = val("--unifi");
  const json = a.includes("--json");
  const conSegreto = a.includes("--segreto-stdin");
  const liberi = a.filter((x, i) => !x.startsWith("--") && !["--cartella", "--unifi"].includes(a[i - 1] ?? ""));
  if (!cartella || liberi.length !== 1) return uso();
  if (unifi !== undefined && (!/^\d+$/.test(unifi) || !conSegreto)) return uso("--unifi vuole l'id del controller e --segreto-stdin.");

  const sorgente = path.resolve(liberi[0]);
  const tenant = path.basename(sorgente).replace(/\.db$/i, "");
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(tenant)) return uso("Nome del file non valido come codice tenant.");
  const lavoro = path.join(path.resolve(cartella), `misura-topologia-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  const dataDir = path.join(lavoro, "data");
  const hubDb = path.join(lavoro, "hub.db");
  const errori = controllaPercorsi({ scratchpad: cartella, sorgente, dataDir, hubDb, repo: process.cwd() });
  if (errori.length > 0) return uso(`Non parto:\n${errori.map((e) => `  - ${e}`).join("\n")}`);

  const segreto = conSegreto ? await primaRiga() : "";
  if (conSegreto && !segreto) return uso("Nessun segreto sulla prima riga di stdin.");

  const dest = path.join(dataDir, "tenants", `${tenant}.db`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(sorgente, dest);
  process.env.DA_INVENT_DATA_DIR = dataDir;
  process.env.DA_IPAM_HUB_DB_PATH = hubDb;
  process.env.ENCRYPTION_KEY ||= crypto.randomBytes(16).toString("hex");
  const registro = path.join(lavoro, "misura.log");
  for (const k of ["log", "info", "warn", "error", "debug"] as const) {
    console[k] = (...p: unknown[]) => fs.appendFileSync(registro, `[${k}] ${p.map(String).join(" ").split(segreto || "\u0000").join("***")}\n`);
  }

  const Database = (await import("better-sqlite3")).default;
  // «Pagina mai usata» è un avviso di spazio non referenziato, non un danno ai dati: si conta a parte.
  const sintesi = (righe: string[]): string => {
    const avvisi = righe.filter((r) => /^Page \d+: never used$/.test(r)).length;
    const gravi = righe.filter((r) => r !== "ok" && r !== "*** in database main ***" && !/^Page \d+: never used$/.test(r)).length;
    if (gravi > 0) return `ROVINATA (${gravi} errori)`;
    return avvisi > 0 ? `ok (${avvisi} pagine mai usate)` : "ok";
  };
  const controllo = (d: { prepare(s: string): { all(): unknown[] } }): string =>
    sintesi((d.prepare("PRAGMA integrity_check").all() as Array<{ integrity_check: string }>).flatMap((r) => r.integrity_check.split("\n")));
  const integrita = (f: string) => {
    const d = new Database(f, { readonly: true });
    try {
      return controllo(d);
    } finally {
      d.close();
    }
  };
  const out: Record<string, unknown> = { tenant, integrita_prima: integrita(dest) };

  const t0 = Date.now();
  // Import dinamico voluto e sicuro qui: l'ambiente (cartella dati, copia del
  // DB) va impostato prima che db-tenant venga caricato, e questo script è un
  // processo solo, fuori dall'app. ADR 0002 riguarda il runtime tsx dell'app,
  // dove una seconda istanza del modulo perde il contesto tenant.
  const tenantDb = await import("../src/lib/db-tenant");
  const db = tenantDb.getTenantDb(tenant);
  out.migrazione_ms = Date.now() - t0;
  out.integrita_dopo = controllo(db);

  const { buildTopologyGraph } = await import("../src/lib/topology/graph");
  const { buildTopologyModel } = await import("../src/lib/topology/model");
  const vecchia = tenantDb.withTenant(tenant, () => {
    const d = tenantDb.getTopologyData();
    const g = buildTopologyGraph({ devices: d.devices, hosts: d.hosts, neighbors: d.neighbors, statusByNode: new Map() });
    const grado = new Map<string, number>();
    for (const e of g.edges) for (const n of [e.source, e.target]) grado.set(n, (grado.get(n) ?? 0) + 1);
    return {
      collegamenti_fra_apparati: g.edges.filter((e) => e.source.startsWith("dev:") && e.target.startsWith("dev:")).length,
      nodi_esterni: g.nodes.filter((n) => n.kind === "external").length,
      apparati_isolati: g.nodes.filter((n) => n.kind === "device" && !grado.has(n.id)).length,
    };
  });
  out.prima = vecchia;
  const tm = Date.now();
  out.dopo = tenantDb.withTenant(tenant, () => buildTopologyModel(tenantDb.getTopologyModelInput(2)).counts);
  out.modello_ms = Date.now() - tm;

  if (unifi !== undefined) {
    const { createUnifiClient } = await import("../src/lib/integrations/unifi-api");
    const { syncUnifiForTenant } = await import("../src/lib/integrations/unifi-sync");
    const row = db.prepare("SELECT kind, url, site, credential_id, cert_pin FROM network_controllers WHERE id = ?").get(Number(unifi)) as
      | { kind: string; url: string; site: string; credential_id: number | null; cert_pin: string | null }
      | undefined;
    if (!row) return uso(`Controller ${unifi} assente nella copia.`);
    // Dalla 2g (T27) la colonna username della riga è vuota: l'utente viene dalla voce dell'archivio.
    let utente = "";
    if (row.kind !== "udm") {
      const { utenteVoceControllerDb } = await import("../src/lib/controllers/credenziale");
      const u = utenteVoceControllerDb(db, row.credential_id);
      if (!u.ok) return uso(u.motivo);
      utente = u.username;
    }
    let pin = row.cert_pin;
    const store = { get: () => pin, set: (p: string) => { pin = p; }, clear: () => { pin = null; } };
    const cfg = row.kind === "udm"
      ? { url: row.url, kind: "udm" as const, site: row.site, apiToken: segreto }
      : { url: row.url, kind: "self_hosted" as const, site: row.site, username: utente, password: segreto };
    const ts = Date.now();
    try {
      const r = await tenantDb.withTenant(tenant, () => syncUnifiForTenant({ source: createUnifiClient(cfg, store) }));
      out.lettura_unifi = { apparati: r.total, nuovi: r.added, aggiornati: r.updated, saltati: r.skipped, porte: r.portsUpserted, vicini: r.neighborsUpserted, uplink: r.uplinksSaved, errori: r.errors.length, ms: Date.now() - ts };
    } catch (e) {
      // Il messaggio può citare l'indirizzo: va nel registro (senza segreto), a schermo solo il conteggio.
      fs.appendFileSync(registro, `[error] lettura UniFi: ${(e instanceof Error ? e.message : String(e)).split(segreto).join("***")}\n`);
      out.lettura_unifi = { apparati: 0, nuovi: 0, aggiornati: 0, saltati: 0, porte: 0, vicini: 0, uplink: 0, errori: 1, ms: Date.now() - ts };
    }
    const td = Date.now();
    out.dopo_lettura = tenantDb.withTenant(tenant, () => buildTopologyModel(tenantDb.getTopologyModelInput(2)).counts);
    out.modello_dopo_lettura_ms = Date.now() - td;
  }
  out.integrita_finale = controllo(db);

  process.stdout.write(json ? `${JSON.stringify(out, null, 1)}\n` : `${Object.entries(out).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`).join("\n")}\n`);
  return !String(out.integrita_finale).startsWith("ROVINATA") && !String(out.integrita_dopo).startsWith("ROVINATA") ? 0 : 1;
}

main().then((c) => process.exit(c), (e) => { process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`); process.exit(2); });
