/**
 * La politica degli accessi come la scrive DA-IPAM e la rilegge l'esecutore `scripts/accessi/da-ipam-accessi.sh`
 * (Protezione, tappa 2; ADR 0041). Modulo puro. Il file è `chiave=valore`, mai eseguito; l'esecutore rivalida
 * tutto da capo: questa validazione serve a dire l'errore a chi scrive, non a proteggere la macchina.
 * Le regole sono le stesse dello script e una prova le confronta caso per caso.
 * Va anche nel browser (la pagina «Chi può collegarsi»): niente moduli di Node, o la build non passa (25/11/2026).
 */

export const GRUPPI = ["web", "ssh", "console", "dati"] as const;
export type GruppoAccessi = (typeof GRUPPI)[number];

export const NOME_GRUPPO: Readonly<Record<GruppoAccessi, string>> = {
  web: "Pagina web",
  ssh: "SSH",
  console: "Console dei moduli",
  dati: "Ricezione dati",
};

/** Le porte di ogni gruppo: stanno nello script; qui servono solo a mostrarle. Una prova le tiene uguali. */
export const PORTE_GRUPPO: Readonly<Record<GruppoAccessi, { tcp: readonly number[]; udp: readonly number[] }>> = {
  web: { tcp: [80, 443], udp: [] },
  ssh: { tcp: [22], udp: [] },
  console: { tcp: [6443, 7443, 8443, 9443], udp: [] },
  dati: { tcp: [514, 1514, 1515, 4443, 10051], udp: [162, 514, 2055, 6343] },
};

export interface VoceGruppo {
  /** Aperto a chiunque, scritto apposta: nel file è la parola `tutti`. */
  aperto: boolean;
  indirizzi: string[];
}

export interface Politica {
  /** Sempre ammessi a tutto, oltre a NetBird/DA-Link che è nel codice dell'esecutore. */
  sempre: string[];
  gruppi: Record<GruppoAccessi, VoceGruppo>;
}

export const POLITICA_VUOTA: Politica = {
  sempre: [],
  gruppi: { web: { aperto: false, indirizzi: [] }, ssh: { aperto: false, indirizzi: [] }, console: { aperto: false, indirizzi: [] }, dati: { aperto: false, indirizzi: [] } },
};

/** Come `net.isIPv6` sugli indirizzi scritti solo con cifre esadecimali e due punti: una prova li confronta. */
export function ipv6Valido(ip: string): boolean {
  const meta = ip.split("::");
  if (meta.length > 2) return false;
  const gruppi = meta.flatMap((m) => (m === "" ? [] : m.split(":")));
  if (gruppi.some((g) => !/^[0-9a-fA-F]{1,4}$/.test(g))) return false;
  return meta.length === 1 ? gruppi.length === 8 : gruppi.length <= 7;
}

/** `ipv4`, `ipv6` o `null` se non è un indirizzo o una rete ammessa (IPv4 da /8 a /32, IPv6 da /16 a /128). */
export function tipoIndirizzo(s: string): "ipv4" | "ipv6" | null {
  const [ip, pref, altro] = s.split("/");
  if (altro !== undefined || !ip) return null;
  if (pref !== undefined && !/^\d{1,3}$/.test(pref)) return null;
  const n = pref === undefined ? null : Number(pref);
  if (/^[0-9.]+$/.test(ip)) {
    const ottetti = ip.split(".");
    if (ottetti.length !== 4 || ottetti.some((o) => !/^\d{1,3}$/.test(o) || Number(o) > 255) || Number(ottetti[0]) === 0) return null;
    return n === null || (n >= 8 && n <= 32) ? "ipv4" : null;
  }
  if (/^[0-9a-fA-F:]+$/.test(ip) && ip.length <= 39 && ipv6Valido(ip)) return n === null || (n >= 16 && n <= 128) ? "ipv6" : null;
  return null;
}

const CHIAVE: Readonly<Record<GruppoAccessi | "sempre", string>> = { sempre: "ACCESSI_SEMPRE", web: "ACCESSI_WEB", ssh: "ACCESSI_SSH", console: "ACCESSI_CONSOLE", dati: "ACCESSI_DATI" };

/** Gli errori di una politica, in parole; vuoto = si può scrivere. */
export function erroriPolitica(p: Politica): string[] {
  const errori: string[] = [];
  const guarda = (dove: string, elenco: readonly string[]) => {
    const visti = new Set<string>();
    for (const i of elenco) {
      if (tipoIndirizzo(i) === null) errori.push(`${dove}: «${i}» non è un indirizzo né una rete ammessa`);
      if (visti.has(i)) errori.push(`${dove}: «${i}» è scritto due volte`);
      visti.add(i);
    }
    if (elenco.length > 256) errori.push(`${dove}: più di 256 voci`);
  };
  guarda("Sempre ammessi", p.sempre);
  for (const g of GRUPPI) guarda(NOME_GRUPPO[g], p.gruppi[g].indirizzi);
  return errori;
}

/** Il testo del file. Lancia se la politica ha errori: un file sbagliato non si scrive. */
export function scriviPolitica(p: Politica): string {
  const errori = erroriPolitica(p);
  if (errori.length > 0) throw new Error(`Politica non valida: ${errori.join("; ")}`);
  const riga = (chiave: string, v: VoceGruppo) => `${chiave}=${[...(v.aperto ? ["tutti"] : []), ...v.indirizzi].join(",")}`;
  return [
    "# Scritto da DA-IPAM (Protezione › Chi può collegarsi). Non si esegue: lo legge da-ipam-accessi.sh.",
    riga(CHIAVE.sempre, { aperto: false, indirizzi: p.sempre }),
    ...GRUPPI.map((g) => riga(CHIAVE[g], p.gruppi[g])),
    "",
  ].join("\n");
}

/** Rilegge il file: ultima riga che definisce la chiave, come fa lo script. Le voci non valide restano e le dice `erroriPolitica`. */
export function leggiPolitica(testo: string): Politica {
  const valori = new Map<string, string>();
  for (const grezza of testo.split("\n")) {
    const riga = grezza.trim();
    if (!riga || riga.startsWith("#")) continue;
    const i = riga.indexOf("=");
    if (i > 0) valori.set(riga.slice(0, i), riga.slice(i + 1).trim().replace(/^(["'])(.*)\1$/, "$2"));
  }
  const voci = (chiave: string): string[] => (valori.get(chiave) ?? "").split(/[,\s]+/).filter(Boolean);
  const gruppo = (g: GruppoAccessi): VoceGruppo => {
    const v = voci(CHIAVE[g]);
    return { aperto: v.includes("tutti"), indirizzi: v.filter((x) => x !== "tutti") };
  };
  return { sempre: voci(CHIAVE.sempre), gruppi: { web: gruppo("web"), ssh: gruppo("ssh"), console: gruppo("console"), dati: gruppo("dati") } };
}
