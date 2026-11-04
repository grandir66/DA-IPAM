/**
 * Motivo dell'accesso Windows → una parola, un segno, una sola azione (piano accesso Windows, Task 9).
 *
 * Riccardo, 04/11/2026: «una parola sola per esito, e una sola azione presa dal catalogo». Il catalogo dei motivi è
 * `MotivoAccesso` del motore di scansione; qui sta come si dicono a chi legge la pagina. Le azioni dei diritti si leggono da
 * `diritti.ts`, non si ricopiano: una guida sola.
 *
 * Il segno ha tre valori e non due: porte chiuse e budget esaurito vogliono dire che su quell'host non è partito nessun
 * login, quindi si vedono come «non provato», uguali a una riga che non c'è (non si prova niente e non si inventa un «no»).
 *
 * Il modulo è puro e lo importano anche i componenti client: niente database, niente import di server (solo tipi).
 */
import type { MotivoAccesso } from "@/lib/scanner/accesso-windows";
import { dirittoPerId } from "./diritti";

export type StradaAccesso = "winrm" | "wmi";
export type SegnoStato = "si" | "no" | "non_provato";

/**
 * Tutti i motivi, nell'ordine di utilità del motore (`ORDINE_MOTIVI`) più quelli che il motore non classifica per strada.
 * L'indice è la posizione usata da SQL per scegliere il motivo che vince fra più voci: dal più utile (0) al meno.
 */
export const MOTIVI: readonly MotivoAccesso[] = [
  "ok", "password_errata", "diritti_mancanti", "firewall", "errore", "porte_chiuse", "budget_esaurito", "nessuna_voce",
];

const PAROLE: Readonly<Record<MotivoAccesso, string>> = {
  ok: "Riuscito",
  diritti_mancanti: "Negato",
  password_errata: "Password",
  firewall: "Firewall",
  porte_chiuse: "Chiusa",
  budget_esaurito: "Sospeso",
  nessuna_voce: "Senza-voce",
  errore: "Errore",
};

const SEGNI: Readonly<Record<MotivoAccesso, SegnoStato>> = {
  ok: "si",
  diritti_mancanti: "no",
  password_errata: "no",
  firewall: "no",
  errore: "no",
  porte_chiuse: "non_provato",
  budget_esaurito: "non_provato",
  nessuna_voce: "non_provato",
};

export function parolaDelMotivo(motivo: MotivoAccesso | null): string {
  return motivo ? PAROLE[motivo] : "Non provato";
}

export function segnoDelMotivo(motivo: MotivoAccesso | null): SegnoStato {
  return motivo ? SEGNI[motivo] : "non_provato";
}

const NOME_STRADA: Readonly<Record<StradaAccesso, string>> = { winrm: "WinRM", wmi: "WMI" };

/** L'unica azione per motivo e strada, o null se non c'è niente da fare. */
export function azioneDelMotivo(motivo: MotivoAccesso | null, strada: StradaAccesso): string | null {
  const nome = NOME_STRADA[strada];
  switch (motivo) {
    case "ok":
      return null;
    case "diritti_mancanti":
      return `Abilita: ${dirittoPerId(strada === "winrm" ? "inventario_winrm" : "inventario_wmi").abilitare}`;
    case "password_errata":
      return "Correggi la password della voce";
    case "firewall":
      return strada === "winrm" ? "Apri la porta 5985 nel firewall del PC" : "Abilita la regola firewall WMI";
    case "porte_chiuse":
      return strada === "winrm" ? "Attiva il servizio WinRM sul PC" : "Abilita la regola firewall WMI";
    case "budget_esaurito":
      return "Aspetta la prossima scansione";
    case "nessuna_voce":
      return `Aggiungi una voce Windows per ${nome}`;
    case "errore":
      return `Rilancia la scansione su questo host`;
    case null:
      return "Lancia una scansione";
  }
}

/** La posizione di un motivo per SQL (vedi `MOTIVI`). */
export function posizioneDelMotivo(motivo: MotivoAccesso): number {
  return MOTIVI.indexOf(motivo);
}

export function motivoDaPosizione(posizione: number | null): MotivoAccesso | null {
  if (posizione == null) return null;
  return MOTIVI[posizione] ?? null;
}

/** Un testo letto dal database: solo un motivo vero lo è. Un valore sconosciuto è «nessun esito», non un errore finto. */
export function comeMotivo(valore: string | null | undefined): MotivoAccesso | null {
  return MOTIVI.find((m) => m === valore) ?? null;
}
