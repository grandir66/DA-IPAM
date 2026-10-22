/**
 * misura-inventario-vulcan.ts — A-IPAM, Task 4: quanto pesa la fotografia dell'inventario
 * per DA-Vul-can su una COPIA del DB di un tenant. Apre `<cartella-dati>/tenants/<tenant>.db`
 * in sola lettura (nessuna scrittura, nemmeno le migrazioni) e stampa solo numeri: mai ip,
 * nomi, sistemi o il corpo.
 *
 * Uso:   npx tsx scripts/misura-inventario-vulcan.ts <cartella-dati> <tenant>
 * Uscita: 0 fatto, 1 corpo rifiutato dal costruttore (oltre i limiti dell'hub), 2 non partito.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import Database from "better-sqlite3";
import { leggiDatiInventario } from "../src/lib/vulcan/dati-inventario";
import { corpoInventario } from "../src/lib/vulcan/corpo-inventario";

function esci(msg: string, codice: number): never {
  process.stderr.write(`${msg}\n`);
  process.exit(codice);
}

const [cartella, tenant] = process.argv.slice(2);
if (!cartella || !tenant) esci("Uso: npx tsx scripts/misura-inventario-vulcan.ts <cartella-dati> <tenant>", 2);
if (!/^[A-Za-z0-9_-]{1,40}$/.test(tenant)) esci("tenant non valido", 2);
const reale = fs.realpathSync(cartella);
// Sui dati veri non si misura: solo copie (sola lettura in ogni caso).
for (const vietata of ["/opt/", path.join(process.cwd(), "data") + path.sep]) {
  if ((reale + path.sep).startsWith(vietata)) esci(`cartella non ammessa (${vietata}): si misura su una copia`, 2);
}
const file = path.join(reale, "tenants", `${tenant}.db`);
if (!fs.existsSync(file)) esci("DB del tenant non trovato nella cartella", 2);

const db = new Database(file, { readonly: true, fileMustExist: true });
const t0 = process.hrtime.bigint();
const dati = leggiDatiInventario(db);
const t1 = process.hrtime.bigint();
const r = corpoInventario(dati, { codcli: tenant, nodo: "misura", versione: "misura", adesso: new Date() });
const t2 = process.hrtime.bigint();
db.close();

const ms = (a: bigint, b: bigint) => (Number(b - a) / 1e6).toFixed(1);
if ("errore" in r) esci(`costruttore: ${r.errore}`, 1);

const gz = zlib.gzipSync(Buffer.from(r.json, "utf8"));
const j = JSON.parse(r.json) as { reti: unknown[]; oggetti: { fuori_supporto: boolean | null; in_ad: boolean; agente_wazuh: boolean; porte: unknown[] }[] };
const conta = (f: (o: (typeof j.oggetti)[number]) => boolean) => j.oggetti.filter(f).length;
const righe: [string, string | number][] = [
  ["host letti", dati.host.length],
  ["oggetti", r.oggetti],
  ["host saltati (senza ip, rete o data)", r.saltati],
  ["reti", j.reti.length],
  ["byte JSON", Buffer.byteLength(r.json, "utf8")],
  ["byte gzip", gz.length],
  ["ms lettura DB", ms(t0, t1)],
  ["ms costruzione", ms(t1, t2)],
  ["porte illeggibili (host)", r.porteIllegibili],
  ["porte inviate (totale)", j.oggetti.reduce((n, o) => n + o.porte.length, 0)],
  ["fuori_supporto true", conta((o) => o.fuori_supporto === true)],
  ["fuori_supporto false", conta((o) => o.fuori_supporto === false)],
  ["fuori_supporto null", conta((o) => o.fuori_supporto == null)],
  ["in_ad", conta((o) => o.in_ad)],
  ["agente_wazuh", conta((o) => o.agente_wazuh)],
  ["apparati senza host (non inviati in v1)", dati.apparatiSenzaHost],
];
for (const [k, v] of righe) process.stdout.write(`${k}: ${v}\n`);
