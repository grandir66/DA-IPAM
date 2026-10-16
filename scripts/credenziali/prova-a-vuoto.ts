// scripts/credenziali/prova-a-vuoto.ts
/**
 * Prova a vuoto delle migrazioni della tappa 2 credenziali, sulla COPIA dei
 * dati (T11 del piano 2026-10-15-tappa2-archivio-credenziali, procedura R
 * passo 2; si estende nei T16, T19, T22 e T27).
 *
 * Questo script SCRIVE: apre ogni tenant della copia con getTenantDb, cioè con
 * tutte le migrazioni, come al riavvio vero. Per ogni tenant:
 *   1. conta in sola lettura PRIMA: righe di credentials, figli per colonna,
 *      violazioni delle chiavi esterne, contatore, segni credenziali_t2_*;
 *   2. apre con getTenantDb (migrazioni);
 *   3. conta DOPO e stampa le differenze, coi nomi delle voci a terminale;
 *   4. chiude e riapre: la seconda apertura non deve cambiare niente.
 *
 * Ordine obbligato (vincolo «Script sulle copie»): db-tenant e db-hub fissano i
 * percorsi quando si caricano, e l'ambiente del servizio punta ai dati veri.
 *   1. qui si importano staticamente solo moduli di node e la guardia pura;
 *   2. si sposta l'ambiente su --dati;
 *   3. solo dopo si carica `appoggio-prova` (che importa db-tenant);
 *   4. prima di aprire un DB, la guardia ricontrolla i percorsi che i moduli
 *      useranno davvero. Ogni errore: uscita 2, niente aperto.
 *
 * Uso:  npx tsx scripts/credenziali/prova-a-vuoto.ts --dati <copia> [--dati-servizio <cartella>]
 *   Serve ENCRYPTION_KEY (ambiente del servizio, caricato senza stamparlo).
 *   Senza DA_INVENT_DATA_DIR nell'ambiente (l'hub non ce l'ha) serve
 *   --dati-servizio con la cartella dati del servizio.
 *   Uscita: 0 tutto in regola, 1 da guardare (seconda apertura che cambia,
 *   segno errore: o parziale:, tenant che non si apre), 2 non partito.
 */
import path from "node:path";
import { cartelleServizio, controllaCopia } from "../../src/lib/credentials/guardia-copia";

type Misura = import("./appoggio-prova").Misura;

function uso(msg?: string): number {
  if (msg) process.stderr.write(`${msg}\n`);
  process.stderr.write("Uso: npx tsx scripts/credenziali/prova-a-vuoto.ts --dati <copia dei dati> [--dati-servizio <cartella>]\n");
  return 2;
}

function figli(prima: Misura, dopo: Misura): string[] {
  const chiavi = [...new Set([...Object.keys(prima.stato.figli), ...Object.keys(dopo.stato.figli)])].sort();
  return chiavi.map((k) => {
    const a = prima.stato.figli[k];
    const b = dopo.stato.figli[k];
    return `  ${k}: ${a ?? "-"} → ${b ?? "-"}${a === b ? "" : "  (DIVERSO)"}`;
  });
}

function voci(prima: Misura, dopo: Misura): string[] {
  const out: string[] = [];
  const primaPerId = new Map(prima.voci.map((v) => [v.id, v]));
  const dopoPerId = new Map(dopo.voci.map((v) => [v.id, v]));
  for (const v of dopo.voci) {
    const p = primaPerId.get(v.id);
    if (!p) out.push(`  #${v.id} «${v.name}»: nuova, ${v.credential_type}`);
    else if (p.credential_type !== v.credential_type || p.name !== v.name) {
      out.push(`  #${v.id} «${v.name}»: ${p.credential_type} → ${v.credential_type}${p.name !== v.name ? ` (era «${p.name}»)` : ""}`);
    }
  }
  for (const p of prima.voci) if (!dopoPerId.has(p.id)) out.push(`  #${p.id} «${p.name}»: SPARITA`);
  return out;
}

function stampaTenant(code: string, prima: Misura, dopo: Misura): void {
  const s1 = prima.stato;
  const s2 = dopo.stato;
  process.stdout.write(`== Tenant ${code}\n`);
  process.stdout.write(
    `credentials: righe ${s1.righe} → ${s2.righe}, violazioni ${s1.violazioni ?? "-"} → ${s2.violazioni ?? "-"}, seq ${s1.seq ?? "-"} → ${s2.seq ?? "-"}\n`
  );
  process.stdout.write(`figli per colonna:\n${figli(prima, dopo).join("\n") || "  (nessuna colonna figlia)"}\n`);
  const segni = [...new Set([...Object.keys(prima.segni), ...Object.keys(dopo.segni)])].sort();
  process.stdout.write(`segni:\n${segni.map((k) => `  ${k}: ${prima.segni[k] ?? "(assente)"} → ${dopo.segni[k] ?? "(assente)"}`).join("\n") || "  (nessuno)"}\n`);
  const v = voci(prima, dopo);
  process.stdout.write(`voci cambiate:\n${v.join("\n") || "  (nessuna)"}\n`);
}

async function main(): Promise<number> {
  const a = process.argv.slice(2);
  // Un'opzione scritta senza valore vale "" (errore), non «assente».
  const val = (k: string) => (a.indexOf(k) >= 0 ? (a[a.indexOf(k) + 1] ?? "") : undefined);
  const datiArg = val("--dati");
  if (!datiArg) return uso();
  if (!process.env.ENCRYPTION_KEY?.trim()) return uso("ENCRYPTION_KEY assente: carica l'ambiente del servizio prima di lanciare la prova a vuoto.");

  // Le cartelle dati del servizio, lette PRIMA di sovrascrivere l'ambiente.
  const servizio = cartelleServizio(process.env, val("--dati-servizio"), process.cwd());
  if (!servizio.ok) return uso(`Non parto: ${servizio.motivo}`);
  const dati = path.resolve(datiArg);
  const attesi = { dati, hubDb: path.join(dati, "hub.db"), cartellaTenant: path.join(dati, "tenants"), datiServizio: servizio.cartelle };
  const erroriPrima = controllaCopia(attesi);
  if (erroriPrima.length > 0) return uso(`Non parto:\n${erroriPrima.map((e) => `  - ${e}`).join("\n")}`);

  process.env.DA_INVENT_DATA_DIR = attesi.dati;
  process.env.DA_IPAM_HUB_DB_PATH = attesi.hubDb;
  const appoggio = await import("./appoggio-prova");
  const erroriDopo = controllaCopia({ ...attesi, hubDb: appoggio.getHubDbPath(), cartellaTenant: appoggio.cartellaTenant() });
  if (erroriDopo.length > 0) return uso(`Non parto (percorsi dei moduli):\n${erroriDopo.map((e) => `  - ${e}`).join("\n")}`);

  let esito = 0;
  for (const code of appoggio.elencaTenant()) {
    let prima: Misura;
    let dopo: Misura;
    let riapertura: Misura;
    try {
      prima = appoggio.misuraFile(code);
      dopo = appoggio.apriEMisura(code);
      riapertura = appoggio.apriEMisura(code);
    } catch (e) {
      process.stdout.write(`== Tenant ${code}\nERRORE: ${e instanceof Error ? e.message : String(e)}\n`);
      esito = 1;
      continue;
    }
    stampaTenant(code, prima, dopo);
    if (JSON.stringify(riapertura) === JSON.stringify(dopo)) {
      process.stdout.write("seconda apertura: nessun cambiamento\n");
    } else {
      process.stdout.write("seconda apertura: CAMBIA QUALCOSA\n");
      stampaTenant(`${code} (seconda apertura)`, dopo, riapertura);
      esito = 1;
    }
    for (const [k, v] of Object.entries(dopo.segni)) {
      if (v.startsWith("errore:") || v.startsWith("parziale:")) {
        process.stdout.write(`DA GUARDARE: ${k} = ${v}\n`);
        esito = 1;
      }
    }
  }
  appoggio.chiudiTutto();
  return esito;
}

function esci(codice: number): void {
  process.stdout.write("", () => process.stderr.write("", () => process.exit(codice)));
}

main().then(esci, (e) => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  esci(2);
});
