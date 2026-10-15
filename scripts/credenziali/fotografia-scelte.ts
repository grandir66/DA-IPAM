// scripts/credenziali/fotografia-scelte.ts
/**
 * Fotografia delle scelte delle credenziali, sulla COPIA dei dati (tappa 2
 * credenziali, T1 del piano 2026-10-15-tappa2-archivio-credenziali).
 *
 * Per ogni tenant della copia: apparati (protocollo principale e snmp), host
 * (ssh, winrm, snmp), catene di rete, anteprima edge, credenziali patch degli
 * host Windows. Una riga JSON per scelta, col segreto solo come impronta.
 * La fotografia «prima» e quella «dopo», prese sulla stessa copia col codice di
 * prima e con quello di dopo, si confrontano con --confronta: è la misura di
 * arresto di ogni sotto-tappa.
 *
 * Ordine obbligato (vincolo «Script sulle copie»): db-tenant e db-hub fissano i
 * percorsi quando si caricano, e l'ambiente del servizio punta ai dati veri.
 *   1. qui si importano staticamente solo moduli di node, la guardia pura e il
 *      formato della fotografia;
 *   2. si sposta l'ambiente su --dati;
 *   3. solo dopo si carica `appoggio-fotografia` (che importa db-tenant);
 *   4. prima di aprire un DB, la guardia ricontrolla i percorsi che i moduli
 *      useranno davvero. Ogni errore: uscita 2, niente aperto.
 *
 * Uso:  npx tsx scripts/credenziali/fotografia-scelte.ts --dati <copia> --out <file.jsonl>
 *       npx tsx scripts/credenziali/fotografia-scelte.ts --confronta <prima.jsonl> <dopo.jsonl> [--con-fonte]
 *   Serve ENCRYPTION_KEY (ambiente del servizio, caricato senza stamparlo).
 *   La cartella di --out si crea 0700 (si rifiuta una cartella più larga), il
 *   file nasce 0600 e non si sovrascrive. Uscita: 0 fatto / nessuna
 *   differenza, 1 differenze, 2 non partito.
 */
import fs from "node:fs";
import path from "node:path";
import { controllaCopia } from "../../src/lib/credentials/guardia-copia";
import {
  confrontaFotografie,
  contaPerOggetto,
  descriviDifferenza,
  leggiFotografia,
  type RigaFotografia,
} from "../../src/lib/credentials/fotografia";

function uso(msg?: string): number {
  if (msg) process.stderr.write(`${msg}\n`);
  process.stderr.write(
    "Uso: npx tsx scripts/credenziali/fotografia-scelte.ts --dati <copia dei dati> --out <file.jsonl>\n" +
      "     npx tsx scripts/credenziali/fotografia-scelte.ts --confronta <prima.jsonl> <dopo.jsonl> [--con-fonte]\n"
  );
  return 2;
}

function confronta(a: string[]): number {
  const i = a.indexOf("--confronta");
  const primaF = a[i + 1];
  const dopoF = a[i + 2];
  if (!primaF || !dopoF || primaF.startsWith("--") || dopoF.startsWith("--")) return uso();
  const prima = leggiFotografia(fs.readFileSync(primaF, "utf8"), primaF);
  const dopo = leggiFotografia(fs.readFileSync(dopoF, "utf8"), dopoF);
  const diff = confrontaFotografie(prima, dopo, { conFonte: a.includes("--con-fonte") });
  process.stdout.write(`Righe: prima ${prima.length}, dopo ${dopo.length}. Differenze: ${diff.length}\n`);
  for (const d of diff) process.stdout.write(`${descriviDifferenza(d)}\n`);
  return diff.length === 0 ? 0 : 1;
}

async function main(): Promise<number> {
  const a = process.argv.slice(2);
  if (a.includes("--confronta")) return confronta(a);
  const val = (k: string) => (a.indexOf(k) >= 0 ? a[a.indexOf(k) + 1] : undefined);
  const datiArg = val("--dati");
  const outArg = val("--out");
  if (!datiArg || !outArg) return uso();
  const chiave = process.env.ENCRYPTION_KEY?.trim();
  if (!chiave) return uso("ENCRYPTION_KEY assente: carica l'ambiente del servizio prima di lanciare la fotografia.");

  // La cartella dati del servizio, letta PRIMA di sovrascrivere l'ambiente
  // (stessa regola di resolveDataDir in src/lib/data-dir.ts).
  const datiServizio = process.env.DA_INVENT_DATA_DIR?.trim() || path.join(process.cwd(), "data");
  const dati = path.resolve(datiArg);
  const attesi = { dati, hubDb: path.join(dati, "hub.db"), cartellaTenant: path.join(dati, "tenants"), datiServizio };
  const erroriPrima = controllaCopia(attesi);
  if (erroriPrima.length > 0) return uso(`Non parto:\n${erroriPrima.map((e) => `  - ${e}`).join("\n")}`);

  const out = path.resolve(outArg);
  const cartellaOut = path.dirname(out);
  if (fs.existsSync(cartellaOut)) {
    if ((fs.statSync(cartellaOut).mode & 0o077) !== 0) {
      return uso(`La cartella ${cartellaOut} ha permessi più larghi di 0700: la fotografia contiene nomi e impronte.`);
    }
  } else {
    fs.mkdirSync(cartellaOut, { recursive: true, mode: 0o700 });
    fs.chmodSync(cartellaOut, 0o700);
  }
  if (fs.existsSync(out)) return uso(`${out} esiste già: una fotografia non si sovrascrive.`);

  process.env.DA_INVENT_DATA_DIR = attesi.dati;
  process.env.DA_IPAM_HUB_DB_PATH = attesi.hubDb;
  const appoggio = await import("./appoggio-fotografia");
  const erroriDopo = controllaCopia({ ...attesi, hubDb: appoggio.getHubDbPath(), cartellaTenant: appoggio.cartellaTenant() });
  if (erroriDopo.length > 0) return uso(`Non parto (percorsi dei moduli):\n${erroriDopo.map((e) => `  - ${e}`).join("\n")}`);

  const righe: RigaFotografia[] = [];
  for (const code of appoggio.elencaTenant()) {
    const r = appoggio.fotografaTenant(code, chiave);
    righe.push(...r.righe);
    const c = contaPerOggetto(r.righe);
    process.stdout.write(
      `[${code}] apparato ${c.apparato}, host ${c.host}, rete ${c.rete}, edge ${c.edge}, patch ${c.patch}; ` +
        `credenziali cifrate leggibili ${r.cifrate.leggibili}/${r.cifrate.totali}; provenienza non ricostruita ${r.discordi}\n`
    );
  }
  appoggio.chiudiTutto();
  fs.writeFileSync(out, righe.map((r) => JSON.stringify(r)).join("\n") + (righe.length ? "\n" : ""), { mode: 0o600, flag: "wx" });
  process.stdout.write(`Fotografia: ${righe.length} righe in ${out}\n`);
  return 0;
}

function esci(codice: number): void {
  process.stdout.write("", () => process.stderr.write("", () => process.exit(codice)));
}

main().then(esci, (e) => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  esci(2);
});
