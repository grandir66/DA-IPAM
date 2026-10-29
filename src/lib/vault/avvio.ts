/**
 * Avvio del vault da `server.ts` (piano da-vault 2026-10-23). `server.ts` lo importa solo con un interruttore acceso
 * (`DA_VAULT_LOCALE=1`, `DA_VAULT_OPENBAO=1` o `DA_VAULT_DALINK=1`): spenti di serie, l'avvio è quello di oggi.
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
 *
 * DA-Link (vault semplice, passo 6, piano DA-Link `2026-10-29-vault-passo6-app.md`), con `DA_VAULT_DALINK=1`:
 * - `DALINK_VAULT_URL` (https, es. https://192.168.4.44:8443), `DALINK_VAULT_GETTONE` (`dlv_…`, il gettone dell'app),
 *   `DALINK_VAULT_IMPRONTA` (`sha256//<base64>`, l'impronta SPKI del certificato della 8443, come `DALINK_IMPRONTA`);
 * - una che manca o è malformata = configurazione rifiutata col nome della variabile, mai col valore;
 * - `DA_VAULT_DALINK=1` con `DA_VAULT_OPENBAO=1` = rifiutata: nessun backend, errore nel log (fail-closed).
 */
import { readFileSync } from "node:fs";
import { getActiveTenants } from "@/lib/db-hub";
import { getTenantDb, schemaVaultPresente } from "@/lib/db-tenant";
import { avviaVaultLocale } from "./appliance";
import { OpenBaoStore, type ConfigOpenBao } from "./openbao";
import { DaLinkStore, type ConfigDaLink } from "./dalink";
import { statoVaultProcesso } from "./stato";
import { unisci } from "../percorsi";
import { normalizzaImpronta } from "@/lib/dalink/config";

const GETTONE_DALINK = /^dlv_[A-Za-z0-9_-]{20,200}$/;

/** Le tre variabili di DA-Link; nei motivi solo i nomi, mai i valori (il gettone è un segreto). */
export function configurazioneDalink(env: Record<string, string | undefined>): { ok: true; config: ConfigDaLink } | { ok: false; motivo: string } {
  const problemi: string[] = [];
  const urlGrezzo = env.DALINK_VAULT_URL?.trim() ?? "";
  let url: URL | null = null;
  if (!urlGrezzo) problemi.push("manca DALINK_VAULT_URL");
  else {
    try {
      url = new URL(urlGrezzo);
    } catch {
      url = null;
    }
    if (!url) problemi.push("DALINK_VAULT_URL non è un indirizzo");
    else if (url.protocol !== "https:") problemi.push("DALINK_VAULT_URL deve essere https");
    else if (url.username || url.password) problemi.push("DALINK_VAULT_URL non deve contenere credenziali");
  }
  const gettone = env.DALINK_VAULT_GETTONE?.trim() ?? "";
  if (!gettone) problemi.push("manca DALINK_VAULT_GETTONE");
  else if (!GETTONE_DALINK.test(gettone)) problemi.push("DALINK_VAULT_GETTONE non è un gettone del vault di DA-Link (dlv_…)");
  const improntaGrezza = env.DALINK_VAULT_IMPRONTA?.trim() ?? "";
  const impronta = improntaGrezza ? normalizzaImpronta(improntaGrezza) : null;
  if (!improntaGrezza) problemi.push("manca DALINK_VAULT_IMPRONTA");
  else if (!impronta) problemi.push("DALINK_VAULT_IMPRONTA non è nella forma sha256//<base64> (impronta SPKI del certificato di DA-Link)");
  if (problemi.length > 0 || !url || !impronta) return { ok: false, motivo: problemi.join("; ") };
  return { ok: true, config: { url, gettone, impronta } };
}

export type SceltaBackendRemoto =
  | { backend: "nessuno" }
  | { backend: "openbao" }
  | { backend: "dalink" }
  | { backend: "rifiutato"; motivo: string };

/** Quale backend remoto: spenti di serie; i due interruttori insieme sono una configurazione rifiutata. */
export function sceltaBackendRemoto(env: Record<string, string | undefined>): SceltaBackendRemoto {
  const openbao = env.DA_VAULT_OPENBAO === "1";
  const dalink = env.DA_VAULT_DALINK === "1";
  if (openbao && dalink) {
    return { backend: "rifiutato", motivo: "DA_VAULT_DALINK=1 e DA_VAULT_OPENBAO=1 insieme: se ne accende uno solo" };
  }
  if (dalink) return { backend: "dalink" };
  if (openbao) return { backend: "openbao" };
  return { backend: "nessuno" };
}

export function configurazioneOpenBao(env: Record<string, string | undefined>): { ok: true; config: ConfigOpenBao } | { ok: false; motivo: string } {
  const url = env.DA_VAULT_OPENBAO_URL?.trim();
  const roleId = env.DA_VAULT_OPENBAO_ROLE_ID?.trim();
  if (!url || !roleId) return { ok: false, motivo: "mancano DA_VAULT_OPENBAO_URL e/o DA_VAULT_OPENBAO_ROLE_ID nel file dell'appliance" };
  const cartellaCredenziali = env.CREDENTIALS_DIRECTORY?.trim();
  const fileSid = env.DA_VAULT_OPENBAO_SECRET_ID_FILE?.trim() || (cartellaCredenziali ? unisci(cartellaCredenziali, "openbao-secret-id") : "");
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
  const scelta = sceltaBackendRemoto(env);
  if (scelta.backend === "nessuno") return;
  if (scelta.backend === "rifiutato") {
    console.error(`[vault] ${scelta.motivo}: nessun backend avviato, credenziali con riferimento non leggibili, scansioni in pausa`);
    return;
  }
  if (scelta.backend === "dalink") {
    avviaDalink(env);
    return;
  }
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

function avviaDalink(env: Record<string, string | undefined>): void {
  const c = configurazioneDalink(env);
  if (!c.ok) {
    console.error(`[vault] DA_VAULT_DALINK=1 ma ${c.motivo}: credenziali con riferimento non leggibili, scansioni in pausa`);
    return;
  }
  const store = new DaLinkStore(c.config);
  statoVaultProcesso().openbao = store;
  store.avvia();
  console.info("[vault] DA-Link: cache dei segreti avviata");
}
