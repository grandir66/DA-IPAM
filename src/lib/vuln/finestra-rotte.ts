/**
 * Il lavoro delle rotte `/api/networks/[id]/edge-scan/finestra` (e `/ip`), senza il rivestimento
 * HTTP: ogni funzione dà `{ status, body }`. Le rotte tengono guardia (sessione, admin) e contesto
 * tenant; qui stanno la validazione e la scelta dello stato HTTP, provabili contro un finto edge.
 * Un rifiuto della sonda (400, 409) resta tale; il resto che va storto a monte è 502.
 */
import { z } from "zod";
import {
  leggiFinestra,
  leggiFinestraIp,
  removeEdgeSubnetFinestra,
  resolveAssessmentForNetwork,
  saveEdgeSubnetFinestra,
} from "@/lib/vuln/edge-subnet-bridge";
import { assessmentProfileIdSchema } from "@/lib/vuln/edge-profiles";
import { STATI_IP, type StatoIp } from "@/lib/vuln/finestra";

export interface RispostaRotta {
  status: number;
  body: unknown;
}

const orario = z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/, "Orario non valido: scrivi HH:MM");

export const finestraSchema = z.object({
  enabled: z.boolean(),
  giorni: z.array(z.number().int().min(0).max(6)).min(1, "Scegli almeno un giorno").max(7),
  dalle: orario,
  alle: orario,
  ripeti: z.enum(["mese", "settimana"]),
  ip_per_gruppo: z.number().int().min(1).max(20),
  tentativi: z.number().int().min(1).max(10),
  profile: z.enum(["fast", "balanced", "deep"]),
  targeting_mode: z.enum(["full_subnet", "found_ips", "populated_24"]),
  assessment_enabled: z.boolean().optional(),
  assessment_profile_id: assessmentProfileIdSchema.nullable().optional(),
});

export async function leggiFinestraRotta(networkId: number): Promise<RispostaRotta> {
  return { status: 200, body: await leggiFinestra(networkId) };
}

/** `corpo` è il JSON già letto, o `undefined` se non era JSON. */
export async function salvaFinestraRotta(networkId: number, corpo: unknown): Promise<RispostaRotta> {
  if (corpo === undefined) return { status: 400, body: { error: "Body JSON non valido" } };
  const parsed = finestraSchema.safeParse(corpo);
  if (!parsed.success) {
    return {
      status: 400,
      body: { error: parsed.error.issues[0]?.message ?? "Body JSON non valido", details: parsed.error.issues },
    };
  }
  const body = parsed.data;

  // Come la pianificazione: un profilo assessment che l'edge non ha si ferma qui, prima di scrivere.
  const assessment = await resolveAssessmentForNetwork(networkId, {
    enabled: body.assessment_enabled,
    profileId: body.assessment_profile_id,
  });
  if (!assessment.ok) return { status: assessment.status, body: { ok: false, error: assessment.error } };

  const result = await saveEdgeSubnetFinestra(networkId, {
    enabled: body.enabled,
    giorni: body.giorni,
    dalle: body.dalle,
    alle: body.alle,
    ripeti: body.ripeti,
    ipPerGruppo: body.ip_per_gruppo,
    tentativi: body.tentativi,
    profile: body.profile,
    targetingMode: body.targeting_mode,
    assessmentEnabled: assessment.enabled,
    assessmentProfileId: assessment.profileId,
  });
  if (!result.ok) {
    return {
      status: result.status ?? 502,
      body: { ok: false, error: result.error, daAggiornare: result.daAggiornare ?? false },
    };
  }
  return { status: 200, body: { ok: true, avviso: result.avviso ?? null, finestra: await leggiFinestra(networkId) } };
}

export async function cancellaFinestraRotta(networkId: number): Promise<RispostaRotta> {
  const result = await removeEdgeSubnetFinestra(networkId);
  if (!result.ok) return { status: result.status ?? 502, body: { ok: false, error: result.error } };
  return { status: 200, body: { ok: true, finestra: await leggiFinestra(networkId) } };
}

/** `q` = i parametri dell'indirizzo: `stato`, `limit` (1-1000, predefinito 200), `offset` (da 0). */
export async function elencoIpRotta(networkId: number, q: URLSearchParams): Promise<RispostaRotta> {
  const stato = q.get("stato");
  if (stato !== null && stato !== "" && !(STATI_IP as readonly string[]).includes(stato)) {
    return { status: 400, body: { error: `Stato sconosciuto: ${stato}` } };
  }
  const numero = (nome: string, min: number, max: number, predefinito: number): number | null => {
    const v = q.get(nome);
    if (v === null || v === "") return predefinito;
    const n = Number(v);
    return Number.isInteger(n) && n >= min && n <= max ? n : null;
  };
  const limit = numero("limit", 1, 1000, 200);
  const offset = numero("offset", 0, 10_000_000, 0);
  if (limit === null) return { status: 400, body: { error: "limit deve essere da 1 a 1000" } };
  if (offset === null) return { status: 400, body: { error: "offset non valido" } };
  return {
    status: 200,
    body: await leggiFinestraIp(networkId, { stato: (stato || undefined) as StatoIp | undefined, limit, offset }),
  };
}
