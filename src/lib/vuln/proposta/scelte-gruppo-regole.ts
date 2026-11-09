/**
 * Regole pure della scelta per gruppo (le usa anche il browser). L'archivio sta in `scelte-gruppo.ts`.
 *
 * Scelta per gruppo (Riccardo, 09/11/2026: «perché Windows giro minimo e non c'è un'opzione per cambiare per il gruppo
 * la modalità di scansione»; tavola oggetti 45-48 approvata).
 *
 * Di serie vale la tabella di `gruppi.ts`. Una persona può cambiare Greenbone, nuclei e moduli di una famiglia, per la
 * rete; la scelta resta finché qualcuno non la cambia o non torna alla tabella, con chi, quando e una nota. Le scelte che
 * alzano il rischio vogliono la nota (lo controlla la rotta). Gli impianti non si toccano mai da qui; «da chiarire» sale
 * al massimo a Bilanciato, senza nuclei né moduli, finché il tipo non è certo: lo ricontrolla anche `gruppi.ts`, così una
 * scelta sbagliata finita nel database non passa comunque.
 */
import type { EdgeScanProfile } from "@/lib/vuln/edge-subnet-bridge";
import type { NucleiGruppo } from "./gruppi";
import type { Famiglia } from "./regole";

export type NucleiScelta = "nessuno" | NucleiGruppo;
export type ModuliScelta = "nessuno" | "base" | "completi";
export const FAMIGLIE_SCEGLIBILI = ["rete", "windows", "linux", "web", "periferiche", "da_chiarire"] as const;
export const PROFILI_SCELTA = ["fast", "balanced", "deep"] as const;
export const NUCLEI_SCELTA = ["nessuno", "gestione", "quick", "standard"] as const;
export const MODULI_SCELTA = ["nessuno", "base", "completi"] as const;

/** Un campo `null` = vale la tabella per quel campo. */
export interface ValoriScelta {
  profile: EdgeScanProfile | null;
  nuclei: NucleiScelta | null;
  moduli: ModuliScelta | null;
}

export interface SceltaGruppo extends ValoriScelta {
  famiglia: Famiglia;
  chi: string;
  nota: string | null;
  il: string;
}

/** Perché una scelta non si può fare; `null` = si può. Pura. */
export function controllaScelta(famiglia: Famiglia, v: ValoriScelta): string | null {
  if (!(FAMIGLIE_SCEGLIBILI as readonly string[]).includes(famiglia)) return "Gli impianti non si cambiano da qui: solo Greenbone Veloce, col consenso";
  if (famiglia === "da_chiarire") {
    if (v.profile === "deep") return "«Da chiarire» sale al massimo a Bilanciato finché il tipo non è certo";
    if ((v.nuclei && v.nuclei !== "nessuno") || (v.moduli && v.moduli !== "nessuno")) return "«Da chiarire» resta senza nuclei né moduli finché il tipo non è certo";
  }
  return null;
}

/** Il rischio in più di una scelta, da confermare con una nota; `null` = nessun rischio in più. Pura. */
export function rischioDellaScelta(famiglia: Famiglia, v: ValoriScelta): string | null {
  if (v.moduli === "completi" && famiglia === "windows") {
    return "Giro completo aggiunge enum4linux-ng e LDAP: interrogano il dominio con l'utente dell'integrazione e possono far scattare allarmi o il blocco degli account.";
  }
  if (v.moduli === "completi" && famiglia === "rete") {
    return "Giro completo su apparati di rete aggiunge SNMP, SMTP ed enumerazioni: su switch e firewall può far scattare allarmi.";
  }
  if (v.profile === "deep") return "Greenbone Profondo prova molte più porte e controlli: giri lunghi e più traffico sugli apparati.";
  if (v.nuclei === "standard" && (famiglia === "rete" || famiglia === "periferiche")) {
    return "Nuclei Standard su apparati di rete e periferiche prova molti più percorsi web: su stampanti e apparati piccoli può dare fastidio.";
  }
  return null;
}

