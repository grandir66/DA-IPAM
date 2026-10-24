/**
 * Migrazione delle credenziali dei device verso OpenBao (piano da-vault 2026-10-23, passo 6): sull'hub, nella
 * cartella dell'app, con l'ambiente dell'app (ENCRYPTION_KEY per leggere le colonne, la configurazione di OpenBao):
 *
 *   node --import tsx --env-file=.env.local scripts/da-vault-migra-openbao.ts             # prova a vuoto (di serie)
 *   node --import tsx --env-file=.env.local scripts/da-vault-migra-openbao.ts --applica   # scrive e mette i riferimenti
 *   node --import tsx --env-file=.env.local scripts/da-vault-migra-openbao.ts --verifica  # OpenBao = colonne?
 *
 * Configurazione: DA_VAULT_OPENBAO_URL, DA_VAULT_OPENBAO_ROLE_ID, secret_id dalla credenziale di systemd
 * `openbao-secret-id` o da DA_VAULT_OPENBAO_SECRET_ID_FILE (vedi `src/lib/vault/avvio.ts`). L'AppRole della
 * migrazione deve poter scrivere e leggere `clienti/*\/da-ipam/*`.
 *
 * Ordine: --applica (i riferimenti a interruttore spento non contano) → --verifica → DA_VAULT_OPENBAO=1 e riavvio.
 * Le colonne cifrate restano finché non si lancia `scripts/da-vault-svuota-colonne.ts` (ADR 0035). Mai valori a schermo.
 */
import { getActiveTenants } from "../src/lib/db-hub";
import { getTenantDb } from "../src/lib/db-tenant";
import { configurazioneOpenBao } from "../src/lib/vault/avvio";
import { migraVersoOpenBao, verificaMigrazione } from "../src/lib/vault/migra-openbao";
import { OpenBaoStore } from "../src/lib/vault/openbao";

function esci(messaggio: string, codice = 1): never {
  console.error(messaggio);
  process.exit(codice);
}

async function main(): Promise<void> {
  const argomenti = process.argv.slice(2);
  for (const a of argomenti) if (a !== "--applica" && a !== "--verifica") esci("Uso: scripts/da-vault-migra-openbao.ts [--applica | --verifica]");
  const c = configurazioneOpenBao(process.env);
  if (!c.ok) esci(`OpenBao non configurato: ${c.motivo}`);
  const store = new OpenBaoStore({ ...c.config, cartelle: [] });
  const tenants = getActiveTenants().map((t) => ({ codice: t.codice_cliente, dbh: getTenantDb(t.codice_cliente) }));

  if (argomenti.includes("--verifica")) {
    const v = await verificaMigrazione({ store, tenants });
    let diverse = 0;
    let orfani = 0;
    for (const t of v.perTenant) {
      console.info(`${t.codice}: ${t.controllate} controllate, ${t.diverse.length} diverse, ${t.orfani.length} orfani in OpenBao`);
      for (const d of t.diverse) console.info(`  #${d.id} «${d.nome}» (${d.percorso}): ${d.motivo}`);
      for (const p of t.orfani) console.info(`  ORFANO ${p}`);
      if (t.orfaniErrore) console.error(`  ATTENZIONE: orfani NON verificati (${t.orfaniErrore})`);
      diverse += t.diverse.length;
      orfani += t.orfani.length;
    }
    if (orfani > 0) {
      console.warn(
        `${orfani} percorsi in OpenBao senza una voce che li usi (credenziale cancellata o segreto cambiato). ` +
          "Se la voce è davvero andata, togli il segreto da OpenBao (bao kv metadata delete kv-domarc/<percorso>); " +
          "un segreto cambiato dalla pagina si riscrive allo stesso percorso con --applica.",
      );
    }
    if (diverse > 0) esci(`${diverse} voci con OpenBao diverso dalle colonne: rilancia --applica dopo aver tolto i loro riferimenti, o correggi in OpenBao`, 2);
    return;
  }

  const applica = argomenti.includes("--applica");
  const e = await migraVersoOpenBao({ store, tenants, applica });
  console.info(applica ? "Migrazione APPLICATA." : "Prova a vuoto: niente è stato scritto (per scrivere: --applica).");
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
