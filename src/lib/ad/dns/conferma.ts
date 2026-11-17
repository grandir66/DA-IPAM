/**
 * Conferma legata all'anteprima (passo 2, 17/11/2026): l'anteprima firma esattamente i passi che
 * ha mostrato, per quell'utente e quel dominio, con una scadenza. «Applica» rifà il calcolo dai
 * dati di adesso e confronta la firma: se qualcosa è cambiato, o è passato il tempo, si rifà
 * l'anteprima. Niente stato in memoria: la firma è un HMAC con il segreto del servizio.
 */
import crypto from "node:crypto";
import type { Correzione } from "./correzioni";

export const DURATA_CONFERMA_MS = 5 * 60_000;
export const MASSIMO_CORREZIONI = 50;

export interface DatiConferma {
  integrazione: number;
  utente: string;
  /** Millisecondi dall'epoca. */
  scade: number;
  correzioni: readonly Correzione[];
}

function canonico(d: DatiConferma): string {
  return JSON.stringify([d.integrazione, d.utente, d.scade, d.correzioni.map((c) => [c.id, c.passi.map((p) => [p.azione, p.zona, p.nome, p.tipo, p.dato])])]);
}

export function firmaConferma(d: DatiConferma, segreto: string): string {
  if (!segreto) throw new Error("Segreto del servizio assente: nessuna conferma possibile");
  return crypto.createHmac("sha256", segreto).update(canonico(d)).digest("hex");
}

export type EsitoConferma = { ok: true } | { ok: false; motivo: string };

export function verificaConferma(d: DatiConferma, gettone: string, segreto: string, adesso: number = Date.now()): EsitoConferma {
  if (!Number.isFinite(d.scade) || d.scade <= adesso) return { ok: false, motivo: "La conferma è scaduta: rifai l'anteprima" };
  if (d.scade - adesso > DURATA_CONFERMA_MS + 5_000) return { ok: false, motivo: "Conferma non valida" };
  const atteso = Buffer.from(firmaConferma(d, segreto), "hex");
  const dato = /^[0-9a-f]{64}$/.test(gettone) ? Buffer.from(gettone, "hex") : Buffer.alloc(0);
  if (dato.length !== atteso.length || !crypto.timingSafeEqual(atteso, dato)) {
    return { ok: false, motivo: "I dati sono cambiati dall'anteprima: rifalla e controlla di nuovo" };
  }
  return { ok: true };
}

/** Il segreto del servizio. Vuoto = le rotte rifiutano. */
export function segretoConferma(env: Record<string, string | undefined> = process.env): string {
  return env.AUTH_SECRET || env.NEXTAUTH_SECRET || "";
}
