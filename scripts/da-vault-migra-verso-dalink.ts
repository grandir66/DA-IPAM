/**
 * Migrazione delle credenziali dei device verso DA-Link (piano da-vault 2026-10-23, passo 6; vault semplice, condizioni
 * del passo 7, revisione del 29/10): sull'hub, nella cartella dell'app, con l'ambiente dell'app (ENCRYPTION_KEY per
 * leggere le colonne e la configurazione di DA-Link):
 *
 *   node --import tsx --env-file=.env.local scripts/da-vault-migra-verso-dalink.ts             # prova a vuoto (di serie)
 *   node --import tsx --env-file=.env.local scripts/da-vault-migra-verso-dalink.ts --applica   # scrive e mette i riferimenti
 *   node --import tsx --env-file=.env.local scripts/da-vault-migra-verso-dalink.ts --verifica  # DA-Link = colonne?
 *
 * Servono DALINK_VAULT_URL, DALINK_VAULT_GETTONE e DALINK_VAULT_IMPRONTA (vedi `src/lib/vault/avvio.ts`). Prima di ogni
 * elenco e di ogni scrittura si rilegge l'ambito, così una voce già in DA-Link col valore vecchio (credenziale cambiata
 * dalla pagina: il riferimento è stato tolto) si sostituisce con la versione giusta. `DA_VAULT_OPENBAO=1` rimasto nel
 * file (OpenBao è stato tolto il 02/11): esce col motivo (codice 1), niente scritto.
 *
 * Uso: dopo un cambio di password dalla pagina, a vuoto → --applica → --verifica (0 diverse). Mai valori a schermo.
 */
import { getActiveTenants } from "../src/lib/db-hub";
import { getTenantDb } from "../src/lib/db-tenant";
import { migraVersoDalink, storeDellaMigrazione, verificaMigrazione } from "../src/lib/vault/migra-verso-dalink";

function esci(messaggio: string, codice = 1): never {
  console.error(messaggio);
  process.exit(codice);
}

async function main(): Promise<void> {
  const argomenti = process.argv.slice(2);
  for (const a of argomenti) if (a !== "--applica" && a !== "--verifica") esci("Uso: scripts/da-vault-migra-verso-dalink.ts [--applica | --verifica]");
  const scelta = storeDellaMigrazione(process.env);
  if (!scelta.ok) esci(scelta.motivo);
  const { store, nome } = scelta;
  const tenants = getActiveTenants().map((t) => ({ codice: t.codice_cliente, dbh: getTenantDb(t.codice_cliente) }));

  if (argomenti.includes("--verifica")) {
    const v = await verificaMigrazione({ store, tenants });
    let diverse = 0;
    let orfani = 0;
    for (const t of v.perTenant) {
      console.info(`${t.codice}: ${t.controllate} controllate, ${t.diverse.length} diverse, ${t.orfani.length} orfani in ${nome}`);
      for (const d of t.diverse) console.info(`  #${d.id} «${d.nome}» (${d.percorso}): ${d.motivo}`);
      for (const p of t.orfani) console.info(`  ORFANO ${p}`);
      if (t.orfaniErrore) console.error(`  ATTENZIONE: orfani NON verificati (${t.orfaniErrore})`);
      diverse += t.diverse.length;
      orfani += t.orfani.length;
    }
    if (orfani > 0) {
      console.warn(
        `${orfani} percorsi in ${nome} senza una voce che li usi (credenziale cancellata o segreto cambiato). ` +
          "Se la voce è davvero andata, togli il segreto dal vault di DA-Link; " +
          "un segreto cambiato dalla pagina si riscrive allo stesso percorso con --applica.",
      );
    }
    if (diverse > 0) esci(`${diverse} voci con ${nome} diverso dalle colonne: rilancia --applica dopo aver tolto i loro riferimenti, o correggi in ${nome}`, 2);
    return;
  }

  const applica = argomenti.includes("--applica");
  const e = await migraVersoDalink({ store, tenants, applica });
  console.info(applica ? `Migrazione verso ${nome} APPLICATA.` : `Prova a vuoto verso ${nome}: niente è stato scritto (per scrivere: --applica).`);
  let errori = 0;
  for (const t of e.perTenant) {
    console.info(`${t.codice}: ${t.daMigrare} da migrare, ${t.giaMigrate} già migrate${applica ? `, ${t.migrate} migrate ora` : ""}`);
    for (const i of t.illeggibili) console.info(`  saltata #${i.id} «${i.nome}»: ${i.motivo}`);
    if (t.errore) {
      errori += 1;
      console.error(`  ERRORE: ${t.errore}`);
    }
  }
  if (errori > 0) esci(`${errori} clienti con errori: i loro riferimenti non sono stati scritti`, 2);
}

main().catch((e: unknown) => esci(`Errore: ${e instanceof Error ? e.message : String(e)}`));
