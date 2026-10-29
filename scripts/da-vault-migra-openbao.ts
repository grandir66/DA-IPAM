/**
 * Migrazione delle credenziali dei device verso il backend del vault ACCESO (piano da-vault 2026-10-23, passo 6; col
 * vault semplice anche DA-Link, condizioni del passo 7, revisione del 29/10): sull'hub, nella cartella dell'app, con
 * l'ambiente dell'app (ENCRYPTION_KEY per leggere le colonne, l'interruttore e la configurazione del backend):
 *
 *   node --import tsx --env-file=.env.local scripts/da-vault-migra-openbao.ts             # prova a vuoto (di serie)
 *   node --import tsx --env-file=.env.local scripts/da-vault-migra-openbao.ts --applica   # scrive e mette i riferimenti
 *   node --import tsx --env-file=.env.local scripts/da-vault-migra-openbao.ts --verifica  # backend = colonne?
 *
 * Il backend è quello dell'interruttore, come nell'app (`sceltaBackendRemoto`); se l'interruttore sta nell'unità di
 * systemd e non nel `.env.local`, si mette davanti al comando (`DA_VAULT_DALINK=1 node …`):
 * - `DA_VAULT_OPENBAO=1` → OpenBao: DA_VAULT_OPENBAO_URL, DA_VAULT_OPENBAO_ROLE_ID, secret_id dalla credenziale di
 *   systemd `openbao-secret-id` o da DA_VAULT_OPENBAO_SECRET_ID_FILE (vedi `src/lib/vault/avvio.ts`). L'AppRole della
 *   migrazione deve poter scrivere e leggere `clienti/*\/da-ipam/*`;
 * - `DA_VAULT_DALINK=1` → DA-Link: DALINK_VAULT_URL, DALINK_VAULT_GETTONE, DALINK_VAULT_IMPRONTA. Prima di ogni elenco
 *   e di ogni scrittura si rilegge l'ambito, così una voce già in DA-Link col valore vecchio (credenziale cambiata
 *   dalla pagina: il riferimento è stato tolto) si sostituisce con la versione giusta;
 * - spenti, o tutti e due accesi: esce col motivo (codice 1), niente scritto.
 *
 * Uso con DA-Link acceso: dopo un cambio di password dalla pagina, a vuoto → --applica → --verifica (0 diverse).
 * Le colonne cifrate restano per una versione (doppia lettura); svuotarle è il passo dopo. Mai valori a schermo.
 */
import { getActiveTenants } from "../src/lib/db-hub";
import { getTenantDb } from "../src/lib/db-tenant";
import { migraVersoOpenBao, storeDellaMigrazione, verificaMigrazione } from "../src/lib/vault/migra-openbao";

function esci(messaggio: string, codice = 1): never {
  console.error(messaggio);
  process.exit(codice);
}

async function main(): Promise<void> {
  const argomenti = process.argv.slice(2);
  for (const a of argomenti) if (a !== "--applica" && a !== "--verifica") esci("Uso: scripts/da-vault-migra-openbao.ts [--applica | --verifica]");
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
          (store.backend === "dalink"
            ? "Se la voce è davvero andata, togli il segreto dal vault di DA-Link; "
            : "Se la voce è davvero andata, togli il segreto da OpenBao (bao kv metadata delete kv-domarc/<percorso>); ") +
          "un segreto cambiato dalla pagina si riscrive allo stesso percorso con --applica.",
      );
    }
    if (diverse > 0) esci(`${diverse} voci con ${nome} diverso dalle colonne: rilancia --applica dopo aver tolto i loro riferimenti, o correggi in ${nome}`, 2);
    return;
  }

  const applica = argomenti.includes("--applica");
  const e = await migraVersoOpenBao({ store, tenants, applica });
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
