/**
 * La configurazione DA-Link dell'istanza (tappa C1 NetBird/DA-Link).
 *
 * La scrive DA-Link, non DA-IPAM: il comando d'installazione che DA-Link mostra una
 * volta crea `/etc/dalink/oggetto.env` (umask 077) con URL dell'API, impronta del
 * certificato, codice cliente, nome del nodo e token dell'istanza. È il contratto
 * con la tappa A (`DA-Link/dalink/comando.py`).
 *
 * Regole:
 * - file assente = funzione assente: nessun timer chiama, nessuna rete (freno del
 *   parco per gli strumenti installati dai clienti);
 * - il file si rilegge a ogni uso, così chi lo crea dopo l'installazione non deve
 *   riavviare DA-IPAM;
 * - permessi larghi (leggibile da gruppo o altri) = configurazione rifiutata: il
 *   token varrebbe per chiunque lo legga;
 * - nessun motivo di rifiuto contiene il token o altri valori del file.
 *
 * Nessuna risposta di DA-Link cambia questo file: DA-IPAM lo legge e basta.
 */
import fs from "node:fs";

export const PERCORSO_PREDEFINITO = "/etc/dalink/oggetto.env";

export type ConfigDalink =
  | { stato: "assente" }
  | { stato: "non_valida"; motivo: string }
  | {
      stato: "pronta";
      url: URL;
      /** Impronta SPKI nella forma di DA-IPAM: `sha256/<base64>`. */
      impronta: string;
      codcli: string;
      nodo: string;
      token: string;
    };

export function percorsoOggettoEnv(): string {
  const p = process.env.DALINK_OGGETTO_ENV?.trim();
  return p ? p : PERCORSO_PREDEFINITO;
}

/**
 * DA-Link scrive l'impronta come curl (`sha256//<b64>`), DA-IPAM la calcola con una
 * barra sola (`spkiPinFromDer`). Si accettano le due e si rende la seconda. Il
 * base64 deve essere quello di 32 byte (SHA-256).
 */
export function normalizzaImpronta(v: string): string | null {
  const m = /^sha256\/\/?([A-Za-z0-9+/]{43}=)$/.exec(v.trim());
  return m ? `sha256/${m[1]}` : null;
}

export const CODCLI = /^[0-9]{3,8}$/;
const TOKEN = /^dlk_[A-Za-z0-9_-]{20,200}$/;
/**
 * Un'appliance per sede per cliente (decisione del 18/10/2026): la prima sede è
 * `<codcli>-ipam`, dalla seconda `<codcli>-ipam-<n>` con n da 2 a 99, senza zeri
 * davanti. Stessa forma in `scripts/dalink/prepara-netbird.sh`.
 */
export const NODO_IPAM = /^([0-9]{3,8})-ipam(?:-([2-9]|[1-9][0-9]))?$/;

export function leggiRighe(testo: string): Map<string, string> {
  const valori = new Map<string, string>();
  for (const grezza of testo.split(/\r?\n/)) {
    const riga = grezza.trim();
    if (!riga || riga.startsWith("#")) continue;
    const i = riga.indexOf("=");
    if (i <= 0) continue;
    const chiave = riga.slice(0, i).trim();
    let valore = riga.slice(i + 1);
    const t = valore.trim();
    if (t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))) {
      valore = t.slice(1, -1);
    }
    valori.set(chiave, valore);
  }
  return valori;
}

export type FileOggetto =
  | { esito: "assente" }
  | { esito: "non_valido"; motivo: string }
  | { esito: "letto"; testo: string };

/**
 * Le regole sul file, comuni a DA-Link e all'invio verso DA-Vul-can: assente,
 * non un file, permessi più larghi di 600, illeggibile. Nessun motivo contiene
 * valori del file.
 */
export function controllaFileOggetto(percorso: string): FileOggetto {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(percorso);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { esito: "assente" };
    return { esito: "non_valido", motivo: "file di configurazione DA-Link non leggibile" };
  }
  if (!stat.isFile()) return { esito: "non_valido", motivo: "la configurazione DA-Link non è un file" };
  if ((stat.mode & 0o077) !== 0) {
    return {
      esito: "non_valido",
      motivo: "permessi troppo larghi sul file di configurazione DA-Link: deve essere leggibile solo dal proprietario (600)",
    };
  }
  try {
    return { esito: "letto", testo: fs.readFileSync(percorso, "utf8") };
  } catch {
    return { esito: "non_valido", motivo: "file di configurazione DA-Link non leggibile" };
  }
}

export function leggiConfigDalink(percorso: string = percorsoOggettoEnv()): ConfigDalink {
  const f = controllaFileOggetto(percorso);
  if (f.esito === "assente") return { stato: "assente" };
  if (f.esito === "non_valido") return { stato: "non_valida", motivo: f.motivo };
  const testo = f.testo;
  const v = leggiRighe(testo);

  const urlGrezzo = (v.get("DALINK_URL") ?? "").trim();
  let url: URL;
  try {
    url = new URL(urlGrezzo);
  } catch {
    return { stato: "non_valida", motivo: "DALINK_URL mancante o non è un indirizzo" };
  }
  if (url.protocol !== "https:") return { stato: "non_valida", motivo: "DALINK_URL deve essere https" };

  const impronta = normalizzaImpronta(v.get("DALINK_IMPRONTA") ?? "");
  if (!impronta) return { stato: "non_valida", motivo: "DALINK_IMPRONTA mancante o non nella forma sha256//…" };

  // Il gestionale ha codici con lo spazio davanti: si toglie qui, al confine.
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

  const token = (v.get("DALINK_TOKEN") ?? "").trim();
  if (!TOKEN.test(token)) return { stato: "non_valida", motivo: "DALINK_TOKEN mancante o non è un token di DA-Link" };

  return { stato: "pronta", url, impronta, codcli, nodo, token };
}
