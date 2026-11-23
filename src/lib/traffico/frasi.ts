/**
 * Le parole dell'interfaccia del traffico: per ogni tipo di anomalia un nome corto (filtri) e una frase
 * (cosa è successo). Modulo puro: lo leggono la pagina `/traffico`, il riquadro dell'host e le prove.
 */
import type { TipoAnomalia } from "./anomalie";

export const NOME_TIPO: Record<TipoAnomalia, string> = {
  coppia_nuova: "Collegamento nuovo",
  porta_nuova: "Porta nuova",
  molti_contatti: "Molti contatti",
  impianto: "Impianto",
  vlan_chiuse: "Reti chiuse",
  volume: "Volume",
  non_censito: "Non censito",
  chiaro_telnet: "Telnet in chiaro",
  chiaro_ftp: "FTP in chiaro",
  chiaro_posta: "Posta in chiaro",
  chiaro_http_basic: "Web in chiaro",
  chiaro_ldap: "LDAP in chiaro",
  snmp_vecchio: "SNMP vecchio",
  smb1: "SMB 1",
  tls_vecchio: "TLS vecchio",
  ntlm1: "NTLM 1",
  nome_conteso: "Nome conteso",
  impianto_scrittura: "Scrittura su impianto",
  dns_anomalo: "DNS anomalo",
  ip_doppio: "IP doppio",
  mac_cambiato: "MAC cambiato",
  paese_nuovo: "Paese nuovo",
};

/** I tipi nell'ordine dei filtri. Sta qui e non in `anomalie.ts`: quel modulo tocca il database e non entra nel browser. */
export const TIPI = Object.keys(NOME_TIPO) as TipoAnomalia[];

export const GRAVITA: Record<number, { segno: string; testo: string }> = {
  1: { segno: "○", testo: "bassa" },
  2: { segno: "△", testo: "media" },
  3: { segno: "▲", testo: "alta" },
};

export function formattaByte(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  const unita = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < unita.length - 1) { v /= 1024; i++; }
  return `${i === 0 || v >= 100 ? Math.round(v) : v.toFixed(1).replace(".", ",")} ${unita[i]}`;
}

/** Protocollo e porta come si leggono: «tcp/502», «udp/53», «—» quando l'anomalia non ha una porta. */
export function protoPorta(proto: number, porta: number): string {
  if (!porta) return "—";
  const p = proto === 6 ? "tcp" : proto === 17 ? "udp" : proto === 0 ? "" : String(proto);
  return p ? `${p}/${porta}` : String(porta);
}

const ESTERNO = "esterno";

/** Cosa è successo, in una frase. Dal dettaglio si prendono solo numeri e nomi, mai un valore letto dai pacchetti. */
export function fraseAnomalia(a: { tipo: TipoAnomalia; client: string; server: string; dettaglio: Record<string, unknown> }): string {
  const d = a.dettaglio;
  const numero = (k: string): number | null => (typeof d[k] === "number" ? (d[k] as number) : null);
  switch (a.tipo) {
    case "coppia_nuova": return "Due host che non si erano mai parlati";
    case "porta_nuova": return "Porta mai usata prima su un server già noto";
    case "molti_contatti": return `Ha contattato ${numero("server") ?? "molti"} host in cinque minuti`;
    case "impianto":
      return a.client === ESTERNO || a.server === ESTERNO ? "Un impianto parla con l'esterno" : "Collegamento nuovo con un impianto";
    case "vlan_chiuse": return "Traffico fra due reti che la matrice di segmentazione dà per chiuse";
    case "volume": {
      const b = numero("byte");
      const m = numero("mediana");
      return b !== null && m !== null ? `${formattaByte(b)} in un giorno, di solito ${formattaByte(m)}` : "Volume lontano dall'abitudine";
    }
    case "non_censito": return "Indirizzo che parla in una rete censita ma non è fra gli host";
    case "chiaro_telnet": return "Accesso Telnet: utente e password passano in chiaro";
    case "chiaro_ftp": return "Accesso FTP: la password passa in chiaro";
    case "chiaro_posta": return "Accesso alla posta senza cifratura";
    case "chiaro_http_basic": return "Password mandata a un sito senza cifratura";
    case "chiaro_ldap": return "Accesso LDAP con password in chiaro";
    case "snmp_vecchio": return "SNMP v1 o v2c: la comunità passa in chiaro";
    case "smb1": return "Condivisione file con SMB versione 1";
    case "tls_vecchio": return "Connessione cifrata con TLS più vecchio della 1.2";
    case "ntlm1": return "Accesso con NTLM versione 1";
    case "nome_conteso": return typeof d.nome === "string" ? `Due host rispondono per il nome ${d.nome}` : "Due host rispondono per lo stesso nome";
    case "impianto_scrittura": return "Comando di scrittura verso un impianto";
    case "ip_doppio": return "Due apparati rispondono per lo stesso indirizzo";
    case "mac_cambiato": return "Risponde un apparato diverso da quello censito su questo indirizzo";
    case "paese_nuovo": return typeof d.paese === "string" ? `Collegamento verso un paese mai visto prima: ${nomePaese(d.paese)}` : "Collegamento verso un paese mai visto prima";
    case "dns_anomalo": return d.motivo === "molte_richieste" ? "Moltissime richieste DNS in cinque minuti" : "Richieste DNS fuori dal comune";
  }
}

/** I MAC di un avviso «IP doppio» o «MAC cambiato», da mostrare sotto la frase. Null per gli altri tipi o se mancano. */
export function macAnomalia(a: { tipo: TipoAnomalia; dettaglio: Record<string, unknown> }): string | null {
  const m = (k: string): string | null => (typeof a.dettaglio[k] === "string" && /^[0-9a-f:]{17}$/i.test(a.dettaglio[k] as string) ? (a.dettaglio[k] as string).toUpperCase() : null);
  if (a.tipo === "ip_doppio") {
    const [x, y] = [m("mac_a"), m("mac_b")];
    const altri = typeof a.dettaglio.quanti === "number" && a.dettaglio.quanti > 2 ? ` e altri ${a.dettaglio.quanti - 2}` : "";
    return x && y ? `${x} e ${y}${altri}` : null;
  }
  if (a.tipo === "mac_cambiato") {
    const [x, y] = [m("prima"), m("ora")];
    return x && y ? `prima ${x}, ora ${y}` : null;
  }
  return null;
}

/** Il nome italiano di un paese dal codice a due lettere («DE» → «Germania»); il codice stesso se non si conosce. */
export function nomePaese(codice: string | null): string {
  if (!codice || !/^[A-Z]{2}$/.test(codice)) return "Paese non noto";
  try {
    return new Intl.DisplayNames(["it"], { type: "region" }).of(codice) ?? codice;
  } catch {
    return codice;
  }
}
