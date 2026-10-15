// scripts/credenziali/copia-dati.ts
/**
 * Copia online di hub.db e dei DB tenant con l'API di backup di SQLite
 * (`db.backup()` di better-sqlite3), per la tappa 2 credenziali: fotografia,
 * prova a vuoto e misure lavorano SOLO su copie (piano
 * 2026-10-15-tappa2-archivio-credenziali, procedura R passo 2).
 *
 * Mai `cp` di un DB in WAL: le righe ancora nel WAL resterebbero indietro, o la
 * copia uscirebbe a metà di una scrittura. I sorgenti si aprono in sola lettura.
 *
 * Uso:  npx tsx scripts/credenziali/copia-dati.ts --da <cartella dati> --a <cartella nuova>
 *   --a non deve esistere (o essere vuota), né stare dentro --da o contenerla.
 *   Lo spazio libero si controlla prima (somma dei DB e dei WAL, più il 10%).
 *   Uscita: 0 copiato, 1 copia fallita a metà, 2 non partito.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { dentro, percorsoReale } from "../../src/lib/credentials/guardia-copia";

const CODICE_TENANT = /^([A-Za-z0-9_-]{1,64})\.db$/;

function uso(msg?: string): number {
  if (msg) process.stderr.write(`${msg}\n`);
  process.stderr.write("Uso: npx tsx scripts/credenziali/copia-dati.ts --da <cartella dati> --a <cartella nuova>\n");
  return 2;
}

function dimensione(f: string): number {
  let n = 0;
  for (const g of [f, `${f}-wal`]) {
    try {
      n += fs.statSync(g).size;
    } catch {
      /* il WAL può mancare: DB chiuso e già riportato */
    }
  }
  return n;
}

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

async function main(): Promise<number> {
  const a = process.argv.slice(2);
  const val = (k: string) => (a.indexOf(k) >= 0 ? a[a.indexOf(k) + 1] : undefined);
  const daArg = val("--da");
  const aArg = val("--a");
  if (!daArg || !aArg) return uso();

  let da: string;
  try {
    da = fs.realpathSync(path.resolve(daArg));
  } catch {
    return uso(`La cartella --da non esiste: ${daArg}`);
  }
  const hub = path.join(da, "hub.db");
  const tenants = path.join(da, "tenants");
  if (!fs.existsSync(hub) || !fs.existsSync(tenants)) return uso(`--da non sembra una cartella dati: mancano hub.db o tenants/ (${da})`);

  const dest = percorsoReale(aArg);
  if (dest === da || dentro(dest, da) || dentro(da, dest)) {
    return uso(`--a (${dest}) non può essere --da, stare dentro --da o contenerla (${da})`);
  }
  if (fs.existsSync(dest) && (!fs.statSync(dest).isDirectory() || fs.readdirSync(dest).length > 0)) {
    return uso(`--a esiste già e non è una cartella vuota: ${dest}`);
  }

  const sorgenti: Array<{ da: string; a: string }> = [{ da: hub, a: path.join(dest, "hub.db") }];
  for (const f of fs.readdirSync(tenants).sort()) {
    if (CODICE_TENANT.test(f)) sorgenti.push({ da: path.join(tenants, f), a: path.join(dest, "tenants", f) });
  }
  const serve = Math.ceil(sorgenti.reduce((s, x) => s + dimensione(x.da), 0) * 1.1);

  let antenato = dest;
  while (!fs.existsSync(antenato)) antenato = path.dirname(antenato);
  const st = fs.statfsSync(antenato);
  const libero = st.bavail * st.bsize;
  if (libero < serve) return uso(`Spazio libero insufficiente in ${antenato}: servono ${mb(serve)}, liberi ${mb(libero)}`);
  process.stdout.write(`Spazio: servono ${mb(serve)}, liberi ${mb(libero)}\n`);

  fs.mkdirSync(path.join(dest, "tenants"), { recursive: true, mode: 0o700 });
  fs.chmodSync(dest, 0o700);
  fs.chmodSync(path.join(dest, "tenants"), 0o700);

  for (const s of sorgenti) {
    const src = new Database(s.da, { readonly: true, fileMustExist: true });
    try {
      await src.backup(s.a);
    } catch (e) {
      process.stderr.write(`Copia fallita di ${path.relative(da, s.da)}: ${e instanceof Error ? e.message : String(e)}\n`);
      return 1;
    } finally {
      src.close();
    }
    fs.chmodSync(s.a, 0o600);
    process.stdout.write(`copiato ${path.relative(da, s.da)} (${mb(fs.statSync(s.a).size)})\n`);
  }
  process.stdout.write(`Copia completa in ${dest}: ${sorgenti.length} DB\n`);
  return 0;
}

function esci(codice: number): void {
  process.stdout.write("", () => process.stderr.write("", () => process.exit(codice)));
}

main().then(esci, (e) => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  esci(2);
});
