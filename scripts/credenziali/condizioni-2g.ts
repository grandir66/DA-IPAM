// scripts/credenziali/condizioni-2g.ts
/**
 * Le condizioni per togliere il vecchio (tappa 2g credenziali, T26 del piano
 * 2026-10-15-tappa2-archivio-credenziali), misurate sulla COPIA dei dati. Non
 * scrive niente: le conversioni si rifanno a vuoto e si annullano.
 *
 * Con le decisioni di Riccardo del 16/10 (D9 rivista e lasciati accettati,
 * `src/lib/credentials/condizioni-2g.ts`): per ogni tenant della copia
 *   - i segni `credenziali_t2_tipi`, `…_catene`, `…_integrazioni` devono valere
 *     `done:`; un tenant senza nessun segno (mai aperto dopo la 2c) si esclude
 *     e si dice per nome;
 *   - gli apparati che la conversione della 2e lascerebbe ADESSO devono
 *     coincidere con l'elenco `--lasciati-accettati <tenant>:<id>,<id>` di quel
 *     tenant (nessun elenco = nessun lasciato ammesso, e un `parziale:` blocca);
 *   - nessuna riga di controller e AD lasciata dalla 2f (Omada): blocco;
 *   - nel registro dei ripieghi nessun caso di D9 (tutti i `cred_*` tranne
 *     `cred_public`) dalla data del segno della 2f del tenant, e da nessun'altra
 *     (niente `--dal`: poteva solo restringere la finestra; un'opzione
 *     sconosciuta ferma lo script).
 * Niente più attesa di 14 giorni.
 *
 * Ordine obbligato (vincolo «Script sulle copie»): db-tenant e db-hub fissano i
 * percorsi quando si caricano, e l'ambiente del servizio punta ai dati veri.
 *   1. qui si importano staticamente solo moduli di node, la guardia pura e la
 *      regola pura delle condizioni;
 *   2. si sposta l'ambiente su --dati;
 *   3. solo dopo si carica `appoggio-condizioni` (che importa db-tenant);
 *   4. prima di aprire un DB, la guardia ricontrolla i percorsi che i moduli
 *      useranno davvero. Ogni errore: uscita 2, niente aperto.
 * Il registro dei ripieghi (`--registro`, di solito <dati del servizio>/logs/
 * ripieghi) si legge soltanto: è un file di log, non un DB.
 *
 * Uso:  npx tsx scripts/credenziali/condizioni-2g.ts --dati <copia> --registro <cartella del registro>
 *         [--dati-servizio <cartella>] [--lasciati-accettati <tenant>:<id>,<id>]…
 *   Serve ENCRYPTION_KEY (ambiente del servizio, caricato senza stamparlo): le
 *   conversioni a vuoto decifrano in memoria per confrontare.
 *   Uscita: 0 in regola, 1 bloccato (il perché è a terminale), 2 non partito,
 *   3 niente blocchi ma ripieghi `cred_colonna_apparato` da confermare (T27:
 *   il registro non dice se vengono dai lasciati accettati; li conferma
 *   Riccardo nella conferma scritta della pulizia, col numero stampato).
 */
import path from "node:path";
import { cartelleServizio, controllaCopia } from "../../src/lib/credentials/guardia-copia";
import { leggiLasciatiAccettati, leggiRegistroRipieghi, valutaCondizioni2g, type Registro } from "../../src/lib/credentials/condizioni-2g";
import { opzioneSconosciuta } from "../../src/lib/credentials/guardia-scrittura";

function uso(msg?: string): number {
  if (msg) process.stderr.write(`${msg}\n`);
  process.stderr.write(
    "Uso: npx tsx scripts/credenziali/condizioni-2g.ts --dati <copia dei dati> --registro <cartella del registro dei ripieghi> " +
      "[--dati-servizio <cartella>] [--lasciati-accettati <tenant>:<id>,<id>]...\n"
  );
  return 2;
}

/** Tutti i valori di un'opzione ripetibile; un'opzione scritta senza valore vale "" (errore). */
function valori(a: readonly string[], k: string): string[] {
  const out: string[] = [];
  a.forEach((x, i) => {
    if (x === k) out.push(a[i + 1] ?? "");
  });
  return out;
}

async function main(): Promise<number> {
  const a = process.argv.slice(2);
  const ignota = opzioneSconosciuta(a, ["--dati", "--registro", "--dati-servizio", "--lasciati-accettati"], []);
  if (ignota != null) return uso(`Opzione sconosciuta «${ignota}»: niente misurato (i ripieghi contano dalla data del segno della 2f, senza --dal)`);
  const val = (k: string): string | undefined => (a.indexOf(k) >= 0 ? (a[a.indexOf(k) + 1] ?? "") : undefined);
  const datiArg = val("--dati");
  if (!datiArg) return uso();
  const registroArg = val("--registro");
  if (!registroArg) return uso("Serve --registro con la cartella del registro dei ripieghi del servizio: senza, «nessun ripiego» non si può dire.");
  if (!process.env.ENCRYPTION_KEY?.trim()) return uso("ENCRYPTION_KEY assente: carica l'ambiente del servizio prima di lanciare la misura.");

  let accettati: Map<string, number[]>;
  try {
    accettati = leggiLasciatiAccettati(valori(a, "--lasciati-accettati"));
  } catch (e) {
    return uso(e instanceof Error ? e.message : String(e));
  }

  let registro: Registro;
  try {
    registro = leggiRegistroRipieghi(path.resolve(registroArg));
  } catch (e) {
    return uso(e instanceof Error ? e.message : String(e));
  }

  // Le cartelle dati del servizio, lette PRIMA di sovrascrivere l'ambiente.
  const servizio = cartelleServizio(process.env, val("--dati-servizio"), process.cwd());
  if (!servizio.ok) return uso(`Non parto: ${servizio.motivo}`);
  const dati = path.resolve(datiArg);
  const attesi = { dati, hubDb: path.join(dati, "hub.db"), cartellaTenant: path.join(dati, "tenants"), datiServizio: servizio.cartelle };
  const erroriPrima = controllaCopia(attesi);
  if (erroriPrima.length > 0) return uso(`Non parto:\n${erroriPrima.map((e) => `  - ${e}`).join("\n")}`);

  process.env.DA_INVENT_DATA_DIR = attesi.dati;
  process.env.DA_IPAM_HUB_DB_PATH = attesi.hubDb;
  const appoggio = await import("./appoggio-condizioni");
  const erroriDopo = controllaCopia({ ...attesi, hubDb: appoggio.getHubDbPath(), cartellaTenant: appoggio.cartellaTenant() });
  if (erroriDopo.length > 0) return uso(`Non parto (percorsi dei moduli):\n${erroriDopo.map((e) => `  - ${e}`).join("\n")}`);

  const tenant = appoggio.elencaTenant();
  const sconosciuti = [...accettati.keys()].filter((t) => !tenant.includes(t));
  if (sconosciuti.length > 0) {
    return uso(`--lasciati-accettati per tenant che nella copia non ci sono: ${sconosciuti.join(", ")} (tenant della copia: ${tenant.join(", ") || "nessuno"})`);
  }
  process.stdout.write(
    `registro dei ripieghi: ${registro.righe.length} righe lette${registro.illeggibili ? `, ${registro.illeggibili} illeggibili` : ""}\n`
  );

  let bloccato = false;
  let daConfermare = false;
  for (const code of tenant) {
    process.stdout.write(`== Tenant ${code}\n`);
    let m: import("./appoggio-condizioni").MisuraTenant;
    try {
      m = appoggio.misuraTenant(code);
    } catch (e) {
      process.stdout.write(`BLOCCATO: il tenant non si legge: ${e instanceof Error ? e.message : String(e)}\n`);
      bloccato = true;
      continue;
    }
    const s = m.stato.segni;
    process.stdout.write(
      `segni: tipi ${s.tipi ?? "(assente)"}; catene ${s.catene ?? "(assente)"}; apparati ${s.apparati ?? "(assente)"}; integrazioni ${s.integrazioni ?? "(assente)"}\n`
    );
    const lasciati = m.stato.lasciatiApparati.map((l) => `  «${m.nomiApparati[l.device_id] ?? "?"}» (#${l.device_id}): ${l.motivo}`);
    process.stdout.write(`apparati lasciati dalla 2e, ricalcolati adesso:\n${lasciati.join("\n") || "  (nessuno)"}\n`);
    const righe = m.stato.lasciatiIntegrazioni.map((l) => `  ${l.tabella} #${l.id}: ${l.motivo}`);
    process.stdout.write(`righe di controller e AD lasciate dalla 2f:\n${righe.join("\n") || "  (nessuna)"}\n`);

    const esito = valutaCondizioni2g(m.stato, registro, accettati.get(code) ?? null);
    const blocchi = [...m.nonMisurabili, ...esito.blocchi];
    for (const n of esito.note) process.stdout.write(`nota: ${n}\n`);
    if (esito.stato === "escluso") {
      process.stdout.write("ESCLUSO (dirlo per nome a Riccardo)\n");
      continue;
    }
    if (esito.daConfermare) {
      process.stdout.write(
        `ripieghi da confermare (${esito.daConfermare.conteggio}):\n${esito.daConfermare.righe.map((r) => `  - ${r}`).join("\n")}\n`
      );
    }
    if (blocchi.length > 0) {
      bloccato = true;
      process.stdout.write(`BLOCCATO:\n${blocchi.map((b) => `  - ${b}`).join("\n")}\n`);
    } else if (esito.daConfermare) {
      daConfermare = true;
      process.stdout.write(`DA CONFERMARE: ${esito.daConfermare.conteggio} ripieghi ${esito.daConfermare.righe.length > 1 ? "elencati" : "elencato"} qui sopra\n`);
    } else {
      process.stdout.write("in regola\n");
    }
  }
  if (bloccato) {
    process.stdout.write("condizioni della 2g: BLOCCATO\n");
    return 1;
  }
  if (daConfermare) {
    process.stdout.write("condizioni della 2g: DA CONFERMARE (ripieghi che solo Riccardo può attribuire ai lasciati accettati)\n");
    return 3;
  }
  process.stdout.write("condizioni della 2g: in regola\n");
  return 0;
}

function esci(codice: number): void {
  process.stdout.write("", () => process.stderr.write("", () => process.exit(codice)));
}

main().then(esci, (e) => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  esci(2);
});
