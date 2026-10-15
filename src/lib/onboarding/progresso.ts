/**
 * Punto raggiunto nel wizard di prima configurazione e oggetti già creati
 * (tappa 4 credenziali, 15/10). Si salva nelle impostazioni dell'hub, una
 * chiave per cliente: `onboarding_progresso:<cliente>`.
 *
 * Perché: «Esci» segnava il wizard completato e dimenticava il resto;
 * riaprendolo si ripartiva dal primo passo e router e rete si ricreavano.
 * Modulo puro (niente DB) per la rotta `/api/onboarding/progresso`; il
 * wizard ne importa solo i tipi. Un valore guasto si dice «illeggibile», mai
 * «assente».
 */
import { z } from "zod";
import { PASSI_WIZARD } from "./passi";

export interface ProgressoWizard {
  /** Indice del passo, da 0. */
  passo: number;
  router_device_id: number | null;
  network_id: number | null;
  ad_integration_id: number | null;
}

export const PROGRESSO_INIZIALE: ProgressoWizard = {
  passo: 0,
  router_device_id: null,
  network_id: null,
  ad_integration_id: null,
};

const CAMPI_ID = ["router_device_id", "network_id", "ad_integration_id"] as const;

const idOggetto = z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable().optional();

/** Campi sconosciuti rifiutati: un refuso non deve passare per un progresso senza oggetti. */
const SchemaProgresso = z.strictObject({
  passo: z.number().int().min(0).max(PASSI_WIZARD.length - 1),
  router_device_id: idOggetto,
  network_id: idOggetto,
  ad_integration_id: idOggetto,
});

export type EsitoValidazione = { ok: true; progresso: ProgressoWizard } | { ok: false; errore: string };

function messaggio(issue: z.core.$ZodIssue): string {
  if (issue.code === "unrecognized_keys") return `Campo sconosciuto: «${issue.keys.join("», «")}»`;
  const campo = issue.path[0];
  if (campo === "passo") return `Passo non valido: atteso un intero fra 0 e ${PASSI_WIZARD.length - 1}`;
  if (typeof campo === "string" && (CAMPI_ID as readonly string[]).includes(campo)) {
    return `«${campo}» deve essere l'id di un oggetto creato (intero positivo) o null`;
  }
  return "Il punto raggiunto deve essere un oggetto con il passo";
}

/** Corpo del PUT (o valore riletto) → punto raggiunto; gli id assenti valgono null. */
export function validaProgresso(x: unknown): EsitoValidazione {
  const parsed = SchemaProgresso.safeParse(x);
  if (!parsed.success) return { ok: false, errore: messaggio(parsed.error.issues[0]) };
  const d = parsed.data;
  return {
    ok: true,
    progresso: {
      passo: d.passo,
      router_device_id: d.router_device_id ?? null,
      network_id: d.network_id ?? null,
      ad_integration_id: d.ad_integration_id ?? null,
    },
  };
}

export type LetturaProgresso =
  | { stato: "assente" }
  | { stato: "valido"; progresso: ProgressoWizard }
  | { stato: "illeggibile"; errore: string };

/** Valore salvato nell'hub → punto raggiunto. */
export function leggiProgresso(raw: string | null): LetturaProgresso {
  if (raw === null || raw === "") return { stato: "assente" };
  let dato: unknown;
  try {
    dato = JSON.parse(raw);
  } catch {
    return { stato: "illeggibile", errore: "il valore salvato non è JSON" };
  }
  const esito = validaProgresso(dato);
  return esito.ok ? { stato: "valido", progresso: esito.progresso } : { stato: "illeggibile", errore: esito.errore };
}

/** Punto raggiunto → valore da salvare, sempre con le stesse chiavi nello stesso ordine. */
export function scriviProgresso(p: ProgressoWizard): string {
  return JSON.stringify({
    passo: p.passo,
    router_device_id: p.router_device_id,
    network_id: p.network_id,
    ad_integration_id: p.ad_integration_id,
  });
}

export function chiaveProgresso(tenantCode: string): string {
  return `onboarding_progresso:${tenantCode}`;
}
