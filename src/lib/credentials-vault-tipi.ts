/**
 * Tipi di credenziale che le API del caveau accettano in scrittura (creazione,
 * modifica, bootstrap dall'appliance). Un solo elenco per le tre rotte.
 *
 * `master` non c'è apposta: la password master la scrive solo `master-password.ts`.
 * La colonna `kind` è TEXT senza CHECK: una riga di un tipo tolto resta leggibile.
 * Il tipo dell'overlay precedente è tolto il 20/10/2026 (sul live 0 righe): una riga
 * vecchia si legge ancora, ma non se ne creano altre.
 */
import { z } from "zod";

export const TIPI_CREDENZIALE = [
  "wazuh",
  "graylog",
  "librenms",
  "truenas",
  "edge",
  "hub",
  "pve",
  "other",
] as const;

export const TipoCredenzialeSchema = z.enum(TIPI_CREDENZIALE);

const ModoAperturaSchema = z.enum(["copy", "sso_form", "sso_token"]);

/** Corpo di POST /api/system-credentials. */
export const CreaCredenzialeSchema = z.object({
  kind: TipoCredenzialeSchema,
  label: z.string().min(1).max(120),
  url: z.string().url().nullable().optional(),
  api_url: z.string().url().nullable().optional(),
  username: z.string().nullable().optional(),
  password: z.string().nullable().optional(),
  api_token: z.string().nullable().optional(),
  extra: z.record(z.string(), z.string()).nullable().optional(),
  launch_mode: ModoAperturaSchema.optional(),
  notes: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
  sort_order: z.number().int().optional(),
});

/** Corpo di PUT /api/system-credentials/[id]: tutto facoltativo, `kind` compreso. */
export const AggiornaCredenzialeSchema = CreaCredenzialeSchema.partial();

/** Una voce di POST /api/system-credentials/bootstrap (connect.sh di Deploy-Appliance). */
export const VoceBootstrapSchema = z.object({
  kind: TipoCredenzialeSchema,
  label: z.string().min(1).max(120),
  url: z.string().url().nullable().optional(),
  api_url: z.string().url().nullable().optional(),
  username: z.string().nullable().optional(),
  password: z.string().nullable().optional(),
  api_token: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  launch_mode: ModoAperturaSchema.optional(),
});

/**
 * Il `kind` da mandare salvando dal Launchpad: in creazione sempre; in modifica solo se
 * cambiato, così una riga di un tipo tolto si modifica senza un 400 (rilievo del 20/10).
 */
export function tipoDaInviare(opz: { originale: string | undefined; scelto: string }): string | undefined {
  if (opz.originale === undefined) return opz.scelto;
  return opz.scelto === opz.originale ? undefined : opz.scelto;
}
