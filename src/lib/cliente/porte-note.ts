const NOMI: Record<number, string> = {
  22: "accesso remoto",
  23: "accesso remoto non protetto",
  25: "posta",
  53: "nomi di rete",
  80: "pagina web",
  135: "servizi Windows",
  139: "condivisione file",
  161: "gestione di rete",
  389: "elenco utenti",
  443: "pagina web",
  445: "condivisione file",
  587: "posta",
  631: "stampa",
  636: "elenco utenti",
  1433: "archivio dati",
  3306: "archivio dati",
  3389: "desktop remoto",
  5060: "telefonia",
  5432: "archivio dati",
  5900: "controllo remoto",
  8080: "pagina web",
  8443: "pagina web",
  9100: "stampa",
};

/** Nome semplice di una porta nota. Le altre restano solo un numero. */
export function nomeDellaPorta(numero: number): string | null {
  return NOMI[numero] ?? null;
}
