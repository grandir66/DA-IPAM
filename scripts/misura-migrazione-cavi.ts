/**
 * misura-migrazione-cavi.ts — la migrazione di T2 su una COPIA del DB di un tenant (spec 2026-10-14 §13.11.3, «Misure
 * sulle copie», primo punto): copia della copia dentro --cartella, `integrity_check` prima, apertura col codice nuovo
 * (schema e migrazioni) misurata, `integrity_check` dopo, che cosa è stato aggiunto, seconda apertura che non aggiunge
 * niente. Stampa solo conteggi e nomi di colonne: niente dati del cliente. La copia della copia si toglie a fine giro.
 *
 * Uso:  npx tsx scripts/misura-migrazione-cavi.ts <copia.db> --cartella <scratchpad>
 *   Uscita: 0 fatto e integro; 1 integrità rovinata o seconda apertura che aggiunge; 2 non partito.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { controllaPercorsi } from "../src/lib/scanner/__tests__/support/percorsi-prova";

const copie: string[] = [];

async function main(): Promise<number> {
  const a = process.argv.slice(2);
  const i = a.indexOf("--cartella");
  const cartella = i >= 0 ? a[i + 1] : undefined;
  const liberi = a.filter((x, k) => !x.startsWith("--") && a[k - 1] !== "--cartella");
  if (!cartella || liberi.length !== 1) {
    process.stderr.write("Uso: npx tsx scripts/misura-migrazione-cavi.ts <copia.db> --cartella <scratchpad>\n");
    return 2;
  }
  const sorgente = path.resolve(liberi[0]);
  const tenant = path.basename(sorgente).replace(/\.db$/i, "");
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(tenant)) { process.stderr.write("Nome del file non valido come codice tenant.\n"); return 2; }
  const lavoro = path.join(path.resolve(cartella), `misura-migrazione-cavi-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  const dataDir = path.join(lavoro, "data");
  const hubDb = path.join(lavoro, "hub.db");
  copie.push(dataDir, hubDb, `${hubDb}-wal`, `${hubDb}-shm`);
  const errori = controllaPercorsi({ scratchpad: cartella, sorgente, dataDir, hubDb, repo: process.cwd() });
  if (errori.length > 0) { process.stderr.write(`Non parto:\n${errori.map((e) => `  - ${e}`).join("\n")}\n`); return 2; }
  const dest = path.join(dataDir, "tenants", `${tenant}.db`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(sorgente, dest);
  const wal = `${sorgente}-wal`;
  if (fs.existsSync(wal) && fs.statSync(wal).size > 0) fs.copyFileSync(wal, `${dest}-wal`);
  process.env.DA_INVENT_DATA_DIR = dataDir;
  process.env.DA_IPAM_HUB_DB_PATH = hubDb;
  process.env.ENCRYPTION_KEY ||= crypto.randomBytes(16).toString("hex");
  const registro = path.join(lavoro, "misura.log");
  for (const k of ["log", "info", "warn", "error", "debug"] as const) console[k] = (...p: unknown[]) => fs.appendFileSync(registro, `[${k}] ${p.map(String).join(" ")}\n`);

  const Database = (await import("better-sqlite3")).default;
  const integrita = (file: string): string[] => {
    const raw = new Database(file, { readonly: true });
    try {
      return (raw.prepare("PRAGMA integrity_check").all() as Array<{ integrity_check: string }>)
        .flatMap((r) => r.integrity_check.split("\n")).map((r) => r.trim()).filter((r) => r !== "" && r !== "*** in database main ***");
    } finally { raw.close(); }
  };
  const struttura = (file: string): string => {
    const raw = new Database(file, { readonly: true });
    try {
      const oggetti = raw.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY type, name").all();
      const colonne = (raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{ name: string }>)
        .map((t) => [t.name, raw.prepare(`PRAGMA table_info(${t.name})`).all()]);
      return JSON.stringify({ oggetti, colonne });
    } finally { raw.close(); }
  };
  const integraPrima = integrita(dest);
  const strutturaPrima = struttura(dest);
  // Import dinamico voluto qui (come misura-cavi.ts): l'ambiente va impostato prima che db-tenant si carichi.
  const tenantDb = await import("../src/lib/db-tenant");
  const t0 = performance.now();
  tenantDb.getTenantDb(tenant);
  const durata = Math.round(performance.now() - t0);
  const schema = tenantDb.withTenant(tenant, () => tenantDb.schemaCaviPresente());
  tenantDb.closeTenantDb(tenant);
  const strutturaDopo = struttura(dest);
  const integraDopo = integrita(dest);
  tenantDb.getTenantDb(tenant);
  tenantDb.closeTenantDb(tenant);
  const secondaUguale = struttura(dest) === strutturaDopo;
  const aggiunto = (JSON.parse(strutturaDopo) as { oggetti: Array<{ name: string }> }).oggetti.map((o) => o.name)
    .filter((n) => !strutturaPrima.includes(`"name":"${n}"`));
  const ok = (r: string[]) => r.every((x) => x === "ok" || /^Page \d+: never used$/.test(x));
  const out = {
    tenant, durata_apertura_ms: durata, integrity_prima: integraPrima.join("; "), integrity_dopo: integraDopo.join("; "),
    schema_cavi_presente: schema, oggetti_aggiunti: aggiunto, seconda_apertura_uguale: secondaUguale,
    righe_migrazione: fs.existsSync(registro) ? fs.readFileSync(registro, "utf8").split("\n").filter((r) => r.includes("topologia cavi (T2)")).length : 0,
  };
  process.stdout.write(`${JSON.stringify(out, null, 1)}\n`);
  return ok(integraPrima) && ok(integraDopo) && secondaUguale && schema ? 0 : 1;
}

main()
  .catch((e: unknown) => { process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`); return 2; })
  .then((c) => { for (const p of copie) fs.rmSync(p, { recursive: true, force: true }); process.exit(c); });
