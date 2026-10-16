/**
 * Il dialogo «Collega a…» (spec §11.3): dalle porte note (GET
 * /api/topology/ports) alle voci della scelta, e dalla scelta al corpo di
 * POST /api/topology/links (nuovo) o PATCH /api/topology/links/[id] (modifica).
 * Una porta si sceglie fra le note, si scrive a mano o si lascia «non nota».
 * Logica pura; i limiti sono quelli del parser delle rotte (100 caratteri per
 * porta, 500 per la nota).
 */
import { parseSpeedMbps } from "@/lib/topology/link-attrs";
import { poeLabel, speedLabel } from "@/lib/topology/edge-look";
import type { LinkMedium } from "@/lib/topology/model-types";
import type { KnownPort } from "@/lib/topology/api-input";

// La porta nota ha la forma della risposta di GET /api/topology/ports: si definisce una volta sola, in api-input.ts.
export type { KnownPort };

export const PORT_NONE = "__nessuna__";
export const PORT_MANUAL = "__a_mano__";
const PORT_MAX = 100;
const NOTE_MAX = 500;

/** Le voci della scelta della porta: le note in ordine naturale («Port 2» prima di «Port 10»), poi «non nota» e «a mano». */
export function portChoices(ports: readonly KnownPort[]): Array<{ value: string; label: string }> {
  const seen = new Set<string>();
  const uniq = ports.filter((p) => p.name.trim() !== "" && !seen.has(p.name) && seen.add(p.name));
  const sorted = [...uniq].sort((a, b) => Number(a.kind !== "switch_port") - Number(b.kind !== "switch_port") || a.name.localeCompare(b.name, "it", { numeric: true }));
  return [
    ...sorted.map((p) => ({
      value: p.name,
      label: [p.name, speedLabel(parseSpeedMbps(p.speed)), poeLabel(p.poeW), p.note].filter(Boolean).join(" · "),
    })),
    { value: PORT_NONE, label: "porta non nota" },
    { value: PORT_MANUAL, label: "✎ scrivi a mano…" },
  ];
}

export interface PortPick {
  /** Il nome di una porta nota, PORT_NONE o PORT_MANUAL. */
  choice: string;
  /** Il testo scritto a mano (vale solo con PORT_MANUAL). */
  text: string;
}

const MEDIA_DI_PRIMA: ReadonlyArray<{ value: LinkMedium; label: string }> = [
  { value: "cavo", label: "cavo" },
  { value: "fibra", label: "fibra" },
  { value: "wireless", label: "wireless (ponte radio, mesh)" },
];

/**
 * I tipi del dialogo. «tunnel» (T3, §13.9: le rotte lo accettano) solo con la mappa nuova accesa: spenta, il dialogo è quello
 * di prima (revisione finale di T3, I1).
 */
export function mediaDelDialogo(mappaNuova: boolean): Array<{ value: LinkMedium; label: string }> {
  return mappaNuova ? [...MEDIA_DI_PRIMA, { value: "tunnel", label: "tunnel" }] : [...MEDIA_DI_PRIMA];
}

/** La scelta iniziale per una porta già salvata (modifica) o vuota (nuovo collegamento). */
export function initialPort(ports: readonly KnownPort[], current: string): PortPick {
  if (!current.trim()) return { choice: PORT_NONE, text: "" };
  return ports.some((p) => p.name === current) ? { choice: current, text: "" } : { choice: PORT_MANUAL, text: current };
}

type Built<T> = { ok: true; body: T } | { ok: false; error: string };

function portOf(p: PortPick, which: "partenza" | "arrivo"): Built<string> {
  if (p.choice === PORT_NONE) return { ok: true, body: "" };
  const v = p.choice === PORT_MANUAL ? p.text.trim() : p.choice;
  if (!v) return { ok: false, error: `Scrivi la porta di ${which}, o scegli «porta non nota»` };
  if (v.length > PORT_MAX) return { ok: false, error: `Porta troppo lunga (massimo ${PORT_MAX} caratteri)` };
  return { ok: true, body: v };
}

function noteOf(note: string): Built<string | null> {
  const v = note.trim();
  if (v.length > NOTE_MAX) return { ok: false, error: `Nota troppo lunga (massimo ${NOTE_MAX} caratteri)` };
  return { ok: true, body: v || null };
}

export interface ManualLinkInput {
  a: string;
  b: string;
  aPort: PortPick;
  bPort: PortPick;
  medium: LinkMedium | null;
  note: string;
}

export interface ManualLinkBody {
  action: "add";
  a_node: string;
  a_port: string;
  b_node: string;
  b_port: string;
  /** null = tipo non indicato. */
  medium: LinkMedium | null;
  note: string | null;
}

export interface LinkPatchBody {
  a_port?: string;
  b_port?: string;
  medium?: LinkMedium | null;
  note?: string | null;
}

/** Corpo di POST /api/topology/links per un collegamento a mano. */
export function buildManualLink(i: ManualLinkInput): Built<ManualLinkBody> {
  if (i.a === i.b) return { ok: false, error: "Un collegamento unisce due oggetti diversi" };
  const ap = portOf(i.aPort, "partenza");
  if (!ap.ok) return ap;
  const bp = portOf(i.bPort, "arrivo");
  if (!bp.ok) return bp;
  const note = noteOf(i.note);
  if (!note.ok) return note;
  return { ok: true, body: { action: "add", a_node: i.a, a_port: ap.body, b_node: i.b, b_port: bp.body, medium: i.medium, note: note.body } };
}

/** Corpo di PATCH /api/topology/links/[id]: porte, tipo e nota. */
export function buildLinkPatch(i: Omit<ManualLinkInput, "a" | "b">): Built<LinkPatchBody> {
  const ap = portOf(i.aPort, "partenza");
  if (!ap.ok) return ap;
  const bp = portOf(i.bPort, "arrivo");
  if (!bp.ok) return bp;
  const note = noteOf(i.note);
  if (!note.ok) return note;
  return { ok: true, body: { a_port: ap.body, b_port: bp.body, medium: i.medium, note: note.body } };
}
