/**
 * Svuotamento delle colonne cifrate delle credenziali dell'hub (piano da-vault 2026-10-23, ADR 0035): sull'hub, nella
 * cartella dell'app, con l'ambiente dell'app (la configurazione di OpenBao; ENCRYPTION_KEY per leggere le colonne):
 *
 *   node --import tsx --env-file=.env.local scripts/da-vault-svuota-colonne.ts             # a vuoto (di serie)
 *   node --import tsx --env-file=.env.local scripts/da-vault-svuota-colonne.ts --applica   # backup, svuota, VACUUM
 *   node --import tsx --env-file=.env.local scripts/da-vault-svuota-colonne.ts --verifica  # 0 segreti nelle colonne?
 *
 * Configurazione di OpenBao: come `da-vault-migra-openbao` (DA_VAULT_OPENBAO_URL, DA_VAULT_OPENBAO_ROLE_ID, secret_id
 * dalla credenziale di systemd `openbao-secret-id` o da DA_VAULT_OPENBAO_SECRET_ID_FILE).
 *
 * Quando: dopo `da-vault-migra-openbao --applica` e `--verifica`, con l'hub già acceso su OpenBao (`DA_VAULT_OPENBAO=1`)
 * e le credenziali lette da lì per almeno un giro. Meglio a servizio fermo: il VACUUM prende il blocco di scrittura.
 *
 * Esce con 0 solo se tutto è a posto. Esce con 2 se qualcosa blocca (riga senza riferimento con le colonne ancora piene,
 * segreto mancante o diverso, colonna illeggibile, OpenBao irraggiungibile, segreti rimasti): in quel caso, a vuoto o con
 * --applica, NON ha toccato niente. Mai valori a schermo: solo numeri, id e nomi delle righe.
 *
 * Dopo ogni importazione di un pacchetto (transfer/import.ts) le voci nuove hanno le colonne piene e nessun riferimento:
 * rifare migra --applica, migra --verifica e questo comando (ADR 0035).
 *
 * Con --applica: copia del database in <dati>/backups/ (con quick_check), una transazione per cliente col ricontrollo di
 * ogni riga, poi checkpoint e VACUUM. La copia contiene i segreti cifrati con la chiave dell'appliance: è il punto di
 * ritorno; si cancella dopo aver verificato l'hub (vale come ogni altro backup con segreti).
 */
import { getActiveTenants } from "../src/lib/db-hub";
import { getTenantDb } from "../src/lib/db-tenant";
import { resolveDataDir } from "../src/lib/data-dir";
import { configurazioneOpenBao } from "../src/lib/vault/avvio";
import { OpenBaoStore } from "../src/lib/vault/openbao";
import { cartellaBackupSvuotamento, svuotaColonne, verificaSvuotamento } from "../src/lib/vault/svuota-colonne";

function esci(messaggio: string, codice = 1): never {
  console.error(messaggio);
  process.exit(codice);
}

async function main(): Promise<void> {
  const argomenti = process.argv.slice(2);
  for (const a of argomenti) if (a !== "--applica" && a !== "--verifica") esci("Uso: scripts/da-vault-svuota-colonne.ts [--applica | --verifica]");
  if (argomenti.includes("--applica") && argomenti.includes("--verifica")) esci("Uso: --applica oppure --verifica, non tutti e due");
  const c = configurazioneOpenBao(process.env);
  if (!c.ok) esci(`OpenBao non configurato: ${c.motivo}`);
  const store = new OpenBaoStore({ ...c.config, cartelle: [] });
  const dati = resolveDataDir();
  console.info(`Cartella dati: ${dati}`);
  const tenants = getActiveTenants().map((t) => ({ codice: t.codice_cliente, dbh: getTenantDb(t.codice_cliente) }));

  if (argomenti.includes("--verifica")) {
    const v = await verificaSvuotamento({ store, tenants });
    let rimaste = 0;
    let mancanti = 0;
    let libere = 0;
    for (const t of v.perTenant) {
      console.info(`${t.codice}: ${t.righe} credenziali, ${t.rimaste.length} con segreti ancora nelle colonne, ${t.inOpenBao} con il segreto in OpenBao, ${t.senzaSegreti} senza segreti, ${t.pagineLibere} pagine libere`);
      if (t.pagineLibere > 0) console.info(`  PAGINE LIBERE nel database di ${t.codice}: i valori cifrati possono essere ancora nel file (rilancia --applica: fa il VACUUM anche a righe già vuote)`);
      for (const r of t.rimaste) console.info(`  RIMASTA #${r.id} «${r.nome}»`);
      for (const s of t.senzaSegreto) console.info(`  SENZA SEGRETO #${s.id} «${s.nome}» (${s.percorso}): ${s.motivo}`);
      rimaste += t.rimaste.length;
      mancanti += t.senzaSegreto.length;
      libere += t.pagineLibere;
    }
    if (!v.ok) esci(`Verifica NON superata: ${rimaste} righe con segreti nelle colonne, ${mancanti} senza segreto in OpenBao, ${libere} pagine libere`, 2);
    console.info("Verifica superata: 0 segreti rimasti nelle colonne cifrate, 0 pagine libere, ogni riga con riferimento ha il suo segreto in OpenBao.");
    return;
  }

  const applica = argomenti.includes("--applica");
  const e = await svuotaColonne({ store, tenants, applica, cartellaBackup: cartellaBackupSvuotamento(dati) });
  console.info(applica && e.applicata ? "Svuotamento APPLICATO." : "A vuoto: niente è stato scritto (per scrivere: --applica).");
  let ostacoli = 0;
  for (const t of e.perTenant) {
    console.info(
      `${t.codice}: ${t.righe} credenziali, ${t.giaVuote} già vuote, ${t.conColonnePiene} con colonne piene, ${t.daSvuotare} ${e.applicata ? "provate uguali a OpenBao" : "da svuotare (OpenBao uguale)"}` +
        (e.applicata ? `, ${t.svuotate} svuotate${t.vacuum ? ", VACUUM fatto" : ""}` : ""),
    );
    if (t.backup) console.info(`  backup: ${t.backup}`);
    for (const r of t.senzaRiferimento) {
      ostacoli += 1;
      console.info(`  SENZA RIFERIMENTO #${r.id} «${r.nome}»: colonne piene e nessun segreto in OpenBao (rilancia da-vault-migra-openbao --applica)`);
    }
    for (const d of t.diverse) {
      ostacoli += 1;
      console.info(`  DIVERSA #${d.id} «${d.nome}» (${d.percorso}): ${d.motivo}`);
    }
    if (t.errore) {
      ostacoli += 1;
      console.error(`  ERRORE: ${t.errore}`);
    }
  }
  if (!e.ok) esci(`${ostacoli} ostacoli: ${e.applicata ? "lo svuotamento si è fermato (vedi sopra cosa è stato fatto)" : "non è stato toccato niente"}`, 2);
  if (applica) console.info("Ora: lancia --verifica. Se l'hub legge tutto bene, cancella il backup in <dati>/backups/ quando non serve più.");
}

main().catch((e: unknown) => esci(`Errore: ${e instanceof Error ? e.message : String(e)}`));
