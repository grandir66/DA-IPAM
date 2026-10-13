/**
 * Validazione dei corpi delle rotte /api/topology, /api/locations/:id/topology
 * e /api/devices/:id/location, e forma delle loro risposte. Queste rotte
 * scrivono dati del cliente su conferma di un admin: niente passa senza schema.
 */
import { z } from "zod";
import { LINK_STALE_DAYS_MAX, LINK_STALE_DAYS_MIN } from "@/lib/topology/settings";

export type Parsed<T> = { ok: true; data: T } | { ok: false; error: string };

export interface SiteTopologyView {
  location_id: number;
  head_device_id: number | null;
  head_set_by: string | null;
  head_set_at: string | null;
  network_ids: number[];
  proposed_head: { device_id: number; name: string } | null;
  devices: Array<{ id: number; name: string; device_type: string; host: string }>;
  networks: Array<{ id: number; cidr: string; name: string; location_id: number | null; location_name: string | null }>;
}

export interface DeviceLocationView {
  location_id: number | null;
  location_set_by: string | null;
  location_set_at: string | null;
  proposed_site: { id: number; name: string } | null;
}

// Ogni schema porta il suo messaggio: quelli predefiniti di Zod sono in inglese
// e arriverebbero così all'admin.
const BODY = { error: "Corpo della richiesta non valido" };
const NODE = z.string({ error: "Nodo non valido" }).regex(/^(dev|host):\d+$/, "Nodo non valido");
const id = (msg: string) => z.number({ error: msg }).int({ error: msg }).positive({ error: msg });
const PORT = z.string({ error: "Porta non valida" }).max(100, "Porta troppo lunga (massimo 100 caratteri)");

function first(e: z.ZodError): string {
  return e.issues[0]?.message ?? "Dati non validi";
}

const linkSchema = z.object(
  {
    action: z.enum(["add", "ignore"], { error: "Azione non valida: «add» o «ignore»" }),
    a_node: NODE,
    a_port: PORT.optional().default(""),
    b_node: NODE,
    b_port: PORT.optional().default(""),
    note: z
      .string({ error: "Nota non valida" })
      .max(500, "Nota troppo lunga (massimo 500 caratteri)")
      .nullish()
      .transform((v) => v ?? null),
  },
  BODY,
);

export function parseLinkOverrideBody(raw: unknown): Parsed<z.infer<typeof linkSchema>> {
  const r = linkSchema.safeParse(raw);
  if (!r.success) return { ok: false, error: first(r.error) };
  if (r.data.a_node === r.data.b_node) return { ok: false, error: "Un collegamento unisce due nodi diversi" };
  return { ok: true, data: r.data };
}

const siteSchema = z.object(
  {
    head_device_id: id("Apparato di testa non valido").nullable().optional(),
    network_ids: z
      .array(id("Subnet non valida"), { error: "Elenco delle subnet non valido" })
      .max(500, "Troppe subnet (massimo 500)")
      .optional(),
  },
  BODY,
);

export function parseSiteTopologyBody(raw: unknown): Parsed<{ headDeviceId?: number | null; networkIds?: number[] }> {
  const r = siteSchema.safeParse(raw);
  if (!r.success) return { ok: false, error: first(r.error) };
  const data: { headDeviceId?: number | null; networkIds?: number[] } = {};
  if (r.data.head_device_id !== undefined) data.headDeviceId = r.data.head_device_id;
  if (r.data.network_ids !== undefined) data.networkIds = r.data.network_ids;
  return { ok: true, data };
}

const deviceLocationSchema = z.object({ location_id: id("Sede non valida: un identificativo, o null per toglierla").nullable() }, BODY);

export function parseDeviceLocationBody(raw: unknown): Parsed<{ locationId: number | null }> {
  const r = deviceLocationSchema.safeParse(raw);
  return r.success ? { ok: true, data: { locationId: r.data.location_id } } : { ok: false, error: first(r.error) };
}

// Qualunque rifiuto qui ha lo stesso messaggio (sotto), quindi niente testi per campo.
const staleSchema = z.object({ staleDays: z.number().int().min(LINK_STALE_DAYS_MIN).max(LINK_STALE_DAYS_MAX) });

export function parseStaleDaysBody(raw: unknown): Parsed<number> {
  const r = staleSchema.safeParse(raw);
  return r.success
    ? { ok: true, data: r.data.staleDays }
    : { ok: false, error: `La soglia va da ${LINK_STALE_DAYS_MIN} a ${LINK_STALE_DAYS_MAX} giorni` };
}
