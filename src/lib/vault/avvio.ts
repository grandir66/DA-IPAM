/**
 * Avvio del vault da `server.ts` (piano da-vault 2026-10-23). `server.ts` lo importa solo con un interruttore acceso
 * (`DA_VAULT_LOCALE=1` o `DA_VAULT_OPENBAO=1`): spenti di serie, l'avvio è quello di oggi.
 *
 * - vault locale (appliance): sblocco dallo slot TPM, altrimenti bloccato col motivo (banner e scansioni in pausa);
 * - OpenBao (hub): lo store dalla configurazione dell'ambiente, con la cartella dell'app e i `credential_ref` delle
 *   credenziali nella cache, e i giri periodici. Configurazione che manca = errore nel log, OpenBao «non configurato»
 *   (scansioni in pausa, letture con riferimento rifiutate): mai un ripiego.
 *
 * Ambiente (file dell'appliance; il secret_id NON sta lì):
 * - `DA_VAULT_OPENBAO_URL` (es. https://openbao.interno:8200), `DA_VAULT_OPENBAO_ROLE_ID`;
 * - secret_id: la credenziale di systemd `openbao-secret-id` (`LoadCredentialEncrypted=…`, sigillata sul TPM) oppure il
 *   file `DA_VAULT_OPENBAO_SECRET_ID_FILE`; si rilegge a ogni login;
 * - facoltativi: `DA_VAULT_OPENBAO_MOUNT` (kv-domarc), `DA_VAULT_OPENBAO_CARTELLA` (app/da-ipam);
 * - la CA interna con `NODE_EXTRA_CA_CERTS` nell'unità.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getActiveTenants } from "@/lib/db-hub";
import { getTenantDb, schemaVaultPresente } from "@/lib/db-tenant";
import { avviaVaultLocale } from "./appliance";
import { OpenBaoStore, type ConfigOpenBao } from "./openbao";
import { statoVaultProcesso, vaultOpenBaoAcceso } from "./stato";

export function configurazioneOpenBao(env: Record<string, string | undefined>): { ok: true; config: ConfigOpenBao } | { ok: false; motivo: string } {
  const url = env.DA_VAULT_OPENBAO_URL?.trim();
  const roleId = env.DA_VAULT_OPENBAO_ROLE_ID?.trim();
  if (!url || !roleId) return { ok: false, motivo: "mancano DA_VAULT_OPENBAO_URL e/o DA_VAULT_OPENBAO_ROLE_ID nel file dell'appliance" };
  const cartellaCredenziali = env.CREDENTIALS_DIRECTORY?.trim();
  const fileSid = env.DA_VAULT_OPENBAO_SECRET_ID_FILE?.trim() || (cartellaCredenziali ? join(cartellaCredenziali, "openbao-secret-id") : "");
  if (!fileSid) {
    return { ok: false, motivo: "manca il secret_id: credenziale di systemd openbao-secret-id o DA_VAULT_OPENBAO_SECRET_ID_FILE" };
  }
  return {
    ok: true,
    config: {
      url,
      roleId,
      secretId: () => readFileSync(fileSid, "utf8").trim(),
      mount: env.DA_VAULT_OPENBAO_MOUNT?.trim() || "kv-domarc",
      cartelle: [env.DA_VAULT_OPENBAO_CARTELLA?.trim() || "app/da-ipam"],
    },
  };
}

/**
 * I `credential_ref` di tutte le credenziali dei clienti attivi: entrano nella cache a ogni giro. Ogni riferimento
 * porta la sua origine (cliente e credenziale): se è malformato la cache lo salta e dice quale voce è.
 */
export function riferimentiDelleCredenziali(): Array<{ percorso: string; origine: string }> {
  const out: Array<{ percorso: string; origine: string }> = [];
  for (const t of getActiveTenants()) {
    try {
      const dbh = getTenantDb(t.codice_cliente);
      if (!schemaVaultPresente(dbh)) continue;
      const righe = dbh
        .prepare("SELECT id, credential_ref FROM credentials WHERE credential_ref IS NOT NULL AND trim(credential_ref) != '' ORDER BY id")
        .all() as Array<{ id: number; credential_ref: string }>;
      for (const r of righe) out.push({ percorso: r.credential_ref.trim(), origine: `${t.codice_cliente}#${r.id}` });
    } catch (e) {
      console.warn(`[vault] riferimenti del cliente ${t.codice_cliente} non letti (${e instanceof Error ? e.name : "errore"})`);
    }
  }
  return out;
}

export function avviaVault(env: Record<string, string | undefined> = process.env): void {
  avviaVaultLocale();
  if (!vaultOpenBaoAcceso()) return;
  const c = configurazioneOpenBao(env);
  if (!c.ok) {
    console.error(`[vault] DA_VAULT_OPENBAO=1 ma ${c.motivo}: credenziali con riferimento non leggibili, scansioni in pausa`);
    return;
  }
  const store = new OpenBaoStore({ ...c.config, percorsiExtra: riferimentiDelleCredenziali });
  statoVaultProcesso().openbao = store;
  store.avvia();
  console.info("[vault] OpenBao: cache dei segreti avviata");
}
