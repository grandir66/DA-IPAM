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

/** Una porta nota di un oggetto (GET /api/topology/ports): porta dello switch o scheda dell'hypervisor. */
export interface KnownPort {
  name: string;
  /** Velocità come la scrive la fonte («1000 Mbps»); null se non nota. */
  speed: string | null;
  /** Potenza PoE erogata in W; null se nessuna o non nota. */
  poeW: number | null;
  kind: "switch_port" | "hypervisor_nic";
  /** Altro da dire in parole: «uplink», «membro di bond0», «giù». */
  note: string | null;
}

export interface PortsView {
  node: string;
  ports: KnownPort[];
}

// Ogni schema porta il suo messaggio: quelli predefiniti di Zod sono in inglese
// e arriverebbero così all'admin.
const BODY = { error: "Corpo della richiesta non valido" };
const NODE = z.string({ error: "Nodo non valido" }).regex(/^(dev|host):\d+$/, "Nodo non valido");
/**
 * Un nodo che può essere anche una VM (`vm:<apparato>:<vmid>`, fase 2b): regex del
 * piano. Vale dove un oggetto della mappa può essere una VM (collegamenti, principale,
 * porte, nodi e ritocchi delle mappe); testa e «nascondi» restano agli apparati e host.
 */
const NODE_ANY = z.string({ error: "Nodo non valido" }).regex(/^(dev|host|vm):\d+(:\d+)?$/, "Nodo non valido");
const MEDIUM = z.enum(["cavo", "fibra", "wireless"], { error: "Tipo non valido: «cavo», «fibra» o «wireless»" });
const NOTE = z.string({ error: "Nota non valida" }).max(500, "Nota troppo lunga (massimo 500 caratteri)");
const id = (msg: string) => z.number({ error: msg }).int({ error: msg }).positive({ error: msg });
const PORT = z.string({ error: "Porta non valida" }).max(100, "Porta troppo lunga (massimo 100 caratteri)");

function first(e: z.ZodError): string {
  return e.issues[0]?.message ?? "Dati non validi";
}

const linkSchema = z.object(
  {
    action: z.enum(["add", "ignore"], { error: "Azione non valida: «add» o «ignore»" }),
    a_node: NODE_ANY,
    a_port: PORT.optional().default(""),
    b_node: NODE_ANY,
    b_port: PORT.optional().default(""),
    medium: MEDIUM.nullish().transform((v) => v ?? null),
    note: NOTE.nullish().transform((v) => v ?? null),
  },
  BODY,
);

export function parseLinkOverrideBody(raw: unknown): Parsed<z.infer<typeof linkSchema>> {
  const r = linkSchema.safeParse(raw);
  if (!r.success) return { ok: false, error: first(r.error) };
  if (r.data.a_node === r.data.b_node) return { ok: false, error: "Un collegamento unisce due nodi diversi" };
  if (r.data.action === "ignore" && r.data.medium !== null) {
    return { ok: false, error: "Il tipo (cavo, fibra, wireless) si indica solo per un collegamento aggiunto a mano" };
  }
  return { ok: true, data: r.data };
}

const linkPatchSchema = z.object(
  { a_port: PORT.optional(), b_port: PORT.optional(), medium: MEDIUM.nullable().optional(), note: NOTE.nullable().optional() },
  BODY,
);

export type LinkPatch = { a_port?: string; b_port?: string; medium?: "cavo" | "fibra" | "wireless" | null; note?: string | null };

/** PATCH /api/topology/links/[id]: cambiano solo i campi presenti; `medium`/`note` null = tolti. */
export function parseLinkPatchBody(raw: unknown): Parsed<LinkPatch> {
  const r = linkPatchSchema.safeParse(raw);
  if (!r.success) return { ok: false, error: first(r.error) };
  const data: LinkPatch = {};
  if (r.data.a_port !== undefined) data.a_port = r.data.a_port;
  if (r.data.b_port !== undefined) data.b_port = r.data.b_port;
  if (r.data.medium !== undefined) data.medium = r.data.medium;
  if (r.data.note !== undefined) data.note = r.data.note;
  return Object.keys(data).length > 0 ? { ok: true, data } : { ok: false, error: "Niente da modificare: servono le porte, il tipo o la nota" };
}

const primarySchema = z.object(
  { node_id: NODE_ANY, other_node: NODE_ANY, node_port: PORT.optional().default(""), other_port: PORT.optional().default("") },
  BODY,
);

/** PUT /api/topology/primary: per `node_id` il principale è il collegamento verso `other_node` su quelle porte. */
export function parsePrimaryBody(raw: unknown): Parsed<{ node_id: string; other_node: string; node_port: string; other_port: string }> {
  const r = primarySchema.safeParse(raw);
  if (!r.success) return { ok: false, error: first(r.error) };
  if (r.data.node_id === r.data.other_node) return { ok: false, error: "Un collegamento unisce due nodi diversi" };
  return { ok: true, data: r.data };
}

const primaryDeleteSchema = z.object({ node_id: NODE_ANY }, BODY);

/** DELETE /api/topology/primary: toglie la scelta a mano per quell'oggetto. */
export function parsePrimaryDeleteBody(raw: unknown): Parsed<{ node_id: string }> {
  const r = primaryDeleteSchema.safeParse(raw);
  return r.success ? { ok: true, data: { node_id: r.data.node_id } } : { ok: false, error: first(r.error) };
}

/** GET /api/topology/ports?node=…: il nodo di cui si vogliono le porte note. */
export function parsePortsQuery(node: string | null): Parsed<string> {
  if (node === null || node.trim() === "") return { ok: false, error: "Manca il nodo: ?node=dev:N" };
  const r = NODE_ANY.safeParse(node.trim());
  return r.success ? { ok: true, data: r.data } : { ok: false, error: first(r.error) };
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

// ─── Mappe salvate, ritocchi, nascondi ───────────────────────────────────────

const NODES_MAX = 2000;
const NODE_LIST = (msg: string) => z.array(NODE_ANY, { error: msg }).max(NODES_MAX, `Troppi nodi in un colpo (massimo ${NODES_MAX})`);
const MAP_NAME = z
  .string({ error: "Nome della mappa non valido" })
  .trim()
  .min(1, "Il nome della mappa non può essere vuoto")
  .max(80, "Nome della mappa troppo lungo (massimo 80 caratteri)");

const mapCreateSchema = z.object(
  { name: MAP_NAME, roots: NODE_LIST("Elenco delle radici non valido").default([]), nodes: NODE_LIST("Elenco dei nodi non valido").default([]) },
  BODY,
);

export function parseMapCreateBody(raw: unknown): Parsed<{ name: string; roots: string[]; nodes: string[] }> {
  const r = mapCreateSchema.safeParse(raw);
  return r.success ? { ok: true, data: r.data } : { ok: false, error: first(r.error) };
}

const mapPatchSchema = z.object({ name: MAP_NAME.optional(), roots: NODE_LIST("Elenco delle radici non valido").optional() }, BODY);

export function parseMapPatchBody(raw: unknown): Parsed<{ name?: string; roots?: string[] }> {
  const r = mapPatchSchema.safeParse(raw);
  if (!r.success) return { ok: false, error: first(r.error) };
  const data: { name?: string; roots?: string[] } = {};
  if (r.data.name !== undefined) data.name = r.data.name;
  if (r.data.roots !== undefined) data.roots = r.data.roots;
  return Object.keys(data).length > 0 ? { ok: true, data } : { ok: false, error: "Niente da modificare: serve un nome o delle radici" };
}

const mapNodesSchema = z.object(
  { add: NODE_LIST("Elenco dei nodi da aggiungere non valido").default([]), remove: NODE_LIST("Elenco dei nodi da togliere non valido").default([]) },
  BODY,
);

export function parseMapNodesBody(raw: unknown): Parsed<{ add: string[]; remove: string[] }> {
  const r = mapNodesSchema.safeParse(raw);
  return r.success ? { ok: true, data: r.data } : { ok: false, error: first(r.error) };
}

const autoHeadSchema = z.object({ head_node: NODE.nullable() }, BODY);

export function parseAutoHeadBody(raw: unknown): Parsed<{ headNode: string | null }> {
  const r = autoHeadSchema.safeParse(raw);
  return r.success ? { ok: true, data: { headNode: r.data.head_node } } : { ok: false, error: first(r.error) };
}

const VIEW = z.string({ error: "Vista non valida" }).regex(/^(auto|mappa:\d+)$/, "Vista non valida: «auto» o «mappa:N»");
const positionsSchema = z.object(
  {
    view: VIEW,
    clear: z.boolean({ error: "«clear» non valido" }).optional(),
    tweaks: z
      .array(
        z.object({
          nodeId: NODE_ANY,
          x: z.number({ error: "Coordinata non valida" }).finite("Coordinata non valida"),
          y: z.number({ error: "Coordinata non valida" }).finite("Coordinata non valida"),
          sig: z.string({ error: "Firma non valida" }).min(1, "Firma non valida").max(200, "Firma non valida"),
        }),
        { error: "Elenco dei ritocchi non valido" },
      )
      .max(5000, "Troppi ritocchi in un colpo (massimo 5000)")
      .optional(),
    rename: z
      .array(z.object({ from: NODE_ANY, to: NODE_ANY }), { error: "Elenco delle rinomine non valido" })
      .max(NODES_MAX, `Troppe rinomine in un colpo (massimo ${NODES_MAX})`)
      .optional(),
  },
  BODY,
);

/** `rename` (revisione finale I5): id della vista da riscrivere sull'id canonico, prima del resto. */
export function parsePositionsBody(raw: unknown): Parsed<{
  view: string;
  clear: boolean;
  tweaks: Array<{ nodeId: string; x: number; y: number; sig: string }>;
  rename: Array<{ from: string; to: string }>;
}> {
  const r = positionsSchema.safeParse(raw);
  if (!r.success) return { ok: false, error: first(r.error) };
  const rename = r.data.rename ?? [];
  if (rename.some((x) => x.from === x.to)) return { ok: false, error: "Una rinomina porta un nodo su un id diverso" };
  if (r.data.clear !== true && r.data.tweaks === undefined && rename.length === 0) {
    return { ok: false, error: "Servono i ritocchi da salvare, «clear» oppure le rinomine" };
  }
  return { ok: true, data: { view: r.data.view, clear: r.data.clear === true, tweaks: r.data.clear === true ? [] : (r.data.tweaks ?? []), rename } };
}

const hiddenSchema = z.object(
  {
    node_id: z.string({ error: "Apparato non valido" }).regex(/^dev:\d+$/, "Si nascondono solo gli apparati (dev:N)"),
    hidden: z.boolean({ error: "«hidden» deve essere vero o falso" }),
  },
  BODY,
);

export function parseHiddenBody(raw: unknown): Parsed<{ deviceId: number; hidden: boolean }> {
  const r = hiddenSchema.safeParse(raw);
  return r.success ? { ok: true, data: { deviceId: Number(r.data.node_id.slice(4)), hidden: r.data.hidden } } : { ok: false, error: first(r.error) };
}
