/**
 * Avvio del vault da `server.ts` (piano da-vault 2026-10-23). `server.ts` lo importa solo con un interruttore acceso
 * (`DA_VAULT_LOCALE=1` o `DA_VAULT_DALINK=1`, e `DA_VAULT_OPENBAO=1` per rifiutarlo ad alta voce): spenti di serie,
 * l'avvio è quello di oggi.
 *
 * - vault locale (appliance): sblocco dallo slot TPM, altrimenti bloccato col motivo (banner e scansioni in pausa);
 * - DA-Link (hub, vault semplice passo 6, piano DA-Link `2026-10-29-vault-passo6-app.md`), con `DA_VAULT_DALINK=1`:
 *   `DALINK_VAULT_URL` (https, es. https://192.168.4.44:8443), `DALINK_VAULT_GETTONE` (`dlv_…`, il gettone dell'app),
 *   `DALINK_VAULT_IMPRONTA` (`sha256//<base64>`, l'impronta SPKI del certificato della 8443, come `DALINK_IMPRONTA`);
 *   una che manca o è malformata = configurazione rifiutata col nome della variabile, mai col valore.
 *
 * OpenBao è stato tolto il 02/11/2026. `DA_VAULT_OPENBAO=1` rimasto nel file (da solo o con `DA_VAULT_DALINK=1`) è una
 * configurazione rifiutata: nessun backend, il motivo nel log e a schermo, credenziali col riferimento non leggibili e
 * scansioni in pausa (fail-closed). Si toglie la riga e si riavvia.
 */
import { avviaVaultLocale } from "./appliance";
import { DaLinkStore, type ConfigDaLink } from "./dalink";
import { MOTIVO_OPENBAO_TOLTO, statoVaultProcesso } from "./stato";
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

export type SceltaBackendRemoto = { backend: "nessuno" } | { backend: "dalink" } | { backend: "rifiutato"; motivo: string };

/** Quale backend remoto: spento di serie; `DA_VAULT_OPENBAO=1` (OpenBao tolto il 02/11) è una configurazione rifiutata. */
export function sceltaBackendRemoto(env: Record<string, string | undefined>): SceltaBackendRemoto {
  if (env.DA_VAULT_OPENBAO === "1") return { backend: "rifiutato", motivo: MOTIVO_OPENBAO_TOLTO };
  if (env.DA_VAULT_DALINK === "1") return { backend: "dalink" };
  return { backend: "nessuno" };
}

export function avviaVault(env: Record<string, string | undefined> = process.env): void {
  avviaVaultLocale();
  const stato = statoVaultProcesso();
  stato.remotoNonAvviato = null;
  const scelta = sceltaBackendRemoto(env);
  if (scelta.backend === "nessuno") return;
  if (scelta.backend === "rifiutato") {
    stato.remotoNonAvviato = scelta.motivo;
    console.error(`[vault] ${scelta.motivo}: nessun backend avviato, credenziali con riferimento non leggibili, scansioni in pausa`);
    return;
  }
  avviaDalink(env);
}

function avviaDalink(env: Record<string, string | undefined>): void {
  const c = configurazioneDalink(env);
  if (!c.ok) {
    statoVaultProcesso().remotoNonAvviato = `DA_VAULT_DALINK=1 ma ${c.motivo}`;
    console.error(`[vault] DA_VAULT_DALINK=1 ma ${c.motivo}: credenziali con riferimento non leggibili, scansioni in pausa`);
    return;
  }
  const store = new DaLinkStore(c.config);
  statoVaultProcesso().remoto = store;
  store.avvia();
  console.info("[vault] DA-Link: cache dei segreti avviata");
}
