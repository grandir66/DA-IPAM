/**
 * Profili assessment dell'edge (EDG-1, piano di miglioramento 2026-10-12, tappa 1).
 *
 * DA-IPAM offriva una lista fissa di quattro profili; l'edge conosce solo quelli
 * del suo catalogo (DA-Vul-can, `infra/scanner-edge/app/scanner_edge/data/
 * assessment_profiles.json`). Un id che l'edge non ha si salvava senza errori:
 * l'assessment falliva dopo la scansione, sull'edge, con «Profilo sconosciuto»,
 * e DA-IPAM non lo mostrava. Adesso l'elenco si legge da `GET /api/v1/profiles`
 * dell'edge (`services/profile_runner.py::list_profiles`):
 *
 *   {"profiles": [{"id", "label", "image", "requires_authorization", "steps": [nomi dei moduli]}]}
 *
 * Qui stanno la lettura difensiva di quella risposta e le regole che decidono
 * quale profilo vale per una richiesta. Modulo puro (niente rete né database):
 * lo importano anche i componenti client.
 */

import { z } from "zod";

/** Id di profilo accettato da DA-IPAM: minuscole, cifre e trattini, 1-64 caratteri
 *  (l'edge accetta `profile_id` fino a 64 caratteri). */
export const ASSESSMENT_PROFILE_ID_RE = /^[a-z0-9-]{1,64}$/;

const ID_NON_VALIDO =
  "Profilo assessment non valido: solo lettere minuscole, cifre e trattini, al massimo 64 caratteri";

export const assessmentProfileIdSchema = z
  .string({ error: ID_NON_VALIDO })
  .regex(ASSESSMENT_PROFILE_ID_RE, { error: ID_NON_VALIDO });

export interface EdgeAssessmentProfile {
  id: string;
  /** Etichetta scritta nel catalogo dell'edge; se manca, l'id. */
  label: string;
  /** Immagine che esegue il profilo sull'edge (oggi "advanced"). */
  image: string | null;
  /** Profilo intrusivo: serve l'autorizzazione del cliente. */
  requires_authorization: boolean;
  /** Moduli eseguiti, nell'ordine. */
  steps: string[];
}

export interface EdgeProfilesList {
  profiles: EdgeAssessmentProfile[];
  /** Voci del catalogo scartate: non oggetti, id mancante, non sicuro o ripetuto. */
  ignored: number;
}

export type ParseEdgeProfilesResult =
  | { ok: true; list: EdgeProfilesList }
  | { ok: false; error: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Legge la risposta di `GET /api/v1/profiles`. Una forma sbagliata è un errore
 * (mai una lista vuota: farebbe credere che l'edge non abbia profili); una voce
 * sbagliata si scarta e si conta, così la pagina può dirlo.
 */
export function parseEdgeProfilesResponse(raw: unknown): ParseEdgeProfilesResult {
  if (!isRecord(raw) || !Array.isArray(raw.profiles)) {
    return { ok: false, error: "risposta dell'edge non valida: manca l'elenco «profiles» dei profili" };
  }
  const profiles: EdgeAssessmentProfile[] = [];
  const seen = new Set<string>();
  let ignored = 0;
  for (const entry of raw.profiles) {
    if (!isRecord(entry)) {
      ignored++;
      continue;
    }
    const id = entry.id;
    if (typeof id !== "string" || !ASSESSMENT_PROFILE_ID_RE.test(id) || seen.has(id)) {
      ignored++;
      continue;
    }
    seen.add(id);
    const label = typeof entry.label === "string" && entry.label.trim() ? entry.label.trim() : id;
    profiles.push({
      id,
      label,
      image: typeof entry.image === "string" ? entry.image : null,
      requires_authorization: entry.requires_authorization === true,
      steps: Array.isArray(entry.steps)
        ? entry.steps.filter((s): s is string => typeof s === "string")
        : [],
    });
  }
  return { ok: true, list: { profiles, ignored } };
}

export function findEdgeProfile(
  profiles: readonly EdgeAssessmentProfile[],
  id: string | null | undefined,
): EdgeAssessmentProfile | null {
  if (!id) return null;
  return profiles.find((p) => p.id === id) ?? null;
}

export function missingProfileMessage(id: string, profiles: readonly EdgeAssessmentProfile[]): string {
  const disponibili = profiles.length ? profiles.map((p) => p.id).join(", ") : "nessuno";
  return `Il profilo assessment «${id}» non esiste sull'edge (profili disponibili: ${disponibili}).`;
}

export interface AssessmentConfig {
  enabled: boolean;
  profileId: string | null;
}

/** Quello che una richiesta dice dell'assessment; `undefined` = non lo tocca. */
export interface AssessmentRequest {
  enabled?: boolean;
  profileId?: string | null;
}

export type EffectiveAssessment =
  | { ok: true; enabled: false; profileId: null }
  | { ok: true; enabled: true; profileId: string }
  | { ok: false; error: string };

const SCEGLI_PROFILO = "Scegli il profilo assessment, oppure disattiva l'assessment.";

/**
 * La configurazione assessment che una richiesta lascia sulla rete. Un campo
 * assente vale com'è salvato; acceso senza profilo è un errore (prima si
 * ripiegava su un profilo scritto nel codice, che l'edge poteva non avere).
 */
export function effectiveAssessment(req: AssessmentRequest, saved: AssessmentConfig): EffectiveAssessment {
  const enabled = req.enabled ?? saved.enabled;
  if (!enabled) return { ok: true, enabled: false, profileId: null };
  const profileId = req.profileId !== undefined ? req.profileId : saved.profileId;
  if (!profileId) return { ok: false, error: SCEGLI_PROFILO };
  return { ok: true, enabled: true, profileId };
}

/**
 * Confronto fra la configurazione assessment di DA-IPAM e quella della sonda.
 *
 * Le due copie esistono entrambe: DA-IPAM ne tiene una (è quella che il pannello
 * mostra e quella che parte nel corpo di `/networks/ensure`), ma a **eseguire** è
 * la riga della sonda. Finché passa tutto dalla pagina restano allineate — la
 * copia locale si scrive solo dopo che la sonda ha accettato. Una modifica fatta
 * **fuori** (a mano sul database, o dall'interfaccia della sonda) le separa, e
 * nessuno se ne accorgeva: il 05/11/2026 sul 72729 DA-IPAM diceva un profilo e
 * la sonda ne eseguiva un altro (gli id non si scrivono qui fra apici: li vieta il
 * lucchetto in edge-profiles.test.ts, e avrebbe ragione).
 *
 * `undefined` per la sonda significa «non l'ha detto»: una sonda più vecchia del
 * 05/11/2026 non ha quei campi nel `lookup`. In quel caso non si inventa un
 * disallineamento — si dice che non è noto.
 */
export type ConfrontoAssessment =
  | { stato: "non-noto" }
  | { stato: "allineati" }
  | { stato: "diversi"; qui: AssessmentConfig; sonda: AssessmentConfig };

/** Stringa vuota e `null` sono la stessa cosa: «nessun profilo». */
function normalizzaProfilo(id: string | null | undefined): string | null {
  return (id || "").trim() || null;
}

export function confrontaAssessment(
  qui: AssessmentConfig,
  sonda: AssessmentConfig | undefined,
): ConfrontoAssessment {
  if (!sonda) return { stato: "non-noto" };
  const idQui = normalizzaProfilo(qui.profileId);
  const idSonda = normalizzaProfilo(sonda.profileId);
  // Spento da tutte e due le parti: che profilo sia scritto accanto non conta,
  // non viene eseguito niente.
  if (!qui.enabled && !sonda.enabled) return { stato: "allineati" };
  if (qui.enabled === sonda.enabled && idQui === idSonda) return { stato: "allineati" };
  return {
    stato: "diversi",
    qui: { enabled: qui.enabled, profileId: idQui },
    sonda: { enabled: sonda.enabled, profileId: idSonda },
  };
}
