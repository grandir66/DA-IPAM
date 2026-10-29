/**
 * Copia delle voci del vault da OpenBao a DA-Link (vault semplice, passo 6 → passo 7 sul live; piano DA-Link
 * `2026-10-29-vault-passo6-app.md`, S2). Sull'hub, nella cartella dell'app, con l'ambiente dell'app:
 *
 *   node --import tsx --env-file=.env.local scripts/da-vault-copia-verso-dalink.ts                          # a vuoto (di serie)
 *   node --import tsx --env-file=.env.local scripts/da-vault-copia-verso-dalink.ts --applica                # scrive i «copierei»
 *   node --import tsx --env-file=.env.local scripts/da-vault-copia-verso-dalink.ts --applica --sostituisci  # anche le «diversa»
 *   node --import tsx --env-file=.env.local scripts/da-vault-copia-verso-dalink.ts --verifica              # solo confronto
 *
 * Ambiente (quello dell'app): per OpenBao `DA_VAULT_OPENBAO_URL`, `DA_VAULT_OPENBAO_ROLE_ID`, il secret_id dalla
 * credenziale di systemd `openbao-secret-id` o da `DA_VAULT_OPENBAO_SECRET_ID_FILE` (facoltative `DA_VAULT_OPENBAO_MOUNT`,
 * `DA_VAULT_OPENBAO_CARTELLA`); per DA-Link `DALINK_VAULT_URL`, `DALINK_VAULT_GETTONE`, `DALINK_VAULT_IMPRONTA`. Gli
 * interruttori `DA_VAULT_OPENBAO` / `DA_VAULT_DALINK` NON contano e non si cambiano: la copia si fa con OpenBao ancora
 * acceso e DA-Link ancora spento. L'AppRole deve poter leggere la cartella dell'app e `clienti/*\/da-ipam/*`.
 *
 * Elenco: la cartella dell'app in OpenBao (con le sottocartelle) e i `credential_ref` del database, senza doppioni:
 * esattamente quello che l'app usa. Per ogni percorso si stampa `copierei | uguale | diversa (serve --sostituisci) |
 * manca in OpenBao | percorso non valido`; MAI valori, gettone o token.
 *
 * Uscita: 0 = tutto torna (a vuoto: nulla di diverso/mancante/non valido; i «copierei» sono il lavoro da fare);
 * 1 = uso o configurazione sbagliati; 2 = qualcosa non torna, o un backend non risponde.
 * Ordine al passo 7: a vuoto → --applica → --verifica (0) → DA_VAULT_OPENBAO=0, DA_VAULT_DALINK=1, riavvio.
 */
import { configurazioneDalink, configurazioneOpenBao, riferimentiDelleCredenziali } from "../src/lib/vault/avvio";
import { copiaVersoDalink, ErroreCopia, type ClasseVoce, type EsitoCopia, type ModoCopia, type VoceCopia } from "../src/lib/vault/copia-verso-dalink";
import { DaLinkStore } from "../src/lib/vault/dalink";
import { OpenBaoStore } from "../src/lib/vault/openbao";

function esci(messaggio: string, codice = 1): never {
  console.error(messaggio);
  process.exit(codice);
}

const USO = "Uso: scripts/da-vault-copia-verso-dalink.ts [--applica [--sostituisci] | --verifica]";

function etichetta(v: VoceCopia, e: EsitoCopia): string {
  const dove = v.origini.length > 0 ? ` (credenziale ${v.origini.join(", ")})` : "";
  const per: Record<ClasseVoce, string> = {
    copierei: "copierei",
    uguale: v.scritta ? "copiata (riletta da DA-Link: uguale)" : "uguale",
    diversa: e.modo === "applica" && e.sostituisci ? "diversa (sostituzione non riuscita)" : "diversa (serve --sostituisci)",
    manca_in_openbao: `manca in OpenBao${dove}`,
    non_valido: `percorso non valido${dove}`,
  };
  return per[v.classe];
}

async function main(): Promise<void> {
  const argomenti = process.argv.slice(2);
  for (const a of argomenti) if (a !== "--applica" && a !== "--verifica" && a !== "--sostituisci") esci(USO);
  const applica = argomenti.includes("--applica");
  const verifica = argomenti.includes("--verifica");
  const sostituisci = argomenti.includes("--sostituisci");
  if ((applica && verifica) || (sostituisci && !applica)) esci(USO);
  const modo: ModoCopia = applica ? "applica" : verifica ? "verifica" : "a_vuoto";

  // La configurazione di tutti e due, dall'ambiente, senza guardare gli interruttori DA_VAULT_*.
  const cb = configurazioneOpenBao(process.env);
  if (!cb.ok) esci(`OpenBao non configurato: ${cb.motivo}`);
  const cd = configurazioneDalink(process.env);
  if (!cd.ok) esci(`DA-Link non configurato: ${cd.motivo}`);
  const cartelle = cb.config.cartelle;
  const openbao = new OpenBaoStore({ ...cb.config, cartelle: [] });
  const dalink = new DaLinkStore(cd.config);

  // `riferimentiDelleCredenziali` salta un cliente che non si legge e lo dice nel log: per una copia sarebbe un elenco
  // incompleto (e una verifica verde sbagliata), quindi ogni avviso ferma tutto.
  const avvisi: string[] = [];
  const warnOriginale = console.warn;
  console.warn = (...a: unknown[]) => {
    avvisi.push(a.map(String).join(" "));
  };
  let riferimenti: ReturnType<typeof riferimentiDelleCredenziali>;
  try {
    riferimenti = riferimentiDelleCredenziali();
  } finally {
    console.warn = warnOriginale;
  }
  if (avvisi.length > 0) {
    for (const a of avvisi) console.error(a);
    esci(`${avvisi.length} clienti con i riferimenti non leggibili: l'elenco sarebbe incompleto, niente copiato`, 2);
  }

  let e: EsitoCopia;
  try {
    e = await copiaVersoDalink({ openbao, dalink, cartelle, riferimenti, modo, sostituisci });
  } catch (err) {
    if (err instanceof ErroreCopia) esci(`Errore, niente copiato né modificato: ${err.message}`, 2);
    throw err;
  }

  console.info(
    modo === "applica"
      ? `Copia APPLICATA${sostituisci ? " (con sostituzione delle voci diverse)" : ""}.`
      : modo === "verifica"
        ? "Verifica: solo confronto, niente è stato scritto."
        : "Prova a vuoto: niente è stato scritto (per scrivere: --applica).",
  );
  for (const v of e.voci) console.info(`  ${v.percorso}: ${etichetta(v, e)}`);
  const conta = (c: ClasseVoce) => e.voci.filter((v) => v.classe === c).length;
  console.info(
    `${e.voci.length} voci: ${conta("uguale")} uguali, ${conta("copierei")} da copiare, ${conta("diversa")} diverse, ` +
      `${conta("manca_in_openbao")} mancano in OpenBao, ${conta("non_valido")} con percorso non valido` +
      (modo === "applica" ? `; scritte ora: ${e.scritte}` : ""),
  );
  if (e.voci.length === 0) {
    esci("Nessuna voce trovata: controlla DA_VAULT_OPENBAO_CARTELLA, DA_VAULT_OPENBAO_MOUNT e i riferimenti del database", 2);
  }
  if (e.errore) esci(`ERRORE: ${e.errore}`, 2);
  if (!e.ok) {
    esci(
      modo === "a_vuoto"
        ? "Qualcosa non torna (diversa, mancante in OpenBao o percorso non valido): vedi l'elenco"
        : "Non tutte le voci sono uguali in DA-Link: vedi l'elenco",
      2,
    );
  }
}

main().catch((e: unknown) => esci(`Errore: ${e instanceof Error ? e.message : String(e)}`));
