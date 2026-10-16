/**
 * Validazione dei corpi delle rotte /api/topology, /api/locations/:id/topology
 * e /api/devices/:id/location, e forma delle loro risposte. Queste rotte
 * scrivono dati del cliente su conferma di un admin: niente passa senza schema.
 */
import { z } from "zod";
import { LINK_STALE_DAYS_MAX, LINK_STALE_DAYS_MIN } from "@/lib/topology/settings";
import { SEGMENTO_NON_COLLEGABILE, VM_NON_COLLEGABILE } from "@/lib/topology/vm-nodes";
import type { LinkMedium, MapOrientation } from "@/lib/topology/model-types";
import { MAX_MEMBRI_UNIONE, TESTI_UNIONI, type CorpoSeparazione, type CorpoUnione } from "@/lib/topology/unioni-tipi";

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
/**
 * Per gli schemi stretti (`.strict()`): lo stesso messaggio di BODY e, per un campo che lo schema non conosce, il suo nome. Senza,
 * «medio» al posto di «medium» passava e il collegamento si salvava senza tipo, in silenzio (revisione finale di T3, M9).
 */
const BODY_STRETTO = {
  error: (iss: z.core.$ZodRawIssue): string =>
    iss.code === "unrecognized_keys" ? `Campo non previsto: ${(iss as { keys: readonly string[] }).keys.map((k) => `«${k}»`).join(", ")}` : BODY.error,
};
const NODE = z.string({ error: "Nodo non valido" }).regex(/^(dev|host):\d+$/, "Nodo non valido");
/**
 * L'id di un segmento (T3, spec §13.7.3): «seg:<id apparato>:<indice>» oppure «seg:<id apparato>:n-<nome codificato con
 * encodeURIComponent>», come lo scrive il modello per cavo (`cavi/collegamenti.ts`). Un solo «:» dopo l'apparato, mai «|»:
 * la classe dei caratteri è quella che `encodeURIComponent` lascia, più «%».
 */
export const ID_SEGMENTO = /^seg:\d+:(\d+|n-[A-Za-z0-9\-_.!~*'()%]{1,90})$/;
/**
 * Un nodo che può essere anche una VM (`vm:<apparato>:<vmid>`, fase 2b) o, da T3, un segmento (`seg:…`, §13.7.3).
 * Vale dove un oggetto della mappa può essere una VM o un segmento (porte, nodi, partenze e ritocchi delle mappe,
 * togliere una scelta del principale); per collegamenti e principale le VM no (LINK_NODE); testa e «nascondi» restano
 * agli apparati e host. 120 caratteri al massimo: un id più lungo non lo scrive nessuno.
 */
const NODE_ANY = z.string({ error: "Nodo non valido" }).max(120, "Nodo non valido")
  .refine((v) => /^(dev|host|vm):\d+(:\d+)?$/.test(v) || ID_SEGMENTO.test(v), "Nodo non valido");
/**
 * Revisione finale I-1: nel modello una VM non censita non è un capo di collegamento (`buildLinks` non
 * la trova), quindi un collegamento a mano o un principale verso di lei si salverebbe e non comparirebbe
 * mai. Si rifiuta in parole; le mappe passo passo continuano ad accettarla (NODE_ANY).
 * Un segmento invece passa: si ignora un'appartenenza e si sceglie la ★ (§13.7.3); «add» verso un segmento lo rifiuta
 * lo schema dei collegamenti, con SEGMENTO_NON_COLLEGABILE.
 */
export { SEGMENTO_NON_COLLEGABILE, VM_NON_COLLEGABILE };
const LINK_NODE = NODE_ANY.refine((v) => !v.startsWith("vm:"), { message: VM_NON_COLLEGABILE });
// «tunnel» da T3 (§13.9): `medium` non ha CHECK nel DB, lo valida questo schema.
const MEDIUM = z.enum(["cavo", "fibra", "wireless", "tunnel"], { error: "Tipo non valido: «cavo», «fibra», «wireless» o «tunnel»" });
const NOTE = z.string({ error: "Nota non valida" }).max(500, "Nota troppo lunga (massimo 500 caratteri)");
const id = (msg: string) => z.number({ error: msg }).int({ error: msg }).positive({ error: msg });
const PORT = z.string({ error: "Porta non valida" }).max(100, "Porta troppo lunga (massimo 100 caratteri)");

function first(e: z.ZodError): string {
  return e.issues[0]?.message ?? "Dati non validi";
}

const linkSchema = z.object(
  {
    action: z.enum(["add", "ignore"], { error: "Azione non valida: «add» o «ignore»" }),
    a_node: LINK_NODE,
    a_port: PORT.optional().default(""),
    b_node: LINK_NODE,
    b_port: PORT.optional().default(""),
    medium: MEDIUM.nullish().transform((v) => v ?? null),
    note: NOTE.nullish().transform((v) => v ?? null),
  },
  BODY_STRETTO,
).strict().superRefine((v, ctx) => {
  // Un segmento non si collega a mano (§13.7.3): «ignore» di un'appartenenza sì, «add» no. L'errore sul capo che è il segmento.
  if (v.action !== "add") return;
  const capo = v.a_node.startsWith("seg:") ? "a_node" : v.b_node.startsWith("seg:") ? "b_node" : null;
  if (capo !== null) ctx.addIssue({ code: "custom", message: SEGMENTO_NON_COLLEGABILE, path: [capo] });
});

export function parseLinkOverrideBody(raw: unknown): Parsed<z.infer<typeof linkSchema>> {
  const r = linkSchema.safeParse(raw);
  if (!r.success) return { ok: false, error: first(r.error) };
  if (r.data.a_node === r.data.b_node) return { ok: false, error: "Un collegamento unisce due nodi diversi" };
  if (r.data.action === "ignore" && r.data.medium !== null) {
    return { ok: false, error: "Il tipo (cavo, fibra, wireless o tunnel) si indica solo per un collegamento aggiunto a mano" };
  }
  return { ok: true, data: r.data };
}

const linkPatchSchema = z.object(
  { a_port: PORT.optional(), b_port: PORT.optional(), medium: MEDIUM.nullable().optional(), note: NOTE.nullable().optional() },
  BODY_STRETTO,
).strict();

export type LinkPatch = { a_port?: string; b_port?: string; medium?: LinkMedium | null; note?: string | null };

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
  { node_id: LINK_NODE, other_node: LINK_NODE, node_port: PORT.optional().default(""), other_port: PORT.optional().default("") },
  BODY_STRETTO,
).strict();

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

/**
 * GET /api/topology/candidati?nodo=… (T3, «Candidati per porta», spec §13.4.6): un nodo solo, nella forma delle mappe (anche un
 * segmento), e nessun altro parametro (Zod strict: l'errore dell'oggetto vale anche per un parametro in più, in italiano).
 */
const candidatiQuerySchema = z.object({ nodo: NODE_ANY }, { error: "Richiesta non valida" }).strict();

export function parseCandidatiQuery(params: URLSearchParams): Parsed<string> {
  const chiavi = [...params.keys()];
  if (!chiavi.includes("nodo")) return { ok: false, error: "Manca il nodo: ?nodo=dev:N" };
  if (chiavi.filter((k) => k === "nodo").length > 1) return { ok: false, error: "Il nodo si indica una volta sola" };
  const r = candidatiQuerySchema.safeParse(Object.fromEntries([...params].map(([k, v]) => [k, k === "nodo" ? v.trim() : v])));
  return r.success ? { ok: true, data: r.data.nodo } : { ok: false, error: first(r.error) };
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

// ─── Orientamento (spec §12.2): «Verticale» = lr, «Orizzontale» = tb ───
const ORIENTATION_MSG = "Orientamento non valido: si sceglie fra verticale e orizzontale";
const ORIENTATION = z.enum(["lr", "tb"], { error: ORIENTATION_MSG });

/** Il corpo di un PATCH /api/topology/maps/[id] chiede di cambiare l'orientamento (la chiave c'è: il resto lo dice il parser). */
export function asksOrientation(raw: unknown): boolean {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw) && "orientation" in raw;
}

/** PATCH /api/topology/maps/[id] (anche `auto`): `{ orientation: "lr" | "tb" }`, da solo. */
export function parseMapOrientationBody(raw: unknown): Parsed<{ orientation: MapOrientation }> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, error: BODY.error };
  if (Object.keys(raw).some((k) => k !== "orientation")) return { ok: false, error: "L'orientamento si cambia da solo, senza altri campi" };
  const r = ORIENTATION.safeParse((raw as { orientation?: unknown }).orientation);
  return r.success ? { ok: true, data: { orientation: r.data } } : { ok: false, error: ORIENTATION_MSG };
}

const VIEW = z.string({ error: "Vista non valida" }).regex(/^(auto|mappa:\d+)$/, "Vista non valida: «auto» o «mappa:N»");
const positionsSchema = z.object(
  {
    view: VIEW,
    clear: z.boolean({ error: "«clear» non valido" }).optional(),
    orientation: ORIENTATION.optional(),
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

/**
 * `rename` (revisione finale I5): id della vista da riscrivere sull'id canonico, prima del resto.
 * `orientation` (spec §12.2): l'orientamento in cui sono fatti i ritocchi, obbligatorio per
 * salvarli (un ritocco senza orientamento finirebbe nell'altro disegno); con «clear» limita il
 * riordino a quell'orientamento; senza, il riordino toglie tutti i ritocchi.
 */
export function parsePositionsBody(raw: unknown): Parsed<{
  view: string;
  clear: boolean;
  tweaks: Array<{ nodeId: string; x: number; y: number; sig: string }>;
  rename: Array<{ from: string; to: string }>;
  orientation: MapOrientation | null;
}> {
  const r = positionsSchema.safeParse(raw);
  if (!r.success) return { ok: false, error: first(r.error) };
  const rename = r.data.rename ?? [];
  if (rename.some((x) => x.from === x.to)) return { ok: false, error: "Una rinomina porta un nodo su un id diverso" };
  if (r.data.clear !== true && r.data.tweaks === undefined && rename.length === 0) {
    return { ok: false, error: "Servono i ritocchi da salvare, «clear» oppure le rinomine" };
  }
  const clear = r.data.clear === true;
  const tweaks = clear ? [] : (r.data.tweaks ?? []);
  const orientation = r.data.orientation ?? null;
  if (tweaks.length > 0 && orientation === null) {
    return { ok: false, error: "Manca l'orientamento dei ritocchi: si sceglie fra verticale e orizzontale" };
  }
  return { ok: true, data: { view: r.data.view, clear, tweaks, rename, orientation } };
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

const roleSchema = z.object(
  {
    node_id: z.string({ error: "Apparato non valido" })
      .regex(/^dev:\d+$/, "Il ruolo nella mappa si sceglie solo per un apparato: un host prima si promuove ad apparato"),
    // Da T3 anche «core» e «accesso» (spec §13.9): li legge il modello per cavo; quello di T1 li legge «rete» (ruoloLetto).
    role: z.enum(["", "rete", "attaccato", "core", "accesso"], {
      error: "Ruolo non valido: «» (decide il sistema), «rete», «attaccato», «core» o «accesso»",
    }),
  },
  BODY_STRETTO,
).strict();

export function parseNodeRoleBody(raw: unknown): Parsed<{ deviceId: number; role: "" | "rete" | "attaccato" | "core" | "accesso" }> {
  const r = roleSchema.safeParse(raw);
  return r.success ? { ok: true, data: { deviceId: Number(r.data.node_id.slice(4)), role: r.data.role } } : { ok: false, error: first(r.error) };
}

// ═══════════════════════════════════════════════════════════════════════════
// Unioni e separazioni a mano (piano 2026-10-16, Task 3; ADR 0021): /api/topology/unioni e /api/topology/unioni/separa.
// Scrivono il DB del cliente: corpi stretti, `applica` sempre detto (false = anteprima, non scrive), 2-20 oggetti distinti. Un
// oggetto è un apparato o un host della mappa («dev:N», «host:N»): VM e segmenti non si uniscono.
// ═══════════════════════════════════════════════════════════════════════════

const MEMBRO = z.string({ error: "Oggetto non valido" }).regex(/^(dev|host):[1-9]\d{0,9}$/, "Oggetto non valido: «host:N» o «dev:N»");
const INDIRIZZO = z.string({ error: "Si separa un indirizzo: «host:N»" }).regex(/^host:[1-9]\d{0,9}$/, "Si separa un indirizzo: «host:N»");
const APPLICA = z.boolean({ error: "«applica» deve essere vero o falso" });

const unioneSchema = z.object(
  {
    membri: z.array(MEMBRO, { error: "Elenco degli oggetti non valido" })
      .min(2, "Servono almeno due oggetti").max(MAX_MEMBRI_UNIONE, `Al massimo ${MAX_MEMBRI_UNIONE} oggetti alla volta`),
    applica: APPLICA,
  },
  BODY_STRETTO,
).strict();

/** POST /api/topology/unioni: gli oggetti da far diventare uno sulla mappa; `applica: false` è l'anteprima. */
export function parseUnioneBody(raw: unknown): Parsed<CorpoUnione> {
  const r = unioneSchema.safeParse(raw);
  if (!r.success) return { ok: false, error: first(r.error) };
  if (new Set(r.data.membri).size !== r.data.membri.length) return { ok: false, error: TESTI_UNIONI.doppio };
  return { ok: true, data: { membri: r.data.membri, applica: r.data.applica } };
}

const separaSchema = z.object({ nodo: MEMBRO, membro: INDIRIZZO, applica: APPLICA }, BODY_STRETTO).strict();

/** POST /api/topology/unioni/separa: l'indirizzo che esce dall'oggetto `nodo` della mappa; `applica: false` è l'anteprima. */
export function parseSeparaBody(raw: unknown): Parsed<CorpoSeparazione> {
  const r = separaSchema.safeParse(raw);
  return r.success ? { ok: true, data: { nodo: r.data.nodo, membro: r.data.membro, applica: r.data.applica } } : { ok: false, error: first(r.error) };
}

/** GET /api/topology/unioni?oggetto=… e …/candidati?da=…: un oggetto della mappa, «host:N» o «dev:N». */
export function parseOggettoParam(v: string | null): Parsed<string> {
  if (v === null || v.trim() === "") return { ok: false, error: "Manca l'oggetto: «host:N» o «dev:N»" };
  const r = MEMBRO.safeParse(v.trim());
  return r.success ? { ok: true, data: r.data } : { ok: false, error: first(r.error) };
}

const RICERCA_MAX = 100;

/** GET /api/topology/unioni/candidati?q=…: il testo cercato (vuoto = niente), al massimo 100 caratteri. */
export function parseRicercaParam(v: string | null): Parsed<string> {
  const s = (v ?? "").trim();
  return s.length > RICERCA_MAX ? { ok: false, error: `Ricerca troppo lunga (massimo ${RICERCA_MAX} caratteri)` } : { ok: true, data: s };
}
