/**
 * L'elenco chiuso delle esche, per l'applicazione e per la pagina (Protezione, tappa 5). Lo stesso elenco sta nel
 * servizio (`scripts/esche/da-ipam-esche.mjs`) e nell'esecutore: una prova li tiene uguali.
 * Va anche nel browser: niente moduli di Node qui.
 */
export const NOMI_ESCHE = ["ftp", "telnet", "smb", "ssh", "mysql", "rdp", "web"] as const;
export type NomeEsca = (typeof NOMI_ESCHE)[number];

export const ESCHE: Readonly<Record<NomeEsca, { porta: number; ascolta: number; nome: string; cosa: string }>> = {
  ftp: { porta: 21, ascolta: 20021, nome: "FTP", cosa: "chiede nome e password, rifiuta" },
  telnet: { porta: 23, ascolta: 20023, nome: "Telnet", cosa: "chiede nome e password, rifiuta" },
  smb: { porta: 445, ascolta: 20445, nome: "Condivisione Windows (SMB)", cosa: "accetta la connessione e non risponde" },
  ssh: { porta: 2222, ascolta: 22222, nome: "SSH finto", cosa: "mostra la versione e chiude" },
  mysql: { porta: 3306, ascolta: 23306, nome: "Database MySQL", cosa: "saluta come un server, poi nega l'accesso" },
  rdp: { porta: 3389, ascolta: 23389, nome: "Desktop remoto (RDP)", cosa: "accetta la connessione e non risponde" },
  web: { porta: 8081, ascolta: 28081, nome: "Pagina di login finta", cosa: "mostra un login, rifiuta ogni credenziale" },
};

export function eNomeEsca(v: string): v is NomeEsca {
  return (NOMI_ESCHE as readonly string[]).includes(v);
}

export interface ConfEsche {
  accese: NomeEsca[];
  /** Risposte lente: chi scansiona resta appeso su ogni porta finta. */
  lente: boolean;
}

export function leggiConfEsche(testo: string): ConfEsche {
  const valori = new Map<string, string>();
  for (const grezza of testo.split("\n")) {
    const riga = grezza.trim();
    if (!riga || riga.startsWith("#")) continue;
    const i = riga.indexOf("=");
    if (i > 0) valori.set(riga.slice(0, i), riga.slice(i + 1).trim());
  }
  return { accese: [...new Set((valori.get("ESCHE") ?? "").split(/[,\s]+/).filter(eNomeEsca))], lente: valori.get("ESCHE_LENTE") === "si" };
}

export function scriviConfEsche(c: ConfEsche): string {
  const accese = NOMI_ESCHE.filter((n) => c.accese.includes(n));
  return `# Scritto da DA-IPAM (Protezione › Esche). Non si esegue: lo leggono da-ipam-accessi.sh e il servizio delle esche.\nESCHE=${accese.join(",")}\nESCHE_LENTE=${c.lente ? "si" : "no"}\n`;
}
