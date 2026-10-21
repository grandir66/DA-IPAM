/**
 * Riempie le tabelle della scheda MikroTik di una COPIA del DB di un tenant con le righe ricavate dalle fixture vere
 * (piano «Scheda MikroTik copiata dal Manager», Task 9): serve solo a vedere le tab VLAN e Bridge in locale quando il router
 * della copia non ha bridge o la lettura della topologia è spenta sull'hub (e `next dev` non fa girare lo scheduler).
 *
 * Scrive SOLO nella copia indicata, che deve stare in `<dati>/tenants/<codice>.db` dentro la cartella di lavoro (temporanea,
 * fuori dal repo): stesse guardie di `scripts/estrai-fixture-topologia.ts`. Livello 2: bridge (mk3), porte (mk4), bond (mk8a)
 * con `scriviSchedaMikrotikTopologia`, cioè lo stesso codice della lettura vera. Il livello 3 arriva col Task 10.
 * Stampa solo conteggi (i registri dell'app hanno nomi e indirizzi).
 *
 * Uso:  npx tsx scripts/prova-scheda-mikrotik.ts <copia.db> --cartella <scratchpad> --device <id> [--livello 2]
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { percorsoReale } from "../src/lib/scanner/__tests__/support/percorsi-prova";

function uso(msg?: string): number {
  if (msg) process.stderr.write(`${msg}\n`);
  process.stderr.write("Uso: npx tsx scripts/prova-scheda-mikrotik.ts <copia.db> --cartella <scratchpad> --device <id> [--livello 2]\n");
  return 2;
}

const dentro = (figlio: string, padre: string): boolean => {
  const rel = path.relative(padre, figlio);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
};

/** I motivi per non partire (vuoto = si parte): la copia e l'hub dentro la cartella di lavoro, temporanea e fuori dal repo. */
function controlla(cartella: string, copia: string, hub: string): string[] {
  const e: string[] = [];
  const scratch = percorsoReale(cartella);
  const repo = percorsoReale(process.cwd());
  if (!fs.existsSync(scratch) || !fs.statSync(scratch).isDirectory()) e.push("la cartella di lavoro non esiste");
  if (![os.tmpdir(), "/tmp", "/private/tmp"].map(percorsoReale).some((r) => dentro(scratch, r))) e.push("la cartella di lavoro non sta in una cartella temporanea");
  if (scratch === repo || dentro(scratch, repo)) e.push("la cartella di lavoro sta dentro il repo");
  if (!dentro(percorsoReale(copia), scratch)) e.push("la copia è fuori dalla cartella di lavoro");
  if (!dentro(percorsoReale(hub), scratch)) e.push("l'hub è fuori dalla cartella di lavoro");
  if (!fs.existsSync(copia) || !fs.statSync(copia).isFile()) e.push("la copia non esiste");
  if (path.basename(path.dirname(copia)) !== "tenants") e.push("la copia deve stare in <dati>/tenants/<codice>.db");
  return e;
}

async function main(): Promise<number> {
  const a = process.argv.slice(2);
  const conValore = ["--cartella", "--device", "--livello"];
  const val = (k: string) => (a.indexOf(k) >= 0 ? a[a.indexOf(k) + 1] : undefined);
  const liberi = a.filter((x, i) => !x.startsWith("--") && !conValore.includes(a[i - 1]));
  const cartella = val("--cartella");
  const device = Number(val("--device"));
  const livello = Number(val("--livello") ?? "2");
  if (!cartella || liberi.length !== 1 || !Number.isInteger(device) || device <= 0) return uso();
  if (livello === 3) return uso("Il livello 3 (VLAN dei bridge, interfacce VLAN, DNS) arriva col Task 10.");
  if (livello !== 2) return uso("Livello non valido.");

  const copia = path.resolve(liberi[0]);
  const tenant = path.basename(copia).replace(/\.db$/i, "");
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(tenant)) return uso("Nome del file non valido come codice tenant.");
  const dati = path.dirname(path.dirname(copia));
  const hub = path.join(dati, "hub.db");
  const errori = controlla(cartella, copia, hub);
  if (errori.length > 0) return uso(`Non parto:\n${errori.map((e) => `  - ${e}`).join("\n")}`);

  process.env.DA_INVENT_DATA_DIR = dati;
  process.env.DA_IPAM_HUB_DB_PATH = hub;
  process.env.ENCRYPTION_KEY ||= crypto.randomBytes(16).toString("hex");
  const scrivi = process.stdout.write.bind(process.stdout);
  for (const k of ["log", "info", "warn", "debug", "error"] as const) console[k] = () => {};

  // Import dopo aver fissato l'ambiente: il modulo legge DA_INVENT_DATA_DIR al caricamento (come estrai-fixture-topologia).
  const { withTenant, getTenantDb, getNetworkDeviceById, livelloSchemaSchedaMk, scriviSchedaMikrotikTopologia } = await import("../src/lib/db-tenant");
  const { parseBridgeScheda, parsePorteBridgeScheda, parseBondScheda } = await import("../src/lib/devices/mikrotik-scheda");
  const fx = (n: string) => fs.readFileSync(path.join(process.cwd(), "src/lib/devices/__tests__/fixtures", n), "utf8");

  return withTenant(tenant, () => {
    const d = getNetworkDeviceById(device);
    if (!d) return uso("Apparato assente nella copia.");
    if (d.vendor !== "mikrotik") return uso("L'apparato non è un MikroTik.");
    if (livelloSchemaSchedaMk(getTenantDb(tenant)) < 2) return uso("Schema della scheda sotto il livello 2: tabelle assenti nella copia.");
    const r = scriviSchedaMikrotikTopologia(device, {
      bridge: parseBridgeScheda(fx("mikrotik-mk3-testa.txt")),
      porte: parsePorteBridgeScheda(fx("mikrotik-mk4-testa.txt")),
      bond: parseBondScheda(fx("mikrotik-mk8a-testa.txt")),
    });
    if (!r) return uso("Scrittura rifiutata (schema).");
    scrivi(`scritte nella copia: bridge ${r.bridge}, porte ${r.porte}, bond ${r.bond}\n`);
    return 0;
  });
}

main().then((c) => process.exit(c), (e: unknown) => {
  process.stderr.write(`Errore: ${e instanceof Error ? e.message.slice(0, 200) : "sconosciuto"}\n`);
  process.exit(1);
});
