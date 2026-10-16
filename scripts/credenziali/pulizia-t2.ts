// scripts/credenziali/pulizia-t2.ts
/**
 * La pulizia dei dati vecchi delle credenziali (tappa 2g, T27 del piano
 * 2026-10-15-tappa2-archivio-credenziali). Dal T26 nessuno legge più colonne
 * degli apparati, catene vecchie e colonne di controller e AD; qui si tolgono
 * i segreti rimasti lì (`src/lib/credentials/pulizia-t2.ts`). Non sta in
 * getTenantDb: su un'appliance che riceve `main` girerebbe senza prova a
 * vuoto, backup e conferma.
 *
 * Per ogni tenant (o solo quelli di `--tenant`):
 *   1. con il segno `credenziali_t2_pulizia` a `done:` non fa niente;
 *   2. le condizioni (`valutaCondizioni2g`, decisioni di Riccardo del 16/10):
 *      segni della tappa 2 chiusi; la 2e anche `parziale:` se i lasciati
 *      ricalcolati adesso a vuoto sono ESATTAMENTE l'elenco
 *      `--lasciati-accettati <tenant>:<id>,<id>` (mai dedotto); nessuna riga
 *      Omada lasciata dalla 2f; nel registro dei ripieghi nessun caso di D9
 *      dalla data del segno della 2f (niente attesa di giorni). I
 *      `cred_colonna_apparato` che il registro non sa attribuire ai lasciati
 *      accettati si stampano col numero e si confermano nella conferma
 *      scritta. Un tenant senza segni si esclude e si dice per nome;
 *   3. il piano, coi nomi a terminale: un apparato con una colonna piena fuori
 *      dall'elenco, o senza binding equivalente, blocca il tenant;
 *   4. senza `--applica` si ferma lì (a vuoto: niente scritto). Con
 *      `--applica`: la conferma scritta (il codice del tenant, più il numero
 *      dei ripieghi da confermare se ce ne sono), poi il backup
 *      `.bak-YYYYMMDD-HHMMSS` accanto al DB (spazio controllato prima), poi
 *      la pulizia in una transazione col segno. Un tenant alla volta.
 *
 * Due modi, sempre dichiarati:
 *   --copia                --dati è una copia (guardia delle copie, ordine di
 *                          caricamento come gli altri script della tappa 2);
 *   --servizio <unità>     --dati sono i dati veri di quell'unità (da-ipam o
 *                          da-ipam.service), che deve essere ferma, e fermi
 *                          anche <app>-update.timer e <app>-update.service.
 *
 * Uso:  npx tsx scripts/credenziali/pulizia-t2.ts --dati <cartella dati> --registro <cartella del registro>
 *         (--copia | --servizio <unità>) [--dati-servizio <cartella>] [--tenant <codice>]...
 *         [--lasciati-accettati <tenant>:<id>,<id>]... [--applica]
 *   I ripieghi contano dalla data del segno della 2f di ogni tenant, e da
 *   nessun'altra (niente `--dal`); un'opzione sconosciuta ferma lo script.
 *   Serve ENCRYPTION_KEY (ambiente del servizio, caricato senza stamparlo).
 *   Uscita: 0 fatto (o niente da fare, o a vuoto senza blocchi), 1 qualche
 *   tenant bloccato, non confermato o in errore, 2 non partito.
 */
import fs from "node:fs";
import path from "node:path";
import { cartelleServizio, controllaCopia, dentro, percorsoReale } from "../../src/lib/credentials/guardia-copia";
import { controllaDatiVeri, lettoreConferme, opzioneSconosciuta, valoreOpzione, valoriOpzione } from "../../src/lib/credentials/guardia-scrittura";
import { leggiLasciatiAccettati, leggiRegistroRipieghi, valutaCondizioni2g, type Registro } from "../../src/lib/credentials/condizioni-2g";

const USO =
  "Uso: npx tsx scripts/credenziali/pulizia-t2.ts --dati <cartella dati> --registro <cartella del registro dei ripieghi> " +
  "(--copia | --servizio <unità>) [--dati-servizio <cartella>] [--tenant <codice>]... " +
  "[--lasciati-accettati <tenant>:<id>,<id>]... [--applica]\n";

const CON_VALORE = ["--dati", "--registro", "--servizio", "--dati-servizio", "--tenant", "--lasciati-accettati"];
const SENZA_VALORE = ["--copia", "--applica"];

function uso(msg?: string): number {
  if (msg) process.stderr.write(`${msg}\n`);
  process.stderr.write(USO);
  return 2;
}

const scrivi = (s: string) => process.stdout.write(`${s}\n`);
const elenco = (righe: string[], vuoto: string) => (righe.length > 0 ? righe.map((r) => `  ${r}`).join("\n") : `  ${vuoto}`);
const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

type Appoggio = typeof import("./appoggio-pulizia");

function stampaPiano(p: import("./appoggio-pulizia").PianoPulizia): void {
  scrivi("piano:");
  scrivi(`apparati da svuotare:\n${elenco(p.apparati.map((a) => `«${a.nome}» (#${a.device_id}): ${a.colonne.join(", ")}`), "(nessuno)")}`);
  if (p.bloccanti.length > 0) scrivi(`apparati che bloccano:\n${elenco(p.bloccanti.map((b) => `«${b.nome}» (#${b.device_id}): ${b.motivo}`), "")}`);
  scrivi(`controller da svuotare:\n${elenco(p.controller.map((r) => `«${r.nome}» (#${r.id})`), "(nessuno)")}`);
  if (p.controllerSenzaVoce.length > 0) {
    scrivi(`controller senza voce, restano com'erano:\n${elenco(p.controllerSenzaVoce.map((r) => `«${r.nome}» (#${r.id})`), "")}`);
  }
  scrivi(`Active Directory da svuotare:\n${elenco(p.ad.map((r) => `«${r.nome}» (#${r.id})`), "(nessuna)")}`);
  if (p.adSenzaVoce.length > 0) scrivi(`Active Directory senza voce, restano com'erano:\n${elenco(p.adSenzaVoce.map((r) => `«${r.nome}» (#${r.id})`), "")}`);
  scrivi(`tabelle da togliere: ${p.tabelle.length > 0 ? p.tabelle.map((t) => `${t.nome} (${t.righe} righe)`).join(", ") : "(nessuna)"}`);
}

interface Opzioni {
  registro: Registro;
  accettati: Map<string, number[]>;
  applica: boolean;
  chiedi: (domanda: string) => Promise<string | null>;
}

/** Un tenant: true se è andato (fatto, già fatto, escluso, a vuoto senza blocchi), false se bloccato o non fatto. */
async function tenant(appoggio: Appoggio, code: string, o: Opzioni): Promise<boolean> {
  scrivi(`== Tenant ${code}`);
  let aperto: { dbh: import("better-sqlite3").Database; file: string };
  try {
    aperto = appoggio.apriTenant(code);
  } catch (e) {
    scrivi(`BLOCCATO: il DB del tenant non si apre: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
  const { dbh, file } = aperto;
  try {
    const fatta = appoggio.puliziaFatta(dbh);
    if (fatta) {
      scrivi(`già pulito (${fatta}): niente da fare`);
      return true;
    }
    const m = appoggio.misuraCondizioniDb(dbh, code);
    const s = m.stato.segni;
    scrivi(`segni: tipi ${s.tipi ?? "(assente)"}; catene ${s.catene ?? "(assente)"}; apparati ${s.apparati ?? "(assente)"}; integrazioni ${s.integrazioni ?? "(assente)"}`);
    scrivi(
      `apparati lasciati dalla 2e, ricalcolati adesso:\n${elenco(
        m.stato.lasciatiApparati.map((l) => `«${m.nomiApparati[l.device_id] ?? "?"}» (#${l.device_id}): ${l.motivo}`),
        "(nessuno)"
      )}`
    );
    scrivi(`righe di controller e AD lasciate dalla 2f:\n${elenco(m.stato.lasciatiIntegrazioni.map((l) => `${l.tabella} #${l.id}: ${l.motivo}`), "(nessuna)")}`);
    const accettati = o.accettati.get(code) ?? null;
    const esito = valutaCondizioni2g(m.stato, o.registro, accettati);
    for (const n of esito.note) scrivi(`nota: ${n}`);
    if (esito.stato === "escluso") {
      scrivi("ESCLUSO (dirlo per nome a Riccardo): la pulizia qui non parte");
      return true;
    }
    if (esito.daConfermare) {
      scrivi(`ripieghi da confermare (${esito.daConfermare.conteggio}):\n${esito.daConfermare.righe.map((r) => `  - ${r}`).join("\n")}`);
    }
    const blocchi = [...m.nonMisurabili, ...esito.blocchi];
    if (blocchi.length > 0) {
      scrivi(`BLOCCATO:\n${blocchi.map((b) => `  - ${b}`).join("\n")}`);
      return false;
    }

    const piano = appoggio.pianoPuliziaDb(dbh, code, accettati ?? []);
    stampaPiano(piano);
    if (piano.bloccanti.length > 0) {
      scrivi("BLOCCATO: apparati con fonti vecchie che la pulizia non può togliere (elencati qui sopra)");
      return false;
    }
    if (!o.applica) {
      scrivi("a vuoto: niente scritto (con --applica: conferma scritta, backup, pulizia)");
      return true;
    }

    const confermare = esito.daConfermare?.conteggio ?? 0;
    const atteso = esito.daConfermare ? `${code} ${confermare}` : code;
    const spiega = esito.daConfermare
      ? ` (il codice e il numero dei ripieghi qui sopra, che confermi venire dagli apparati lasciati accettati)`
      : "";
    const risposta = await o.chiedi(`Per pulire il tenant ${code} scrivi «${atteso}»${spiega} e Invio (altro = non toccare): `);
    if (risposta !== atteso) {
      scrivi(`conferma non data: tenant ${code} non toccato`);
      return false;
    }
    const b = await appoggio.backupAccanto(dbh, file);
    scrivi(`backup: ${b.percorso} (${mb(b.byte)}) alle ${appoggio.oraItaliana(b.quando)} ora italiana (${b.quando.toISOString()})`);
    const fatto = appoggio.applicaPuliziaDb(dbh, piano, { ripieghiConfermati: confermare });
    scrivi(
      `pulito: ${fatto.apparati} apparati, ${fatto.controller} controller, ${fatto.ad} AD, tabelle tolte ${fatto.tabelle.join(", ") || "nessuna"}; segno ${fatto.segno}`
    );
    return true;
  } catch (e) {
    scrivi(`ERRORE, niente scritto in questo passo: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  } finally {
    dbh.close();
  }
}

async function main(): Promise<number> {
  const a = process.argv.slice(2);
  const ignota = opzioneSconosciuta(a, CON_VALORE, SENZA_VALORE);
  if (ignota != null) return uso(`Opzione sconosciuta «${ignota}»: niente fatto (i ripieghi contano dalla data del segno della 2f, senza --dal)`);
  const datiArg = valoreOpzione(a, "--dati");
  if (!datiArg) return uso();
  const registroArg = valoreOpzione(a, "--registro");
  if (!registroArg) return uso("Serve --registro con la cartella del registro dei ripieghi del servizio: senza, «nessun ripiego» non si può dire.");
  const copia = a.includes("--copia");
  const unita = valoreOpzione(a, "--servizio");
  if (copia === (unita !== undefined)) {
    return uso("Dichiara i dati: --copia (la cartella è una copia) oppure --servizio <unità> (i dati veri di quell'unità, a servizio fermo).");
  }
  if (!process.env.ENCRYPTION_KEY?.trim()) return uso("ENCRYPTION_KEY assente: carica l'ambiente del servizio prima di lanciare la pulizia.");
  const richiesti = valoriOpzione(a, "--tenant");
  if (richiesti.some((t) => !/^[A-Za-z0-9_-]{1,64}$/.test(t))) return uso("--tenant vuole il codice di un tenant");

  let accettati: Map<string, number[]>;
  let registro: Registro;
  try {
    accettati = leggiLasciatiAccettati(valoriOpzione(a, "--lasciati-accettati"));
    registro = leggiRegistroRipieghi(path.resolve(registroArg));
  } catch (e) {
    return uso(e instanceof Error ? e.message : String(e));
  }

  // Le cartelle dati del servizio, lette PRIMA di sovrascrivere l'ambiente.
  const servizio = cartelleServizio(process.env, valoreOpzione(a, "--dati-servizio"), process.cwd());
  if (!servizio.ok) return uso(`Non parto: ${servizio.motivo}`);
  const dati = path.resolve(datiArg);
  const attesi = { dati, hubDb: path.join(dati, "hub.db"), cartellaTenant: path.join(dati, "tenants"), datiServizio: servizio.cartelle };
  const veri = copia ? null : controllaDatiVeri({ dati, unita: unita ?? "", cartelle: servizio.cartelle });
  const erroriPrima = veri ? veri.errori : controllaCopia(attesi);
  const guardate = veri && veri.controllate.length > 0 ? `\nunità guardate: ${veri.controllate.join("; ")}` : "";
  if (erroriPrima.length > 0) return uso(`Non parto:\n${erroriPrima.map((e) => `  - ${e}`).join("\n")}${guardate}`);

  process.env.DA_INVENT_DATA_DIR = dati;
  process.env.DA_IPAM_HUB_DB_PATH = attesi.hubDb;
  const appoggio = await import("./appoggio-pulizia");
  const reale = fs.realpathSync(dati);
  const erroriDopo = copia
    ? controllaCopia({ ...attesi, hubDb: appoggio.getHubDbPath(), cartellaTenant: appoggio.cartellaTenant() })
    : [appoggio.getHubDbPath(), appoggio.cartellaTenant()].filter((p) => !dentro(percorsoReale(p), reale)).map((p) => `${p} è fuori da --dati (${reale})`);
  if (erroriDopo.length > 0) return uso(`Non parto (percorsi dei moduli):\n${erroriDopo.map((e) => `  - ${e}`).join("\n")}`);

  const tutti = appoggio.elencaTenant();
  const mancanti = [...richiesti, ...accettati.keys()].filter((t) => !tutti.includes(t));
  if (mancanti.length > 0) return uso(`Tenant che in --dati non ci sono: ${[...new Set(mancanti)].join(", ")} (tenant: ${tutti.join(", ") || "nessuno"})`);
  const tenantDaFare = richiesti.length > 0 ? [...new Set(richiesti)] : tutti;

  scrivi(veri ? `dati: quelli veri, in ${reale}; unità guardate: ${veri.controllate.join("; ")}` : `dati: copia in ${reale}`);
  scrivi(`registro dei ripieghi: ${registro.righe.length} righe lette${registro.illeggibili ? `, ${registro.illeggibili} illeggibili` : ""}`);
  scrivi(a.includes("--applica") ? "modo: --applica (conferma scritta per ogni tenant)" : "modo: a vuoto");

  const conferme = a.includes("--applica") ? lettoreConferme() : null;
  const o: Opzioni = {
    registro,
    accettati,
    applica: conferme != null,
    chiedi: conferme ? conferme.chiedi : async () => null,
  };
  const nonAndati: string[] = [];
  try {
    for (const code of tenantDaFare) {
      if (!(await tenant(appoggio, code, o))) nonAndati.push(code);
    }
  } finally {
    conferme?.chiudi();
  }
  if (nonAndati.length > 0) scrivi(`pulizia della 2g: NON fatta su ${nonAndati.join(", ")} (il perché è qui sopra)`);
  else scrivi(o.applica ? "pulizia della 2g: fatta (o già fatta) su ogni tenant non escluso" : "pulizia della 2g: a vuoto, niente bloccato");
  return nonAndati.length > 0 ? 1 : 0;
}

function esci(codice: number): void {
  process.stdout.write("", () => process.stderr.write("", () => process.exit(codice)));
}

main().then(esci, (e) => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  esci(2);
});
