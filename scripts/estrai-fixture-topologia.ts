/**
 * Estrae una fixture ANONIMA del modello della topologia da una COPIA del DB di
 * un tenant (piano topologia fase 1, Task 9). Copia della copia in una cartella
 * temporanea (stesse guardie di prova-giri-sovrapposti), migrazione applicata
 * lì, sola lettura. Tiene tutti gli host (il modello li conta). Stampa solo
 * conteggi. Rifiuta di scrivere (exit 1/2) se il modello della fixture non dà i
 * conteggi del dato vero, o se nella fixture c'è un IP, un MAC o un nome veri.
 *
 * Uso:  npx tsx scripts/estrai-fixture-topologia.ts <copia.db> --cartella <scratchpad> --uscita <file.json>
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { controllaPercorsi } from "../src/lib/scanner/__tests__/support/percorsi-prova";

function uso(msg?: string): number {
  if (msg) process.stderr.write(`${msg}\n`);
  process.stderr.write("Uso: npx tsx scripts/estrai-fixture-topologia.ts <copia.db> --cartella <scratchpad> --uscita <file.json>\n");
  return 2;
}

/** La cartella di lavoro con la copia del DB (320 MB sul cliente A, 2 GB sull'hub): si toglie a fine giro, comunque vada. */
const copie: string[] = [];

async function main(): Promise<number> {
  const a = process.argv.slice(2);
  const val = (k: string) => (a.indexOf(k) >= 0 ? a[a.indexOf(k) + 1] : undefined);
  const cartella = val("--cartella");
  const uscita = val("--uscita");
  const liberi = a.filter((x, i) => !x.startsWith("--") && a[i - 1] !== "--cartella" && a[i - 1] !== "--uscita");
  if (!cartella || !uscita || liberi.length !== 1) return uso();
  const sorgente = path.resolve(liberi[0]);
  const tenant = path.basename(sorgente).replace(/\.db$/i, "");
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(tenant)) return uso("Nome del file non valido come codice tenant.");

  const lavoro = path.join(path.resolve(cartella), `fixture-topologia-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  copie.push(lavoro);
  const dataDir = path.join(lavoro, "data");
  const hubDb = path.join(lavoro, "hub.db");
  const errori = controllaPercorsi({ scratchpad: cartella, sorgente, dataDir, hubDb, repo: process.cwd() });
  if (errori.length > 0) return uso(`Non parto:\n${errori.map((e) => `  - ${e}`).join("\n")}`);

  // Copia della copia: il file dato si legge e basta.
  const dest = path.join(dataDir, "tenants", `${tenant}.db`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(sorgente, dest);
  const wal = `${sorgente}-wal`;
  if (fs.existsSync(wal) && fs.statSync(wal).size > 0) fs.copyFileSync(wal, `${dest}-wal`);
  process.env.DA_INVENT_DATA_DIR = dataDir;
  process.env.DA_IPAM_HUB_DB_PATH = hubDb;
  process.env.ENCRYPTION_KEY ||= crypto.randomBytes(16).toString("hex");
  // I registri dell'app contengono nomi e indirizzi: non escono a schermo.
  for (const k of ["log", "info", "warn", "debug", "error"] as const) console[k] = () => {};

  const { withTenant, getTopologyModelInput } = await import("../src/lib/db-tenant");
  const { anonimizzaInput, contaValoriVeri, ingressoDellaFixture, porteInChiaro } = await import("../src/lib/topology/anonimizza");
    const { buildTopologyModel } = await import("../src/lib/topology/model");

  const input = withTenant(tenant, () => getTopologyModelInput(2));
  // Tutti gli host: dalla fase 2 il modello conta ogni host come nodo (`nodes`) e i gruppi di host
  // fusi fra loro (`mergedHosts`), quindi togliere host «che non servono» cambierebbe i conteggi.
  // Le VM e gli host dei cluster invece no: portano nomi, IP e MAC veri e la fixture non li ha (prova della forma,
  // FASE_2B_SEZIONI.vms: null). Dalla fase 2b le VM cambiano il modello, quindi il confronto si fa fra l'ingresso vero
  // SENZA le VM e la fixture, e la differenza dovuta alle VM si stampa a parte (revisione del piano, 15/10: confrontando
  // col dato vero intero l'estrazione usciva con 1 su tutte e due le copie, già col codice di prima).
  const ridotto = ingressoDellaFixture(input);
  const anonimo = anonimizzaInput(ridotto);

  // Il modello della fixture dev'essere quello vero senza le VM: stessi conteggi, o niente fixture.
  const vero = JSON.stringify(buildTopologyModel(input).counts);
  const conteggiRidotto = JSON.stringify(buildTopologyModel(ridotto).counts);
  const conteggiAnonimo = JSON.stringify(buildTopologyModel(anonimo).counts);
  process.stdout.write(`conteggi del modello: ${vero}\n`);
  if (conteggiRidotto !== vero) process.stdout.write(`senza le VM (la forma della fixture): ${conteggiRidotto}\n`);
  if (conteggiAnonimo !== conteggiRidotto) {
    process.stderr.write(`Conteggi diversi, fixture NON scritta.\n  senza le VM: ${conteggiRidotto}\n  anonimo: ${conteggiAnonimo}\n`);
    return 1;
  }
  // Il repo è pubblico: nessun IP, MAC o nome veri (dell'input COMPLETO) nella fixture, o niente fixture.
  const fughe = contaValoriVeri(input, JSON.parse(JSON.stringify(anonimo)));
  if (fughe.ip + fughe.mac + fughe.nomi > 0) {
    process.stderr.write(`Valori veri nella fixture, NON scritta: IP ${fughe.ip} · MAC ${fughe.mac} · nomi ${fughe.nomi} (valori di testo che li contengono)\n`);
    return 2;
  }
  // I nomi di porta (spec §13.12.2): ogni pezzo rimasto uguale al vero dev'essere un nome di fabbrica, o niente fixture.
  const porte = porteInChiaro(ridotto, anonimo);
  if (porte > 0) {
    process.stderr.write(`Nomi di porta veri che non sono di fabbrica nella fixture, NON scritta: ${porte}\n`);
    return 2;
  }
  process.stdout.write("valori veri nella fixture: 0 IP · 0 MAC · 0 nomi · 0 nomi di porta scelti\n");
  fs.writeFileSync(path.resolve(uscita), `${JSON.stringify(anonimo, null, 1)}\n`);
  process.stdout.write(
    `apparati ${anonimo.devices.length} · host ${anonimo.hosts.length} · vicini ${anonimo.neighbors.length} · reti ${anonimo.networks.length} · ubicazioni ${anonimo.locations.length} · MAC per porta ${anonimo.macPorts.length}\n`,
  );
  return 0;
}

main()
  .catch((e: unknown) => { process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`); return 2; })
  .then((c) => { for (const p of copie) fs.rmSync(p, { recursive: true, force: true }); process.exit(c); });
