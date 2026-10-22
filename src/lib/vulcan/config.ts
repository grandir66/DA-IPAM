/**
 * Le chiavi dell'invio verso DA-Vul-can (A-IPAM: AD Health e inventario).
 *
 * Stanno nello stesso `/etc/dalink/oggetto.env` di DA-Link (decisione 4 della spec
 * DA-Vul-can 2026-10-21), con le stesse regole di `dalink/config.ts`:
 * - file assente, o `VULCAN_TOKEN` assente/vuoto = flusso spento: nessun timer chiama,
 *   nessuna riga in coda (oggi le istanze con NetBird hanno il file senza queste chiavi);
 * - il file si rilegge a ogni uso: chi aggiunge le chiavi non riavvia DA-IPAM;
 * - permessi più larghi di 600 = configurazione rifiutata;
 * - nessun motivo contiene il gettone o altri valori del file.
 *
 * `DALINK_URL`/`DALINK_TOKEN` non servono a questo flusso: bastano codice cliente,
 * nodo e le due chiavi VULCAN. Il cliente lo decide il gettone dell'hub; il `codcli`
 * qui serve solo come controllo e per scegliere il tenant da cui leggere.
 */
import crypto from "node:crypto";
import { CODCLI, NODO_IPAM, controllaFileOggetto, leggiRighe, percorsoOggettoEnv } from "@/lib/dalink/config";
import { CLIENTE_APPLIANCE, dipendenzeFattiReali, type DipendenzeFatti } from "@/lib/dalink/fatti";

export type ConfigVulcan =
  | { stato: "spento" }
  | { stato: "non_valida"; motivo: string }
  | {
      stato: "pronta";
      /** Solo l'origine dell'hub (https, niente percorso né credenziali). */
      url: URL;
      token: string;
      codcli: string;
      nodo: string;
      /** Primi 16 caratteri esadecimali dello sha256 del gettone: per «sospeso per questo gettone» senza salvarlo. */
      improntaGettone: string;
    };

/** Gettone dell'hub: 48 byte in base64url; si accetta l'alfabeto base64url fra 40 e 200 caratteri. */
const GETTONE = /^[A-Za-z0-9_-]{40,200}$/;

export function improntaDelGettone(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex").slice(0, 16);
}

export function leggiConfigVulcan(percorso: string = percorsoOggettoEnv()): ConfigVulcan {
  const f = controllaFileOggetto(percorso);
  if (f.esito === "assente") return { stato: "spento" };
  if (f.esito === "non_valido") return { stato: "non_valida", motivo: f.motivo };
  const v = leggiRighe(f.testo);

  const token = (v.get("VULCAN_TOKEN") ?? "").trim();
  if (!token) return { stato: "spento" };
  // Il gettone di DA-Link (`dlk_…`) non vale per l'hub: messo qui per sbaglio, si dice.
  if (token.startsWith("dlk_") || !GETTONE.test(token)) {
    return { stato: "non_valida", motivo: "VULCAN_TOKEN non è un gettone dell'hub DA-Vul-can (base64url, senza prefisso dlk_)" };
  }

  let url: URL;
  try {
    url = new URL((v.get("VULCAN_URL") ?? "").trim());
  } catch {
    return { stato: "non_valida", motivo: "VULCAN_URL mancante o non è un indirizzo" };
  }
  if (url.protocol !== "https:") return { stato: "non_valida", motivo: "VULCAN_URL deve essere https" };
  if (url.username || url.password) return { stato: "non_valida", motivo: "VULCAN_URL non deve contenere credenziali" };
  if ((url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) {
    return { stato: "non_valida", motivo: "VULCAN_URL deve essere solo l'origine dell'hub (https://nome), senza percorso" };
  }

  const codcli = (v.get("DALINK_CODCLI") ?? "").trim();
  if (!CODCLI.test(codcli)) return { stato: "non_valida", motivo: "DALINK_CODCLI non è un codice cliente del gestionale (solo cifre)" };
  const nodo = (v.get("DALINK_NODO") ?? "").trim();
  const m = NODO_IPAM.exec(nodo);
  if (!m || m[1] !== codcli) {
    return {
      stato: "non_valida",
      motivo: "DALINK_NODO non è il nodo di un'istanza IPAM di questo cliente (<codice>-ipam o <codice>-ipam-<n>)",
    };
  }

  return { stato: "pronta", url: new URL(url.origin), token, codcli, nodo, improntaGettone: improntaDelGettone(token) };
}

/**
 * Il tenant da cui si leggono i dati da inviare, come in `fatti.ts`: il codice di
 * DA-Link se è un cliente dell'istanza, altrimenti `DEFAULT` se è l'unico cliente
 * dell'appliance, altrimenti null («cliente non presente su questa istanza»). Un
 * errore nel leggere il registro dei clienti dà null: mai un tenant a caso.
 */
export function tenantPerVulcan(
  codcli: string,
  dip: Pick<DipendenzeFatti, "clienteEsiste" | "unicoClienteAppliance"> = dipendenzeFattiReali,
): string | null {
  try {
    if (dip.clienteEsiste(codcli)) return codcli;
    if (dip.unicoClienteAppliance()) return CLIENTE_APPLIANCE;
  } catch {
    return null;
  }
  return null;
}
